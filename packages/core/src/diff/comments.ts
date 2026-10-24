import type { SchemaModel } from '../model/types';
import type { ChangeOp, DiffPart } from './ops';

// Postgres can't store an empty comment (it removes it), so '' and null are the same.
const normalize = (comment: string | null | undefined): string | null =>
  comment || null;

/**
 * Comments on tables and columns: set, change and clear (to null). New tables and columns start
 * with no comment, so one that already has a comment gets a `setComment` after it is created.
 * Columns of a dropped table are not in the edited model and get nothing.
 */
export function diffComments(
  baseline: SchemaModel,
  desired: SchemaModel,
): DiffPart {
  const ops: ChangeOp[] = [];
  for (const table of Object.values(desired.tables)) {
    const to = normalize(table.comment);
    if (to !== normalize(baseline.tables[table.id]?.comment)) {
      ops.push({
        kind: 'setComment',
        target: { kind: 'table', tableId: table.id },
        to,
      });
    }
  }
  for (const column of Object.values(desired.columns)) {
    const to = normalize(column.comment);
    if (to !== normalize(baseline.columns[column.id]?.comment)) {
      ops.push({
        kind: 'setComment',
        target: { kind: 'column', columnId: column.id },
        to,
      });
    }
  }
  return { ops, errors: [] };
}
