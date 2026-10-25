import { DatabaseSync } from 'node:sqlite';

export interface Migration {
  /** The `user_version` the database has once this migration has run. */
  version: number;
  sql: string;
}

// `001_init.sql`, `002_…`: the number is the version, and the files are bundled as text
const files = import.meta.glob<string>('./migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function loadMigrations(source: Record<string, string>): Migration[] {
  return Object.entries(source)
    .map(([path, sql]) => {
      const version = Number(/\/(\d+)_[^/]*\.sql$/.exec(path)?.[1]);
      if (!Number.isInteger(version) || version < 1)
        throw new Error(`Migration file without a number: ${path}`);
      return { version, sql };
    })
    .sort((a, b) => a.version - b.version);
}

/** The migrations that ship with the app, in order. */
export const MIGRATIONS = loadMigrations(files);

const userVersion = (db: DatabaseSync): number =>
  Number(db.prepare('PRAGMA user_version').get()?.user_version);

/**
 * Brings the database up to the newest migration. Each one runs in its own transaction together
 * with the `user_version` bump, so a failure leaves the database at the last version that worked.
 * A database from a newer pgsketch is refused rather than opened and possibly damaged.
 */
export function migrate(
  db: DatabaseSync,
  migrations: Migration[] = MIGRATIONS,
): void {
  const current = userVersion(db);
  const latest = migrations.at(-1)?.version ?? 0;
  if (current > latest)
    throw new Error(
      `The app database is from a newer version of pgsketch (schema ${current}, this one knows ${latest})`,
    );
  for (const { version, sql } of migrations) {
    if (version <= current) continue;
    db.exec('BEGIN');
    try {
      db.exec(sql);
      // a PRAGMA can't take a parameter; `version` is an integer read from a file name
      db.exec(`PRAGMA user_version = ${version}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

/** Opens the app database (a file, or `:memory:`) with WAL and foreign keys on, and migrates it. */
export function openAppDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}
