import { readFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { startServer, type TestServer } from '../test/postgres';
import { launchApp, launchWithKeyring } from './app';

let server: TestServer;
// the container's own user, password and database are all "test", which is no use for
// checking that a password never shows up somewhere
const USER = 'e2e_user';
const PASSWORD = 'pw-9f3c1d7a-e2e';

test.beforeAll(async () => {
  test.setTimeout(120_000);
  server = await startServer(process.env.PG_VERSION ?? '16');
  await server.admin.query(`CREATE ROLE ${USER} LOGIN PASSWORD '${PASSWORD}'`);
  await server.admin.query(
    `GRANT CONNECT ON DATABASE ${server.database} TO ${USER}`,
  );
});

test.afterAll(async () => {
  await server?.stop();
});

const params = (over: Record<string, unknown> = {}) => ({
  kind: 'params',
  host: server.host,
  port: server.port,
  user: USER,
  password: PASSWORD,
  database: server.database,
  sslMode: 'disable',
  ...over,
});

/** Calls a channel from the page, like the renderer does, and gives back what came back. */
const invoke = <T>(window: Page, channel: string, input?: unknown) =>
  window.evaluate<T>(
    `window.api.invoke(${JSON.stringify(channel)}${input === undefined ? '' : `, ${JSON.stringify(input)}`})`,
  );

test('the defaults are the operating system user and the socket directory', async () => {
  const { app, window } = await launchApp();
  expect(await invoke(window, 'connection.defaults')).toEqual({
    osUser: userInfo().username,
    socketPath: '/var/run/postgresql',
  });
  await app.close();
});

test('connection.test reaches the container, and says what is wrong when it cannot', async () => {
  const { app, window } = await launchApp();
  expect(await invoke(window, 'connection.test', params())).toEqual({
    ok: true,
  });
  expect(
    await invoke(window, 'connection.test', params({ password: 'wrong' })),
  ).toEqual({
    ok: false,
    message: `Password authentication failed for user "${USER}"`,
  });
  expect(
    await invoke(window, 'connection.test', params({ port: 1 })),
  ).toMatchObject({
    ok: false,
    message: expect.stringContaining("Couldn't reach Postgres"),
  });
  await app.close();
});

test('a saved connection opens without the renderer ever receiving the password', async () => {
  const { window, dataDir, close } = await launchWithKeyring();
  const seen: unknown[] = [];
  const call = async <T>(channel: string, input?: unknown) => {
    const result = await invoke<T>(window, channel, input);
    seen.push(result);
    return result;
  };

  const opened = await call<{
    status: string;
    session: { saved: { connectionId: string; passwordNotSaved: boolean } };
  }>('connection.open', { params: params(), remember: true });
  expect(opened.status).toBe('opened');
  // without a system keyring a password is never kept, and then there is nothing to open with
  test.skip(
    opened.session.saved.passwordNotSaved,
    'this system has no keyring to keep passwords in',
  );

  const recent =
    await call<{ id: string; hasPassword: boolean; database: string }[]>(
      'connection.recent',
    );
  expect(recent).toHaveLength(1);
  expect(recent[0]).toMatchObject({
    hasPassword: true,
    database: server.database,
  });

  await call('connection.close');
  const again = await call<{
    status: string;
    session: { serverVersion: string; dbKey: string };
  }>('connection.openSaved', { connectionId: recent[0]!.id });
  expect(again.status).toBe('opened');
  expect(again.session.dbKey).toBe(`${recent[0]!.id}:${server.database}`);

  // nothing the renderer got back, and nothing in the log, holds the password
  expect(JSON.stringify(seen)).not.toContain(PASSWORD);
  expect(readFileSync(join(dataDir, 'main.log'), 'utf8')).not.toContain(
    PASSWORD,
  );

  await call('connection.forget', { connectionId: recent[0]!.id });
  expect(await call('connection.recent')).toEqual([]);
  await close();
});

test('a connection that fails to open comes back as a message', async () => {
  const { app, window } = await launchApp();
  expect(
    await invoke(window, 'connection.open', {
      params: params({ database: 'nope' }),
      remember: true,
    }),
  ).toEqual({
    status: 'failed',
    message: "Database doesn't exist on this server",
  });
  expect(await invoke(window, 'connection.recent')).toEqual([]);
  await app.close();
});
