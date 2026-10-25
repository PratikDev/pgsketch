import { describe, expect, test, vi } from 'vitest';
import { testDeps } from './test-deps';
import { fakeIpc } from './fake-ipc';
import { registerAllIpc } from './index';
import { IpcValidationError, registerIpc } from './register';

describe('registerIpc', () => {
  test('a ping round-trips, and the handler gets the parsed input', async () => {
    const ipc = fakeIpc();
    const handler = vi.fn(({ message }: { message: string }) => ({ message }));
    registerIpc(ipc, 'app.ping', handler);
    expect(await ipc.invoke('app.ping', { message: 'hi', extra: 1 })).toEqual({
      message: 'hi',
    });
    expect(handler).toHaveBeenCalledWith({ message: 'hi' }, expect.anything());
  });

  test('an invalid payload is rejected in main and the handler never runs', async () => {
    const ipc = fakeIpc();
    const handler = vi.fn();
    registerIpc(ipc, 'app.ping', handler);
    for (const payload of [undefined, null, {}, { message: 5 }, 'hi']) {
      await expect(ipc.invoke('app.ping', payload)).rejects.toBeInstanceOf(
        IpcValidationError,
      );
    }
    expect(handler).not.toHaveBeenCalled();
  });

  test('the message names the channel and field, and never repeats a value', async () => {
    const ipc = fakeIpc();
    registerIpc(ipc, 'connection.test', vi.fn());
    const error = await ipc
      .invoke('connection.test', {
        kind: 'params',
        host: 'h',
        port: 99999,
        user: 'u',
        password: 'hunter2-secret',
        database: 'd',
        sslMode: 'weird-mode',
      })
      .catch((e: Error) => e);
    expect(error).toBeInstanceOf(IpcValidationError);
    const message = (error as Error).message;
    expect(message).toContain('Invalid input for "connection.test"');
    expect(message).toContain('port');
    expect(message).toContain('sslMode');
    expect(message).not.toContain('hunter2-secret');
    expect(message).not.toContain('99999');
    expect(message).not.toContain('weird-mode');
  });

  test('an error thrown by the handler reaches the caller', async () => {
    const ipc = fakeIpc();
    registerIpc(ipc, 'app.ping', async () => {
      throw new Error('boom');
    });
    await expect(ipc.invoke('app.ping', { message: 'x' })).rejects.toThrow(
      'boom',
    );
  });

  test('a channel with no input takes none, and one with input does not run without it', async () => {
    const ipc = fakeIpc();
    registerIpc(ipc, 'connection.close', () => undefined);
    await expect(ipc.invoke('connection.close')).resolves.toBeUndefined();
    await expect(
      ipc.invoke('connection.close', { x: 1 }),
    ).rejects.toBeInstanceOf(IpcValidationError);
  });
});

describe('registerAllIpc', () => {
  test('registers every domain once, including ping', async () => {
    const ipc = fakeIpc();
    registerAllIpc(ipc, testDeps().deps);
    expect(await ipc.invoke('app.ping', { message: 'pong' })).toEqual({
      message: 'pong',
    });
    expect(() => registerAllIpc(ipc, testDeps().deps)).toThrow(
      'second handler',
    );
  });
});
