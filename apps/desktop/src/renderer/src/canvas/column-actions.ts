import type { Id } from '@pgsketch/core';
import { schemaStore } from '@/stores/schema';
import { uiStore } from '@/stores/ui';

/** A new column at the end of the table, with its name ready to be typed. Esc takes it away again. */
export function addColumnAndEdit(tableId: Id): void {
  const columnId = schemaStore.getState().addColumn(tableId);
  uiStore.getState().startEditing(`${columnId}:name`, columnId);
}

/** Removes a column; if something depends on it, says so instead. */
export function deleteColumn(columnId: Id): void {
  const reason = schemaStore.getState().removeColumn(columnId);
  if (reason) uiStore.getState().showNotice(reason);
}
