import { useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { api, onEvent } from '@/api';
import { layoutStore } from '@/stores/layout';
import { schemaStore } from '@/stores/schema';
import { createChangeHandler } from '@/stores/schema/change-handler';
import { uiStore } from '@/stores/ui';

/**
 * Keeps the open schema in step with the database. A change made from outside, which the main
 * process notices, is looked at (see `createChangeHandler`); when it was the SQL of the edits, the
 * user is told so and the tables keep their places. A connection that was lost is noted, for the
 * banner. Returns the handler, for what else needs to look again (a reconnect).
 *
 * `ready` is when the schema has been loaded: a change before that is not a change of it, and one
 * that came between loading and now is looked for once.
 */
export function useSchemaChanges(ready: boolean): () => Promise<void> {
  const onSchemaChanged = useMemo(
    () =>
      createChangeHandler({
        load: () => api.schema.load(),
        onApplied: (tableIds) => {
          layoutStore.getState().remap(tableIds);
          toast.success('Changes applied');
        },
      }),
    [],
  );

  useEffect(() => {
    const stop = onEvent('connection:lost', ({ reason }) =>
      uiStore.getState().setConnectionLost(reason),
    );
    return () => {
      stop();
      uiStore.getState().setConnectionLost(null);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const stop = onEvent('schema:changed', () => void onSchemaChanged());
    // the loading took time; a cheap look says whether anything came in the meantime
    void api.schema.fingerprint().then(
      (now) => {
        if (now !== schemaStore.getState().loadedFingerprint)
          void onSchemaChanged();
      },
      () => undefined,
    );
    return stop;
  }, [ready, onSchemaChanged]);

  return onSchemaChanged;
}
