import { describe, expect, test } from 'vitest';
import { fixtureModel } from '@/test-model';
import { derive, derived } from './derived';
import { createSchemaStore } from './schema';

const casts = { categories: {}, domains: {}, casts: {} };

function loaded() {
  const store = createSchemaStore();
  store.getState().load({ model: fixtureModel, casts, fingerprint: 'f' });
  const d = () => derived(store.getState().baseline, store.getState().desired);
  return { store, d };
}

describe('derived', () => {
  test('with no edits there is nothing: no operations, errors, risks or statuses', () => {
    const { d } = loaded();
    expect(d()).toMatchObject({ ops: [], errors: [], risks: [], statuses: {} });
  });

  test('a renamed column is modified with its old name, and the operation is a rename', () => {
    const { store, d } = loaded();
    store.getState().edit((x) => (x.columns['c:10:2']!.name = 'state'));
    expect(d().statuses['c:10:2']).toEqual({
      status: 'modified',
      old: { name: 'status' },
    });
    expect(d().ops).toEqual([
      { kind: 'renameColumn', columnId: 'c:10:2', from: 'status', to: 'state' },
    ]);
  });

  test('a new table is added with its key, and the names come from the database rules', () => {
    const { store, d } = loaded();
    const id = store.getState().addTable('s:1');
    const key = Object.values(store.getState().desired.constraints).find(
      (c) => c.tableId === id,
    )!;
    expect(d().statuses[id]?.status).toBe('added');
    expect(d().statuses[key.id]?.status).toBe('added');
    expect(d().named.constraints[key.id]?.name).toBe('new_table_pkey');
    expect(store.getState().desired.constraints[key.id]?.name).toBe('');
    expect(d().errors).toEqual([]);
  });

  test('removing a table gives the drop, the foreign keys that point at it, and a destructive risk', () => {
    const { store, d } = loaded();
    store.getState().removeTable('t:10');
    expect(
      d()
        .ops.map((o) => o.kind)
        .sort(),
    ).toEqual(['dropConstraint', 'dropTable']);
    expect(d().risks).toEqual([
      expect.objectContaining({
        level: 'destructive',
        message: 'Drops table "public"."users" and all its data',
        op: expect.objectContaining({ kind: 'dropTable' }),
      }),
    ]);
    expect(d().statuses['t:10']?.status).toBe('removed');
    expect(d().statuses['k:2']?.status).toBe('removed');
  });

  test('a restored table leaves no trace', () => {
    const { store, d } = loaded();
    store.getState().removeTable('t:10');
    store.getState().restoreTable('t:10');
    expect(d()).toMatchObject({ ops: [], errors: [], risks: [], statuses: {} });
  });

  test('validation errors are listed with the object they belong to', () => {
    const { store, d } = loaded();
    store.getState().renameTable('t:10', '');
    expect(d().errors).toEqual([
      expect.objectContaining({ code: 'name-empty', objectId: 't:10' }),
    ]);
  });

  test('an edit the diff cannot express is an error too', () => {
    const { store, d } = loaded();
    store.getState().edit((x) => (x.columns['c:10:1']!.identity = 'byDefault'));
    expect(d().errors).toEqual([
      expect.objectContaining({
        code: 'column-identity-changed',
        objectId: 'c:10:1',
      }),
    ]);
  });

  test('risks name the operation they belong to', () => {
    const { store, d } = loaded();
    store.getState().edit((x) => (x.columns['c:20:3']!.notNull = true));
    expect(d().risks.map((r) => [r.level, r.op.kind])).toEqual([
      ['may-fail', 'setNotNull'],
      ['locks', 'setNotNull'],
    ]);
  });
});

describe('the memo', () => {
  test('gives the same result for the same models, and a new one after an edit', () => {
    const { store, d } = loaded();
    const first = d();
    expect(d()).toBe(first);
    store.getState().renameTable('t:10', 'people');
    const second = d();
    expect(second).not.toBe(first);
    expect(d()).toBe(second);
  });

  test('is kept apart for each pair of models, so two stores never share a result', () => {
    const a = loaded();
    const b = loaded();
    a.store.getState().renameTable('t:10', 'people');
    expect(a.d().ops).toHaveLength(1);
    expect(b.d().ops).toHaveLength(0);
  });

  test('derive itself always works the result out again', () => {
    const { store } = loaded();
    const { baseline, desired } = store.getState();
    expect(derive(baseline, desired)).not.toBe(derive(baseline, desired));
  });
});
