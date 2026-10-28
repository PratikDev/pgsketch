import type { CastData, Introspection, SchemaModel } from '@pgsketch/core';
import type { StateCreator } from 'zustand';
import type { SchemaStore } from '.';

export const emptyModel = (): SchemaModel => ({
  schemas: {},
  tables: {},
  columns: {},
  constraints: {},
  indexes: {},
  enums: {},
  unmodeled: {},
});

export interface CoreSlice {
  /** Exactly what was loaded. */
  baseline: SchemaModel;
  /** The baseline with the user's edits; the diff is always `diff(baseline, desired)`. */
  desired: SchemaModel;
  casts: CastData | null;
  /** The fingerprint of `baseline`, from the snapshot it was read in. */
  loadedFingerprint: string | null;
  /** The database changed outside the app since this was loaded. */
  stale: boolean;
  /** Counts every edit of `desired`, so a handler that started earlier can tell it has moved. */
  version: number;
  /** Replaces everything with a freshly loaded schema and no edits. */
  load: (introspection: Introspection) => void;
  markStale: () => void;
  /**
   * Changes a copy of `desired` and makes it the new one. A copy per edit keeps every model the
   * store has handed out unchanged, which the memoized diff relies on.
   * shortcut: copies the whole model each time, switch to updating only what changed if a very
   * large schema makes editing slow.
   */
  edit: (change: (desired: SchemaModel) => void) => void;
}

export const createCoreSlice: StateCreator<SchemaStore, [], [], CoreSlice> = (
  set,
  get,
) => ({
  baseline: emptyModel(),
  desired: emptyModel(),
  casts: null,
  loadedFingerprint: null,
  stale: false,
  version: 0,
  load: ({ model, casts, fingerprint }) =>
    set({
      baseline: model,
      desired: structuredClone(model),
      casts,
      loadedFingerprint: fingerprint,
      stale: false,
      version: 0,
    }),
  markStale: () => set({ stale: true }),
  edit: (change) => {
    const desired = structuredClone(get().desired);
    change(desired);
    set((s) => ({ desired, version: s.version + 1 }));
  },
});
