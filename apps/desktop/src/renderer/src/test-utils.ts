import type {
  IpcChannel,
  IpcResults,
  IpcArgs,
  PgsketchApi,
  SessionInfo,
} from '../../shared/ipc-contract';

type Handlers = {
  [C in IpcChannel]?: (...args: IpcArgs<C>) => IpcResults[C];
};

/**
 * A stand-in for `window.api` whose channels answer from `handlers`; a channel with no handler
 * fails the test that calls it. Every call is recorded in the returned list.
 */
export function installFakeApi(handlers: Handlers) {
  const calls: { channel: IpcChannel; args: unknown[] }[] = [];
  const invoke: PgsketchApi['invoke'] = async (channel, ...args) => {
    calls.push({ channel, args });
    const handler = handlers[channel];
    if (!handler) throw new Error(`No fake for ${channel}`);
    return handler(...args);
  };
  window.api = { invoke, on: () => () => undefined };
  return calls;
}

/** An open database on this machine, with whatever a test wants different. */
export const testSession = (over: Partial<SessionInfo> = {}): SessionInfo => ({
  serverVersion: '16.4',
  database: 'app',
  host: 'localhost',
  hostKind: 'local',
  dbKey: 'k',
  saved: null,
  ...over,
});
