import { describe, expect, test } from 'vitest';
import type {
  ConnectionParams,
  SavedConnection,
} from '../../shared/ipc-contract';
import {
  dbKeyFor,
  hostKindOf,
  labelFor,
  paramsOfSaved,
  passwordOf,
} from './session-info';

const fields = (
  host: string,
  over: Partial<Extract<ConnectionParams, { kind: 'params' }>> = {},
): ConnectionParams => ({
  kind: 'params',
  host,
  port: 5432,
  user: 'u',
  password: 'pw',
  database: 'app',
  sslMode: 'disable',
  ...over,
});

describe('hostKindOf', () => {
  test.each([
    ['localhost', 'local'],
    ['127.0.0.1', 'local'],
    ['::1', 'local'],
    ['LocalHost', 'local'],
    ['db.example.com', 'remote'],
    ['10.0.0.5', 'remote'],
    ['/var/run/postgresql', 'socket'],
  ])('%s is %s', (host, kind) => {
    expect(hostKindOf(fields(host))).toBe(kind);
  });

  test('a socket connection, and URLs of each kind', () => {
    expect(
      hostKindOf({
        kind: 'socket',
        host: '/tmp',
        port: 5432,
        user: 'u',
        database: 'a',
        sslMode: 'disable',
      }),
    ).toBe('socket');
    const url = (u: string): ConnectionParams => ({
      kind: 'url',
      url: u,
      database: 'a',
      sslMode: 'disable',
    });
    expect(hostKindOf(url('postgres://u@localhost/a'))).toBe('local');
    expect(hostKindOf(url('postgres://u@db.example.com/a'))).toBe('remote');
    expect(hostKindOf(url('postgres://u@%2Fvar%2Frun%2Fpostgresql/a'))).toBe(
      'socket',
    );
  });
});

describe('dbKeyFor', () => {
  test('a saved connection is its id and the database', () => {
    expect(dbKeyFor(fields('h'), 'abc')).toBe('abc:app');
  });

  test('an unsaved one is a hash of host, port, user and database, and nothing else', () => {
    const key = dbKeyFor(fields('h'), null);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(
      dbKeyFor(fields('h', { password: 'other', sslMode: 'require' }), null),
    ).toBe(key);
    for (const changed of [
      fields('h2'),
      fields('h', { port: 5433 }),
      fields('h', { user: 'v' }),
      fields('h', { database: 'b' }),
    ])
      expect(dbKeyFor(changed, null)).not.toBe(key);
  });

  test('a URL and the same fields give the same key', () => {
    const url: ConnectionParams = {
      kind: 'url',
      url: 'postgres://u:pw@h:5432/app',
      database: 'app',
      sslMode: 'disable',
    };
    expect(dbKeyFor(url, null)).toBe(dbKeyFor(fields('h'), null));
  });
});

describe('labels and passwords', () => {
  test('a label names the user, host, port and database, and no password', () => {
    expect(labelFor(fields('h'))).toBe('u@h:5432/app');
    expect(
      labelFor({
        kind: 'socket',
        host: '/tmp',
        port: 5432,
        user: 'me',
        database: 'a',
        sslMode: 'disable',
      }),
    ).toBe('me@/tmp/a');
    expect(
      labelFor({
        kind: 'url',
        url: 'postgres://x:secret@h/db',
        database: 'db',
        sslMode: 'disable',
      }),
    ).toBe('x@h:5432/db');
  });

  test('the password is in its field or in the URL, and a socket has none', () => {
    expect(passwordOf(fields('h'))).toBe('pw');
    expect(passwordOf(fields('h', { password: undefined }))).toBeUndefined();
    expect(
      passwordOf({
        kind: 'url',
        url: 'postgres://u:p%40ss@h/db',
        database: 'db',
        sslMode: 'disable',
      }),
    ).toBe('p@ss');
    expect(
      passwordOf({
        kind: 'socket',
        host: '/tmp',
        port: 5432,
        user: 'me',
        database: 'a',
        sslMode: 'disable',
      }),
    ).toBeUndefined();
  });
});

describe('paramsOfSaved', () => {
  const saved = (over: Partial<SavedConnection>): SavedConnection => ({
    id: 'i',
    label: 'l',
    kind: 'params',
    host: 'h',
    port: 5432,
    user: 'u',
    database: 'app',
    url: null,
    sslMode: 'verify-full',
    sslCaPath: '/ca.pem',
    hasPassword: true,
    lastUsedAt: 1,
    ...over,
  });

  test('fields get their password back, and keep the SSL settings', () => {
    expect(paramsOfSaved(saved({}), 'pw')).toEqual({
      kind: 'params',
      host: 'h',
      port: 5432,
      user: 'u',
      password: 'pw',
      database: 'app',
      sslMode: 'verify-full',
      sslCaPath: '/ca.pem',
    });
  });

  test('a socket takes no password', () => {
    expect(
      paramsOfSaved(saved({ kind: 'socket', host: '/tmp' }), 'pw'),
    ).not.toHaveProperty('password');
  });

  test('a URL gets the password put back inside it', () => {
    const params = paramsOfSaved(
      saved({
        kind: 'url',
        host: null,
        port: null,
        user: null,
        url: 'postgres://u@h:5432/app',
      }),
      'p@ss/w',
    );
    expect(params).toMatchObject({ kind: 'url' });
    expect(passwordOf(params)).toBe('p@ss/w');
    expect(
      paramsOfSaved(
        saved({
          kind: 'url',
          host: null,
          port: null,
          user: null,
          url: 'postgres://u@h/app',
        }),
        undefined,
      ),
    ).toMatchObject({
      url: 'postgres://u@h/app',
    });
  });

  test('an incomplete row is refused', () => {
    expect(() => paramsOfSaved(saved({ host: null }), undefined)).toThrow(
      'incomplete',
    );
    expect(() =>
      paramsOfSaved(saved({ kind: 'url', url: null }), undefined),
    ).toThrow('incomplete');
  });
});
