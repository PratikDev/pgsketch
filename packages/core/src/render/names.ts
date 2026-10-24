import type { Id, ModelPair } from '../model/types';

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
