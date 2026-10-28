import { useEffect, useState } from 'react';
import { api } from '@/api';
import { schemaStore } from '@/stores/schema';

export type LoadState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'failed'; message: string };

/** Loads the open database's schema into the schema store, once, when the Editor opens. */
export function useLoadSchema(): LoadState {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  useEffect(() => {
    let current = true;
    api.schema.load().then(
      (introspection) => {
        if (!current) return;
        schemaStore.getState().load(introspection);
        setState({ status: 'ready' });
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
