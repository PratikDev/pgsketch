import { describe, expect, test, vi } from 'vitest';
import type { NormalizedExpression } from '@pgsketch/core';
import { fakeIpc } from './fake-ipc';
import { registerExpr } from './expr';
import { fakePoller, fakeServerConnection, testDeps } from './test-deps';

const input = {
  expression: "'active'",
  target: { kind: 'default' as const, columnId: 'c1' },
  columns: [
    { id: 'c1', name: 'status', type: { name: 'text', isArray: false } },
  ],
};

describe('expr.normalize', () => {
  test('says so when no database is open', async () => {
    const ipc = fakeIpc();
    registerExpr(ipc, testDeps().deps);
    await expect(ipc.invoke('expr.normalize', input)).rejects.toThrow(
      'No database is open',
    );
  });

  test("hands the request to the open database's normalizer, and returns its answer", async () => {
    const answer: NormalizedExpression = {
      status: 'normalized',
      expression: "'active'::text",
      columnIds: [],
    };
    const normalizer = {
      normalize: vi.fn(async () => answer),
      close: vi.fn(async () => undefined),
    };
    const { deps } = testDeps();
    await deps.session.replace({
      connection: fakeServerConnection(),
      normalizer,
      poller: fakePoller(),
      info: {
        serverVersion: '16',
        database: 'x',
        host: 'h',
        hostKind: 'local',
        dbKey: 'k',
        saved: null,
      },
    });
    const ipc = fakeIpc();
    registerExpr(ipc, deps);
    expect(await ipc.invoke('expr.normalize', input)).toEqual(answer);
    expect(normalizer.normalize).toHaveBeenCalledWith(input);
  });

  test('refuses input that is not a request, before anything runs', async () => {
    const ipc = fakeIpc();
    registerExpr(ipc, testDeps().deps);
    await expect(
      ipc.invoke('expr.normalize', { ...input, target: { kind: 'other' } }),
    ).rejects.toThrow('Invalid input');
  });
});
