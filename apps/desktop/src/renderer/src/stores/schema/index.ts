import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { createColumnsSlice, type ColumnsSlice } from './columns';
import { createConstraintsSlice, type ConstraintsSlice } from './constraints';
import { createCoreSlice, type CoreSlice } from './core';
import { createIndexesSlice, type IndexesSlice } from './indexes';
import { createSchemasSlice, type SchemasSlice } from './schemas';
import { createTablesSlice, type TablesSlice } from './tables';

/** The schema store is its slices together; each slice is a file, so none grows without bound. */
export type SchemaStore = CoreSlice &
  TablesSlice &
  ColumnsSlice &
  ConstraintsSlice &
  IndexesSlice &
  SchemasSlice;

/** A store of its own, for tests; the app uses `schemaStore`. */
export const createSchemaStore = () =>
  createStore<SchemaStore>()((...a) => ({
    ...createCoreSlice(...a),
    ...createTablesSlice(...a),
    ...createColumnsSlice(...a),
    ...createConstraintsSlice(...a),
    ...createIndexesSlice(...a),
    ...createSchemasSlice(...a),
  }));

export const schemaStore = createSchemaStore();

export const useSchemaStore = <T>(selector: (state: SchemaStore) => T): T =>
  useStore(schemaStore, selector);
