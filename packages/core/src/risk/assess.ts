import type { ChangeOp } from '../diff/ops';
import type { Constraint, Id, SchemaModel } from '../model/types';
import { renderPgType } from '../sql/pgtype';
import { classifyTypeChange, typeChangeRewritesTable } from './type-changes';

export type RiskLevel = 'destructive' | 'may-fail' | 'breaks-app' | 'locks';

export interface Risk {
  level: RiskLevel;
  message: string;
}

/** How each level is written in the UI and in the migration's warnings. */
export const RISK_LABELS: Record<RiskLevel, string> = {
  destructive: 'destructive',
  'may-fail': 'may fail',
  'breaks-app': 'breaks app code',
  locks: 'locks or slow',
};

const risk = (level: RiskLevel, message: string): Risk => ({ level, message });

/** Never throws: this runs on every edit, including while the model is half-edited and invalid. */
const typeName = (type: Parameters<typeof renderPgType>[0]) => {
  try {
    return renderPgType(type);
  } catch {
    return type.name;
  }
};

const quote = (name: string) => `"${name}"`;

type Kind = ChangeOp['kind'];
type ConstraintKind = Constraint['kind'];
// not `Extract`: setNotNull and dropNotNull share one union member, which `Extract` would drop
type OpOf<K extends Kind> = ChangeOp extends infer O
  ? O extends { kind: infer OK }
    ? [K] extends [OK]
      ? O
      : never
    : never
  : never;

/** The loaded schema, as the names a message uses. Ids stand in for anything not in it. */
interface Names {
  table: (id: Id) => string;
  column: (id: Id) => string;
  /** A table created in this same migration is empty, so adding to it is safe. */
  existingTable: (id: Id) => boolean;
}

function namesIn(baseline: SchemaModel): Names {
  const table = (id: Id) => {
    const t = baseline.tables[id];
    const schema = t && baseline.schemas[t.schemaId];
    return t && schema ? `${quote(schema.name)}.${quote(t.name)}` : id;
  };
  return {
    table,
    column: (id) => {
      const c = baseline.columns[id];
      return c ? `${table(c.tableId)}.${quote(c.name)}` : id;
    },
    existingTable: (id) => baseline.tables[id] !== undefined,
  };
}

const NONE = (): Risk[] => [];

/** A read-only object only goes when its own table or column does, and pgsketch can't recreate it. */
const dropsUnrecreatable = (
  name: string,
  readOnly: string | undefined,
): Risk[] =>
  readOnly
    ? [risk('destructive', `Drops "${name}", which pgsketch can't recreate`)]
    : [];

const CONSTRAINT_FAILS: Record<ConstraintKind, string> = {
  pk: 'values are missing or duplicated',
  unique: 'there are duplicate values',
  check: 'any row breaks the check',
  fk: 'any row points at a row that does not exist',
  exclusion: 'any rows conflict',
};

const CONSTRAINT_LABELS: Record<ConstraintKind, string> = {
  pk: 'primary key',
  unique: 'unique',
  check: 'check',
  fk: 'foreign key',
  exclusion: 'exclusion',
};

/** One rule per operation kind; the compiler rejects a missing kind or a rule for the wrong op. */
type Rules = { [K in Kind]: (op: OpOf<K>, names: Names) => Risk[] };

const RULES: Rules = {
  createSchema: NONE,
  createTable: NONE,
  dropNotNull: NONE,
  setDefault: NONE,
  dropDefault: NONE,
  renameConstraint: NONE,
  renameIndex: NONE,
  setComment: NONE,
  dropTable: (op, { table }) => [
    risk('destructive', `Drops table ${table(op.table.id)} and all its data`),
  ],
  dropColumn: (op, { column }) => [
    risk(
      'destructive',
      `Drops column ${column(op.column.id)} and the data in it`,
    ),
  ],
  renameTable: (op) => [
    risk(
      'breaks-app',
      `Renaming table ${quote(op.from)} to ${quote(op.to)} breaks code that still uses the old name`,
    ),
  ],
  renameColumn: (op) => [
    risk(
      'breaks-app',
      `Renaming column ${quote(op.from)} to ${quote(op.to)} breaks code that still uses the old name`,
    ),
  ],
  addColumn: ({ column: c }, { table }) =>
    !c.notNull || c.default || c.identity
      ? []
      : [
          risk(
            'may-fail',
            `Adding NOT NULL column ${quote(c.name)} with no default fails if ${table(c.tableId)} already has rows`,
          ),
        ],
  alterColumnType: (op, { column }) => {
    const change = `${column(op.columnId)} from ${typeName(op.from)} to ${typeName(op.to)}`;
    const found: Risk[] = [];
    const kind = classifyTypeChange(op.from, op.to);
    if (kind === 'lossy')
      found.push(
        risk(
          'destructive',
          `Changing ${change} can round or cut the stored values`,
        ),
      );
    if (kind === 'may-fail')
      found.push(
        risk('may-fail', `Changing ${change} may fail, depending on the data`),
      );
    if (typeChangeRewritesTable(op.from, op.to)) {
      found.push(
        risk(
          'locks',
          `Changing ${change} rewrites or scans the whole table while holding a lock`,
        ),
      );
    }
    return found;
  },
  setNotNull: (op, { column }) => [
    risk(
      'may-fail',
      `Setting NOT NULL on ${column(op.columnId)} fails if any row has no value there`,
    ),
    risk(
      'locks',
      `Setting NOT NULL on ${column(op.columnId)} scans the whole table while holding a lock`,
    ),
  ],
  addConstraint: ({ constraint: c }, { table, existingTable }) =>
    !existingTable(c.tableId)
      ? []
      : [
          risk(
            'may-fail',
            `Adding ${CONSTRAINT_LABELS[c.kind]} constraint "${c.name}" fails if ${CONSTRAINT_FAILS[c.kind]}`,
          ),
          risk(
            'locks',
            `Adding constraint "${c.name}" scans ${table(c.tableId)} while holding a lock`,
          ),
        ],
  addIndex: ({ index }, { table, existingTable }) =>
    !existingTable(index.tableId)
      ? []
      : [
          ...(index.unique
            ? [
                risk(
                  'may-fail',
                  `Creating unique index "${index.name}" fails if there are duplicate values`,
                ),
              ]
            : []),
          risk(
            'locks',
            `Creating index "${index.name}" blocks writes to ${table(index.tableId)} until it finishes`,
          ),
        ],
  dropConstraint: ({ constraint: c }) => dropsUnrecreatable(c.name, c.readOnly),
  dropIndex: ({ index }) => dropsUnrecreatable(index.name, index.readOnly),
};

/**
 * What could go wrong when this operation runs on the database as it was loaded. An operation
 * can carry several risks (setting NOT NULL may fail and also scans the table) or none. Names in
 * the messages are the loaded schema's, and a table created in this same migration is empty, so
 * adding to it is safe.
 */
export function assessRisk(op: ChangeOp, baseline: SchemaModel): Risk[] {
  // the cast is the one place the compiler can't follow: `op.kind` picks the rule that takes this op
  const rule = RULES[op.kind] as (op: ChangeOp, names: Names) => Risk[];
  return rule(op, namesIn(baseline));
}
