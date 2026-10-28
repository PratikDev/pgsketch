import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { createCoreSlice, type CoreSlice } from './core';
import { createTablesSlice, type TablesSlice } from './tables';

/** The schema store is its slices together; each slice is a file, so none grows without bound. */
export type SchemaStore = CoreSlice & TablesSlice;

/** A store of its own, for tests; the app uses `schemaStore`. */
export const createSchemaStore = () =>
  createStore<SchemaStore>()((...a) => ({
    ...createCoreSlice(...a),
    ...createTablesSlice(...a),
  }));

export const schemaStore = createSchemaStore();

export const useSchemaStore = <T>(selector: (state: SchemaStore) => T): T =>
  useStore(schemaStore, selector);
