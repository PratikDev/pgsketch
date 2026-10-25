import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { ConnectionParams } from '../../shared/ipc-contract';
import {
  makeCertificates,
  startServer,
  type Certificates,
  type TestServer,
} from '../../../test/postgres';
import { openMainConnection, type MainConnection } from './connection';
import { ConnectionError } from './errors';

const version = process.env.PG_VERSION ?? '16';
let plain: TestServer;
let secure: TestServer;
let certificates: Certificates;
const open: MainConnection[] = [];

beforeAll(async () => {
  certificates = makeCertificates();
  [plain, secure] = await Promise.all([
    startServer(version),
    startServer(version, certificates),
  ]);
});

afterAll(async () => {
  await Promise.all(open.map((c) => c.close().catch(() => undefined)));
  await Promise.all([plain?.stop(), secure?.stop()]);
});

const paramsFor = (
  server: TestServer,
  over: Partial<Extract<ConnectionParams, { kind: 'params' }>> = {},
): ConnectionParams => ({
  kind: 'params',
  host: server.host,
  port: server.port,
  user: server.user,
  password: server.password,
  database: server.database,
  sslMode: 'disable',
  ...over,
});

async function connect(params: ConnectionParams, onLost?: (e: Error) => void) {
  const connection = await openMainConnection(params, { onLost });
  open.push(connection);
  return connection;
}

/** The message of the `ConnectionError` that opening these parameters ends in. */
async function failure(params: ConnectionParams): Promise<string> {
  try {
    await connect(params);
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectionError);
    return (error as Error).message;
  }
  throw new Error('connected');
}

const usesSsl = async (c: MainConnection) =>
  (
    await c.query<{ ssl: boolean }>(
      'SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()',
    )
  )[0]?.ssl;

describe('the main connection', () => {
  test('connects, records the search_path and pins it, and names itself', async () => {
    const c = await connect(paramsFor(plain));
    expect(c.serverVersion.split('.')[0]).toBe(version);
    expect(c.originalSearchPath).toBe('"$user", public');
    expect(
      (await c.query<{ search_path: string }>('SHOW search_path'))[0]
        ?.search_path,
    ).toBe('""'); // pinned to an empty path, which Postgres shows as two quotes
    expect(
      (
        await c.query<{ n: string }>(
          `SELECT current_setting('application_name') AS n`,
        )
      )[0]?.n,
    ).toBe('pgsketch');
  });

  test('a URL connects with its password, and its sslmode is ignored', async () => {
    const url = `postgres://${plain.user}:${plain.password}@${plain.host}:${plain.port}/${plain.database}?sslmode=verify-full`;
    const c = await connect({
      kind: 'url',
      url,
      database: plain.database,
      sslMode: 'disable',
    });
    expect(await usesSsl(c)).toBe(false);
  });

  test('queries from different callers never interleave', async () => {
    const c = await connect(paramsFor(plain));
    const events: string[] = [];
    const section = (name: string, wait: number) =>
      c.exclusive(async (q) => {
        events.push(`${name} start`);
        await q('BEGIN');
        await q('SELECT pg_sleep($1)', [wait]);
        events.push(`${name} middle`);
        await q('COMMIT');
        events.push(`${name} end`);
      });
    await Promise.all([
      section('a', 0.15),
      section('b', 0.05),
      section('c', 0),
    ]);
    expect(events).toEqual([
      'a start',
      'a middle',
      'a end',
      'b start',
      'b middle',
      'b end',
      'c start',
      'c middle',
      'c end',
    ]);
    // a single statement waits for a running section too
    const order: string[] = [];
    await Promise.all([
      section('d', 0.1).then(() => order.push('d')),
      c.query('SELECT 1').then(() => order.push('single')),
    ]);
    expect(order).toEqual(['d', 'single']);
  });

  test('a failed section does not block the next one', async () => {
    const c = await connect(paramsFor(plain));
    await expect(c.exclusive(async (q) => q('SELECT nope'))).rejects.toThrow();
    expect(await c.query('SELECT 1 AS one')).toEqual([{ one: 1 }]);
  });

  test('a broken connection is reported and does not crash anything', async () => {
    const lost: Error[] = [];
    const c = await connect(paramsFor(plain), (e) => lost.push(e));
    const [pid] = await c.query<{ pid: number }>(
      'SELECT pg_backend_pid() AS pid',
    );
    await plain.admin.query('SELECT pg_terminate_backend($1)', [pid?.pid]);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(lost).toHaveLength(1);
  });

  test('close ends the connection', async () => {
    const c = await openMainConnection(paramsFor(plain));
    await c.close();
    await expect(c.query('SELECT 1')).rejects.toThrow();
  });
});

describe('SSL', () => {
  test('require connects encrypted without checking the server', async () => {
    expect(
      await usesSsl(await connect(paramsFor(secure, { sslMode: 'require' }))),
    ).toBe(true);
  });

  test('disable still works on a server that offers SSL, in plaintext', async () => {
    expect(await usesSsl(await connect(paramsFor(secure)))).toBe(false);
  });

  test('verify-full connects when the CA signed the certificate and the host matches', async () => {
    const c = await connect(
      paramsFor(secure, {
        host: 'localhost',
        sslMode: 'verify-full',
        sslCaPath: certificates.caPath,
      }),
    );
    expect(await usesSsl(c)).toBe(true);
  });

  test('verify-full with the wrong CA fails with the certificate message', async () => {
    expect(
      await failure(
        paramsFor(secure, {
          host: 'localhost',
          sslMode: 'verify-full',
          sslCaPath: certificates.wrongCaPath,
        }),
      ),
    ).toBe(
      "The server's certificate couldn't be verified with the given CA file",
    );
  });

  test("verify-full fails when the host name is not the certificate's", async () => {
    expect(
      await failure(
        paramsFor(secure, {
          host: '127.0.0.1',
          sslMode: 'verify-full',
          sslCaPath: certificates.caPath,
        }),
      ),
    ).toBe(
      "The server's certificate couldn't be verified with the given CA file",
    );
  });

  test('verify-full with an unreadable CA file says so', async () => {
    expect(
      await failure(
        paramsFor(secure, {
          sslMode: 'verify-full',
          sslCaPath: '/nonexistent/ca.pem',
        }),
      ),
    ).toBe("Couldn't read the CA certificate file");
  });

  test('prefer is encrypted when the server offers SSL, and falls back when it does not', async () => {
    expect(
      await usesSsl(await connect(paramsFor(secure, { sslMode: 'prefer' }))),
    ).toBe(true);
    expect(
      await usesSsl(await connect(paramsFor(plain, { sslMode: 'prefer' }))),
    ).toBe(false);
  });

  test('require on a server without SSL says so, instead of falling back', async () => {
    expect(await failure(paramsFor(plain, { sslMode: 'require' }))).toBe(
      "The server doesn't accept SSL connections; choose disable or prefer",
    );
  });

  test('prefer does not hide other failures behind a second attempt', async () => {
    expect(
      await failure(paramsFor(plain, { sslMode: 'prefer', password: 'wrong' })),
    ).toBe(`Password authentication failed for user "${plain.user}"`);
  });
});

describe('failures', () => {
  test('each signal reads as the plan says', async () => {
    expect(await failure(paramsFor(plain, { password: 'wrong' }))).toBe(
      `Password authentication failed for user "${plain.user}"`,
    );
    expect(
      await failure(paramsFor(plain, { database: 'does_not_exist' })),
    ).toBe("Database doesn't exist on this server");
    await plain.admin
      .query(`CREATE ROLE locked LOGIN PASSWORD 'x' NOLOGIN`)
      .catch(() => undefined);
    await plain.admin.query(`CREATE ROLE blocked PASSWORD 'x'`);
    expect(
      await failure(paramsFor(plain, { user: 'blocked', password: 'x' })),
    ).toBe('Authentication rejected (check pg_hba.conf or the peer auth user)');
    expect(await failure(paramsFor(plain, { port: 1 }))).toBe(
      `Couldn't reach Postgres at ${plain.host}:1. Is it running?`,
    );
    expect(
      await failure(paramsFor(plain, { host: 'no-such-host.invalid' })),
    ).toBe('Host not found');
  });

  test('the message never holds the password', async () => {
    const message = await failure(
      paramsFor(plain, { password: 'hunter2-secret' }),
    );
    expect(message).not.toContain('hunter2-secret');
  });
});

describe('server versions', () => {
  test('Postgres 13 is rejected, with its version in the message', async () => {
    const old = await startServer('13');
    try {
      const message = await failure(paramsFor(old));
      expect(message).toMatch(
        /^pgsketch needs Postgres 14 or newer \(found 13\.\d+\)$/,
      );
    } finally {
      await old.stop();
    }
  });
});
