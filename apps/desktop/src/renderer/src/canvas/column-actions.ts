import type { Id } from '@pgsketch/core';
import { showRefusal } from '@/lib/refusal';
import { schemaStore } from '@/stores/schema';
import { uiStore } from '@/stores/ui';

/** A new column at the end of the table, with its name ready to be typed. Esc takes it away again. */
export function addColumnAndEdit(tableId: Id): void {
  const columnId = schemaStore.getState().addColumn(tableId);
  uiStore.getState().startEditing(`${columnId}:name`, columnId);
}

/** Removes a column; if something depends on it, says so instead. */
export function deleteColumn(columnId: Id): void {
  showRefusal(schemaStore.getState().removeColumn(columnId));
}

/**
 * Brings a removed column back. If its table is removed too, the column can't be there without
 * it, so the table comes back, with everything that went with it.
 */
export function restoreColumn(columnId: Id, tableId: Id): void {
  const { desired, restoreColumn, restoreTable } = schemaStore.getState();
  if (desired.tables[tableId]) restoreColumn(columnId);
  else restoreTable(tableId);
}
