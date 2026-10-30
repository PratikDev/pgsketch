import type { Id, SchemaModel } from '@pgsketch/core';

const qualified = (model: SchemaModel, tableId: Id): string | null => {
  const table = model.tables[tableId];
  const schema = table && model.schemas[table.schemaId];
  return table && schema ? JSON.stringify([schema.name, table.name]) : null;
};

/**
 * Which table of `to` is each table of `from`, by schema and name, for the tables whose ids are
 * not the same in both: a table made in the editor has a random id until the database has made
 * it, and the id it has then is the database's.
 */
export function tableIdMap(from: SchemaModel, to: SchemaModel): Record<Id, Id> {
  const byName = new Map<string, Id>();
  for (const id of Object.keys(to.tables)) {
    const name = qualified(to, id);
    if (name !== null) byName.set(name, id);
  }
  const map: Record<Id, Id> = {};
  for (const id of Object.keys(from.tables)) {
    const name = qualified(from, id);
    const target = name === null ? undefined : byName.get(name);
    if (target !== undefined && target !== id) map[id] = target;
  }
  return map;
}
