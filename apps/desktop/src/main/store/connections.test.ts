import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, test } from 'vitest';
import type { ConnectionParams } from '../../shared/ipc-contract';
import { createConnectionsRepo, splitConnectionUrl } from './connections';
import { openAppDb } from './db';

const params: ConnectionParams = {
  kind: 'params',
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'never-stored',
  database: 'app',
  sslMode: 'disable',
};

let db: DatabaseSync;
let clock: number;
let ids: number;
const repo = () =>
  createConnectionsRepo(
    db,
    () => clock,
    () => `id-${++ids}`,
  );

beforeEach(() => {
  db = openAppDb(':memory:');
  clock = 1_000;
  ids = 0;
});

const everything = () =>
  JSON.stringify(db.prepare('SELECT * FROM connections').all(), (_, v) =>
    v instanceof Uint8Array ? Array.from(v) : v,
  );

describe('the connections repository', () => {
  test('inserts, lists by recency, and deletes', () => {
    const r = repo();
    const a = r.add({ params, label: 'a', passwordEnc: null });
    clock = 2_000;
    const b = r.add({
      params: { ...params, database: 'b' },
      label: 'b',
      passwordEnc: null,
    });
    clock = 3_000;
    const c = r.add({
      params: { ...params, database: 'c' },
      label: 'c',
      passwordEnc: null,
    });
    expect(r.list().map((x) => x.label)).toEqual(['c', 'b', 'a']);

    clock = 4_000;
    r.touch(a.id);
    expect(r.list().map((x) => x.label)).toEqual(['a', 'c', 'b']);
    expect(r.get(a.id)?.lastUsedAt).toBe(4_000);

    expect(r.remove(b.id)).toBe(true);
    expect(r.remove(b.id)).toBe(false);
    expect(r.list().map((x) => x.id)).toEqual([a.id, c.id]);
    expect(r.get(b.id)).toBeUndefined();
  });

  test('connections used at the same moment list the one saved last first', () => {
    const r = repo();
    r.add({ params, label: 'first', passwordEnc: null });
    r.add({ params, label: 'second', passwordEnc: null });
    expect(r.list().map((x) => x.label)).toEqual(['second', 'first']);
  });

  test('each kind is stored in its own columns', () => {
    const r = repo();
    const fields = r.add({
      params: { ...params, sslMode: 'require' },
      label: 'p',
      passwordEnc: null,
    });
    const socket = r.add({
      params: {
        kind: 'socket',
        host: '/var/run/postgresql',
        port: 5433,
        user: 'me',
        database: 'app',
        sslMode: 'disable',
      },
      label: 's',
      passwordEnc: null,
    });
    const url = r.add({
      params: {
        kind: 'url',
        url: 'postgres://u@h:5432/app',
        database: 'app',
        sslMode: 'verify-full',
        sslCaPath: '/etc/ca.pem',
      },
      label: 'u',
      passwordEnc: null,
    });
    expect(fields).toMatchObject({
      kind: 'params',
      host: 'localhost',
      port: 5432,
      user: 'postgres',
      database: 'app',
      url: null,
      sslMode: 'require',
      sslCaPath: null,
      hasPassword: false,
    });
    expect(socket).toMatchObject({
      kind: 'socket',
      host: '/var/run/postgresql',
      port: 5433,
      user: 'me',
      url: null,
    });
    expect(url).toMatchObject({
      kind: 'url',
      host: null,
      port: null,
      user: null,
      url: 'postgres://u@h:5432/app',
      sslMode: 'verify-full',
      sslCaPath: '/etc/ca.pem',
    });
  });

  test('a URL is stored without its password or sslmode', () => {
    const r = repo();
    const saved = r.add({
      params: {
        kind: 'url',
        url: 'postgres://alice:s3cr3t@db.example.com:5432/app?sslmode=require&application_name=x',
        database: 'app',
        sslMode: 'require',
      },
      label: 'u',
      passwordEnc: null,
    });
    expect(saved.url).toBe(
      'postgres://alice@db.example.com:5432/app?application_name=x',
    );
    expect(everything()).not.toContain('s3cr3t');
    expect(everything()).not.toContain('sslmode');
  });

  test('the password is never part of a saved connection, only whether there is one', () => {
    const r = repo();
    const saved = r.add({
      params,
      label: 'p',
      passwordEnc: new Uint8Array([1, 2, 3]),
    });
    expect(saved.hasPassword).toBe(true);
    expect(Object.keys(saved)).not.toContain('password');
    expect(JSON.stringify(r.list())).not.toContain('never-stored');
    expect(Array.from(r.passwordEnc(saved.id) ?? [])).toEqual([1, 2, 3]);
    expect(everything()).not.toContain('never-stored');

    const none = r.add({ params, label: 'n', passwordEnc: null });
    expect(none.hasPassword).toBe(false);
    expect(r.passwordEnc(none.id)).toBeNull();
    expect(r.passwordEnc('missing')).toBeNull();
  });

  test('values are stored as given, whatever they contain', () => {
    const r = repo();
    const odd = `x'); DROP TABLE connections; --`;
    const saved = r.add({
      params: { ...params, database: odd, user: odd },
      label: odd,
      passwordEnc: null,
    });
    expect(r.get(saved.id)).toMatchObject({
      database: odd,
      user: odd,
      label: odd,
    });
    expect(r.list()).toHaveLength(1);
  });
});

describe('splitConnectionUrl', () => {
  test('takes the password out of the user info, decoded', () => {
    expect(
      splitConnectionUrl('postgres://alice:p%40ss%2Fw%3Ard@h:5432/db'),
    ).toEqual({
      url: 'postgres://alice@h:5432/db',
      password: 'p@ss/w:rd',
    });
  });

  test('takes it from ?password= too, and drops sslmode and sslpassword', () => {
    expect(
      splitConnectionUrl(
        'postgresql://alice@h/db?password=abc&sslmode=verify-full&sslpassword=k&application_name=a%20b',
      ),
    ).toEqual({
      url: 'postgresql://alice@h/db?application_name=a+b',
      password: 'abc',
    });
  });

  test('a URL with no password stays as it is, and has none', () => {
    expect(splitConnectionUrl('postgres://alice@h:5432/db')).toEqual({
      url: 'postgres://alice@h:5432/db',
      password: null,
    });
    expect(splitConnectionUrl('postgres://h/db')).toEqual({
      url: 'postgres://h/db',
      password: null,
    });
  });

  test('a socket directory in the host survives', () => {
    expect(
      splitConnectionUrl('postgres://u:pw@%2Fvar%2Frun%2Fpostgresql/db').url,
    ).toBe('postgres://u@%2Fvar%2Frun%2Fpostgresql/db');
  });

  test('anything else is refused, and the error does not repeat the text', () => {
    for (const bad of [
      'not a url',
      'host=h password=secret-one dbname=d',
      'http://u:secret-two@h/db',
    ]) {
      let message = '';
      try {
        splitConnectionUrl(bad);
      } catch (error) {
        message = error instanceof Error ? error.message : '';
      }
      expect(message, bad).not.toBe('');
      expect(message).not.toContain('secret');
    }
  });

  test('a password with a broken escape is kept as it was written', () => {
    expect(splitConnectionUrl('postgres://u:100%@h/db').password).toBe('100%');
  });
});
