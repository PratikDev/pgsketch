import type { Column, Constraint, Id, SchemaModel } from './types';

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
