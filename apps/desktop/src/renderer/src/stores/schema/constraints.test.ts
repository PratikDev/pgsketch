import { assignNames, diff, validateModel } from '@pgsketch/core';
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
const ops = () => diff(state().baseline, assignNames(state().desired)).ops;
const kinds = () =>
  ops()
    .map((o) => o.kind)
    .sort();
const errors = () => derived(state().baseline, state().desired).errors;

describe('foreign keys', () => {
  test('one between two tables is one addConstraint, named by the database rules', () => {
    const id = state().addForeignKey({
      tableId: 't:10',
      columnIds: ['c:10:2'],
      refTableId: 't:20',
      refColumnIds: ['c:20:1'],
    });
    expect(state().desired.constraints[id]).toMatchObject({
      kind: 'fk',
      autoName: true,
      onDelete: 'no action',
      onUpdate: 'no action',
    });
    expect(kinds()).toEqual(['addConstraint']);
    expect(
      derived(state().baseline, state().desired).named.constraints[id]!.name,
    ).toBe('users_status_fkey');
  });

  test('a self-referencing one produces one addConstraint, and the model is valid', () => {
    const column = state().addColumn('t:10');
    state().setColumnType(column, { name: 'int8', isArray: false });
    state().addForeignKey({
      tableId: 't:10',
      columnIds: [column],
      refTableId: 't:10',
      refColumnIds: ['c:10:1'],
    });
    expect(kinds()).toEqual(['addColumn', 'addConstraint']);
    expect(errors()).toEqual([]);
  });

  test('a self-reference on a table that is being created is still one addConstraint, after createTable', () => {
    const table = state().addTable('s:1');
    const id = Object.values(state().desired.columns).find(
      (c) => c.tableId === table,
    )!.id;
    const parent = state().addColumn(table);
    state().setColumnType(parent, { name: 'bigint', isArray: false });
    state().addForeignKey({
      tableId: table,
      columnIds: [parent],
      refTableId: table,
      refColumnIds: [id],
    });
    expect(kinds()).toEqual(['addConstraint', 'createTable']);
    expect(errors()).toEqual([]);
  });

  test('the ON DELETE and ON UPDATE actions change, one at a time', () => {
    state().setForeignKeyActions('k:2', { onDelete: 'restrict' });
    expect(state().desired.constraints['k:2']).toMatchObject({
      onDelete: 'restrict',
      onUpdate: 'no action',
    });
    state().setForeignKeyActions('k:2', { onUpdate: 'cascade' });
    expect(state().desired.constraints['k:2']).toMatchObject({
      onDelete: 'restrict',
      onUpdate: 'cascade',
    });
    expect(kinds()).toEqual(['addConstraint', 'dropConstraint']);
    state().setForeignKeyActions('k:2', {
      onDelete: 'cascade',
      onUpdate: 'no action',
    });
    expect(kinds()).toEqual([]);
  });

  test('actions for something that is not a foreign key are ignored', () => {
    state().setForeignKeyActions('k:1', { onDelete: 'cascade' });
    state().setForeignKeyActions('nope', { onDelete: 'cascade' });
    expect(state().version).toBe(0);
  });
});

describe('unique constraints', () => {
  test('turning unique on adds one constraint on the column, and off takes it away again', () => {
    state().setUnique('c:20:3', true);
    expect(
      Object.values(state().desired.constraints).filter(
        (c) => c.kind === 'unique',
      ),
    ).toEqual([
      expect.objectContaining({
        tableId: 't:20',
        columnIds: ['c:20:3'],
        autoName: true,
      }),
    ]);
    state().setUnique('c:20:3', true);
    expect(
      Object.values(state().desired.constraints).filter(
        (c) => c.kind === 'unique',
      ),
    ).toHaveLength(1);
    expect(kinds()).toEqual(['addConstraint']);
    state().setUnique('c:20:3', false);
    expect(kinds()).toEqual([]);
  });

  test('turning off drops a unique constraint that was loaded, but not a composite one', () => {
    const model = structuredClone(fixtureModel);
    model.constraints['u:1'] = {
      id: 'u:1',
      tableId: 't:20',
      kind: 'unique',
      name: 'invoices_total_key',
      columnIds: ['c:20:3'],
    };
    model.constraints['u:2'] = {
      id: 'u:2',
      tableId: 't:20',
      kind: 'unique',
      name: 'invoices_pair_key',
      columnIds: ['c:20:2', 'c:20:3'],
    };
    state().load({ model, casts, fingerprint: 'f' });
    state().setUnique('c:20:3', false);
    expect(state().desired.constraints['u:1']).toBeUndefined();
    expect(state().desired.constraints['u:2']).toBeDefined();
    expect(kinds()).toEqual(['dropConstraint']);
  });
});

describe('checks', () => {
  test('a new check keeps its expression and columns, and is named after them', () => {
    const id = state().addCheck('t:20', {
      expression: '(total < 1000)',
      columnIds: ['c:20:3'],
    });
    expect(state().desired.constraints[id]).toMatchObject({
      kind: 'check',
      expression: '(total < 1000)',
      columnIds: ['c:20:3'],
    });
    expect(kinds()).toEqual(['addConstraint']);
    expect(
      derived(state().baseline, state().desired).named.constraints[id]!.name,
    ).toBe('invoices_total_check1');
  });
});

describe('renaming, removing and restoring', () => {
  test('naming a constraint yourself fixes its name, and a pending one stops following its table', () => {
    const id = state().addForeignKey({
      tableId: 't:10',
      columnIds: ['c:10:2'],
      refTableId: 't:20',
      refColumnIds: ['c:20:1'],
    });
    state().renameConstraint(id, 'my_fk');
    state().renameTable('t:10', 'people');
    expect(
      derived(state().baseline, state().desired).named.constraints[id]!.name,
    ).toBe('my_fk');
    expect(state().desired.constraints[id]!.autoName).toBe(false);
  });

  test('renaming a loaded constraint is one rename, and renaming it back is no change', () => {
    state().renameConstraint('k:3', 'positive_total');
    expect(ops()).toEqual([
      {
        kind: 'renameConstraint',
        constraintId: 'k:3',
        from: 'invoices_total_check',
        to: 'positive_total',
      },
    ]);
    state().renameConstraint('k:3', 'invoices_total_check');
    expect(kinds()).toEqual([]);
  });

  test('removing and restoring a loaded constraint leaves an empty diff', () => {
    state().removeConstraint('k:2');
    expect(kinds()).toEqual(['dropConstraint']);
    state().restoreConstraint('k:2');
    expect(kinds()).toEqual([]);
    expect(state().desired).toEqual(fixtureModel);
  });

  test('a pending constraint is removed for good', () => {
    const id = state().addCheck('t:20', {
      expression: '(total > 0)',
      columnIds: ['c:20:3'],
    });
    state().removeConstraint(id);
    state().restoreConstraint(id);
    expect(kinds()).toEqual([]);
  });

  test('restoring waits for what the constraint is built on', () => {
    state().removeConstraint('k:2');
    state().removeColumn('c:20:2');
    const version = state().version;
    state().restoreConstraint('k:2');
    expect(state().version).toBe(version);
    state().restoreColumn('c:20:2');
    expect(state().desired.constraints['k:2']).toBeDefined();
  });

  test('things that are not there are ignored', () => {
    state().removeConstraint('nope');
    state().renameConstraint('nope', 'x');
    state().restoreConstraint('k:2');
    expect(state().version).toBe(0);
  });

  test('the model is valid after a foreign key is removed', () => {
    state().removeConstraint('k:2');
    expect(validateModel(assignNames(state().desired))).toEqual([]);
  });
});
