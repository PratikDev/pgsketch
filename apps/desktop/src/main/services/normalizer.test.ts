import type { NormalizedExpression } from '@pgsketch/core';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fakeServerConnection } from '../ipc/test-deps';
import { createNormalizer, IDLE_MS } from './normalizer';
import type { TaskConnection } from './task-connection';

// what Postgres says is not the question here: that the connection is shared, queued and closed is
const asked = vi.hoisted(() => ({ order: [] as string[], delay: 0 }));
vi.mock('@pgsketch/core', async (original) => ({
  ...(await original<typeof import('@pgsketch/core')>()),
  normalizeExpression: async (
    _query: unknown,
    expression: string,
  ): Promise<NormalizedExpression> => {
    asked.order.push(`start ${expression}`);
    if (asked.delay > 0) await new Promise((r) => setTimeout(r, asked.delay));
    asked.order.push(`end ${expression}`);
    return {
      status: 'normalized',
      expression: `${expression}!`,
      columnIds: [],
    };
  },
}));

const task = (): TaskConnection => {
  // like the real one, work runs one at a time
  let tail: Promise<unknown> = Promise.resolve();
  const connection = fakeServerConnection();
  return {
    ...connection,
    exclusive: (work) => {
      const run = tail.then(() => work(connection.query));
      tail = run.catch(() => undefined);
      return run;
    },
    rolledBack: (work) => work(connection.query),
  };
};
const request = (expression: string) => ({
  expression,
  target: { kind: 'check' as const },
  columns: [],
});

beforeEach(() => {
  asked.order = [];
  asked.delay = 0;
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('createNormalizer', () => {
  test('answers with what the connection returns', async () => {
    const normalizer = createNormalizer(async () => task());
    expect(await normalizer.normalize(request('a'))).toEqual({
      status: 'normalized',
      expression: 'a!',
      columnIds: [],
    });
  });

  test('opens one connection for many requests', async () => {
    const open = vi.fn(async () => task());
    const normalizer = createNormalizer(open);
    await Promise.all([
      normalizer.normalize(request('a')),
      normalizer.normalize(request('b')),
    ]);
    await normalizer.normalize(request('c'));
    expect(open).toHaveBeenCalledTimes(1);
  });

  test('runs requests one after another', async () => {
    asked.delay = 10;
    const normalizer = createNormalizer(async () => task());
    const all = Promise.all([
      normalizer.normalize(request('a')),
      normalizer.normalize(request('b')),
    ]);
    await vi.advanceTimersByTimeAsync(50);
    await all;
    expect(asked.order).toEqual(['start a', 'end a', 'start b', 'end b']);
  });

  test('closes the connection after 30 seconds with no request, and opens another for the next', async () => {
    const connections: TaskConnection[] = [];
    const open = vi.fn(async () => {
      const connection = task();
      connections.push(connection);
      return connection;
    });
    const normalizer = createNormalizer(open);
    await normalizer.normalize(request('a'));
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1);
    expect(connections[0]!.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(connections[0]!.close).toHaveBeenCalledTimes(1);
    await normalizer.normalize(request('b'));
    expect(open).toHaveBeenCalledTimes(2);
  });

  test('a request restarts the 30 seconds', async () => {
    const connection = task();
    const normalizer = createNormalizer(async () => connection);
    await normalizer.normalize(request('a'));
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1000);
    await normalizer.normalize(request('b'));
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1000);
    expect(connection.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(connection.close).toHaveBeenCalledTimes(1);
  });

  test('is not closed while a request is still running', async () => {
    asked.delay = IDLE_MS * 2;
    const connection = task();
    const normalizer = createNormalizer(async () => connection);
    const slow = normalizer.normalize(request('a'));
    await vi.advanceTimersByTimeAsync(IDLE_MS + 1);
    expect(connection.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(IDLE_MS * 2);
    await slow;
  });

  test('a connection that failed to open is tried again by the next request', async () => {
    const open = vi
      .fn<() => Promise<TaskConnection>>()
      .mockRejectedValueOnce(new Error('refused'))
      .mockImplementation(async () => task());
    const normalizer = createNormalizer(open);
    await expect(normalizer.normalize(request('a'))).rejects.toThrow('refused');
    expect(await normalizer.normalize(request('b'))).toMatchObject({
      status: 'normalized',
    });
    expect(open).toHaveBeenCalledTimes(2);
  });

  test('a connection that broke is not used again', async () => {
    let lost: (error: Error) => void = () => undefined;
    const open = vi.fn(async (onLost: (error: Error) => void) => {
      lost = onLost;
      return task();
    });
    const normalizer = createNormalizer(open);
    await normalizer.normalize(request('a'));
    lost(new Error('terminated'));
    await normalizer.normalize(request('b'));
    expect(open).toHaveBeenCalledTimes(2);
  });

  test('close closes the connection at once, and is fine with none open', async () => {
    const connection = task();
    const normalizer = createNormalizer(async () => connection);
    await normalizer.close();
    await normalizer.normalize(request('a'));
    await normalizer.close();
    expect(connection.close).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(IDLE_MS * 2);
    expect(connection.close).toHaveBeenCalledTimes(1);
  });
});
