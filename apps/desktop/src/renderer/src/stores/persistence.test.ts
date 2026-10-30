import { act } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fixtureModel } from '@/test-model';
import { createPersistence, type PersistenceDeps } from './persistence';
import { schemaStore } from './schema';

const casts = { categories: {}, domains: {}, casts: {} };
const put = vi.fn<PersistenceDeps['put']>(async () => undefined);
const clear = vi.fn<PersistenceDeps['clear']>(async () => undefined);
const persistence = () => createPersistence({ put, clear, debounceMs: 1000 });
const edit = () =>
  act(() => schemaStore.getState().renameTable('t:10', `n${Math.random()}`));

beforeEach(() => {
  vi.useFakeTimers();
  put.mockClear();
  clear.mockClear();
  act(() =>
    schemaStore
      .getState()
      .load({ model: fixtureModel, casts, fingerprint: 'fp-1' }),
  );
});
afterEach(() => vi.useRealTimers());

describe('createPersistence', () => {
  test('saves nothing until something is edited', async () => {
    const p = persistence();
    p.start('k');
    await vi.advanceTimersByTimeAsync(10_000);
    await p.stop();
    expect(put).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });

  test('saves the edited schema with its fingerprint a second after the last edit, once', async () => {
    const p = persistence();
    p.start('k');
    edit();
    await vi.advanceTimersByTimeAsync(600);
    edit();
    await vi.advanceTimersByTimeAsync(600);
    expect(put).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(400);
    expect(put).toHaveBeenCalledOnce();
    const [dbKey, draft] = put.mock.calls[0] as unknown as [
      string,
      { fingerprint: string; desiredJson: string },
    ];
    expect(dbKey).toBe('k');
    expect(draft.fingerprint).toBe('fp-1');
    expect(JSON.parse(draft.desiredJson)).toEqual(
      schemaStore.getState().desired,
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(put).toHaveBeenCalledOnce();
    await p.stop();
  });

  test('when the edits come to nothing it removes the draft instead', async () => {
    const p = persistence();
    p.start('k');
    act(() => schemaStore.getState().renameTable('t:10', 'people'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(put).toHaveBeenCalledOnce();
    act(() => schemaStore.getState().renameTable('t:10', 'users'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(clear).toHaveBeenCalledExactlyOnceWith('k');
    await p.stop();
  });

  test('flush saves at once, and stop saves what is left and then watches no more', async () => {
    const p = persistence();
    p.start('k');
    edit();
    await p.flush();
    expect(put).toHaveBeenCalledOnce();
    edit();
    await p.stop();
    expect(put).toHaveBeenCalledTimes(2);
    edit();
    await vi.advanceTimersByTimeAsync(5000);
    expect(put).toHaveBeenCalledTimes(2);
  });

  test('a save that fails is tried again with the next edit or flush', async () => {
    const p = persistence();
    p.start('k');
    put.mockRejectedValueOnce(new Error('disk full'));
    edit();
    await vi.advanceTimersByTimeAsync(1000);
    expect(put).toHaveBeenCalledOnce();
    await p.flush();
    expect(put).toHaveBeenCalledTimes(2);
    await p.stop();
  });

  test('starting for another database saves what was left for the first, and keeps them apart', async () => {
    const p = persistence();
    p.start('first');
    edit();
    p.start('second');
    expect(put).toHaveBeenCalledOnce();
    expect(put.mock.calls[0]![0]).toBe('first');
    edit();
    await vi.advanceTimersByTimeAsync(1000);
    expect(put).toHaveBeenCalledTimes(2);
    expect(put.mock.calls[1]![0]).toBe('second');
    await p.stop();
  });

  test('loading a schema again, which has no edits, removes the draft', async () => {
    const p = persistence();
    p.start('k');
    edit();
    await vi.advanceTimersByTimeAsync(1000);
    act(() =>
      schemaStore
        .getState()
        .load({ model: fixtureModel, casts, fingerprint: 'fp-2' }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(clear).toHaveBeenCalledWith('k');
    await p.stop();
  });
});
