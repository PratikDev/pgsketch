import { describe, expect, test } from 'vitest';
import { diff } from '../src/diff';
import type { Constraint, SchemaModel } from '../src/model/types';
import { edit, editBoth } from './diff-helpers';
import { fixtureModel } from './fixtures/model';

const run = (change: (m: SchemaModel) => void) => {
  const { baseline, desired } = edit(change);
  return diff(baseline, desired);
};
const kinds = (r: { ops: { kind: string }[] }) =>
  r.ops.map((o) => o.kind).sort();

test('no edits, no operations and no errors', () => {
  expect(diff(fixtureModel, structuredClone(fixtureModel))).toEqual({
    ops: [],
    errors: [],
  });
});

describe('dropping a referenced table or column', () => {
  test('dropping a referenced table also yields dropConstraint for the referencing FK', () => {
    // the table is removed, but the foreign key that points at it is still in the edited model
    const { ops } = run((m) => {
      delete m.tables['t:10'];
      for (const id of ['c:10:1', 'c:10:2']) delete m.columns[id];
      delete m.constraints['k:1'];
    });
    expect(ops).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'dropTable',
          table: expect.objectContaining({ id: 't:10' }),
        }),
        expect.objectContaining({
          kind: 'dropConstraint',
          constraint: expect.objectContaining({ id: 'k:2', kind: 'fk' }),
        }),
      ]),
    );
    expect(ops.filter((o) => o.kind === 'dropConstraint')).toHaveLength(1);
  });

  test('dropping a referenced column also drops a foreign key that is still in the edited model', () => {
    const { ops } = run((m) => {
      delete m.columns['c:10:1'];
      delete m.constraints['k:1'];
    });
    expect(ops).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'dropColumn' }),
        expect.objectContaining({
          kind: 'dropConstraint',
          constraint: expect.objectContaining({ id: 'k:2' }),
        }),
      ]),
    );
  });

  test('when the editor already removed the foreign key, it is dropped once, not twice', () => {
    const { ops } = run((m) => {
      delete m.tables['t:10'];
      for (const id of ['c:10:1', 'c:10:2']) delete m.columns[id];
      delete m.constraints['k:1'];
      delete m.constraints['k:2'];
    });
    expect(
      ops.filter(
        (o) => o.kind === 'dropConstraint' && o.constraint.id === 'k:2',
      ),
    ).toHaveLength(1);
  });

  test('a foreign key between two tables that are both dropped is dropped first, once', () => {
    const { ops } = run((m) => {
      for (const t of ['t:10', 't:20']) delete m.tables[t];
      delete m.constraints['k:2'];
    });
    expect(
      ops
        .filter((o) => o.kind === 'dropConstraint')
        .map((o) => o.constraint.id),
    ).toEqual(['k:2']);
  });
});

test('a foreign key that changes and has both column types change is rebuilt once', () => {
  const { baseline, desired } = editBoth(
    (m) => {
      m.columns['c:20:2']!.type = { name: 'uuid', isArray: false };
      m.columns['c:10:1']!.type = { name: 'uuid', isArray: false };
    },
    (m) => {
      m.columns['c:20:2']!.type = { name: 'text', isArray: false };
      m.columns['c:10:1']!.type = { name: 'text', isArray: false };
      (m.constraints['k:2'] as Extract<Constraint, { kind: 'fk' }>).onDelete =
        'restrict';
    },
  );
  const { ops } = diff(baseline, desired);
  expect(
    ops.filter((o) => o.kind === 'dropConstraint' && o.constraint.id === 'k:2'),
  ).toHaveLength(1);
  expect(
    ops.filter((o) => o.kind === 'addConstraint' && o.constraint.id === 'k:2'),
  ).toHaveLength(1);
});

describe('errors from every part are collected, and guarded operations are removed', () => {
  test('errors from the parts and from the guard come back together', () => {
    const r = run((m) => {
      m.schemas['s:2']!.name = 'invoicing'; // schema-changed
      m.tables['t:10']!.schemaId = 's:2'; // table-schema-changed
      m.columns['c:10:2']!.identity = 'always'; // column-identity-changed
      delete m.columns['c:20:3']; // a view depends on it: read-only-dependency
    });
    expect(r.errors.map((e) => e.code).sort()).toEqual([
      'column-identity-changed',
      'read-only-dependency',
      'schema-changed',
      'table-schema-changed',
    ]);
    expect(kinds(r)).not.toContain('dropColumn');
  });

  test('changing a read-only object is reported and its operation is removed', () => {
    const r = run((m) => (m.tables['t:30']!.name = 'log'));
    expect(r.ops).toEqual([]);
    expect(r.errors).toMatchObject([
      { code: 'read-only-changed', objectId: 't:30' },
    ]);
  });
});

test('one edit of every kind gives the matching operations', () => {
  const r = run((m) => {
    m.schemas.fresh = { id: 'fresh', name: 'reporting' };
    m.tables['new-t'] = {
      id: 'new-t',
      schemaId: 'fresh',
      name: 'orders',
      comment: 'Orders',
    };
    m.tables['t:10']!.name = 'people';
    m.columns['c:10:2']!.name = 'state';
    m.columns['c:20:3']!.notNull = true;
    m.constraints['k:3']!.name = 'positive_total';
    m.indexes['i:1']!.unique = true;
    m.tables['t:20']!.comment = null;
  });
  expect(r.errors).toEqual([]);
  expect(kinds(r)).toEqual([
    'addIndex',
    'createSchema',
    'createTable',
    'dropIndex',
    'renameColumn',
    'renameConstraint',
    'renameTable',
    'setComment',
    'setComment',
    'setNotNull',
  ]);
});

test('the same edit always gives the same operations in the same order', () => {
  const change = (m: SchemaModel) => {
    m.tables['t:10']!.name = 'people';
    delete m.columns['c:10:2'];
    m.columns['c:20:3']!.notNull = true;
  };
  expect(run(change)).toEqual(run(change));
});
