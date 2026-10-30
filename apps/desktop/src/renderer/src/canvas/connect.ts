import type { Id } from '@pgsketch/core';
import { derived } from '@/stores/derived';
import { showRefusal } from '@/lib/refusal';
import { schemaStore } from '@/stores/schema';

const HANDLE = /^(.*):(?:left|right)-(?:source|target)$/;

/** The column a handle belongs to (see `handleId`), or `null` for anything else. */
export const columnOfHandle = (handle: string | null | undefined): Id | null =>
  (handle && HANDLE.exec(handle)?.[1]) || null;

/**
 * A foreign key from one column to another, which may be in the same table. If the model can't
 * have it (the other column is not a key, the types differ…) it is not made, and the reason is
 * shown instead.
 */
export function connectColumns(from: Id, to: Id): void {
  const { desired, addForeignKey, removeConstraint } = schemaStore.getState();
  const source = desired.columns[from];
  const target = desired.columns[to];
  if (!source || !target) return;
  // a column pgsketch can't edit can be pointed at, but it can't be given a key
  const readOnly = source.readOnly ?? desired.tables[source.tableId]?.readOnly;
  if (readOnly)
    return showRefusal(
      `Column "${source.name}" is read-only, so it can't get a foreign key`,
    );
  const id = addForeignKey({
    tableId: source.tableId,
    columnIds: [from],
    refTableId: target.tableId,
    refColumnIds: [to],
  });
  const { baseline, desired: edited } = schemaStore.getState();
  const problem = derived(baseline, edited).errors.find(
    (e) => e.objectId === id,
  );
  if (problem) {
    removeConstraint(id);
    showRefusal(problem.message);
  }
}
