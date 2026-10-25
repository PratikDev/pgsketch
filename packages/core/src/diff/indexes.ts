import { sameIds } from '../model/lookup';
import type { Index, SchemaModel } from '../model/types';
import type { DiffPart } from './ops';

export const sameIndexDefinition = (a: Index, b: Index): boolean =>
  a.tableId === b.tableId &&
  a.unique === b.unique &&
  sameIds(a.columnIds, b.columnIds);

/**
 * The same rules as constraints: a new index is added (also on a new table, since indexes are
 * never part of `createTable`), a removed one is dropped, a changed one, including the same
 * columns in another order, is dropped and added again, and a renamed one is a rename. A dropped
 * table takes its indexes with it.
 */
export function diffIndexes(
  baseline: SchemaModel,
  desired: SchemaModel,
): DiffPart {
  const part: DiffPart = { ops: [], errors: [] };
  for (const index of Object.values(desired.indexes)) {
    if (!baseline.indexes[index.id]) part.ops.push({ kind: 'addIndex', index });
  }
  for (const before of Object.values(baseline.indexes)) {
    if (!desired.tables[before.tableId]) continue;
    const after = desired.indexes[before.id];
    if (!after) {
      part.ops.push({ kind: 'dropIndex', index: before });
    } else if (!sameIndexDefinition(before, after)) {
      part.ops.push(
        { kind: 'dropIndex', index: before },
        { kind: 'addIndex', index: after },
      );
    } else if (before.name !== after.name) {
      part.ops.push({
        kind: 'renameIndex',
        indexId: before.id,
        from: before.name,
        to: after.name,
      });
    }
  }
  return part;
}
