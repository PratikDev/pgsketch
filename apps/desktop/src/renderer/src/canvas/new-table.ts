import type { Id, Schema } from '@pgsketch/core';
import type { Point } from '@/layout/autoLayout';
import { layoutStore } from '@/stores/layout';
import { schemaStore } from '@/stores/schema';
import { uiStore } from '@/stores/ui';

/**
 * The schema a new table goes in: the one the schema filter leaves showing, if it is just one;
 * otherwise `public`, if it is shown; otherwise the first schema by name (among the shown ones, or
 * if the filter hides every schema, among all). `null` when the database has no schema.
 */
export function newTableSchema(schemas: Schema[], hidden: Id[]): Id | null {
  const byName = [...schemas].sort((a, b) => (a.name < b.name ? -1 : 1));
  const shown = byName.filter((s) => !hidden.includes(s.id));
  if (shown.length === 1) return shown[0]!.id;
  return (
    (shown.find((s) => s.name === 'public') ?? shown[0] ?? byName[0])?.id ??
    null
  );
}

/** A new table with its name ready to be typed, its top left corner at `at` on the canvas. */
export function createTableAt(at: Point): void {
  const { desired, addTable } = schemaStore.getState();
  const schemaId = newTableSchema(
    Object.values(desired.schemas),
    uiStore.getState().hiddenSchemas,
  );
  if (schemaId === null) return;
  const tableId = addTable(schemaId);
  layoutStore.getState().place({ [tableId]: at });
  uiStore.getState().startEditing(`${tableId}:name`);
}
