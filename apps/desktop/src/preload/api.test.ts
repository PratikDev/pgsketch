import { describe, expect, test, vi } from 'vitest';
import { testDeps } from '../main/ipc/test-deps';
import { fakeIpc } from '../main/ipc/fake-ipc';
import { registerAllIpc } from '../main/ipc';
import { createApi } from './api';

describe('the bridge', () => {
  test('a call goes through the preload to main and back', async () => {
    const ipc = fakeIpc();
    registerAllIpc(ipc, testDeps().deps);
    const api = createApi(ipc);
    expect(await api.invoke('app.ping', { message: 'hello' })).toEqual({
      message: 'hello',
    });
  });

  test('main rejects a payload that does not match, through the bridge too', async () => {
    const ipc = fakeIpc();
    registerAllIpc(ipc, testDeps().deps);
    const api = createApi(ipc);
    // @ts-expect-error the types stop this; a renderer that ignores them still meets the schema
    await expect(api.invoke('app.ping', { message: 1 })).rejects.toThrow(
      'Invalid input for "app.ping"',
    );
  });

  test('a channel that is not in the contract never reaches ipcRenderer', async () => {
    const ipc = fakeIpc();
    const invoke = vi.spyOn(ipc, 'invoke');
    const api = createApi(ipc);
    // @ts-expect-error not a channel
    await expect(api.invoke('shell.openExternal', 'file:///')).rejects.toThrow(
      'Unknown channel',
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  test('events reach the listener with the payload alone, until it unsubscribes', () => {
    const ipc = fakeIpc();
    const api = createApi(ipc);
    const lost = vi.fn();
    const changed = vi.fn();
    const stop = api.on('connection:lost', lost);
    api.on('schema:changed', changed);
    ipc.send('connection:lost', { reason: 'gone' });
    ipc.send('schema:changed');
    expect(lost).toHaveBeenCalledExactlyOnceWith({ reason: 'gone' });
    expect(changed).toHaveBeenCalledTimes(1);
    stop();
    ipc.send('connection:lost', { reason: 'again' });
    expect(lost).toHaveBeenCalledTimes(1);
  });

  test('an unknown event is refused', () => {
    // @ts-expect-error not an event
    expect(() => createApi(fakeIpc()).on('anything', vi.fn())).toThrow(
      'Unknown event',
    );
  });

  test('nothing but invoke and on is exposed', () => {
    expect(Object.keys(createApi(fakeIpc())).sort()).toEqual(['invoke', 'on']);
  });
});
