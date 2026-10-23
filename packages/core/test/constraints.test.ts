import { expect, test } from 'vitest';
import {
  toConstraint,
  type ConstraintRow,
} from '../src/introspect/constraints';

const row = (over: Partial<ConstraintRow> = {}): ConstraintRow => ({
  oid: 7,
  table_oid: 100,
  name: 'k',
  kind: 'u',
  key_attnums: [1],
  ref_table_oid: 0,
  ref_attnums: null,
  del_action: 'a',
  upd_action: 'a',
  match_type: 's',
  deferrable: false,
  validated: true,
  no_inherit: false,
  has_set_columns: false,
  check_expr: null,
  definition: 'DEF',
  table_reason: null,
  index_reason: null,
  ...over,
});

test('each foreign key action maps', () => {
  const fk = (del: string, upd: string) =>
    toConstraint(
      row({
        kind: 'f',
        ref_table_oid: 200,
        ref_attnums: [2],
        del_action: del,
        upd_action: upd,
      }),
    );
  expect(fk('a', 'r')).toMatchObject({
    onDelete: 'no action',
    onUpdate: 'restrict',
  });
  expect(fk('c', 'n')).toMatchObject({
    onDelete: 'cascade',
    onUpdate: 'set null',
  });
  expect(fk('d', 'a')).toMatchObject({ onDelete: 'set default' });
  expect(fk('a', 'a')).toMatchObject({
    refTableId: 't:200',
    refColumnIds: ['c:200:2'],
    columnIds: ['c:100:1'],
  });
});

test('a check with no column has no column ids', () => {
  expect(
    toConstraint(row({ kind: 'c', key_attnums: null, check_expr: 'true' })),
  ).toMatchObject({
    kind: 'check',
    columnIds: [],
    expression: 'true',
  });
});

test('every reason makes a constraint read-only and keeps its definition', () => {
  const reason = (over: Partial<ConstraintRow>) =>
    toConstraint(row(over)).readOnly;
  expect(reason({ kind: 'x' })).toBe('exclusion');
  expect(reason({ deferrable: true })).toBe('deferrable');
  expect(reason({ validated: false })).toBe('not-valid');
  expect(reason({ kind: 'c', no_inherit: true })).toBe('no-inherit');
  // Postgres sets no_inherit on every non-check constraint, which must not make them read-only
  expect(reason({ kind: 'u', no_inherit: true })).toBeUndefined();
  expect(
    reason({ kind: 'f', ref_table_oid: 2, no_inherit: true }),
  ).toBeUndefined();
  expect(reason({ kind: 'f', match_type: 'f' })).toBe('match-full');
  expect(reason({ kind: 'f', has_set_columns: true })).toBe('fk-set-columns');
  expect(reason({ index_reason: 'include-index' })).toBe('include-index');
  expect(reason({ table_reason: 'partition', deferrable: true })).toBe(
    'partition',
  );
  expect(toConstraint(row({ deferrable: true })).definition).toBe('DEF');
  expect(toConstraint(row())).not.toHaveProperty('readOnly');
});

test('an index reason only applies to the constraints that own an index', () => {
  expect(
    toConstraint(
      row({ kind: 'f', ref_table_oid: 2, index_reason: 'include-index' }),
    ).readOnly,
  ).toBeUndefined();
  expect(
    toConstraint(row({ kind: 'c', index_reason: 'include-index' })).readOnly,
  ).toBeUndefined();
});
