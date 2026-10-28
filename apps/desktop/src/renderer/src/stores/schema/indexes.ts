import type { Id } from '@pgsketch/core';
import type { StateCreator } from 'zustand';
import type { SchemaStore } from '.';
import { indexConnected } from './cascade';

export interface IndexesSlice {
  /** A B-tree index on columns of a table, in the order given. Returns its id. */
  addIndex: (tableId: Id, columnIds: Id[], unique?: boolean) => Id;
  updateIndex: (
    indexId: Id,
    change: { columnIds?: Id[]; unique?: boolean },
  ) => void;
  /** Naming an index yourself stops its name following the table and columns. */
  renameIndex: (indexId: Id, name: string) => void;
  removeIndex: (indexId: Id) => void;
  /** Puts a removed index back as it was loaded, if its columns are there. */
  restoreIndex: (indexId: Id) => void;
}

export const createIndexesSlice: StateCreator<
  SchemaStore,
  [],
  [],
  IndexesSlice
> = (_, get) => ({
  addIndex: (tableId, columnIds, unique = false) => {
    const id = crypto.randomUUID();
    get().edit((d) => {
      d.indexes[id] = {
        id,
        tableId,
        name: '',
        autoName: true,
        unique,
        columnIds,
      };
    });
    return id;
  },

  updateIndex: (indexId, change) => {
    if (!get().desired.indexes[indexId]) return;
    get().edit((d) => {
      const index = d.indexes[indexId];
      if (!index) return;
      index.columnIds = change.columnIds ?? index.columnIds;
      index.unique = change.unique ?? index.unique;
    });
  },

  renameIndex: (indexId, name) => {
    if (!get().desired.indexes[indexId]) return;
    get().edit((d) => {
      const index = d.indexes[indexId];
      if (!index) return;
      index.name = name;
      index.autoName = false;
    });
  },

  removeIndex: (indexId) => {
    if (!get().desired.indexes[indexId]) return;
    get().edit((d) => void delete d.indexes[indexId]);
  },

  restoreIndex: (indexId) => {
    const { baseline, desired, edit } = get();
    const index = baseline.indexes[indexId];
    if (!index || desired.indexes[indexId] || !indexConnected(desired, index))
      return;
    edit((d) => {
      d.indexes[indexId] = structuredClone(index);
    });
  },
});
