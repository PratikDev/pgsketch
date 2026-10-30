import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { Draft } from '../../shared/ipc-contract';

const rowSchema = z.object({
  fingerprint: z.string(),
  desired_json: z.string(),
});

/** `%` and `_` in an id would be wildcards in a `LIKE`. */
const likeEscape = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * The edits that were not finished, one for each database (`dbKey`): the edited schema as JSON the
 * store never reads, and the fingerprint of the schema it was made on.
 */
export function createDraftsRepo(db: DatabaseSync) {
  return {
    get(dbKey: string): Draft | null {
      const row = db
        .prepare(
          'SELECT fingerprint, desired_json FROM drafts WHERE db_key = ?',
        )
        .get(dbKey);
      if (!row) return null;
      const { fingerprint, desired_json } = rowSchema.parse(row);
      return { fingerprint, desiredJson: desired_json };
    },

    /** Replaces the draft of the database, if it has one. */
    put(dbKey: string, { fingerprint, desiredJson }: Draft): void {
      db.prepare(
        `INSERT INTO drafts (db_key, fingerprint, desired_json, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (db_key) DO UPDATE SET
           fingerprint = excluded.fingerprint,
           desired_json = excluded.desired_json,
           updated_at = excluded.updated_at`,
      ).run(dbKey, fingerprint, desiredJson, Date.now());
    },

    clear(dbKey: string): void {
      db.prepare('DELETE FROM drafts WHERE db_key = ?').run(dbKey);
    },

    /** Forgets the drafts of every database that was opened through a saved connection. */
    removeForConnection(connectionId: string): void {
      db.prepare("DELETE FROM drafts WHERE db_key LIKE ? ESCAPE '\\'").run(
        `${likeEscape(connectionId)}:%`,
      );
    },
  };
}

export type DraftsRepo = ReturnType<typeof createDraftsRepo>;
