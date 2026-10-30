import { describe, expect, test } from 'vitest';
import { fakeIpc } from './fake-ipc';
import { registerConnection } from './connection';
import { registerDrafts } from './drafts';
import { testDeps } from './test-deps';

const draft = { fingerprint: 'abc', desiredJson: '{"a":1}' };

function setup() {
  const { deps } = testDeps();
  const ipc = fakeIpc();
  registerDrafts(ipc, deps);
  registerConnection(ipc, deps);
  return { deps, ipc };
}

describe('the draft channels', () => {
  test('a draft saved for a database is read back for it, and for no other', async () => {
    const { ipc } = setup();
    expect(await ipc.invoke('draft.get', { dbKey: 'k' })).toBeNull();
    await ipc.invoke('draft.put', { dbKey: 'k', draft });
    expect(await ipc.invoke('draft.get', { dbKey: 'k' })).toEqual(draft);
    expect(await ipc.invoke('draft.get', { dbKey: 'other' })).toBeNull();
  });

  test('clearing removes it', async () => {
    const { ipc } = setup();
    await ipc.invoke('draft.put', { dbKey: 'k', draft });
    await ipc.invoke('draft.clear', { dbKey: 'k' });
    expect(await ipc.invoke('draft.get', { dbKey: 'k' })).toBeNull();
  });

  test('a payload that does not match is rejected, before anything is saved', async () => {
    const { ipc, deps } = setup();
    await expect(ipc.invoke('draft.get', {})).rejects.toThrow('Invalid input');
    await expect(
      ipc.invoke('draft.put', { dbKey: 'k', draft: { fingerprint: 'x' } }),
    ).rejects.toThrow('Invalid input');
    await expect(
      ipc.invoke('draft.put', {
        dbKey: 'k',
        draft: { fingerprint: '', desiredJson: '{}' },
      }),
    ).rejects.toThrow('Invalid input');
    expect(deps.drafts.get('k')).toBeNull();
  });

  test('forgetting a saved connection deletes the drafts of its databases', async () => {
    const { ipc, deps } = setup();
    const saved = deps.connections.add({
      params: {
        kind: 'socket',
        host: '/s',
        port: 5432,
        user: 'u',
        database: 'app',
        sslMode: 'disable',
      },
      label: 'l',
      passwordEnc: null,
    });
    await ipc.invoke('draft.put', { dbKey: `${saved.id}:app`, draft });
    await ipc.invoke('draft.put', { dbKey: 'unsaved-hash', draft });
    await ipc.invoke('connection.forget', { connectionId: saved.id });
    expect(deps.drafts.get(`${saved.id}:app`)).toBeNull();
    expect(deps.drafts.get('unsaved-hash')).toEqual(draft);
  });
});
