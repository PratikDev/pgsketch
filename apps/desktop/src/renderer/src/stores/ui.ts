import type { Id } from '@pgsketch/core';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

export interface UiState {
  /** Schemas whose tables are not drawn. Hiding is what's remembered, so a new schema shows. */
  hiddenSchemas: Id[];
  /** The one name, type or default being edited, as a key its editor knows; `null` when none. */
  editing: string | null;
  startEditing: (key: string) => void;
  /** Ends the edit of that key; if another editor has opened since, this does nothing. */
  stopEditing: (key: string) => void;
  toggleSchema: (schemaId: Id) => void;
  showAllSchemas: () => void;
}

/** A store of its own, for tests; the app uses `uiStore`. */
export const createUiStore = () =>
  createStore<UiState>()((set) => ({
    hiddenSchemas: [],
    editing: null,
    startEditing: (key) => set({ editing: key }),
    stopEditing: (key) =>
      set(({ editing }) => (editing === key ? { editing: null } : {})),
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
