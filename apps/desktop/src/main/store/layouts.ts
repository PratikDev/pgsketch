import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { Positions } from '../../shared/ipc-contract';

const rowSchema = z.object({
  object_id: z.string(),
  x: z.number(),
  y: z.number(),
});

/** `%` and `_` in an id would be wildcards in a `LIKE`. */
const likeEscape = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Where the tables of each database were last put on the canvas, keyed by `dbKey`. */
export function createLayoutsRepo(db: DatabaseSync) {
  return {
    get(dbKey: string): Positions {
      return Object.fromEntries(
        db
          .prepare('SELECT object_id, x, y FROM layouts WHERE db_key = ?')
          .all(dbKey)
          .map((row) => rowSchema.parse(row))
          .map(({ object_id, x, y }) => [object_id, { x, y }]),
      );
    },

    /** Replaces everything saved for the database with these positions, all or nothing. */
    put(dbKey: string, positions: Positions): void {
      db.exec('BEGIN');
      try {
        db.prepare('DELETE FROM layouts WHERE db_key = ?').run(dbKey);
        const insert = db.prepare(
          'INSERT INTO layouts (db_key, object_id, x, y) VALUES (?, ?, ?, ?)',
        );
        for (const [objectId, { x, y }] of Object.entries(positions))
          insert.run(dbKey, objectId, x, y);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },

    /** Forgets the positions of every table that is not among `keep`. */
    prune(dbKey: string, keep: string[]): void {
      db.prepare(
        `DELETE FROM layouts
          WHERE db_key = ? AND object_id NOT IN (SELECT value FROM json_each(?))`,
      ).run(dbKey, JSON.stringify(keep));
    },

    /** Forgets the positions of every database that was opened through a saved connection. */
    removeForConnection(connectionId: string): void {
      db.prepare("DELETE FROM layouts WHERE db_key LIKE ? ESCAPE '\\'").run(
        `${likeEscape(connectionId)}:%`,
      );
    },
  };
}

export type LayoutsRepo = ReturnType<typeof createLayoutsRepo>;
