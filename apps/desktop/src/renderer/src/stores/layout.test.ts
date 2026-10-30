import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createLayoutStore, type LayoutDeps, type Positions } from './layout';

let saved: [string, Positions][];
let stored: Positions;
let deps: LayoutDeps;

beforeEach(() => {
  vi.useFakeTimers();
  saved = [];
  stored = {};
  deps = {
    get: vi.fn(async () => stored),
    put: vi.fn(async (dbKey, positions) => void saved.push([dbKey, positions])),
    debounceMs: 500,
  };
});
afterEach(() => vi.useRealTimers());

const opened = async (positions: Positions = {}) => {
  stored = positions;
  const store = createLayoutStore(deps);
  await store.getState().restore('k', ['t:1', 't:2']);
  return store;
};

describe('restoring', () => {
  test('reads what was saved for the database, and says it has', async () => {
    const store = createLayoutStore(deps);
    expect(store.getState()).toMatchObject({
      loaded: false,
      positions: {},
      dbKey: null,
    });
    stored = { 't:1': { x: 1, y: 2 } };
    await store.getState().restore('k', ['t:1', 't:2']);
    expect(deps.get).toHaveBeenCalledWith('k', ['t:1', 't:2']);
    expect(store.getState()).toMatchObject({
      loaded: true,
      dbKey: 'k',
      positions: stored,
    });
  });

  test('a layout that cannot be read is an empty one, and the canvas can still open', async () => {
    deps.get = vi.fn(async () => {
      throw new Error('disk');
    });
    const store = createLayoutStore(deps);
    await store.getState().restore('k', []);
    expect(store.getState()).toMatchObject({ loaded: true, positions: {} });
  });

  test('is not loaded while it reads, and an answer for a database that was left is ignored', async () => {
    let answer: (p: Positions) => void = () => undefined;
    deps.get = vi.fn((dbKey) =>
      dbKey === 'old'
        ? new Promise<Positions>((r) => (answer = r))
        : Promise.resolve({ 't:9': { x: 9, y: 9 } }),
    );
    const store = createLayoutStore(deps);
    const slow = store.getState().restore('old', []);
    expect(store.getState().loaded).toBe(false);
    await store.getState().restore('new', []);
    answer({ 't:1': { x: 1, y: 1 } });
    await slow;
    expect(store.getState()).toMatchObject({
      dbKey: 'new',
      positions: { 't:9': { x: 9, y: 9 } },
    });
  });
});

describe('moving and saving', () => {
  test('a move shows at once, and is saved after a pause, once', async () => {
    const store = await opened();
    store.getState().move('t:1', { x: 5, y: 6 });
    expect(store.getState().positions['t:1']).toEqual({ x: 5, y: 6 });
    expect(saved).toEqual([]);
    await vi.advanceTimersByTimeAsync(499);
    expect(saved).toEqual([]);
    await vi.advanceTimersByTimeAsync(2);
    expect(saved).toEqual([['k', { 't:1': { x: 5, y: 6 } }]]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(saved).toHaveLength(1);
  });

  test('a drag is one save with where it ended, however many moves it had', async () => {
    const store = await opened();
    for (let x = 0; x < 50; x++) {
      store.getState().move('t:1', { x, y: x });
      await vi.advanceTimersByTimeAsync(10);
    }
    await vi.advanceTimersByTimeAsync(500);
    expect(saved).toEqual([['k', { 't:1': { x: 49, y: 49 } }]]);
  });

  test('a save has every position, not only the one that moved', async () => {
    const store = await opened({
      't:1': { x: 1, y: 1 },
      't:2': { x: 2, y: 2 },
    });
    store.getState().move('t:2', { x: 20, y: 20 });
    await store.getState().flush();
    expect(saved[0]![1]).toEqual({
      't:1': { x: 1, y: 1 },
      't:2': { x: 20, y: 20 },
    });
  });

  test('tables the layout placed are saved too, without touching the others', async () => {
    const store = await opened({ 't:1': { x: 1, y: 1 } });
    store.getState().place({ 't:2': { x: 8, y: 8 } });
    await store.getState().flush();
    expect(saved[0]![1]).toEqual({
      't:1': { x: 1, y: 1 },
      't:2': { x: 8, y: 8 },
    });
  });

  test('flush saves right away, and does nothing when there is nothing new', async () => {
    const store = await opened();
    await store.getState().flush();
    expect(saved).toEqual([]);
    store.getState().move('t:1', { x: 1, y: 1 });
    await store.getState().flush();
    expect(saved).toHaveLength(1);
    await store.getState().flush();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(saved).toHaveLength(1);
  });

  test('nothing is saved before a database is open', async () => {
    const store = createLayoutStore(deps);
    store.getState().move('t:1', { x: 1, y: 1 });
    await store.getState().flush();
    expect(saved).toEqual([]);
  });

  test('a save that fails is tried again by the next one, and does not throw', async () => {
    const store = await opened();
    let fail = true;
    deps.put = vi.fn(async (dbKey, positions) => {
      if (fail) throw new Error('disk');
      saved.push([dbKey, positions]);
    });
    const retried = createLayoutStore(deps);
    await retried.getState().restore('k', []);
    retried.getState().move('t:1', { x: 1, y: 1 });
    await expect(retried.getState().flush()).resolves.toBeUndefined();
    expect(saved).toEqual([]);
    fail = false;
    await retried.getState().flush();
    expect(saved).toEqual([['k', { 't:1': { x: 1, y: 1 } }]]);
    void store;
  });

  test('what was moved is saved before another database is restored', async () => {
    const store = await opened();
    store.getState().move('t:1', { x: 3, y: 3 });
    await store.getState().restore('other', []);
    expect(saved).toEqual([['k', { 't:1': { x: 3, y: 3 } }]]);
    expect(store.getState().dbKey).toBe('other');
  });
});

describe('remapping', () => {
  test('a table that has another id now keeps its place under it, and the old id is forgotten', async () => {
    const store = await opened({
      'uuid-a': { x: 10, y: 20 },
      't:1': { x: 1, y: 1 },
    });
    store.getState().remap({ 'uuid-a': 't:900' });
    expect(store.getState().positions).toEqual({
      't:900': { x: 10, y: 20 },
      't:1': { x: 1, y: 1 },
    });
  });

  test('is saved like a move', async () => {
    const store = await opened({ 'uuid-a': { x: 10, y: 20 } });
    store.getState().remap({ 'uuid-a': 't:900' });
    await vi.advanceTimersByTimeAsync(500);
    expect(saved).toEqual([['k', { 't:900': { x: 10, y: 20 } }]]);
  });

  test('leaves a place already taken under the new id as it is, and ignores a table it has no place for', async () => {
    const store = await opened({
      'uuid-a': { x: 10, y: 20 },
      't:900': { x: 5, y: 5 },
    });
    store.getState().remap({ 'uuid-a': 't:900', 'uuid-none': 't:901' });
    expect(store.getState().positions).toEqual({ 't:900': { x: 5, y: 5 } });
  });
});
