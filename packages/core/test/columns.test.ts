import { expect, test } from 'vitest';
import { toColumn, type ColumnRow } from '../src/introspect/columns';

const row = (over: Partial<ColumnRow> = {}): ColumnRow => ({
  table_oid: 100,
  attnum: 1,
  name: 'c',
  type: 'integer',
  not_null: false,
  default_expr: null,
  identity: '',
  generated: '',
  comment: null,
  table_reason: null,
  not_null_not_valid: false,
  not_null_no_inherit: false,
  ...over,
});

test('a plain column maps field by field', () => {
  expect(
    toColumn(row({ not_null: true, default_expr: 'now()', comment: 'hi' })),
  ).toEqual({
    id: 'c:100:1',
    tableId: 't:100',
    name: 'c',
    position: 1,
    type: { name: 'integer', isArray: false },
    notNull: true,
    default: { kind: 'expression', expression: 'now()' },
    identity: null,
    comment: 'hi',
  });
});

test('identity kinds are distinguished', () => {
  expect(toColumn(row({ identity: 'a' })).identity).toBe('always');
  expect(toColumn(row({ identity: 'd' })).identity).toBe('byDefault');
});

test('each reason makes a column read-only', () => {
  expect(
    toColumn(row({ generated: 's', default_expr: '(a * 2)' })).readOnly,
  ).toBe('generated-column');
  expect(
    toColumn(row({ default_expr: "nextval('public.t_id_seq'::regclass)" }))
      .readOnly,
  ).toBe('nextval-default');
  expect(toColumn(row({ not_null_not_valid: true })).readOnly).toBe(
    'not-null-not-valid',
  );
  expect(toColumn(row({ not_null_no_inherit: true })).readOnly).toBe(
    'not-null-no-inherit',
  );
  expect(toColumn(row({ table_reason: 'partition' })).readOnly).toBe(
    'partition',
  );
  expect(toColumn(row()).readOnly).toBeUndefined();
});

test('a type with non-integer modifiers is kept as text and read-only', () => {
  const column = toColumn(row({ type: 'public.geometry(Point,4326)' }));
  expect(column.readOnly).toBe('unsupported-type');
  expect(column.type).toEqual({
    name: 'public.geometry(Point,4326)',
    isArray: false,
  });
});
