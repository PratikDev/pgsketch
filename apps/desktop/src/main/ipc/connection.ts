import type {
  ConnectionParams,
  OpenResult,
  SessionInfo,
} from '../../shared/ipc-contract';
import { redact } from '../log';
import { ConnectionError } from '../services/errors';
import { SecretsUnavailableError } from '../services/secrets';
import {
  dbKeyFor,
  hostKindOf,
  labelFor,
  paramsOfSaved,
  passwordOf,
  targetOf,
} from '../services/session-info';
import type { IpcDeps } from './deps';
import { registerIpc, type IpcRegistry } from './register';

/** What went wrong, as a message that is safe to show: ours as they are, anything else without passwords. */
const messageOf = (error: unknown): string =>
  error instanceof ConnectionError
    ? error.message
    : redact(error instanceof Error ? error.message : String(error));

export function registerConnection(ipc: IpcRegistry, deps: IpcDeps): void {
  const { connections, layouts, secrets, session, emit } = deps;

  /**
   * Connects, makes it the window's open database (closing the one it replaces) and describes it.
   * `afterOpen` runs once the connection works and says what was saved; if it fails the new
   * connection is closed again. If connecting fails the earlier database stays open.
   */
  async function start(
    params: ConnectionParams,
    afterOpen: () => SessionInfo['saved'],
  ): Promise<SessionInfo> {
    const connection = await deps.open(params, {
      onLost: (error) => {
        if (session.lost(connection))
          emit('connection:lost', { reason: redact(error.message) });
      },
    });
    try {
      const saved = afterOpen();
      const info: SessionInfo = {
        serverVersion: connection.serverVersion,
        database: params.database,
        host: targetOf(params).host,
        hostKind: hostKindOf(params),
        dbKey: dbKeyFor(params, saved?.connectionId ?? null),
        saved,
      };
      await session.replace({ connection, info });
      return info;
    } catch (error) {
      await connection.close().catch(() => undefined);
      throw error;
    }
  }

  /** Remembers a connection that has just opened; its password only if there is a keyring to keep it in. */
  function remember(params: ConnectionParams): SessionInfo['saved'] {
    const password = passwordOf(params);
    const keep = password !== undefined && secrets.problem() === null;
    const saved = connections.add({
      params,
      label: labelFor(params),
      passwordEnc: keep ? secrets.encrypt(password) : null,
    });
    return {
      connectionId: saved.id,
      passwordNotSaved: password !== undefined && !keep,
    };
  }

  const opened = async (
    run: () => Promise<SessionInfo>,
  ): Promise<OpenResult> => {
    try {
      return { status: 'opened', session: await run() };
    } catch (error) {
      return { status: 'failed', message: messageOf(error) };
    }
  };

  registerIpc(ipc, 'connection.defaults', () => ({
    osUser: deps.osUser,
    socketPath: deps.socketPath,
  }));

  registerIpc(ipc, 'connection.test', async (params) => {
    try {
      const connection = await deps.open(params);
      await connection.close();
      return { ok: true };
    } catch (error) {
      return { ok: false, message: messageOf(error) };
    }
  });

  registerIpc(ipc, 'connection.open', ({ params, remember: keep }) =>
    opened(() => start(params, () => (keep ? remember(params) : null))),
  );

  registerIpc(ipc, 'connection.openSaved', ({ connectionId }) =>
    opened(async () => {
      const saved = connections.get(connectionId);
      if (!saved)
        throw new ConnectionError('That saved connection no longer exists');
      const encrypted = connections.passwordEnc(connectionId);
      let password: string | undefined;
      if (encrypted) {
        try {
          password = secrets.decrypt(encrypted);
        } catch (error) {
          throw new ConnectionError(
            error instanceof SecretsUnavailableError
              ? `${error.message}. Enter the password again.`
              : "The saved password couldn't be read. Enter it again.",
          );
        }
      }
      const info = await start(paramsOfSaved(saved, password), () => ({
        connectionId,
        passwordNotSaved: false,
      }));
      connections.touch(connectionId);
      return info;
    }),
  );

  registerIpc(ipc, 'connection.close', () => session.close());

  registerIpc(ipc, 'connection.recent', () => connections.list());

  registerIpc(ipc, 'connection.forget', ({ connectionId }) => {
    connections.remove(connectionId);
    // what was saved about its databases goes with it
    layouts.removeForConnection(connectionId);
  });
}
