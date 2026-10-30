import type { Id, Introspection } from '@pgsketch/core';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/api';
import { classifyDraft } from '@/stores/draft-restore';
import { layoutStore } from '@/stores/layout';
import { persistence } from '@/stores/persistence';
import { schemaStore } from '@/stores/schema';
import { tableIdMap } from '@/stores/schema/table-remap';

export type LoadState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'failed'; message: string };

/** What the edits saved last time left for the layout: the tables they made, and which of them the database made too. */
interface SavedEdits {
  tableIds: Id[];
  appliedTableIds: Record<Id, Id> | null;
}

/**
 * Deals with the edits saved last time. If they fit the schema that was just loaded they are put
 * back; if the database now has what they asked for (the SQL was run while the app was closed) the
 * user is told so; otherwise they are thrown away, and the user is told that.
 */
async function settleSavedEdits(
  dbKey: string,
  loaded: Introspection,
): Promise<SavedEdits> {
  // edits that can't be read are no reason to keep the database from opening
  const draft = await api.draft.get(dbKey).catch(() => null);
  const none: SavedEdits = { tableIds: [], appliedTableIds: null };
  if (!draft) return none;
  const outcome = classifyDraft(draft, loaded);
  if (outcome.kind === 'restore') {
    schemaStore.getState().restore(outcome.desired);
    return {
      tableIds: Object.keys(outcome.desired.tables),
      appliedTableIds: null,
    };
  }
  await api.draft.clear(dbKey).catch(() => undefined);
  if (outcome.kind === 'applied') {
    toast.success('Changes applied');
    return {
      tableIds: Object.keys(outcome.desired.tables),
      appliedTableIds: tableIdMap(outcome.desired, loaded.model),
    };
  }
  toast.info(
    'Your unsaved edits were not restored: the database changed since they were made.',
    { id: 'draft-discarded', duration: Infinity },
  );
  return none;
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
        const saved = await settleSavedEdits(dbKey, introspection);
        // a table made in the editor and not yet in the database keeps its place too
        const { baseline, desired } = schemaStore.getState();
        await layoutStore
          .getState()
          .restore(dbKey, [
            ...Object.keys({ ...baseline.tables, ...desired.tables }),
            ...saved.tableIds,
          ]);
        // and so does one that the database has made since, under the id the database gave it
        if (saved.appliedTableIds)
          layoutStore.getState().remap(saved.appliedTableIds);
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
