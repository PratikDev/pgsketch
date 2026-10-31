import { describe, expect, test, vi } from 'vitest';
import { fakeIpc } from './fake-ipc';
import { registerFiles } from './files';
import { registerSql } from './sql';
import { fakePoller, fakeServerConnection, testDeps } from './test-deps';
import { createNormalizer } from '../services/normalizer';

const input = { statements: ['SELECT 1'], fingerprint: 'f' };

describe('the sql channels', () => {
  test('validate needs an open database', async () => {
    const ipc = fakeIpc();
    registerSql(ipc, testDeps().deps);
    await expect(ipc.invoke('sql.validate', input)).rejects.toThrow(
      'No database is open',
    );
  });

  test("validate hands the statements and fingerprint to the open database's validator", async () => {
    const { deps } = testDeps();
    const validator = {
      validate: vi.fn(async () => ({ status: 'stale' as const })),
    };
    await deps.session.replace({
      connection: fakeServerConnection(),
      normalizer: createNormalizer(() => Promise.reject(new Error('unused'))),
      validator,
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
    registerSql(ipc, deps);
    expect(await ipc.invoke('sql.validate', input)).toEqual({
      status: 'stale',
    });
    expect(validator.validate).toHaveBeenCalledWith(['SELECT 1'], 'f');
  });

  test('save answers with what the file service did', async () => {
    const { deps } = testDeps();
    const ipc = fakeIpc();
    registerFiles(ipc, deps);
    expect(
      await ipc.invoke('sql.save', {
        text: 'SELECT 1;',
        suggestedName: 'a.sql',
      }),
    ).toEqual({ status: 'cancelled' });
  });
});
