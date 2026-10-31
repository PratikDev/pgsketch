import type {
  ConnectionParams,
  Draft,
  IpcArgs,
  IpcChannel,
  IpcInputs,
  IpcResults,
  Positions,
  PgsketchApi,
} from '../../shared/ipc-contract';

/** Reads `window.api` when called, so a test can put its own in place. */
const call = <C extends IpcChannel>(
  channel: C,
  ...args: IpcArgs<C>
): Promise<IpcResults[C]> => window.api.invoke(channel, ...args);

/** What the renderer asks of the main process, one function per use, typed from the contract. */
export const api = {
  connection: {
    defaults: () => call('connection.defaults'),
    test: (params: ConnectionParams) => call('connection.test', params),
    open: (params: ConnectionParams, remember: boolean) =>
      call('connection.open', { params, remember }),
    openSaved: (connectionId: string) =>
      call('connection.openSaved', { connectionId }),
    close: () => call('connection.close'),
    recent: () => call('connection.recent'),
    forget: (connectionId: string) =>
      call('connection.forget', { connectionId }),
    reconnect: () => call('connection.reconnect'),
  },
  schema: {
    load: () => call('schema.load'),
    fingerprint: () => call('schema.fingerprint'),
    casts: () => call('schema.casts'),
  },
  expr: {
    normalize: (request: IpcInputs['expr.normalize']) =>
      call('expr.normalize', request),
  },
  draft: {
    get: (dbKey: string) => call('draft.get', { dbKey }),
    put: (dbKey: string, draft: Draft) => call('draft.put', { dbKey, draft }),
    clear: (dbKey: string) => call('draft.clear', { dbKey }),
  },
  layout: {
    get: (dbKey: string, tableIds: string[]) =>
      call('layout.get', { dbKey, tableIds }),
    put: (dbKey: string, positions: Positions) =>
      call('layout.put', { dbKey, positions }),
  },
};

/** What the main process says happened, without being asked. Returns what stops listening. */
export const onEvent: PgsketchApi['on'] = (event, listener) =>
  window.api.on(event, listener);
