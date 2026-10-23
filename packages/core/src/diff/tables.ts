import { columnsOf, primaryKeyOf } from '../model/lookup';
import type { SchemaModel } from '../model/types';
import type { DiffPart } from './ops';

/**
 * New tables are created (with their columns and primary key; other constraints and indexes are
 * separate operations), removed ones are dropped, and a renamed table keeps its id, so it is a
 * rename and never a drop plus a create. Moving an existing table to another schema can't be done
 * in 0.1.0 and the editor never allows it, so it blocks generation instead of being ignored.
 */
export function diffTables(
  baseline: SchemaModel,
  desired: SchemaModel,
): DiffPart {
  const part: DiffPart = { ops: [], errors: [] };
  for (const table of Object.values(desired.tables)) {
    if (baseline.tables[table.id]) continue;
    const pk = primaryKeyOf(desired, table.id);
    part.ops.push({
      kind: 'createTable',
      table,
      columns: columnsOf(desired, table.id),
      ...(pk && { pk }),
    });
  }
  for (const before of Object.values(baseline.tables)) {
    const after = desired.tables[before.id];
    if (!after) {
      part.ops.push({ kind: 'dropTable', table: before });
      continue;
    }
    if (after.schemaId !== before.schemaId) {
      part.errors.push({
        code: 'table-schema-changed',
        objectId: before.id,
        message: `Table "${before.name}" can't be moved to another schema`,
      });
    }
    if (after.name !== before.name) {
      part.ops.push({
        kind: 'renameTable',
        tableId: before.id,
        from: before.name,
        to: after.name,
      });
    }
  }
  return part;
}
