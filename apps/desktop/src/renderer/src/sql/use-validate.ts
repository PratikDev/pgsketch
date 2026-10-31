import type { Migration } from '@pgsketch/core';
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/api';
import { schemaStore } from '@/stores/schema';
import type {
  SessionInfo,
  StatementResult,
} from '../../../shared/ipc-contract';
import { messageOf } from '@/lib/errors';

/** What a run is for: the SQL, its statements, and the schema they were made on. */
interface Run {
  text: string;
  statements: string[];
  fingerprint: string;
}

type ValidateState =
  | { status: 'idle' }
  | { status: 'running' }
  /** Asking first, because the server is not this machine: Validate takes locks on it. */
  | { status: 'confirming'; run: Run }
  | { status: 'done'; text: string; results: StatementResult[] };

export interface Validation {
  running: boolean;
  /** The run waiting for a yes, if any. */
  confirming: boolean;
  /** The results for exactly this SQL; none once it has changed. */
  resultsFor: (migration: Migration) => StatementResult[] | null;
  request: (migration: Migration) => Promise<void>;
  confirm: () => Promise<void>;
  cancel: () => void;
}

/**
 * The dry run of the SQL on the server: checks that the database is still what the statements were
 * made for (if not, `onSchemaChanged` looks at the change first and the SQL is made again), asks
 * first when the server is remote, then runs it and keeps the results next to that SQL.
 */
export function useValidate(
  hostKind: SessionInfo['hostKind'],
  onSchemaChanged: () => Promise<void>,
): Validation {
  const [state, setState] = useState<ValidateState>({ status: 'idle' });

  const fail = (error: unknown) => {
    setState({ status: 'idle' });
    toast.error(`Couldn't validate the SQL: ${messageOf(error)}`);
  };

  const changed = async () => {
    setState({ status: 'idle' });
    await onSchemaChanged();
  };

  const run = async ({ text, statements, fingerprint }: Run) => {
    setState({ status: 'running' });
    try {
      const result = await api.sql.validate({ statements, fingerprint });
      if (result.status === 'stale') return await changed();
      setState({ status: 'done', text, results: result.results });
    } catch (error) {
      fail(error);
    }
  };

  return {
    running: state.status === 'running',
    confirming: state.status === 'confirming',
    resultsFor: (migration) =>
      state.status === 'done' && state.text === migration.text
        ? state.results
        : null,

    async request(migration) {
      setState({ status: 'running' });
      try {
        const { loadedFingerprint } = schemaStore.getState();
        if ((await api.schema.fingerprint()) !== loadedFingerprint)
          return await changed();
        const next = {
          text: migration.text,
          statements: migration.statements,
          fingerprint: loadedFingerprint,
        };
        if (hostKind === 'remote')
          return setState({ status: 'confirming', run: next });
        await run(next);
      } catch (error) {
        fail(error);
      }
    },

    async confirm() {
      if (state.status === 'confirming') await run(state.run);
    },

    cancel: () => setState({ status: 'idle' }),
  };
}
