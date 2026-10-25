import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, test } from 'vitest';
import { MIGRATIONS, migrate, openAppDb } from './db';

const tempPath = () =>
  join(mkdtempSync(join(tmpdir(), 'pgsketch-db-')), 'pgsketch.db');

const version = (db: DatabaseSync) =>
  Number(db.prepare('PRAGMA user_version').get()?.user_version);
const tables = (db: DatabaseSync) =>
  db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
    )
    .all()
    .map((r) => String(r.name));
const columns = (db: DatabaseSync, table: string) =>
  db
    .prepare(`SELECT name, "notnull" AS required FROM pragma_table_info(?)`)
    .all(table)
    .map((r) => [String(r.name), Number(r.required)] as const);

describe('the app database', () => {
  test('a new file reaches user_version 1 with all four tables and the SSL and URL columns', () => {
    const db = openAppDb(tempPath());
    expect(version(db)).toBe(1);
    expect(tables(db)).toEqual([
      'connections',
      'drafts',
      'layouts',
      'settings',
    ]);
    expect(columns(db, 'connections')).toEqual([
      ['id', 0],
      ['label', 1],
      ['kind', 1],
      ['host', 0],
      ['port', 0],
      ['user_name', 0],
      ['database', 1],
      ['url', 0],
      ['ssl_mode', 1],
      ['ssl_ca_path', 0],
      ['password_enc', 0],
      ['last_used_at', 1],
    ]);
    expect(columns(db, 'drafts').map(([name]) => name)).toEqual([
      'db_key',
      'fingerprint',
      'desired_json',
      'updated_at',
    ]);
    expect(columns(db, 'layouts').map(([name]) => name)).toEqual([
      'db_key',
      'object_id',
      'x',
      'y',
    ]);
    expect(columns(db, 'settings').map(([name]) => name)).toEqual([
      'key',
      'value',
    ]);
    db.close();
  });

  test('WAL and foreign keys are on', () => {
    const db = openAppDb(tempPath());
    expect(db.prepare('PRAGMA journal_mode').get()?.journal_mode).toBe('wal');
    expect(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
    db.close();
  });

  test('opening it again changes nothing and keeps the rows', () => {
    const path = tempPath();
    const first = openAppDb(path);
    first.prepare(`INSERT INTO settings VALUES ('theme', '"dark"')`).run();
    first.close();
    const second = openAppDb(path);
    expect(version(second)).toBe(1);
    expect(second.prepare('SELECT value FROM settings').all()).toEqual([
      { value: '"dark"' },
    ]);
    second.close();
  });

  test('the migrations that ship are numbered from 1 with no gaps', () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual(
      MIGRATIONS.map((_, i) => i + 1),
    );
  });
});

describe('migrate', () => {
  const steps = [
    { version: 1, sql: 'CREATE TABLE a (x INTEGER)' },
    { version: 2, sql: 'ALTER TABLE a ADD COLUMN y TEXT' },
    { version: 3, sql: 'CREATE TABLE b (z INTEGER)' },
  ];

  test('runs only the steps the database has not had', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, steps.slice(0, 2));
    expect(version(db)).toBe(2);
    migrate(db, steps);
    expect(version(db)).toBe(3);
    expect(tables(db)).toEqual(['a', 'b']);
    expect(columns(db, 'a').map(([name]) => name)).toEqual(['x', 'y']);
  });

  test('a step that fails is rolled back, and the earlier ones stay', () => {
    const db = new DatabaseSync(':memory:');
    const broken = [
      steps[0]!,
      {
        version: 2,
        sql: 'CREATE TABLE c (q INTEGER); SELECT nope FROM nowhere',
      },
    ];
    expect(() => migrate(db, broken)).toThrow();
    expect(version(db)).toBe(1);
    expect(tables(db)).toEqual(['a']);
    // fixed, it runs from where it stopped
    migrate(db, steps);
    expect(version(db)).toBe(3);
  });

  test('a database from a newer pgsketch is refused and left alone', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db, steps);
    expect(() => migrate(db, steps.slice(0, 1))).toThrow(
      'newer version of pgsketch (schema 3, this one knows 1)',
    );
    expect(version(db)).toBe(3);
  });
});
