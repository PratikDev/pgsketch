import { assignNames, diff } from '@pgsketch/core';
import { beforeEach, describe, expect, test } from 'vitest';
import { fixtureModel } from '@/test-model';
import { derived } from '../derived';
import { createSchemaStore } from '.';

const casts = { categories: {}, domains: {}, casts: {} };
let store: ReturnType<typeof createSchemaStore>;

beforeEach(() => {
  store = createSchemaStore();
  store.getState().load({ model: fixtureModel, casts, fingerprint: 'f' });
});

const state = () => store.getState();
const kinds = () =>
  diff(state().baseline, assignNames(state().desired))
    .ops.map((o) => o.kind)
    .sort();

describe('indexes', () => {
  test('a new index has its columns in order, is auto-named, and is one addIndex', () => {
    const id = state().addIndex('t:20', ['c:20:3', 'c:20:2']);
    expect(state().desired.indexes[id]).toMatchObject({
      unique: false,
      autoName: true,
      columnIds: ['c:20:3', 'c:20:2'],
    });
    expect(kinds()).toEqual(['addIndex']);
    expect(
      derived(state().baseline, state().desired).named.indexes[id]!.name,
    ).toBe('invoices_total_user_id_idx');
  });

  test('it can be unique from the start, and changed afterwards', () => {
    const id = state().addIndex('t:20', ['c:20:3'], true);
    expect(state().desired.indexes[id]!.unique).toBe(true);
    state().updateIndex(id, { unique: false, columnIds: ['c:20:2'] });
    expect(state().desired.indexes[id]).toMatchObject({
      unique: false,
      columnIds: ['c:20:2'],
    });
    state().updateIndex(id, { unique: true });
    expect(state().desired.indexes[id]).toMatchObject({
      unique: true,
      columnIds: ['c:20:2'],
    });
  });

  test('changing a loaded index drops it and adds it again; changing it back is no change', () => {
    state().updateIndex('i:1', { columnIds: ['c:20:3'] });
    expect(kinds()).toEqual(['addIndex', 'dropIndex']);
    state().updateIndex('i:1', { columnIds: ['c:20:2'] });
    expect(kinds()).toEqual([]);
  });

  test('naming it yourself fixes its name', () => {
    const id = state().addIndex('t:20', ['c:20:3']);
    state().renameIndex(id, 'by_total');
    state().renameTable('t:20', 'bills');
    expect(
      derived(state().baseline, state().desired).named.indexes[id]!.name,
    ).toBe('by_total');
    expect(state().desired.indexes[id]!.autoName).toBe(false);
    state().renameIndex('i:1', 'by_user');
    expect(kinds()).toEqual(['addIndex', 'renameIndex', 'renameTable']);
  });

  test('removing and restoring a loaded index leaves an empty diff, and a pending one is removed for good', () => {
    state().removeIndex('i:1');
    expect(kinds()).toEqual(['dropIndex']);
    state().restoreIndex('i:1');
    expect(kinds()).toEqual([]);
    const id = state().addIndex('t:20', ['c:20:3']);
    state().removeIndex(id);
    state().restoreIndex(id);
    expect(kinds()).toEqual([]);
  });

  test('restoring waits for the column, and what is not there is ignored', () => {
    state().removeIndex('i:1');
    state().removeColumn('c:20:2');
    const version = state().version;
    state().restoreIndex('i:1');
    expect(state().version).toBe(version);
    state().restoreColumn('c:20:2');
    expect(state().desired.indexes['i:1']).toBeDefined();
    state().removeIndex('nope');
    state().updateIndex('nope', { unique: true });
    state().renameIndex('nope', 'x');
    expect(state().version).toBe(version + 1);
  });
});
