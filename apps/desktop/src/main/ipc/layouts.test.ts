import { describe, expect, test } from 'vitest';
import { fakeIpc } from './fake-ipc';
import { registerConnection } from './connection';
import { registerLayouts } from './layouts';
import { testDeps } from './test-deps';

const positions = { 't:1': { x: 1, y: 2 }, 't:2': { x: 3, y: 4 } };

function setup() {
  const { deps } = testDeps();
  const ipc = fakeIpc();
  registerLayouts(ipc, deps);
  registerConnection(ipc, deps);
  return { deps, ipc };
}

describe('the layout channels', () => {
  test('positions saved for a database are read back for it, and for no other', async () => {
    const { ipc } = setup();
    await ipc.invoke('layout.put', { dbKey: 'k', positions });
    expect(
      await ipc.invoke('layout.get', { dbKey: 'k', tableIds: ['t:1', 't:2'] }),
    ).toEqual(positions);
    expect(
      await ipc.invoke('layout.get', { dbKey: 'other', tableIds: ['t:1'] }),
    ).toEqual({});
  });

  test('reading drops the tables that are gone, for good', async () => {
    const { ipc, deps } = setup();
    await ipc.invoke('layout.put', { dbKey: 'k', positions });
    expect(
      await ipc.invoke('layout.get', { dbKey: 'k', tableIds: ['t:2'] }),
    ).toEqual({ 't:2': positions['t:2'] });
    expect(deps.layouts.get('k')).toEqual({ 't:2': positions['t:2'] });
  });

  test('saving again replaces the positions', async () => {
    const { ipc } = setup();
    await ipc.invoke('layout.put', { dbKey: 'k', positions });
    await ipc.invoke('layout.put', {
      dbKey: 'k',
      positions: { 't:1': { x: 9, y: 9 } },
    });
    expect(
      await ipc.invoke('layout.get', { dbKey: 'k', tableIds: ['t:1', 't:2'] }),
    ).toEqual({ 't:1': { x: 9, y: 9 } });
  });

  test('a payload that does not match is rejected', async () => {
    const { ipc } = setup();
    await expect(ipc.invoke('layout.get', { dbKey: 'k' })).rejects.toThrow(
      'Invalid input',
    );
    await expect(
      ipc.invoke('layout.put', {
        dbKey: 'k',
        positions: { 't:1': { x: 'a', y: 1 } },
      }),
    ).rejects.toThrow('Invalid input');
  });

  test('forgetting a saved connection deletes the layouts of its databases', async () => {
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
    await ipc.invoke('layout.put', { dbKey: `${saved.id}:app`, positions });
    await ipc.invoke('layout.put', { dbKey: 'unsaved-hash', positions });
    await ipc.invoke('connection.forget', { connectionId: saved.id });
    expect(deps.layouts.get(`${saved.id}:app`)).toEqual({});
    expect(deps.layouts.get('unsaved-hash')).toEqual(positions);
    expect(deps.connections.get(saved.id)).toBeUndefined();
  });
});
