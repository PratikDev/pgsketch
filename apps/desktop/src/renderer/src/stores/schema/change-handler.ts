import { matchesByName, type Id, type Introspection } from '@pgsketch/core';
import { derived } from '../derived';
import { uiStore } from '../ui';
import { schemaStore } from '.';
import { tableIdMap } from './table-remap';

export interface ChangeHandlerDeps {
  /** Reads the schema of the open database now, changing nothing in the store. */
  load: () => Promise<Introspection>;
  /** The database now has what the edits asked for: say so, and move what was kept for the tables. */
  onApplied: (tableIds: Record<Id, Id>) => void;
}

/** Resolves when no input or popover is open, which is now if none is. */
function whenNoEditorIsOpen(): Promise<void> {
  if (uiStore.getState().editing === null) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = uiStore.subscribe((state) => {
      if (state.editing !== null) return;
      stop();
      resolve();
    });
  });
}

/**
 * What to do when the database may have changed under the open schema: looks at what is there now
 * and then, in one step with nothing awaited in between, decides from the edits as they are at
 * that moment.
 *
 * - Nothing differs from what was loaded: nothing to do (and a schema that had gone stale is fine).
 * - No edits: the new schema is taken as it is.
 * - Edits that the database now has, by name (the SQL was run): taken, and `onApplied` told.
 * - Any other edits: the schema goes stale, which blocks generating SQL, and the edits are kept.
 *
 * While an input or popover is open nothing is decided, so what is being typed is never lost; it is
 * decided when the editor is closed, from the edits then. Runs one at a time: a change that comes in
 * while one is being handled makes it look again afterwards. If the look itself fails the schema
 * goes stale, since what is shown can no longer be trusted.
 */
export function createChangeHandler({ load, onApplied }: ChangeHandlerDeps) {
  let running = false;
  let again = false;

  function decide(loaded: Introspection): void {
    const store = schemaStore.getState();
    if (loaded.fingerprint === store.loadedFingerprint)
      return store.clearStale();
    const { named, ops } = derived(store.baseline, store.desired);
    if (ops.length === 0) return store.adopt(loaded);
    if (matchesByName(loaded.model, named)) {
      const tableIds = tableIdMap(store.desired, loaded.model);
      store.adopt(loaded);
      return onApplied(tableIds);
    }
    store.markStale();
  }

  return async function onSchemaChanged(): Promise<void> {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        try {
          const loaded = await load();
          await whenNoEditorIsOpen();
          decide(loaded);
        } catch {
          schemaStore.getState().markStale();
        }
      } while (again);
    } finally {
      running = false;
    }
  };
}
