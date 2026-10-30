import type { Introspection } from '@pgsketch/core';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/api';
import { restoreDraft } from '@/stores/draft-restore';
import { layoutStore } from '@/stores/layout';
import { persistence } from '@/stores/persistence';
import { schemaStore } from '@/stores/schema';

export type LoadState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'failed'; message: string };

/**
 * Puts back the edits saved last time, if they fit the schema that was just loaded. If they don't
 * (the database changed while the app was closed) they are thrown away, and the user is told.
 */
async function restoreSavedEdits(
  dbKey: string,
  loaded: Introspection,
): Promise<void> {
  // edits that can't be read are no reason to keep the database from opening
  const draft = await api.draft.get(dbKey).catch(() => null);
  if (!draft) return;
  const desired = restoreDraft(draft, loaded);
  if (desired) return schemaStore.getState().restore(desired);
  await api.draft.clear(dbKey).catch(() => undefined);
  toast.info(
    'Your unsaved edits were not restored: the database changed since they were made.',
    { id: 'draft-discarded', duration: Infinity },
  );
}

/**
 * Loads the open database's schema into the schema store, with the edits saved last time, and where
 * its tables were last put on the canvas into the layout store, once, when the Editor opens. From
 * then on the edits are saved as they are made.
 */
export function useLoadSchema(dbKey: string): LoadState {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  useEffect(() => {
    let current = true;
    api.schema
      .load()
      .then(async (introspection) => {
        schemaStore.getState().load(introspection);
        await restoreSavedEdits(dbKey, introspection);
        // a table made in the editor and not yet in the database keeps its place too
        const { baseline, desired } = schemaStore.getState();
        await layoutStore
          .getState()
          .restore(
            dbKey,
            Object.keys({ ...baseline.tables, ...desired.tables }),
          );
        if (current) persistence.start(dbKey);
      })
      .then(
        () => {
          if (current) setState({ status: 'ready' });
        },
        (error: unknown) => {
          if (current)
            setState({
              status: 'failed',
              message: error instanceof Error ? error.message : String(error),
            });
        },
      );
    return () => {
      current = false;
    };
  }, []);
  return state;
}
