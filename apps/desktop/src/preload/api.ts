import type { IpcRenderer, IpcRendererEvent } from 'electron';
import {
  IPC_CHANNELS,
  IPC_EVENTS,
  type IpcEvent,
  type IpcEvents,
  type PgsketchApi,
} from '../shared/ipc-contract';

/** The part of `ipcRenderer` the bridge uses, so tests can use a stand-in. */
export type IpcClient = Pick<IpcRenderer, 'invoke' | 'on' | 'removeListener'>;

/**
 * The typed API the renderer gets as `window.api`. Only the channels and events in the contract
 * go through, whatever the renderer passes, and the renderer never gets `ipcRenderer` or the
 * event object (which would carry its sender).
 */
export function createApi(ipc: IpcClient): PgsketchApi {
  return {
    invoke: (channel, ...args) => {
      if (!IPC_CHANNELS.includes(channel))
        return Promise.reject(new Error(`Unknown channel "${channel}"`));
      return ipc.invoke(channel, ...args);
    },
    on: <E extends IpcEvent>(
      event: E,
      listener: (payload: IpcEvents[E]) => void,
    ) => {
      if (!IPC_EVENTS.includes(event))
        throw new Error(`Unknown event "${event}"`);
      const forward = (_: IpcRendererEvent, payload: IpcEvents[E]) =>
        listener(payload);
      ipc.on(event, forward);
      return () => {
        ipc.removeListener(event, forward);
      };
    },
  };
}
