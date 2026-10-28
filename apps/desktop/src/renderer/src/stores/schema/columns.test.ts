import { assignNames, diff, validateModel } from '@pgsketch/core';
import { beforeEach, describe, expect, test } from 'vitest';
import { fixtureModel } from '@/test-model';
import { createSchemaStore } from '.';

const casts = { categories: {}, domains: {}, casts: {} };
let store: ReturnType<typeof createSchemaStore>;

beforeEach(() => {
  store = createSchemaStore();
  store.getState().load({ model: fixtureModel, casts, fingerprint: 'f' });
});

const ops = () => {
  const { baseline, desired } = store.getState();
  return diff(baseline, assignNames(desired)).ops;
};
const kinds = () =>
  ops()
    .map((o) => o.kind)
    .sort();
const col = (id: string) => store.getState().desired.columns[id]!;
const keyOf = (tableId: string) =>
  Object.values(store.getState().desired.constraints).find(
    (c) => c.tableId === tableId && c.kind === 'pk',
  );

describe('addColumn and renameColumn', () => {
  test('a new column is a nullable text column at the end, named so it does not collide', () => {
    const a = store.getState().addColumn('t:10');
    const b = store.getState().addColumn('t:10');
    expect(col(a)).toMatchObject({
      tableId: 't:10',
      name: 'new_column',
      position: 3,
      notNull: false,
      default: null,
      identity: null,
      comment: null,
      type: { name: 'text', isArray: false },
    });
    expect(col(b)).toMatchObject({ name: 'new_column_2', position: 4 });
    expect(fixtureModel.columns[a]).toBeUndefined();
    expect(kinds()).toEqual(['addColumn', 'addColumn']);
    expect(validateModel(assignNames(store.getState().desired))).toEqual([]);
  });

  test('a column on a table with no columns is position 1', () => {
    const table = store.getState().addTable('s:1');
    const id = store.getState().addColumn(table);
    expect(col(id).position).toBe(2); // after the id column every new table starts with
  });

  test('a rename changes desired only, and is one rename; renaming back is no change', () => {
    store.getState().renameColumn('c:10:2', 'state');
    expect(col('c:10:2').name).toBe('state');
    expect(fixtureModel.columns['c:10:2']!.name).toBe('status');
    expect(ops()).toEqual([
      { kind: 'renameColumn', columnId: 'c:10:2', from: 'status', to: 'state' },
    ]);
    store.getState().renameColumn('c:10:2', 'status');
    expect(kinds()).toEqual([]);
  });

  test('unknown columns are ignored', () => {
    store.getState().renameColumn('nope', 'x');
    expect(store.getState().version).toBe(0);
  });
});

describe('primary key coupling', () => {
  test('turning it on makes the column NOT NULL, and makes a key when there is none', () => {
    // invoices has no primary key, and total is nullable
    expect(col('c:20:3').notNull).toBe(false);
    store.getState().setPrimaryKey('c:20:3', true);
    expect(col('c:20:3').notNull).toBe(true);
    expect(keyOf('t:20')).toMatchObject({
      kind: 'pk',
      autoName: true,
      columnIds: ['c:20:3'],
    });
    expect(kinds()).toEqual(['addConstraint', 'setNotNull']);
    expect(validateModel(assignNames(store.getState().desired))).toEqual([]);
  });

  test('a second column joins the key, in the order they were turned on', () => {
    store.getState().setPrimaryKey('c:20:3', true);
    store.getState().setPrimaryKey('c:20:2', true);
    expect(keyOf('t:20')!.columnIds).toEqual(['c:20:3', 'c:20:2']);
    store.getState().setPrimaryKey('c:20:2', true);
    expect(keyOf('t:20')!.columnIds).toEqual(['c:20:3', 'c:20:2']);
  });

  test('turning it off leaves NOT NULL on, and removes the key when no column is left', () => {
    store.getState().setPrimaryKey('c:20:3', true);
    store.getState().setPrimaryKey('c:20:3', false);
    expect(col('c:20:3').notNull).toBe(true);
    expect(keyOf('t:20')).toBeUndefined();
    expect(kinds()).toEqual(['setNotNull']);
  });

  test('on a table that has a key, the key changes and is rebuilt', () => {
    store.getState().setPrimaryKey('c:10:2', true);
    expect(keyOf('t:10')!.columnIds).toEqual(['c:10:1', 'c:10:2']);
    expect(kinds()).toContain('dropConstraint');
    expect(kinds()).toContain('addConstraint');
    store.getState().setPrimaryKey('c:10:2', false);
    expect(keyOf('t:10')!.columnIds).toEqual(['c:10:1']);
    expect(kinds()).toEqual([]);
  });

  test('it never changes the type or adds identity', () => {
    store.getState().setPrimaryKey('c:20:3', true);
    expect(col('c:20:3')).toMatchObject({
      identity: null,
      type: fixtureModel.columns['c:20:3']!.type,
    });
  });

  test('turning it on or off for something that is not a column is ignored', () => {
    store.getState().setPrimaryKey('nope', true);
    expect(store.getState().version).toBe(0);
  });
});

describe('nullability', () => {
  test('NOT NULL cannot be turned off while the column is in the primary key, or is an identity', () => {
    expect(store.getState().setNotNull('c:10:1', false)).toBe(
      `"id" is an identity column, so it can't be nullable`,
    );
    store.getState().setPrimaryKey('c:20:3', true);
    expect(store.getState().setNotNull('c:20:3', false)).toBe(
      `"total" is in the primary key, so it can't be nullable`,
    );
    expect(col('c:10:1').notNull).toBe(true);
    expect(col('c:20:3').notNull).toBe(true);
  });

  test('otherwise it can be turned on and off, and the diff says so', () => {
    expect(store.getState().setNotNull('c:20:3', true)).toBeNull();
    expect(ops()).toEqual([{ kind: 'setNotNull', columnId: 'c:20:3' }]);
    expect(store.getState().setNotNull('c:20:3', false)).toBeNull();
    expect(kinds()).toEqual([]);
    expect(store.getState().setNotNull('c:10:2', false)).toBeNull();
    expect(kinds()).toEqual(['dropNotNull']);
  });

  test('once the key is gone, it can be turned off', () => {
    store.getState().setPrimaryKey('c:20:3', true);
    store.getState().setPrimaryKey('c:20:3', false);
    expect(store.getState().setNotNull('c:20:3', false)).toBeNull();
    expect(col('c:20:3').notNull).toBe(false);
  });

  test('a refusal changes nothing', () => {
    store.getState().setNotNull('c:10:1', false);
    expect(store.getState().version).toBe(0);
  });
});

describe('defaults', () => {
  test('an identity column rejects a default, and takes no default away', () => {
    const value = { kind: 'constant' as const, expression: '1' };
    expect(store.getState().setColumnDefault('c:10:1', value)).toBe(
      `"id" is an identity column, so it can't have a default`,
    );
    expect(col('c:10:1').default).toBeNull();
    expect(store.getState().setColumnDefault('c:10:1', null)).toBeNull();
    expect(store.getState().version).toBe(1);
  });

  test('any other column takes a default, and gives it up', () => {
    const value = { kind: 'constant' as const, expression: '5' };
    expect(store.getState().setColumnDefault('c:20:3', value)).toBeNull();
    expect(ops()).toEqual([
      { kind: 'setDefault', columnId: 'c:20:3', to: value },
    ]);
    expect(store.getState().setColumnDefault('c:20:3', null)).toBeNull();
    expect(ops()).toEqual([{ kind: 'dropDefault', columnId: 'c:20:3' }]);
  });
});

describe('types', () => {
  test('an identity column stays an integer', () => {
    const text = { name: 'text', isArray: false };
    expect(store.getState().setColumnType('c:10:1', text)).toContain(
      'has to be smallint, integer or bigint',
    );
    expect(
      store
        .getState()
        .setColumnType('c:10:1', { name: 'integer', isArray: true }),
    ).not.toBeNull();
    expect(
      store.getState().setColumnType('c:10:1', {
        name: 'integer',
        schema: 'x',
        isArray: false,
      }),
    ).not.toBeNull();
    expect(col('c:10:1').type.name).toBe('int8');
    expect(
      store
        .getState()
        .setColumnType('c:10:1', { name: 'integer', isArray: false }),
    ).toBeNull();
    expect(col('c:10:1').type.name).toBe('integer');
  });

  test('another column takes any type, and the diff is one type change', () => {
    const type = { name: 'varchar', params: [20], isArray: false };
    expect(store.getState().setColumnType('c:10:2', type)).toBeNull();
    expect(ops()).toEqual([
      expect.objectContaining({ kind: 'alterColumnType', columnId: 'c:10:2' }),
    ]);
  });
});

describe('comments', () => {
  test('are set and cleared', () => {
    store.getState().setColumnComment('c:20:2', 'Owner');
    expect(col('c:20:2').comment).toBe('Owner');
    expect(kinds()).toEqual(['setComment']);
    store.getState().setColumnComment('c:20:2', null);
    expect(kinds()).toEqual([]);
  });
});
