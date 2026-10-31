import { renderMigration, type Migration } from '@pgsketch/core';
import { useEffect, useState } from 'react';
import { api } from '@/api';
import { generateBlocker } from '@/chrome/generate-state';
import { derived, type OpRisk } from '@/stores/derived';
import { schemaStore, useSchemaStore } from '@/stores/schema';
import { useUiStore } from '@/stores/ui';
import { messageOf } from '@/lib/errors';

export type MigrationState =
  /** Being made: checking the database, reading the casts, rendering. */
  | { status: 'working' }
  /** Can't be made now, and why (see `generateBlocker`). */
  | { status: 'blocked'; reason: string }
  | { status: 'ready'; migration: Migration; risks: OpRisk[] }
  /** Something went wrong in making it, so there is none: generation never goes on without a check. */
  | { status: 'failed'; message: string };

/**
 * The SQL for the edits as they are, made again whenever they or the loaded schema change. Before
 * it is made, the database is asked for its fingerprint, which must be the one the schema was
 * loaded with, not what the poller last saw: if it differs, `onSchemaChanged` looks at the change
 * first, and the SQL is made from whatever that leaves (the edits applied and taken, so nothing to
 * generate; or a stale schema, which blocks). Nothing here ever makes SQL for a database that has
 * changed under the edits.
 */
export function useMigration(
  dbName: string,
  onSchemaChanged: () => Promise<void>,
): MigrationState {
  const [state, setState] = useState<MigrationState>({ status: 'working' });
  const version = useSchemaStore((s) => s.version);
  const loadedFingerprint = useSchemaStore((s) => s.loadedFingerprint);
  const stale = useSchemaStore((s) => s.stale);
  const lost = useUiStore((s) => s.connectionLost);

  useEffect(() => {
    const { baseline, desired } = schemaStore.getState();
    const { ops, errors, named, risks } = derived(baseline, desired);
    const reason = generateBlocker({
      changes: ops.length,
      errors,
      stale,
      lost,
    });
    if (reason !== null) return setState({ status: 'blocked', reason });

    let current = true;
    setState({ status: 'working' });
    (async () => {
      const now = await api.schema.fingerprint();
      if (!current) return;
      if (now !== loadedFingerprint) {
        await onSchemaChanged();
        const after = schemaStore.getState();
        // taken or stale: the store changed, and this runs again with what it is now
        if (
          !current ||
          after.loadedFingerprint !== loadedFingerprint ||
          after.stale
        )
          return;
        // nothing changed: it is generated only if the database is now what was loaded
        if ((await api.schema.fingerprint()) !== loadedFingerprint)
          return setState({
            status: 'blocked',
            reason:
              'The database changed outside pgsketch, and the change is not taken yet.',
          });
      }
      const casts = await api.schema.casts();
      if (!current) return;
      setState({
        status: 'ready',
        risks,
        migration: renderMigration(ops, {
          baseline,
          desired: named,
          casts,
          generatedAt: new Date().toISOString(),
          dbName,
        }),
      });
    })().catch((error: unknown) => {
      if (current)
        setState({
          status: 'failed',
          message: messageOf(error),
        });
    });
    return () => {
      current = false;
    };
  }, [version, loadedFingerprint, stale, lost, dbName, onSchemaChanged]);

  return state;
}
