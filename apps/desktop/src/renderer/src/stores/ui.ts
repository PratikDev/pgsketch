import type { Id } from '@pgsketch/core';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

export interface UiState {
  /** Schemas whose tables are not drawn. Hiding is what's remembered, so a new schema shows. */
  hiddenSchemas: Id[];
  toggleSchema: (schemaId: Id) => void;
  showAllSchemas: () => void;
}

/** A store of its own, for tests; the app uses `uiStore`. */
export const createUiStore = () =>
  createStore<UiState>()((set) => ({
    hiddenSchemas: [],
    toggleSchema: (schemaId) =>
      set(({ hiddenSchemas }) => ({
        hiddenSchemas: hiddenSchemas.includes(schemaId)
          ? hiddenSchemas.filter((id) => id !== schemaId)
          : [...hiddenSchemas, schemaId],
      })),
    showAllSchemas: () => set({ hiddenSchemas: [] }),
  }));

export const uiStore = createUiStore();

export const useUiStore = <T>(selector: (state: UiState) => T): T =>
  useStore(uiStore, selector);
