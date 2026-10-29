import type { Id } from '@pgsketch/core';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

export interface UiState {
  /** Schemas whose tables are not drawn. Hiding is what's remembered, so a new schema shows. */
  hiddenSchemas: Id[];
  /** The one name, type or default being edited (a type picker or default popover that is open counts), as a key its editor knows; `null` when none. */
  editing: string | null;
  /** A column made a moment ago whose name is being typed: Esc takes it away again. */
  addedColumn: Id | null;
  startEditing: (key: string, addedColumn?: Id) => void;
  /** Ends the edit of that key; if another editor has opened since, this does nothing. */
  stopEditing: (key: string) => void;
  /** Ends whatever edit is open, as a click on the empty canvas does. */
  cancelEditing: () => void;
  /** Why something the user did was refused, shown until it is dismissed. */
  notice: string | null;
  showNotice: (message: string) => void;
  clearNotice: () => void;
  toggleSchema: (schemaId: Id) => void;
  showAllSchemas: () => void;
}

/** A store of its own, for tests; the app uses `uiStore`. */
export const createUiStore = () =>
  createStore<UiState>()((set) => ({
    hiddenSchemas: [],
    editing: null,
    addedColumn: null,
    startEditing: (key, addedColumn) =>
      set({ editing: key, addedColumn: addedColumn ?? null }),
    stopEditing: (key) =>
      set(({ editing }) =>
        editing === key ? { editing: null, addedColumn: null } : {},
      ),
    cancelEditing: () => set({ editing: null, addedColumn: null }),
    notice: null,
    showNotice: (message) => set({ notice: message }),
    clearNotice: () => set({ notice: null }),
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
