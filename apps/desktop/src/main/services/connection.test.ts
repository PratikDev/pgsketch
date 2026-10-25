import { describe, expect, test } from 'vitest';
import { clientConfigFor } from './connection';

const base = { database: 'app', sslMode: 'disable' } as const;

describe('clientConfigFor', () => {
  test('separate fields', () => {
    expect(
      clientConfigFor({
        kind: 'params',
        host: 'db',
        port: 6543,
        user: 'u',
        password: 'pw',
        ...base,
      }),
    ).toEqual({
      config: {
        host: 'db',
        port: 6543,
        user: 'u',
        password: 'pw',
        database: 'app',
        application_name: 'pgsketch',
        connectionTimeoutMillis: 5000,
      },
      target: { host: 'db', port: 6543, user: 'u' },
    });
  });

  test('a socket has a directory as its host and no password', () => {
    const { config, target } = clientConfigFor({
      kind: 'socket',
      host: '/var/run/postgresql',
      port: 5432,
      user: 'me',
      ...base,
    });
    expect(config).toMatchObject({
      host: '/var/run/postgresql',
      user: 'me',
      password: undefined,
    });
    expect(target).toEqual({
      host: '/var/run/postgresql',
      port: 5432,
      user: 'me',
    });
  });

  test('a URL gives its parts, with the password taken out of it and sslmode ignored', () => {
    const { config, target } = clientConfigFor({
      kind: 'url',
      url: 'postgres://alice:p%40ss@db.example.com:6000/ignored?sslmode=verify-full&application_name=other',
      ...base,
    });
    expect(config).toMatchObject({
      host: 'db.example.com',
      port: 6000,
      user: 'alice',
      password: 'p@ss',
      database: 'app',
      application_name: 'pgsketch',
    });
    expect(config).not.toHaveProperty('ssl');
    expect(config).not.toHaveProperty('connectionString');
    expect(target).toEqual({
      host: 'db.example.com',
      port: 6000,
      user: 'alice',
    });
  });

  test('a URL without a port or user falls back to the usual ones in messages', () => {
    const { config, target } = clientConfigFor({
      kind: 'url',
      url: 'postgres://h/db',
      ...base,
    });
    expect(config.port).toBeUndefined();
    expect(target).toEqual({ host: 'h', port: 5432, user: null });
  });

  test('a URL that is not one is refused without repeating it', () => {
    expect(() =>
      clientConfigFor({ kind: 'url', url: 'password=secret-x', ...base }),
    ).toThrow('Not a valid connection string');
  });
});
