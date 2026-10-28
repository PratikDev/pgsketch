import type {
  ConnectionParams,
  IpcArgs,
  IpcChannel,
  IpcResults,
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
  },
  schema: {
    load: () => call('schema.load'),
  },
};
