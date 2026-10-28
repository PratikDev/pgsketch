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

describe('addSchema', () => {
  test('creates a pending schema named new_schema, new_schema_2, …', () => {
    const a = state().addSchema();
    const b = state().addSchema();
    expect(state().desired.schemas[a]).toEqual({ id: a, name: 'new_schema' });
    expect(state().desired.schemas[b]!.name).toBe('new_schema_2');
    expect(fixtureModel.schemas[a]).toBeUndefined();
    expect(kinds()).toEqual(['createSchema', 'createSchema']);
  });
});

describe('setTableSchema', () => {
  test('moves a pending table to a schema that exists, and its auto-names follow', () => {
    const table = state().addTable('s:1');
    expect(state().setTableSchema(table, 's:2')).toBeNull();
    expect(state().desired.tables[table]!.schemaId).toBe('s:2');
    const key = Object.values(state().desired.constraints).find(
      (c) => c.tableId === table,
    )!;
    expect(
      derived(state().baseline, state().desired).named.constraints[key.id]!
        .name,
    ).toBe('new_table_pkey');
    expect(kinds()).toEqual(['createTable']);
  });

  test('moves a pending table into a schema that is being created, and the migration creates it first', () => {
    const table = state().addTable('s:1');
    const schema = state().addSchema();
    expect(state().setTableSchema(table, schema)).toBeNull();
    expect(kinds()).toEqual(['createSchema', 'createTable']);
    expect(derived(state().baseline, state().desired).errors).toEqual([]);
  });

  test('a table that is in the database cannot move, and the action says why', () => {
    const before = state();
    expect(state().setTableSchema('t:10', 's:2')).toBe(
      `Can't move table "users" to another schema: it is already in the database, and only new tables can move`,
    );
    expect(state().desired).toBe(before.desired);
    expect(state().version).toBe(0);
    expect(kinds()).toEqual([]);
  });

  test('a schema or table that is not there is ignored', () => {
    const table = state().addTable('s:1');
    const version = state().version;
    expect(state().setTableSchema(table, 'nope')).toBeNull();
    expect(state().setTableSchema('nope', 's:2')).toBeNull();
    expect(state().version).toBe(version);
    expect(state().desired.tables[table]!.schemaId).toBe('s:1');
  });
});
