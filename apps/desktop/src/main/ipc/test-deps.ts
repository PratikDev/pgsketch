import { vi } from 'vitest';
import type { IpcEvent } from '../../shared/ipc-contract';
import { createSession } from '../session';
import type { ServerConnection } from '../services/connection';
import type { Poller } from '../services/poller';
import { createSecrets, type SafeStorageLike } from '../services/secrets';
import { openAppDb } from '../store/db';
import { createConnectionsRepo } from '../store/connections';
import { createDraftsRepo } from '../store/drafts';
import { createLayoutsRepo } from '../store/layouts';
import type { IpcDeps } from './deps';

/** A connection that needs no server, which remembers what was asked of it. */
export function fakeServerConnection(
  over: Partial<ServerConnection> = {},
): ServerConnection & { close: ReturnType<typeof vi.fn> } {
  const query = vi.fn(async () => []);
  return {
    serverVersion: '16.4',
    originalSearchPath: '"$user", public',
    exclusive: (work) => work(query),
    query,
    ...over,
    close: vi.fn(async () => undefined),
  };
}

/** A poller that looks at nothing. */
export const fakePoller = (): Poller => ({
  ready: Promise.resolve(),
  stop: vi.fn(),
});

/** A keyring that "encrypts" by reversing the bytes, with the backend to choose. */
export function fakeSafeStorage(
  backend: ReturnType<
    SafeStorageLike['getSelectedStorageBackend']
  > = 'gnome_libsecret',
): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => backend,
    encryptString: (text) => Buffer.from(text).reverse(),
    decryptString: (data) => Buffer.from(data).reverse().toString(),
  };
}

/** Dependencies for the handlers that touch no server: a real in-memory store and a fake keyring. */
export function testDeps(over: Partial<IpcDeps> = {}) {
  const events: { event: IpcEvent; payload: unknown }[] = [];
  const db = openAppDb(':memory:');
  const deps: IpcDeps = {
    connections: createConnectionsRepo(db),
    layouts: createLayoutsRepo(db),
    drafts: createDraftsRepo(db),
    secrets: createSecrets(fakeSafeStorage(), () => true),
    session: createSession(),
    emit: (event, ...payload) => {
      events.push({ event, payload: payload[0] });
    },
    open: async () => fakeServerConnection(),
    openTask: async () => ({
      ...fakeServerConnection(),
      rolledBack: (work) => work(async () => []),
    }),
    // so far apart that no test sees one
    pollMs: 3_600_000,
    osUser: 'tester',
    socketPath: '/var/run/postgresql',
    ...over,
  };
  return { deps, events };
}
