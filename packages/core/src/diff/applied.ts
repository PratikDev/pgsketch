import type { SchemaModel } from '../model/types';
import { renderPgType } from '../sql/pgtype';

/** Display names only, never SQL, so nothing here may throw on a half-edited model. */
const named = (...parts: string[]): string =>
  parts.map((part) => JSON.stringify(part)).join('.');

/** Every comparable object of a model: what to call it, and everything about it but its id. */
type Facts = Map<string, unknown>;

/**
 * The model with ids taken out: each object is named by its schema, table and own name, so two
 * models of the same database match even when their ids differ. Columns are listed in table order
 * but not by position number, because Postgres keeps gaps where columns were dropped. Unmodeled
 * objects are left out: the user can't edit them.
 */
function factsOf(model: SchemaModel): Facts {
  const facts: Facts = new Map();
  const schema = (id: string) => model.schemas[id]?.name ?? id;
  const tableName = (id: string) => {
    const table = model.tables[id];
    return table ? named(schema(table.schemaId), table.name) : id;
  };
  const columnNames = (ids: string[]) =>
    ids.map((id) => model.columns[id]?.name ?? id);

  for (const s of Object.values(model.schemas))
    facts.set(`schema ${named(s.name)}`, true);
  for (const e of Object.values(model.enums))
    facts.set(`enum ${named(schema(e.schemaId), e.name)}`, e.labels);
  for (const t of Object.values(model.tables)) {
    const columns = Object.values(model.columns)
      .filter((c) => c.tableId === t.id)
      .sort((a, b) => a.position - b.position);
    const name = tableName(t.id);
    facts.set(`table ${name}`, { comment: t.comment, readOnly: t.readOnly });
    facts.set(
      `column order of ${name}`,
      columns.map((c) => c.name),
    );
    for (const c of columns) {
      facts.set(`column ${name}.${named(c.name)}`, {
        type: renderPgType(c.type),
        notNull: c.notNull,
        default: c.default?.expression ?? null,
        identity: c.identity,
        comment: c.comment,
        readOnly: c.readOnly,
      });
    }
  }
  for (const k of Object.values(model.constraints)) {
    facts.set(`constraint ${tableName(k.tableId)}.${named(k.name)}`, {
      kind: k.kind,
      columns: columnNames(k.columnIds),
      readOnly: k.readOnly,
      definition: k.definition,
      ...(k.kind === 'check' && { expression: k.expression }),
      ...(k.kind === 'fk' && {
        references: tableName(k.refTableId),
        referencedColumns: columnNames(k.refColumnIds),
        onDelete: k.onDelete,
        onUpdate: k.onUpdate,
      }),
    });
  }
  for (const i of Object.values(model.indexes)) {
    const table = model.tables[i.tableId];
    facts.set(`index ${named(schema(table?.schemaId ?? ''), i.name)}`, {
      table: tableName(i.tableId),
      unique: i.unique,
      columns: columnNames(i.columnIds),
      readOnly: i.readOnly,
      definition: i.definition,
    });
  }
  return facts;
}

// JSON drops `undefined` fields, so "no read-only reason" and "key left out" are the same
const show = (value: unknown): string => JSON.stringify(value);

/**
 * The first object where `actual` and `expected` differ by qualified name and definition, as a
 * sentence, or `null` when they are the same schema. Objects are compared in the order of
 * `expected` (schemas, enums, tables with their columns, constraints, indexes), then anything
 * extra in `actual`.
 */
export function firstDifference(
  actual: SchemaModel,
  expected: SchemaModel,
): string | null {
  const have = factsOf(actual);
  const want = factsOf(expected);
  for (const [key, definition] of want) {
    if (!have.has(key)) return `Missing ${key}`;
    if (show(have.get(key)) !== show(definition))
      return `Different ${key}: expected ${show(definition)}, found ${show(have.get(key))}`;
  }
  for (const key of have.keys()) if (!want.has(key)) return `Unexpected ${key}`;
  return null;
}

/** Whether the database now matches the edited model: what "Changes applied" depends on. */
export const matchesByName = (
  actual: SchemaModel,
  expected: SchemaModel,
): boolean => firstDifference(actual, expected) === null;
