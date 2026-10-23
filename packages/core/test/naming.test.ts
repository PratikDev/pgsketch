import { describe, expect, test } from 'vitest';
import { assignNames, chooseName, makeObjectName } from '../src/model/naming';
import { utf8Length } from '../src/model/utf8';
import type { Constraint, SchemaModel } from '../src/model/types';
import { fixtureModel } from './fixtures/model';

describe('makeObjectName', () => {
  test('joins the parts with underscores', () => {
    expect(makeObjectName('users', 'email', 'key')).toBe('users_email_key');
    expect(makeObjectName('users', null, 'pkey')).toBe('users_pkey');
  });

  test('never exceeds 63 bytes and keeps the label', () => {
    for (const [a, b] of [
      ['a'.repeat(80), 'b'.repeat(80)],
      ['a'.repeat(10), 'b'.repeat(90)],
      ['é'.repeat(40), 'ü'.repeat(40)],
    ]) {
      const name = makeObjectName(a!, b!, 'fkey');
      expect(utf8Length(name)).toBeLessThanOrEqual(63);
      expect(name.endsWith('_fkey')).toBe(true);
    }
  });

  test('chooseName numbers collisions', () => {
    const taken = new Set(['t_a_key', 't_a_key1']);
    expect(chooseName('t', 'a', 'key', taken)).toBe('t_a_key2');
  });
});

/** A pending table `new_table` (id uuid-like) with columns a, b and a few auto-named objects. */
function pendingModel(): SchemaModel {
  const m: SchemaModel = structuredClone(fixtureModel);
  m.tables['new-t'] = {
    id: 'new-t',
    schemaId: 's:1',
    name: 'new_table',
    comment: null,
  };
  for (const [id, name] of [
    ['new-a', 'a'],
    ['new-b', 'b'],
  ] as const) {
    m.columns[id] = {
      id,
      tableId: 'new-t',
      name,
      position: 1,
      type: { name: 'bigint', isArray: false },
      notNull: true,
      default: null,
      identity: null,
      comment: null,
    };
  }
  const base = (id: string, columnIds: string[]) => ({
    id,
    tableId: 'new-t',
    name: 'x',
    autoName: true,
    columnIds,
  });
  m.constraints['k-pk'] = { ...base('k-pk', ['new-a']), kind: 'pk' };
  m.constraints['k-u1'] = { ...base('k-u1', ['new-a']), kind: 'unique' };
  m.constraints['k-u2'] = { ...base('k-u2', ['new-a']), kind: 'unique' };
  m.constraints['k-user'] = {
    ...base('k-user', ['new-b']),
    kind: 'unique',
    name: 'my_unique',
    autoName: false,
  };
  m.indexes['i-1'] = {
    id: 'i-1',
    tableId: 'new-t',
    name: 'x',
    autoName: true,
    unique: false,
    columnIds: ['new-a', 'new-b'],
  };
  return m;
}

const names = (m: SchemaModel) =>
  Object.fromEntries(
    [...Object.values(m.constraints), ...Object.values(m.indexes)].map((o) => [
      o.id,
      o.name,
    ]),
  );

describe('assignNames', () => {
  test('names auto-named objects like Postgres, numbering repeats', () => {
    const named = names(assignNames(pendingModel()));
    expect(named['k-pk']).toBe('new_table_pkey');
    expect(named['k-u1']).toBe('new_table_a_key');
    expect(named['k-u2']).toBe('new_table_a_key1');
    expect(named['i-1']).toBe('new_table_a_b_idx');
  });

  test('renaming a pending table or column renames its auto-named objects; a user-named one stays', () => {
    const m = pendingModel();
    m.tables['new-t']!.name = 'accounts';
    m.columns['new-a']!.name = 'email';
    const named = names(assignNames(m));
    expect(named['k-pk']).toBe('accounts_pkey');
    expect(named['k-u1']).toBe('accounts_email_key');
    expect(named['i-1']).toBe('accounts_email_b_idx');
    expect(named['k-user']).toBe('my_unique');
  });

  test('existing objects keep their names when their table is renamed', () => {
    const m = pendingModel();
    m.tables['t:10']!.name = 'people';
    expect(names(assignNames(m))['k:1']).toBe('users_pkey');
  });

  test('names that are taken by existing objects are skipped', () => {
    const m = pendingModel();
    m.tables['t:30']!.name = 'new_table_pkey';
    expect(names(assignNames(m))['k-pk']).toBe('new_table_pkey1');
  });

  test('the result does not depend on the order objects were added', () => {
    const forward = pendingModel();
    const reversed = pendingModel();
    reversed.constraints = Object.fromEntries(
      Object.entries(reversed.constraints).reverse(),
    ) as Record<string, Constraint>;
    expect(names(assignNames(reversed))).toEqual(names(assignNames(forward)));
  });

  test('a model without auto-named objects is returned as is', () => {
    expect(assignNames(fixtureModel)).toBe(fixtureModel);
  });
});
