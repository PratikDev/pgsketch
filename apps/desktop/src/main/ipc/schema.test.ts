import { describe, expect, test } from 'vitest';
import { fakeIpc } from './fake-ipc';
import { registerSchema } from './schema';
import { testDeps } from './test-deps';

describe('schema.load', () => {
  test('says so when no database is open, instead of reading anything', async () => {
    const ipc = fakeIpc();
    registerSchema(ipc, testDeps().deps);
    await expect(ipc.invoke('schema.load')).rejects.toThrow(
      'No database is open',
    );
  });

  test('takes no input', async () => {
    const ipc = fakeIpc();
    registerSchema(ipc, testDeps().deps);
    await expect(ipc.invoke('schema.load', { x: 1 })).rejects.toThrow(
      'Invalid input',
    );
  });
});
