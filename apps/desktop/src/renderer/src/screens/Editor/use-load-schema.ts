import { useEffect, useState } from 'react';
import { api } from '@/api';
import { layoutStore } from '@/stores/layout';
import { schemaStore } from '@/stores/schema';

export type LoadState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'failed'; message: string };

/**
 * Loads the open database's schema into the schema store, and where its tables were last put on
 * the canvas into the layout store, once, when the Editor opens.
 */
export function useLoadSchema(dbKey: string): LoadState {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  useEffect(() => {
    let current = true;
    api.schema
      .load()
      .then(async (introspection) => {
        schemaStore.getState().load(introspection);
        await layoutStore
          .getState()
          .restore(dbKey, Object.keys(introspection.model.tables));
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
