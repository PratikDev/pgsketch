import type { Constraint, Id, Index, SchemaModel } from '@pgsketch/core';

/** Whether a constraint is built on a column: it lists it, or (for a foreign key) points at it. */
const usesColumn = (c: Constraint, columnId: Id): boolean =>
  c.columnIds.includes(columnId) ||
  (c.kind === 'fk' && c.refColumnIds.includes(columnId));

/** Whether everything a constraint is built on is in the model. */
export const constraintConnected = (
  model: SchemaModel,
  c: Constraint,
): boolean =>
  Boolean(model.tables[c.tableId]) &&
  c.columnIds.every((id) => model.columns[id]) &&
  (c.kind !== 'fk' ||
    (Boolean(model.tables[c.refTableId]) &&
      c.refColumnIds.every((id) => model.columns[id])));

export const indexConnected = (model: SchemaModel, i: Index): boolean =>
  Boolean(model.tables[i.tableId]) &&
  i.columnIds.every((id) => model.columns[id]);

/**
 * Removes what is built on a column along with it: every constraint and index that lists it (the
 * read-only ones on its table too) and every foreign key, on any table, that points at it.
 */
export function removeColumnDependents(model: SchemaModel, columnId: Id): void {
  for (const [id, c] of Object.entries(model.constraints))
    if (usesColumn(c, columnId)) delete model.constraints[id];
  for (const [id, i] of Object.entries(model.indexes))
    if (i.columnIds.includes(columnId)) delete model.indexes[id];
}

/**
 * Puts back, from the loaded schema, what was built on a column that has just come back, as far
 * as everything it is built on is there again.
 */
export function restoreColumnDependents(
  baseline: SchemaModel,
  model: SchemaModel,
  columnId: Id,
): void {
  for (const c of Object.values(baseline.constraints))
    if (
      !model.constraints[c.id] &&
      usesColumn(c, columnId) &&
      constraintConnected(model, c)
    )
      model.constraints[c.id] = structuredClone(c);
  for (const i of Object.values(baseline.indexes))
    if (
      !model.indexes[i.id] &&
      i.columnIds.includes(columnId) &&
      indexConnected(model, i)
    )
      model.indexes[i.id] = structuredClone(i);
}
