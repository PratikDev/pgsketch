import {
  assignNames,
  diff,
  orderOps,
  validateModel,
  type SchemaModel,
} from '@pgsketch/core';
import { describe, expect, test } from 'vitest';
import { derived } from '../derived';
import { fixtureModel } from '@/test-model';
import { createSchemaStore } from '.';

const casts = { categories: {}, domains: {}, casts: {} };

/** A store with the fixture, optionally changed first, plus a composite unique and a multi-column check on users. */
function setup(prepare: (model: SchemaModel) => void = () => undefined) {
  const model = structuredClone(fixtureModel);
  model.constraints['u:comp'] = {
    id: 'u:comp',
    tableId: 't:10',
    kind: 'unique',
    name: 'users_id_status_key',
    columnIds: ['c:10:1', 'c:10:2'],
  };
  model.constraints['k:multi'] = {
    id: 'k:multi',
    tableId: 't:10',
    kind: 'check',
    name: 'users_multi_check',
    columnIds: ['c:10:1', 'c:10:2'],
    expression: '(id > 0 AND status IS NOT NULL)',
  };
  prepare(model);
  const store = createSchemaStore();
  store.getState().load({ model, casts, fingerprint: 'f' });
  const state = () => store.getState();
  const derive = () => derived(state().baseline, state().desired);
  return { store, state, model, derive };
}

describe('removing a column removes what is built on it', () => {
  test('a composite unique, a multi-column check and a foreign key from another table go with it, and come back with it', () => {
    const { state, model, derive } = setup();
    expect(state().removeColumn('c:10:1')).toBeNull();
    const { desired } = state();
    expect(desired.columns['c:10:1']).toBeUndefined();
    for (const id of ['u:comp', 'k:multi', 'k:1', 'k:2'])
      expect(desired.constraints[id], id).toBeUndefined();
    // the others are untouched
    expect(desired.constraints['k:3']).toBeDefined();
    // the diff drops each of them before the column, and nothing blocks generating
    const kinds = orderOps(derive().ops, {
      baseline: state().baseline,
      desired,
    }).map((o) => o.op.kind);
    expect(kinds.indexOf('dropColumn')).toBeGreaterThan(
      kinds.lastIndexOf('dropConstraint'),
    );
    expect(kinds.filter((k) => k === 'dropConstraint')).toHaveLength(4);
    expect(derive().errors).toEqual([]);

    state().restoreColumn('c:10:1');
    expect(state().desired).toEqual(model);
    expect(derive().ops).toEqual([]);
  });

  test('indexes on the column go too, and constraints on the same table that are read-only', () => {
    const { state } = setup();
    expect(state().removeColumn('c:20:2')).toBeNull();
    const { desired } = state();
    expect(desired.constraints['k:2']).toBeUndefined(); // the foreign key on it
    expect(desired.constraints['k:4']).toBeUndefined(); // the exclusion constraint, read-only
    expect(desired.indexes['i:1']).toBeUndefined();
    expect(desired.constraints['k:3']).toBeDefined(); // on another column
    state().restoreColumn('c:20:2');
    expect(state().desired).toEqual(state().baseline);
  });

  test('a column with a partial index can be removed, and the index is listed as destructive', () => {
    const { state, derive } = setup((m) => delete m.unmodeled['u:1']); // the view would stop it
    expect(state().removeColumn('c:20:3')).toBeNull();
    expect(state().desired.indexes['i:2']).toBeUndefined();
    expect(derive().errors).toEqual([]);
    expect(derive().risks.map((r) => `${r.level}: ${r.message}`)).toContain(
      `destructive: Drops "invoices_open_idx", which pgsketch can't recreate`,
    );
  });

  test('a column a view uses cannot be removed, and the view is named', () => {
    const { state } = setup();
    const before = state();
    expect(state().removeColumn('c:20:3')).toBe(
      `Can't delete column "total": view "open_invoices" still depends on it`,
    );
    expect(state().desired).toBe(before.desired);
    expect(state().version).toBe(0);
  });

  test('a column a read-only foreign key on another table points at cannot be removed', () => {
    const { state } = setup(
      (m) => (m.constraints['k:2']!.readOnly = 'deferrable'),
    );
    expect(state().removeColumn('c:10:1')).toBe(
      `Can't delete column "id": foreign key "invoices_user_id_fkey" still depends on it`,
    );
    expect(state().version).toBe(0);
  });

  test('a read-only foreign key on the same table goes with the column', () => {
    const { state } = setup(
      (m) => (m.constraints['k:2']!.readOnly = 'deferrable'),
    );
    expect(state().removeColumn('c:20:2')).toBeNull();
    expect(state().desired.constraints['k:2']).toBeUndefined();
  });

  test('a pending column is removed for good with the pending things built on it', () => {
    const { state, derive } = setup();
    const column = state().addColumn('t:10');
    state().edit((d) => {
      d.constraints['new-u'] = {
        id: 'new-u',
        tableId: 't:10',
        kind: 'unique',
        name: '',
        autoName: true,
        columnIds: [column],
      };
      d.indexes['new-i'] = {
        id: 'new-i',
        tableId: 't:10',
        name: '',
        autoName: true,
        unique: false,
        columnIds: ['c:10:2', column],
      };
    });
    expect(state().removeColumn(column)).toBeNull();
    state().restoreColumn(column);
    expect(state().desired.columns[column]).toBeUndefined();
    expect(state().desired.constraints['new-u']).toBeUndefined();
    expect(state().desired.indexes['new-i']).toBeUndefined();
    expect(derive().ops).toEqual([]);
  });

  test('restoring leaves out what cannot be back yet: a foreign key whose table is still removed', () => {
    const { state } = setup((m) => delete m.unmodeled['u:1']);
    state().removeTable('t:20');
    state().removeColumn('c:10:1'); // the foreign key from invoices is already gone with the table
    state().restoreColumn('c:10:1');
    expect(state().desired.constraints['k:2']).toBeUndefined();
    state().restoreTable('t:20');
    expect(state().desired.constraints['k:2']).toBeDefined();
  });

  test('restoring a column whose table is removed does nothing', () => {
    const { state } = setup((m) => delete m.unmodeled['u:1']);
    state().removeTable('t:20');
    const version = state().version;
    state().restoreColumn('c:20:2');
    expect(state().version).toBe(version);
  });

  test('the model stays valid after a removal', () => {
    const { state } = setup();
    state().removeColumn('c:10:1');
    expect(validateModel(assignNames(state().desired))).toEqual([]);
    expect(diff(state().baseline, assignNames(state().desired)).errors).toEqual(
      [],
    );
  });
});
