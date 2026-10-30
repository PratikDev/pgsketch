import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fingerprint } from '@pgsketch/core';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { startServer, type TestServer } from '../../../test/postgres';
import { fakeIpc } from '../ipc/fake-ipc';
import { registerSchema } from '../ipc/schema';
import { fakePoller, testDeps } from '../ipc/test-deps';
import { createNormalizer } from './normalizer';
import { openConnection, type ServerConnection } from './connection';
import { loadSchema } from './introspector';
import { startPoller, type Poller } from './poller';

const FIXTURE = join(
  process.cwd(),
  '../../packages/core/test/fixtures/basic.sql',
);
let server: TestServer;
let connection: ServerConnection;

beforeAll(async () => {
  server = await startServer(process.env.PG_VERSION ?? '16');
  await server.admin.query(readFileSync(FIXTURE, 'utf8'));
  connection = await openConnection({
    kind: 'params',
    host: server.host,
    port: server.port,
    user: server.user,
    password: server.password,
    database: server.database,
    sslMode: 'disable',
  });
});
afterAll(async () => {
  await connection?.close();
  await server?.stop();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const watch = async () => {
  const onChange = vi.fn();
  const poller: Poller = startPoller(
    () => fingerprint(connection.query),
    onChange,
    100,
  );
  await poller.ready;
  return { onChange, poller };
};

describe('the poller on a real database', () => {
  test('an ALTER TABLE from outside is one event, soon, and not repeated', async () => {
    const { onChange, poller } = await watch();
    await server.admin.query(
      'ALTER TABLE public.users ADD COLUMN nickname text',
    );
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1), {
      timeout: 5000,
    });
    await sleep(600);
    expect(onChange).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  test('ANALYZE, VACUUM and ordinary writes are none', async () => {
    const { onChange, poller } = await watch();
    await server.admin.query(
      "INSERT INTO public.users (email, nickname) SELECT 'u' || n, 'x' FROM generate_series(1, 200) n",
    );
    await server.admin.query('ANALYZE');
    await server.admin.query('VACUUM public.users');
    await server.admin.query(
      'UPDATE public.users SET nickname = upper(nickname)',
    );
    await server.admin.query('VACUUM FULL public.users');
    await server.admin.query('TRUNCATE public.users CASCADE');
    await sleep(800);
    expect(onChange).not.toHaveBeenCalled();
    poller.stop();
  });

  test('a table dropped and made again as it was is a change, the OIDs being different', async () => {
    await server.admin.query(
      'CREATE TABLE public.scratch (id integer PRIMARY KEY)',
    );
    const { onChange, poller } = await watch();
    await server.admin.query('DROP TABLE public.scratch');
    await server.admin.query(
      'CREATE TABLE public.scratch (id integer PRIMARY KEY)',
    );
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1), {
      timeout: 5000,
    });
    poller.stop();
  });
});

describe('schema.fingerprint', () => {
  test('is read from the database now, and is the one a load gives', async () => {
    const { deps } = testDeps();
    await deps.session.replace({
      connection,
      normalizer: createNormalizer(() => Promise.reject(new Error('unused'))),
      poller: fakePoller(),
      info: {
        serverVersion: '16',
        database: 'x',
        host: 'h',
        hostKind: 'local',
        dbKey: 'k',
        saved: null,
      },
    });
    const ipc = fakeIpc();
    registerSchema(ipc, deps);
    const before = await ipc.invoke('schema.fingerprint');
    expect(before).toBe((await loadSchema(connection)).fingerprint);
    await server.admin.query('CREATE TABLE public.another (id integer)');
    expect(await ipc.invoke('schema.fingerprint')).not.toBe(before);
    await server.admin.query('DROP TABLE public.another');
  });

  test('says so when no database is open', async () => {
    const ipc = fakeIpc();
    registerSchema(ipc, testDeps().deps);
    await expect(ipc.invoke('schema.fingerprint')).rejects.toThrow(
      'No database is open',
    );
  });
});
