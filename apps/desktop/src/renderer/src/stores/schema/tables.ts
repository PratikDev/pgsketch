import { blockersOfTable, type Id, type SchemaModel } from '@pgsketch/core';
import type { StateCreator } from 'zustand';
import type { SchemaStore } from '.';
import { firstFree } from './helpers';

export interface TablesSlice {
  /** A new table in a schema, with an `id bigint` identity primary key. Returns its id. */
  addTable: (schemaId: Id) => Id;
  renameTable: (tableId: Id, name: string) => void;
  setTableComment: (tableId: Id, comment: string | null) => void;
  /**
   * Removes a table with its columns, constraints and indexes, and the foreign keys of other tables
   * that point at it. Returns why not, if something read-only still depends on it.
   */
  removeTable: (tableId: Id) => string | null;
  /** Puts a removed table back as it was loaded, with what went with it. */
  restoreTable: (tableId: Id) => void;
}

function removeFrom(model: SchemaModel, tableId: Id): void {
  for (const [id, c] of Object.entries(model.constraints)) {
    if (c.tableId === tableId || (c.kind === 'fk' && c.refTableId === tableId))
      delete model.constraints[id];
  }
  for (const [id, i] of Object.entries(model.indexes)) {
    if (i.tableId === tableId) delete model.indexes[id];
  }
  for (const [id, c] of Object.entries(model.columns)) {
    if (c.tableId === tableId) delete model.columns[id];
  }
  delete model.tables[tableId];
}

export const createTablesSlice: StateCreator<
  SchemaStore,
  [],
  [],
  TablesSlice
> = (_, get) => ({
  addTable: (schemaId) => {
    const tableId = crypto.randomUUID();
    const columnId = crypto.randomUUID();
    get().edit((d) => {
      d.tables[tableId] = {
        id: tableId,
        schemaId,
        name: firstFree(
          'new_table',
          Object.values(d.tables)
            .filter((t) => t.schemaId === schemaId)
            .map((t) => t.name),
        ),
        comment: null,
      };
      d.columns[columnId] = {
        id: columnId,
        tableId,
        name: 'id',
        position: 1,
        type: { name: 'bigint', isArray: false },
        notNull: true,
        default: null,
        identity: 'always',
        comment: null,
      };
      const keyId = crypto.randomUUID();
      d.constraints[keyId] = {
        id: keyId,
        tableId,
        kind: 'pk',
        name: '',
        autoName: true,
        columnIds: [columnId],
      };
    });
    return tableId;
  },

  renameTable: (tableId, name) =>
    get().edit((d) => {
      const table = d.tables[tableId];
      if (table) table.name = name;
    }),

  setTableComment: (tableId, comment) =>
    get().edit((d) => {
      const table = d.tables[tableId];
      if (table) table.comment = comment;
    }),

  removeTable: (tableId) => {
    const { baseline, desired, edit } = get();
    const table = desired.tables[tableId];
    if (!table) return null;
    const blockers = blockersOfTable(baseline, desired, table);
    if (blockers.length > 0)
      return `Can't delete table "${table.name}": ${blockers.join(', ')} still depend${blockers.length === 1 ? 's' : ''} on it`;
    edit((d) => removeFrom(d, tableId));
    return null;
  },

  restoreTable: (tableId) => {
    const { baseline, desired, edit } = get();
    const table = baseline.tables[tableId];
    if (!table || desired.tables[tableId]) return;
    edit((d) => {
      d.tables[tableId] = structuredClone(table);
      for (const c of Object.values(baseline.columns))
        if (c.tableId === tableId) d.columns[c.id] = structuredClone(c);
      for (const i of Object.values(baseline.indexes))
        if (i.tableId === tableId) d.indexes[i.id] = structuredClone(i);
      // the table's own keys, and other tables' foreign keys to it, each only once everything
      // they connect is there: a foreign key waits for the table it points at to come back too
      for (const c of Object.values(baseline.constraints)) {
        const involved =
          c.tableId === tableId ||
          (c.kind === 'fk' && c.refTableId === tableId);
        if (!involved || d.constraints[c.id]) continue;
        const ends = c.kind === 'fk' ? [c.tableId, c.refTableId] : [c.tableId];
        if (ends.every((id) => d.tables[id]))
          d.constraints[c.id] = structuredClone(c);
      }
    });
  },
});
