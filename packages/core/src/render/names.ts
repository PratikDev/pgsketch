import type { Id, ModelPair } from '../model/types';
import type { CastData } from '../sql/coercion';
import { qualified } from '../sql/quote';

/** A schema's name, from the edited model (it has every schema, including ones created in this migration). */
export function schemaName({ desired }: ModelPair, schemaId: Id): string {
  const schema = desired.schemas[schemaId];
  if (!schema) throw new Error(`Unknown schema ${schemaId}`);
  return schema.name;
}

/** The schema of a table that exists before the migration. */
export function schemaOfExistingTable(models: ModelPair, tableId: Id): string {
  const table = models.baseline.tables[tableId];
  if (!table) throw new Error(`Unknown table ${tableId}`);
  return schemaName(models, table.schemaId);
}

/** What a renderer needs besides the operation: both models, and the cast data for type changes. */
export interface RenderContext extends ModelPair {
  casts: CastData;
}

/**
 * A table as a statement should write it. Statements that run after the renames use the edited
 * model's names; the ones that run before them (dropping constraints and indexes) pass `'baseline'`.
 */
export function tableRef(
  models: ModelPair,
  tableId: Id,
  side: 'baseline' | 'desired' = 'desired',
): string {
  const table = models[side].tables[tableId];
  if (!table) throw new Error(`Unknown table ${tableId}`);
  return qualified(schemaName(models, table.schemaId), table.name);
}

/** A column's name after the migration's renames. */
export function columnName({ desired }: ModelPair, columnId: Id): string {
  const column = desired.columns[columnId];
  if (!column) throw new Error(`Unknown column ${columnId}`);
  return column.name;
}
