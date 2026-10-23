import { expect, test } from 'vitest';
import { toIndex, type IndexRow } from '../src/introspect/indexes';

const row = (over: Partial<IndexRow> = {}): IndexRow => ({
  oid: 5,
  table_oid: 100,
  name: 'i',
  is_unique: false,
  key_attnums: [2, 1],
  other_attnums: [1, 2],
  definition: 'CREATE INDEX ...',
  table_reason: null,
  index_reason: null,
  ...over,
});

test('key columns keep their order and the index has no read-only reason', () => {
  expect(toIndex(row())).toEqual({
    id: 'i:5',
    tableId: 't:100',
    name: 'i',
    unique: false,
    columnIds: ['c:100:2', 'c:100:1'],
  });
});

test('expression and predicate columns are added after the key columns, once', () => {
  const index = toIndex(
    row({
      key_attnums: [0, 3],
      other_attnums: [1, 3],
      index_reason: 'expression-index',
    }),
  );
  expect(index.columnIds).toEqual(['c:100:3', 'c:100:1']);
  expect(index).toMatchObject({
    readOnly: 'expression-index',
    definition: 'CREATE INDEX ...',
  });
});

test('a read-only table makes its indexes read-only for the table reason', () => {
  expect(
    toIndex(row({ table_reason: 'partition', index_reason: 'partial-index' }))
      .readOnly,
  ).toBe('partition');
});
