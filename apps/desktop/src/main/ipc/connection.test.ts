import { describe, expect, test, vi } from 'vitest';
import type { ConnectionParams, OpenResult } from '../../shared/ipc-contract';
import { ConnectionError } from '../services/errors';
import { createSecrets } from '../services/secrets';
import { fakeIpc } from './fake-ipc';
import { registerConnection } from './connection';
import { fakeSafeStorage, fakeServerConnection, testDeps } from './test-deps';

const params: ConnectionParams = {
  kind: 'params',
  host: 'db.example.com',
  port: 5432,
  user: 'alice',
  password: 'hunter2',
  database: 'app',
  sslMode: 'require',
};

function setup(over: Parameters<typeof testDeps>[0] = {}) {
  const { deps, events } = testDeps(over);
  const ipc = fakeIpc();
  registerConnection(ipc, deps);
  const call = (channel: Parameters<typeof ipc.invoke>[0], input?: unknown) =>
    ipc.invoke(channel, input);
  return { deps, events, call };
}

const opened = (result: unknown) => {
  const r = result as OpenResult;
  if (r.status !== 'opened') throw new Error(r.message);
  return r.session;
};

describe('defaults, test and close', () => {
  test('defaults give the operating system user and the socket directory', async () => {
    expect(await setup().call('connection.defaults')).toEqual({
      osUser: 'tester',
      socketPath: '/var/run/postgresql',
    });
  });

  test('test connects, closes again, and says ok', async () => {
    const connection = fakeServerConnection();
    const { call, deps } = setup({ open: vi.fn(async () => connection) });
    expect(await call('connection.test', params)).toEqual({ ok: true });
    expect(connection.close).toHaveBeenCalledTimes(1);
    expect(deps.session.current()).toBeNull();
  });

  test('test turns any failure into a message, without the password', async () => {
    const { call } = setup({
      open: async () => {
        throw new ConnectionError('Host not found');
      },
    });
    expect(await call('connection.test', params)).toEqual({
      ok: false,
      message: 'Host not found',
    });
    const other = setup({
      open: async () => {
        throw new Error('boom postgres://alice:hunter2@h/db');
      },
    });
    expect(await other.call('connection.test', params)).toEqual({
      ok: false,
      message: 'boom postgres://alice:***@h/db',
    });
  });

  test('close ends the open database, and closing again is fine', async () => {
    const connection = fakeServerConnection();
    const { call, deps } = setup({ open: async () => connection });
    await call('connection.open', { params, remember: false });
    await call('connection.close');
    await call('connection.close');
    expect(connection.close).toHaveBeenCalledTimes(1);
    expect(deps.session.current()).toBeNull();
  });
});

describe('open', () => {
  test('without remember, nothing is saved, and the session says what it is', async () => {
    const { call, deps } = setup();
    const session = opened(
      await call('connection.open', { params, remember: false }),
    );
    expect(session).toMatchObject({
      serverVersion: '16.4',
      database: 'app',
      host: 'db.example.com',
      hostKind: 'remote',
      saved: null,
    });
    expect(session.dbKey).toMatch(/^[0-9a-f]{64}$/);
    expect(deps.connections.list()).toEqual([]);
    expect(deps.session.current()?.info).toEqual(session);
  });

  test('with remember, the connection is saved with its password encrypted', async () => {
    const { call, deps } = setup();
    const session = opened(
      await call('connection.open', { params, remember: true }),
    );
    const [saved] = deps.connections.list();
    expect(saved).toMatchObject({
      label: 'alice@db.example.com:5432/app',
      hasPassword: true,
      host: 'db.example.com',
    });
    expect(session.saved).toEqual({
      connectionId: saved?.id,
      passwordNotSaved: false,
    });
    expect(session.dbKey).toBe(`${saved?.id}:app`);
    expect(
      Buffer.from(deps.connections.passwordEnc(saved!.id)!).toString(),
    ).not.toContain('hunter2');
    expect(JSON.stringify(await call('connection.recent'))).not.toContain(
      'hunter2',
    );
  });

  test('without a keyring the connection opens and is saved, the password is not, and it says so', async () => {
    const { call, deps } = setup({
      secrets: createSecrets(fakeSafeStorage('basic_text'), () => true),
    });
    const session = opened(
      await call('connection.open', { params, remember: true }),
    );
    expect(session.saved).toMatchObject({ passwordNotSaved: true });
    expect(deps.connections.list()[0]).toMatchObject({ hasPassword: false });
    expect(deps.session.current()).not.toBeNull();
  });

  test('a connection with no password to keep is not reported as losing one', async () => {
    const { call } = setup({
      secrets: createSecrets(fakeSafeStorage('basic_text'), () => true),
    });
    const socket: ConnectionParams = {
      kind: 'socket',
      host: '/var/run/postgresql',
      port: 5432,
      user: 'me',
      database: 'app',
      sslMode: 'disable',
    };
    const session = opened(
      await call('connection.open', { params: socket, remember: true }),
    );
    expect(session.saved).toMatchObject({ passwordNotSaved: false });
    expect(session.hostKind).toBe('socket');
  });

  test('a connection string is saved without its password, which is encrypted separately', async () => {
    const { call, deps } = setup();
    opened(
      await call('connection.open', {
        params: {
          kind: 'url',
          url: 'postgres://alice:s3cr3t@h:5432/app?sslmode=require',
          database: 'app',
          sslMode: 'require',
        },
        remember: true,
      }),
    );
    const [saved] = deps.connections.list();
    expect(saved).toMatchObject({
      url: 'postgres://alice@h:5432/app',
      hasPassword: true,
    });
    expect(JSON.stringify(saved)).not.toContain('s3cr3t');
  });

  test('a failure comes back as a message, nothing is saved, and the open database stays open', async () => {
    const first = fakeServerConnection();
    let fail = false;
    const { call, deps } = setup({
      open: async () => {
        if (fail) throw new ConnectionError('Host not found');
        return first;
      },
    });
    opened(await call('connection.open', { params, remember: false }));
    fail = true;
    expect(await call('connection.open', { params, remember: true })).toEqual({
      status: 'failed',
      message: 'Host not found',
    });
    expect(deps.connections.list()).toEqual([]);
    expect(deps.session.current()?.connection).toBe(first);
    expect(first.close).not.toHaveBeenCalled();
  });

  test('opening another database closes the first', async () => {
    const connections = [fakeServerConnection(), fakeServerConnection()];
    const { call, deps } = setup({ open: async () => connections.shift()! });
    opened(await call('connection.open', { params, remember: false }));
    const first = deps.session.current()!.connection;
    opened(
      await call('connection.open', {
        params: { ...params, database: 'other' },
        remember: false,
      }),
    );
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(deps.session.current()?.info.database).toBe('other');
  });

  test('a connection that cannot be saved is closed again', async () => {
    const connection = fakeServerConnection();
    const { call, deps } = setup({ open: async () => connection });
    deps.connections.add = () => {
      throw new Error('disk full');
    };
    expect(await call('connection.open', { params, remember: true })).toEqual({
      status: 'failed',
      message: 'disk full',
    });
    expect(connection.close).toHaveBeenCalledTimes(1);
    expect(deps.session.current()).toBeNull();
  });

  test('a broken connection is reported once, with no password in it, and forgotten', async () => {
    let onLost: ((e: Error) => void) | undefined;
    const { call, deps, events } = setup({
      open: async (_, options) => {
        onLost = options?.onLost;
        return fakeServerConnection();
      },
    });
    opened(await call('connection.open', { params, remember: false }));
    onLost?.(new Error('terminated postgres://alice:hunter2@h/db'));
    onLost?.(new Error('again'));
    expect(events).toEqual([
      {
        event: 'connection:lost',
        payload: { reason: 'terminated postgres://alice:***@h/db' },
      },
    ]);
    expect(deps.session.current()).toBeNull();
  });

  test('a connection that was replaced does not report when it breaks later', async () => {
    const hooks: ((e: Error) => void)[] = [];
    const { call, events } = setup({
      open: async (_, options) => {
        hooks.push(options!.onLost!);
        return fakeServerConnection();
      },
    });
    opened(await call('connection.open', { params, remember: false }));
    opened(await call('connection.open', { params, remember: false }));
    hooks[0]?.(new Error('old one died'));
    expect(events).toEqual([]);
  });
});

describe('saved connections', () => {
  async function remembered(over: Parameters<typeof testDeps>[0] = {}) {
    const opens: ConnectionParams[] = [];
    const s = setup({
      open: async (p) => {
        opens.push(p);
        return fakeServerConnection();
      },
      ...over,
    });
    const session = opened(
      await s.call('connection.open', { params, remember: true }),
    );
    await s.call('connection.close');
    opens.length = 0;
    return { ...s, opens, id: session.saved!.connectionId };
  }

  test('openSaved decrypts the password in main, and the renderer never receives it', async () => {
    const { call, opens, id, deps } = await remembered();
    const result = await call('connection.openSaved', { connectionId: id });
    expect(opened(result).saved).toEqual({
      connectionId: id,
      passwordNotSaved: false,
    });
    expect(opens).toEqual([{ ...params, sslCaPath: undefined }]);
    expect(JSON.stringify(result)).not.toContain('hunter2');
    expect(deps.session.current()?.info.dbKey).toBe(`${id}:app`);
  });

  test('a connection string gets its password back inside the URL it opens with', async () => {
    const opens: ConnectionParams[] = [];
    const { call, deps } = setup({
      open: async (p) => (opens.push(p), fakeServerConnection()),
    });
    const first = opened(
      await call('connection.open', {
        params: {
          kind: 'url',
          url: 'postgres://alice:s3cr3t@h:5432/app',
          database: 'app',
          sslMode: 'disable',
        },
        remember: true,
      }),
    );
    opens.length = 0;
    const result = await call('connection.openSaved', {
      connectionId: first.saved!.connectionId,
    });
    expect(opened(result).host).toBe('h');
    expect(opens[0]).toMatchObject({
      kind: 'url',
      url: 'postgres://alice:s3cr3t@h:5432/app',
    });
    expect(JSON.stringify(result)).not.toContain('s3cr3t');
    expect(deps.connections.list()[0]?.url).toBe('postgres://alice@h:5432/app');
  });

  test('opening a saved connection moves it to the top of the recent list', async () => {
    const { deps, call, id } = await remembered();
    deps.connections.add({
      params: { ...params, database: 'newer' },
      label: 'newer',
      passwordEnc: null,
    });
    expect(
      ((await call('connection.recent')) as { label: string }[])[0]?.label,
    ).toBe('newer');
    await new Promise((r) => setTimeout(r, 5));
    await call('connection.openSaved', { connectionId: id });
    expect(((await call('connection.recent')) as { id: string }[])[0]?.id).toBe(
      id,
    );
  });

  test('when the password cannot be read any more, it says to enter it again and does not connect', async () => {
    const open = vi.fn(async () => fakeServerConnection());
    const { id, deps } = await remembered({ open });
    open.mockClear();
    const weak = createSecrets(fakeSafeStorage('basic_text'), () => true);
    const ipc = fakeIpc();
    registerConnection(ipc, { ...deps, secrets: weak });
    const result = (await ipc.invoke('connection.openSaved', {
      connectionId: id,
    })) as OpenResult;
    expect(result).toMatchObject({
      status: 'failed',
      message: expect.stringContaining('Enter the password again'),
    });
    expect(open).not.toHaveBeenCalled();
  });

  test('a saved connection that is gone, or fails to open, is a message', async () => {
    const { call } = setup();
    expect(
      await call('connection.openSaved', { connectionId: 'missing' }),
    ).toEqual({
      status: 'failed',
      message: 'That saved connection no longer exists',
    });
  });

  test('recent lists saved connections without passwords, and forget removes one', async () => {
    const { call, id } = await remembered();
    const recent = (await call('connection.recent')) as {
      id: string;
      hasPassword: boolean;
    }[];
    expect(recent.map((r) => r.id)).toEqual([id]);
    expect(JSON.stringify(recent)).not.toContain('hunter2');
    await call('connection.forget', { connectionId: id });
    expect(await call('connection.recent')).toEqual([]);
    await call('connection.forget', { connectionId: id });
  });
});
