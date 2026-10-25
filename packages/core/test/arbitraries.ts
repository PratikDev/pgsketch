import fc from 'fast-check';
import { assignNames } from '../src/model/naming';
import type { Column, SchemaModel, Table } from '../src/model/types';
import { validateModel } from '../src/model/validate';
import { renderPgType, samePgType } from '../src/sql/pgtype';
import { quoteIdent } from '../src/sql/quote';
import { applyEdit, type Edit } from './edits';

// Plain, odd and reserved names, so quoting and Postgres's own naming get exercised too.
const NAMES = [
  'alpha',
  'beta',
  'gamma',
  'delta',
  'select',
  'Mixed Case',
  'with space',
];
const COLUMN_NAMES = ['id', 'a', 'b', 'c', 'name', 'status', ...NAMES];

/** Types that can be changed into each other with `USING`; the lone ones are only ever added. */
const CONVERTIBLE_TYPES = [
  'smallint',
  'integer',
  'bigint',
  'numeric(10,2)',
  'numeric(12,4)',
  'text',
  'varchar(20)',
  'varchar(40)',
];
const TIME_TYPES = ['timestamptz', 'date'];
const TYPE_GROUPS = [CONVERTIBLE_TYPES, TIME_TYPES, ['boolean']];
const ALL_TYPES = TYPE_GROUPS.flat();
const INTEGER_TYPES = ['smallint', 'integer', 'bigint'];
const NUMBER_TYPES = [...INTEGER_TYPES, 'numeric(10,2)', 'numeric(12,4)'];

/** A default in the form Postgres prints it back, or none for a type that has no simple one. */
export function defaultFor(type: string): string | undefined {
  if (type === 'boolean') return 'true';
  if (type === 'text') return "'abc'::text";
  if (type.startsWith('varchar')) return "'abc'::character varying";
  if (type === 'timestamptz') return 'now()';
  if (type === 'date') return 'CURRENT_DATE';
  return '42';
}

// ---- the starting schema, as SQL ----

interface ColumnDraft {
  name: string;
  type: string;
  notNull: boolean;
  hasDefault: boolean;
  identity: 'always' | 'byDefault' | null;
}

interface TableDraft {
  name: string;
  columns: ColumnDraft[];
  /** The first column is the primary key. */
  pk: boolean;
  unique: number | null;
  index: { column: number; unique: boolean } | null;
  /** A foreign key from this column to the primary key of an earlier table. */
  fk: { column: number; table: number } | null;
}

export interface SchemaDraft {
  tables: TableDraft[];
}

const columnDraft = fc.record({
  name: fc.constantFrom(...COLUMN_NAMES),
  type: fc.constantFrom(...ALL_TYPES),
  notNull: fc.boolean(),
  hasDefault: fc.boolean(),
  identity: fc.constantFrom(null, 'always', 'byDefault'),
});

const tableDraft = fc.record({
  name: fc.constantFrom('users', 'orders', 'items', 'tags', ...NAMES),
  columns: fc.uniqueArray(columnDraft, {
    selector: (c) => c.name,
    minLength: 1,
    maxLength: 5,
  }),
  pk: fc.boolean(),
  unique: fc.option(fc.nat(4), { nil: null }),
  index: fc.option(fc.record({ column: fc.nat(4), unique: fc.boolean() }), {
    nil: null,
  }),
  fk: fc.option(fc.record({ column: fc.nat(4), table: fc.nat(3) }), {
    nil: null,
  }),
});

/** One to four tables in `app`; every table's name and every column's name is different. */
export const schemaDraftArb: fc.Arbitrary<SchemaDraft> = fc.record({
  tables: fc.uniqueArray(tableDraft, {
    selector: (t) => t.name,
    minLength: 1,
    maxLength: 4,
  }),
});

const columnSql = (c: ColumnDraft, isKey: boolean): string => {
  const identity = INTEGER_TYPES.includes(c.type) ? c.identity : null;
  return [
    quoteIdent(c.name),
    c.type,
    identity &&
      `GENERATED ${identity === 'always' ? 'ALWAYS' : 'BY DEFAULT'} AS IDENTITY`,
    (c.notNull || isKey || identity) && 'NOT NULL',
    c.hasDefault && !identity && defaultFor(c.type)
      ? `DEFAULT ${defaultFor(c.type)}`
      : false,
  ]
    .filter(Boolean)
    .join(' ');
};

/** The SQL that creates the drafted schema: `app` and its tables, keys, indexes and foreign keys. */
export function schemaSql({ tables }: SchemaDraft): string {
  const statements = ['CREATE SCHEMA app'];
  tables.forEach((t, i) => {
    // a foreign key column (never the first) takes the type of the key it points at, and can't be identity
    const target = t.fk && i > 0 ? tables[t.fk.table % i] : undefined;
    const fkColumn = t.fk && target?.pk ? t.fk.column % t.columns.length : 0;
    const columns = t.columns.map((c, n) =>
      n === fkColumn && n > 0
        ? { ...c, type: target!.columns[0]!.type, identity: null }
        : c,
    );
    const lines = columns.map((c, n) => columnSql(c, t.pk && n === 0));
    if (t.pk) lines.push(`PRIMARY KEY (${quoteIdent(columns[0]!.name)})`);
    if (t.unique !== null)
      lines.push(
        `UNIQUE (${quoteIdent(columns[t.unique % columns.length]!.name)})`,
      );
    if (fkColumn > 0) {
      lines.push(
        `FOREIGN KEY (${quoteIdent(columns[fkColumn]!.name)}) REFERENCES app.${quoteIdent(target!.name)} (${quoteIdent(target!.columns[0]!.name)})`,
      );
    }
    statements.push(
      `CREATE TABLE app.${quoteIdent(t.name)} (${lines.join(', ')})`,
    );
    if (t.index) {
      const column = columns[t.index.column % columns.length]!;
      statements.push(
        `CREATE ${t.index.unique ? 'UNIQUE ' : ''}INDEX ON app.${quoteIdent(t.name)} (${quoteIdent(column.name)})`,
      );
    }
  });
  return statements.join(';\n');
}

// ---- edits, chosen against whatever the model looks like when they are applied ----

type EditKind = Edit['kind'];

/**
 * An edit that doesn't name its target: the numbers in `picks` choose among whatever exists when
 * the edit is applied, so any list of intents can be applied to any schema, and shrinks well.
 */
export interface EditIntent {
  kind: EditKind;
  picks: [number, number, number];
  name: string;
  type: string;
  flag: boolean;
}

/** `baseline` is the schema before any edit, for names that a rename must not take over. */
type Resolver = (
  model: SchemaModel,
  intent: EditIntent,
  baseline: SchemaModel,
) => Edit | null;

const pickFrom = <T>(items: T[], n: number): T | undefined =>
  items.length === 0 ? undefined : items[n % items.length];

const tableRef = (model: SchemaModel, table: Table) =>
  `${model.schemas[table.schemaId]!.name}.${table.name}`;

const tablesOf = (model: SchemaModel): Table[] =>
  Object.values(model.tables).sort((a, b) =>
    tableRef(model, a) < tableRef(model, b) ? -1 : 1,
  );

const columnsIn = (model: SchemaModel, table: Table): Column[] =>
  Object.values(model.columns)
    .filter((c) => c.tableId === table.id)
    .sort((a, b) => a.position - b.position);

const typeOf = (column: Column) => renderPgType(column.type);

/** A table with a column in it, chosen by the intent. */
function pickColumn(
  model: SchemaModel,
  intent: EditIntent,
  accept: (column: Column) => boolean = () => true,
): { table: Table; column: Column; ref: string } | undefined {
  const columns = tablesOf(model).flatMap((table) =>
    columnsIn(model, table)
      .filter(accept)
      .map((column) => ({ table, column, ref: tableRef(model, table) })),
  );
  return pickFrom(columns, intent.picks[0]);
}

/**
 * Whether an object loaded with this name is still around under another one. Renaming something
 * to such a name needs the other rename to run first, and renames run in name order, not in that
 * order, so it is left out.
 */
// shortcut: chains and swaps of names (a to b while b to c) aren't ordered, so generated renames avoid them; order renames by dependency, breaking swaps with a temporary name
const heldByRenamed = <T extends { id: string; name: string }>(
  loaded: Record<string, T>,
  edited: Record<string, T>,
  name: string,
  inScope: (object: T) => boolean = () => true,
): boolean =>
  Object.values(loaded).some(
    (o) => o.name === name && inScope(o) && edited[o.id] !== undefined,
  );

/** Existing names only: a constraint or index added by an earlier edit has none yet. */
const namedConstraints = (model: SchemaModel) =>
  Object.values(model.constraints)
    .filter((c) => !c.autoName)
    .sort((a, b) => (a.name < b.name ? -1 : 1));
const namedIndexes = (model: SchemaModel) =>
  Object.values(model.indexes)
    .filter((i) => !i.autoName)
    .sort((a, b) => (a.name < b.name ? -1 : 1));

const indexRef = (model: SchemaModel, tableId: string, name: string) =>
  `${model.schemas[model.tables[tableId]!.schemaId]!.name}.${name}`;

/** One or two distinct columns of a table, in the order the intent picks them. */
function pickColumns(model: SchemaModel, table: Table, intent: EditIntent) {
  const columns = columnsIn(model, table);
  const first = pickFrom(columns, intent.picks[1]);
  const second = pickFrom(columns, intent.picks[2]);
  return first && second && second !== first && intent.flag
    ? [first.name, second.name]
    : first
      ? [first.name]
      : [];
}

const RESOLVERS: Record<EditKind, Resolver> = {
  addSchema: (model, i) =>
    Object.values(model.schemas).some((s) => s.name === i.name)
      ? null
      : { kind: 'addSchema', name: i.name },
  addTable: (model, i) => {
    const schema = pickFrom(
      Object.values(model.schemas).sort((a, b) => (a.name < b.name ? -1 : 1)),
      i.picks[0],
    );
    const type = INTEGER_TYPES.includes(i.type) ? i.type : 'integer';
    return schema
      ? {
          kind: 'addTable',
          table: `${schema.name}.${i.name}`,
          pk: i.flag ? ['id'] : undefined,
          columns: [
            { name: 'id', type },
            { name: 'val', type: i.type },
          ],
        }
      : null;
  },
  dropTable: (model, i) => {
    const table = pickFrom(tablesOf(model), i.picks[0]);
    return table ? { kind: 'dropTable', table: tableRef(model, table) } : null;
  },
  renameTable: (model, i, baseline) => {
    const table = pickFrom(tablesOf(model), i.picks[0]);
    const taken =
      table &&
      heldByRenamed(
        baseline.tables,
        model.tables,
        i.name,
        (t) => t.schemaId === table.schemaId,
      );
    return table && !taken
      ? { kind: 'renameTable', table: tableRef(model, table), to: i.name }
      : null;
  },
  setTableComment: (model, i) => {
    const table = pickFrom(tablesOf(model), i.picks[0]);
    return table
      ? {
          kind: 'setTableComment',
          table: tableRef(model, table),
          comment: i.flag ? `About ${i.name}, it's "quoted"` : null,
        }
      : null;
  },
  addColumn: (model, i) => {
    const table = pickFrom(tablesOf(model), i.picks[0]);
    if (!table || columnsIn(model, table).some((c) => c.name === i.name))
      return null;
    return {
      kind: 'addColumn',
      table: tableRef(model, table),
      column: {
        name: i.name,
        type: i.type,
        notNull: i.flag,
        default: i.flag ? defaultFor(i.type) : undefined,
      },
    };
  },
  dropColumn: (model, i) => {
    const found = pickColumn(model, i);
    return found
      ? { kind: 'dropColumn', table: found.ref, column: found.column.name }
      : null;
  },
  renameColumn: (model, i, baseline) => {
    const found = pickColumn(model, i);
    if (
      !found ||
      columnsIn(model, found.table).some((c) => c.name === i.name) ||
      heldByRenamed(
        baseline.columns,
        model.columns,
        i.name,
        (c) => c.tableId === found.table.id,
      )
    )
      return null;
    return {
      kind: 'renameColumn',
      table: found.ref,
      column: found.column.name,
      to: i.name,
    };
  },
  setType: (model, i) => {
    const found = pickColumn(model, i, (c) => c.identity === null);
    const from = found && typeOf(found.column);
    // a default stays as written, so it has to suit the new type too: only numbers do
    const candidates = TYPE_GROUPS.find(
      (g) => from && g.includes(from),
    )?.filter(
      (t) =>
        t !== from &&
        (found?.column.default == null ||
          (NUMBER_TYPES.includes(t) && NUMBER_TYPES.includes(from!))),
    );
    const to = candidates && pickFrom(candidates, i.picks[1]);
    return found && to
      ? {
          kind: 'setType',
          table: found.ref,
          column: found.column.name,
          type: to,
        }
      : null;
  },
  setNotNull: (model, i) => {
    const found = pickColumn(model, i);
    return found
      ? {
          kind: 'setNotNull',
          table: found.ref,
          column: found.column.name,
          notNull: i.flag,
        }
      : null;
  },
  setDefault: (model, i) => {
    const found = pickColumn(model, i, (c) => c.identity === null);
    return found
      ? {
          kind: 'setDefault',
          table: found.ref,
          column: found.column.name,
          default: (i.flag && defaultFor(typeOf(found.column))) || null,
        }
      : null;
  },
  setColumnComment: (model, i) => {
    const found = pickColumn(model, i);
    return found
      ? {
          kind: 'setColumnComment',
          table: found.ref,
          column: found.column.name,
          comment: i.flag ? `About ${i.name}` : null,
        }
      : null;
  },
  addUnique: (model, i) => {
    const table = pickFrom(tablesOf(model), i.picks[0]);
    const columns = table ? pickColumns(model, table, i) : [];
    return table && columns.length > 0
      ? { kind: 'addUnique', table: tableRef(model, table), columns }
      : null;
  },
  addIndex: (model, i) => {
    const table = pickFrom(tablesOf(model), i.picks[0]);
    const columns = table ? pickColumns(model, table, i) : [];
    return table && columns.length > 0
      ? {
          kind: 'addIndex',
          table: tableRef(model, table),
          columns,
          unique: i.picks[2] % 2 === 0,
        }
      : null;
  },
  addForeignKey: (model, i) => {
    const from = pickColumn(model, i);
    if (!from) return null;
    // a key of one column, of the same type, on any table
    const keys = namedConstraints(model).filter(
      (k) =>
        (k.kind === 'pk' || k.kind === 'unique') &&
        k.columnIds.length === 1 &&
        samePgType(model.columns[k.columnIds[0]!]!.type, from.column.type),
    );
    const key = pickFrom(keys, i.picks[1]);
    const target = key && model.columns[key.columnIds[0]!];
    return key && target
      ? {
          kind: 'addForeignKey',
          table: from.ref,
          columns: [from.column.name],
          references: tableRef(model, model.tables[key.tableId]!),
          referencedColumns: [target.name],
          onDelete: i.flag ? 'cascade' : 'no action',
        }
      : null;
  },
  dropConstraint: (model, i) => {
    const constraint = pickFrom(namedConstraints(model), i.picks[0]);
    return constraint
      ? {
          kind: 'dropConstraint',
          table: tableRef(model, model.tables[constraint.tableId]!),
          name: constraint.name,
        }
      : null;
  },
  renameConstraint: (model, i, baseline) => {
    const constraint = pickFrom(namedConstraints(model), i.picks[0]);
    return constraint &&
      !heldByRenamed(baseline.constraints, model.constraints, i.name)
      ? {
          kind: 'renameConstraint',
          table: tableRef(model, model.tables[constraint.tableId]!),
          name: constraint.name,
          to: i.name,
        }
      : null;
  },
  dropIndex: (model, i) => {
    const index = pickFrom(namedIndexes(model), i.picks[0]);
    return index
      ? { kind: 'dropIndex', index: indexRef(model, index.tableId, index.name) }
      : null;
  },
  renameIndex: (model, i, baseline) => {
    const index = pickFrom(namedIndexes(model), i.picks[0]);
    return index && !heldByRenamed(baseline.indexes, model.indexes, i.name)
      ? {
          kind: 'renameIndex',
          index: indexRef(model, index.tableId, index.name),
          to: i.name,
        }
      : null;
  },
};

export const editIntentArb: fc.Arbitrary<EditIntent> = fc.record({
  kind: fc.constantFrom(...(Object.keys(RESOLVERS) as EditKind[])),
  picks: fc.tuple(fc.nat(1000), fc.nat(1000), fc.nat(1000)),
  name: fc.constantFrom(...NAMES),
  type: fc.constantFrom(...ALL_TYPES),
  flag: fc.boolean(),
});

export const editIntentsArb = fc.array(editIntentArb, {
  minLength: 1,
  maxLength: 6,
});

/**
 * Applies the intents to `model` in order. An intent with nothing to act on is skipped, and so is
 * one that would leave the model invalid, which the editor wouldn't allow either.
 */
export function applyIntents(
  model: SchemaModel,
  intents: EditIntent[],
  baseline: SchemaModel,
): void {
  for (const intent of intents) {
    const edit = RESOLVERS[intent.kind](model, intent, baseline);
    if (!edit) continue;
    const trial = structuredClone(model);
    applyEdit(trial, edit);
    if (validateModel(assignNames(trial)).length === 0)
      Object.assign(model, trial);
  }
}
