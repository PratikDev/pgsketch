import { expect, test } from 'vitest';
import {
  toUnmodeled,
  type DependencyRow,
  type ObjectRow,
} from '../src/introspect/unmodeled';

const obj = (over: Partial<ObjectRow>): ObjectRow => ({
  kind: 'view',
  catalog: 'pg_class',
  oid: 1,
  schema_oid: 2200,
  name: 'v',
  table_oid: null,
  attnums: null,
  ...over,
});
const dep = (over: Partial<DependencyRow>): DependencyRow => ({
  catalog: 'pg_class',
  oid: 1,
  table_oid: 100,
  attnum: 0,
  ...over,
});

test('dependencies are matched by catalog and oid, so equal oids in different catalogs do not mix', () => {
  const [view, fn] = toUnmodeled(
    [
      obj({ oid: 5 }),
      obj({ kind: 'function', catalog: 'pg_proc', oid: 5, name: 'f' }),
    ],
    [
      dep({ oid: 5, attnum: 2 }),
      dep({ catalog: 'pg_proc', oid: 5, table_oid: 200, attnum: 0 }),
    ],
  );
  expect(view).toMatchObject({
    id: 'u:view:5',
    tableIds: ['t:100'],
    columnIds: ['c:100:2'],
  });
  expect(fn).toMatchObject({
    id: 'u:function:5',
    tableIds: ['t:200'],
    columnIds: [],
  });
});

test('triggers and policies include their own table and listed columns; ids are unique and sorted', () => {
  const [trigger] = toUnmodeled(
    [
      obj({
        kind: 'trigger',
        catalog: 'pg_trigger',
        schema_oid: null,
        table_oid: 100,
        attnums: [3, 1],
      }),
    ],
    [dep({ catalog: 'pg_trigger', attnum: 1 })],
  );
  expect(trigger).toMatchObject({
    schemaId: null,
    tableIds: ['t:100'],
    columnIds: ['c:100:1', 'c:100:3'],
  });
});

test('an object with no dependencies has none', () => {
  expect(toUnmodeled([obj({})], [])[0]).toMatchObject({
    tableIds: [],
    columnIds: [],
  });
});
