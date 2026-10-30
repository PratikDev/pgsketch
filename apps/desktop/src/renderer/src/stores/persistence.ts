import { api } from '@/api';
import type { Draft } from '../../../shared/ipc-contract';
import { derived } from './derived';
import { schemaStore } from './schema';

export interface PersistenceDeps {
  put: (dbKey: string, draft: Draft) => Promise<void>;
  clear: (dbKey: string) => Promise<void>;
  /** How long after the last edit the draft is saved. */
  debounceMs: number;
}

const appDeps: PersistenceDeps = {
  put: (dbKey, draft) => api.draft.put(dbKey, draft),
  clear: (dbKey) => api.draft.clear(dbKey),
  debounceMs: 1000,
};

/**
 * Keeps the edits of the open database in the app's store, so a restart finds them: a second
 * after the last edit the edited schema is saved with the fingerprint it was made on, and when
 * there is nothing left to change, the draft is removed instead.
 */
export function createPersistence(deps: PersistenceDeps = appDeps) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dbKey: string | null = null;
  let unsubscribe: (() => void) | undefined;
  let unsaved = false;

  const save = async (): Promise<void> => {
    clearTimeout(timer);
    timer = undefined;
    const key = dbKey;
    const { baseline, desired, loadedFingerprint } = schemaStore.getState();
    if (!unsaved || key === null || loadedFingerprint === null) return;
    unsaved = false;
    try {
      if (derived(baseline, desired).ops.length === 0) await deps.clear(key);
      else
        await deps.put(key, {
          fingerprint: loadedFingerprint,
          desiredJson: JSON.stringify(desired),
        });
    } catch {
      // not saved is not lost: the next edit or flush tries again
      unsaved = true;
    }
  };

  // `save` takes what it needs when it is called, so it can finish after this has let go
  const stop = (): Promise<void> => {
    const saving = save();
    unsubscribe?.();
    unsubscribe = undefined;
    dbKey = null;
    return saving;
  };

  return {
    /** Starts watching the edits of the schema that is loaded now. Nothing is saved until one is made. */
    start(key: string): void {
      void stop();
      dbKey = key;
      unsaved = false;
      unsubscribe = schemaStore.subscribe((state, before) => {
        if (state.desired === before.desired) return;
        unsaved = true;
        clearTimeout(timer);
        timer = setTimeout(() => void save(), deps.debounceMs);
      });
    },
    /** Saves now what has not been saved. */
    flush: save,
    /** Saves what is left and stops watching. */
    stop,
  };
}

export const persistence = createPersistence();
