import type { SchemaModel } from '../model/types';
import { samePgType } from '../sql/pgtype';
import type { DiffPart } from './ops';

/**
 * Column changes on tables that exist before and after. Columns of a table being created are part
 * of its `createTable`, and columns of a dropped table go with it, so neither gets an operation of
 * its own. A renamed column keeps its id, so it is a rename and never a drop plus an add. A
 * column that changes in several ways gets one operation per change, in the order they run:
 * type, default, nullability. Turning identity on or off for an existing column isn't possible in
 * 0.1.0, so it blocks generation instead of being ignored.
 */
export function diffColumns(
  baseline: SchemaModel,
  desired: SchemaModel,
): DiffPart {
  const part: DiffPart = { ops: [], errors: [] };
  const keptTable = (tableId: string) =>
    baseline.tables[tableId] && desired.tables[tableId];

  for (const column of Object.values(desired.columns)) {
    if (!baseline.columns[column.id] && keptTable(column.tableId)) {
      part.ops.push({ kind: 'addColumn', column });
    }
  }
  for (const before of Object.values(baseline.columns)) {
    if (!keptTable(before.tableId)) continue;
    const after = desired.columns[before.id];
    if (!after) {
      part.ops.push({ kind: 'dropColumn', column: before });
      continue;
    }
    if (after.name !== before.name) {
      part.ops.push({
        kind: 'renameColumn',
        columnId: before.id,
        from: before.name,
        to: after.name,
      });
    }
    if (!samePgType(before.type, after.type)) {
      part.ops.push({
        kind: 'alterColumnType',
        columnId: before.id,
        from: before.type,
        to: after.type,
      });
    }
    // only the SQL matters: a preset and a typed-in expression with the same text are one default
    if (before.default?.expression !== after.default?.expression) {
      part.ops.push(
        after.default
          ? { kind: 'setDefault', columnId: before.id, to: after.default }
          : { kind: 'dropDefault', columnId: before.id },
      );
    }
    if (before.notNull !== after.notNull) {
      part.ops.push({
        kind: after.notNull ? 'setNotNull' : 'dropNotNull',
        columnId: before.id,
      });
    }
    if (before.identity !== after.identity) {
      part.errors.push({
        code: 'column-identity-changed',
        objectId: before.id,
        message: `Identity on "${before.name}" can't be turned on, off or changed yet`,
      });
    }
  }
  return part;
}
