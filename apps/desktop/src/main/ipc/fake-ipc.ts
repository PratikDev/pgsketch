import type {
  IpcMainInvokeEvent,
  IpcRenderer,
  IpcRendererEvent,
} from 'electron';
import type { IpcClient } from '../../preload/api';
import type { IpcRegistry } from './register';

type Listener = (event: IpcMainInvokeEvent, raw: unknown) => unknown;

// Electron passes an event first and returns the emitter from `on`; neither is ever looked at here
const event: IpcMainInvokeEvent = Object.create(null);
const rendererEvent: IpcRendererEvent = Object.create(null);
const emitter: IpcRenderer = Object.create(null);

type EventListener = (event: IpcRendererEvent, ...args: unknown[]) => void;

/**
 * `ipcMain` and `ipcRenderer` in one object for tests: handlers registered on it are called by
 * `invoke`, the way a call crosses the process boundary, and `send` pushes an event to listeners.
 */
export function fakeIpc(): IpcRegistry &
  IpcClient & { send: (channel: string, payload?: unknown) => void } {
  const handlers = new Map<string, Listener>();
  const listeners = new Map<string, Set<EventListener>>();
  return {
    handle: (channel, listener) => {
      // Electron throws the same way, which is how a channel registered twice shows up
      if (handlers.has(channel))
        throw new Error(
          `Attempted to register a second handler for '${channel}'`,
        );
      handlers.set(channel, listener);
    },
    invoke: async (channel, raw) => {
      const listener = handlers.get(channel);
      if (!listener) throw new Error(`No handler registered for '${channel}'`);
      return listener(event, raw);
    },
    on(channel, listener) {
      const set = listeners.get(channel) ?? new Set();
      set.add(listener);
      listeners.set(channel, set);
      return emitter;
    },
    removeListener(channel, listener) {
      listeners.get(channel)?.delete(listener);
      return emitter;
    },
    send: (channel, payload) => {
      for (const listener of listeners.get(channel) ?? [])
        listener(rendererEvent, payload);
    },
  };
}
