import type {
  Column,
  Constraint,
  Id,
  SchemaModel,
  UnmodeledKind,
} from './types';

/** A table's columns in table order. */
export const columnsOf = (model: SchemaModel, tableId: Id): Column[] =>
  Object.values(model.columns)
    .filter((c) => c.tableId === tableId)
    .sort((a, b) => a.position - b.position);

export const primaryKeyOf = (
  model: SchemaModel,
  tableId: Id,
): Constraint | undefined =>
  Object.values(model.constraints).find(
    (c) => c.tableId === tableId && c.kind === 'pk',
  );

/** Two lists of ids that are equal, in the same order. */
export const sameIds = (a: Id[], b: Id[]): boolean =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/** Two lists of ids with the same members, in any order. */
export const sameSet = (a: Id[], b: Id[]): boolean =>
  a.length === b.length && a.every((id) => b.includes(id));

export interface RelationEntry {
  id: Id;
  name: string;
  /** The schema whose relation namespace the name is in. */
  scope: Id;
}

const UNMODELED_RELATIONS: UnmodeledKind[] = [
  'view',
  'materialized-view',
  'foreign-table',
  'sequence',
];

/**
 * Everything that takes a name in a schema's relation namespace: tables, indexes, views and
 * sequences, and the PK, unique and exclusion constraints, which create an index named after them.
 */
export function relationEntries(model: SchemaModel): RelationEntry[] {
  const schemaOf = (tableId: Id) => model.tables[tableId]?.schemaId;
  const entries: RelationEntry[] = Object.values(model.tables).map((t) => ({
    id: t.id,
    name: t.name,
    scope: t.schemaId,
  }));
  for (const i of Object.values(model.indexes)) {
    const scope = schemaOf(i.tableId);
    if (scope) entries.push({ id: i.id, name: i.name, scope });
  }
  for (const c of Object.values(model.constraints)) {
    const scope = schemaOf(c.tableId);
    if (
      scope &&
      (c.kind === 'pk' || c.kind === 'unique' || c.kind === 'exclusion')
    ) {
      entries.push({ id: c.id, name: c.name, scope });
    }
  }
  for (const u of Object.values(model.unmodeled)) {
    if (u.schemaId && UNMODELED_RELATIONS.includes(u.kind))
      entries.push({ id: u.id, name: u.name, scope: u.schemaId });
  }
  return entries;
}
