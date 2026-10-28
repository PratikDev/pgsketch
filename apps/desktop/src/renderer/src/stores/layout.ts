import type { Id } from '@pgsketch/core';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { api } from '@/api';
import type { Point } from '@/layout/autoLayout';

export type Positions = Record<Id, Point>;

export interface LayoutDeps {
  get: (dbKey: string, tableIds: Id[]) => Promise<Positions>;
  put: (dbKey: string, positions: Positions) => Promise<void>;
  /** How long after the last move the positions are saved. */
  debounceMs: number;
}

export interface LayoutState {
  /** The database the positions are for. */
  dbKey: string | null;
  positions: Positions;
  /** The saved positions have been read, so a table without one really has none. */
  loaded: boolean;
  /** Reads what was saved for a database; `tableIds` are the tables it has now. */
  restore: (dbKey: string, tableIds: Id[]) => Promise<void>;
  /** A table was dragged. */
  move: (tableId: Id, point: Point) => void;
  /** The auto-layout put these tables somewhere. */
  place: (positions: Positions) => void;
  /** Saves now whatever has not been saved yet. */
  flush: () => Promise<void>;
}

const appDeps: LayoutDeps = {
  get: (dbKey, tableIds) => api.layout.get(dbKey, tableIds),
  put: (dbKey, positions) => api.layout.put(dbKey, positions),
  debounceMs: 500,
};

/**
 * Where the tables are on the canvas. Positions are saved a moment after the last change, so
 * dragging a table doesn't write on every mouse move, and read back when the database is opened.
 */
export function createLayoutStore(deps: LayoutDeps = appDeps) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsaved = false;

  return createStore<LayoutState>()((set, get) => {
    const changed = (positions: Positions) => {
      set({ positions });
      unsaved = true;
      clearTimeout(timer);
      timer = setTimeout(() => void get().flush(), deps.debounceMs);
    };
    return {
      dbKey: null,
      positions: {},
      loaded: false,

      restore: async (dbKey, tableIds) => {
        await get().flush(); // what was moved in the database that was open before
        set({ dbKey, positions: {}, loaded: false });
        // a layout that can't be read is no reason to keep the canvas from opening
        const positions = await deps.get(dbKey, tableIds).catch(() => ({}));
        if (get().dbKey === dbKey) set({ positions, loaded: true });
      },

      move: (tableId, point) =>
        changed({ ...get().positions, [tableId]: point }),

      place: (placed) => changed({ ...get().positions, ...placed }),

      flush: async () => {
        clearTimeout(timer);
        timer = undefined;
        const { dbKey, positions } = get();
        if (!unsaved || dbKey === null) return;
        unsaved = false;
        // not saved is not lost: the next change or flush tries again
        await deps.put(dbKey, positions).catch(() => {
          unsaved = true;
        });
      },
    };
  });
}

export const layoutStore = createLayoutStore();

export const useLayoutStore = <T>(selector: (state: LayoutState) => T): T =>
  useStore(layoutStore, selector);
