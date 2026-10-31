import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

/** Small values the app remembers between runs, by key, as JSON. */
export function createSettingsRepo(db: DatabaseSync) {
  return {
    /** The value saved under `key`, or `undefined` when there is none or it is not what `schema` accepts. */
    get<T>(key: string, schema: z.ZodType<T>): T | undefined {
      const row = db
        .prepare('SELECT value FROM settings WHERE key = ?')
        .get(key);
      if (!row) return undefined;
      try {
        const parsed = schema.safeParse(JSON.parse(String(row.value)));
        return parsed.success ? parsed.data : undefined;
      } catch {
        return undefined;
      }
    },

    set(key: string, value: unknown): void {
      db.prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      ).run(key, JSON.stringify(value));
    },
  };
}

export type SettingsRepo = ReturnType<typeof createSettingsRepo>;
