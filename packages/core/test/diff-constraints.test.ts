import { describe, expect, test } from 'vitest';
import {
  diffConstraints,
  sameConstraintDefinition,
} from '../src/diff/constraints';
import type { Constraint } from '../src/model/types';
import {
  edit,
  editBoth,
  partRunner,
  opKinds,
  type Change,
} from './diff-helpers';
import { fixtureModel } from './fixtures/model';

const run = partRunner(diffConstraints);
const kinds = (change: Change) => opKinds(run(change));

const unique: Constraint = {
  id: 'new-u',
  tableId: 't:10',
  kind: 'unique',
  name: 'users_email_key',
  columnIds: ['c:10:2'],
};

const fk = fixtureModel.constraints['k:2'];
const asFk = (m: Change extends (d: infer D) => void ? D : never) =>
  m.constraints['k:2'] as Extract<Constraint, { kind: 'fk' }>;

test('no edits, no operations', () => {
  expect(run(() => {})).toEqual({ ops: [], errors: [] });
});

describe('add', () => {
  test('a new constraint on an existing table yields addConstraint', () => {
    expect(run((m) => (m.constraints['new-u'] = unique)).ops).toEqual([
      { kind: 'addConstraint', constraint: unique },
    ]);
  });

  test('a new constraint on a new table is added too, except its primary key (part of createTable)', () => {
    const ops = run((m) => {
      m.tables['new-t'] = {
        id: 'new-t',
        schemaId: 's:1',
        name: 'orders',
        comment: null,
      };
      m.constraints['new-pk'] = {
        id: 'new-pk',
        tableId: 'new-t',
        kind: 'pk',
        name: 'orders_pkey',
        columnIds: [],
      };
      m.constraints['new-u'] = { ...unique, tableId: 'new-t' };
    }).ops;
    expect(ops).toEqual([
      { kind: 'addConstraint', constraint: { ...unique, tableId: 'new-t' } },
    ]);
  });

  test('a primary key added to an existing table is an addConstraint', () => {
    const pk: Constraint = {
      id: 'new-pk',
      tableId: 't:30',
      kind: 'pk',
      name: 't_pkey',
      columnIds: [],
    };
    expect(run((m) => (m.constraints['new-pk'] = pk)).ops).toEqual([
      { kind: 'addConstraint', constraint: pk },
    ]);
  });

  test('self-referencing foreign keys, on an existing and on a new table', () => {
    const selfFk = (tableId: string, id: string): Constraint => ({
      id,
      tableId,
      kind: 'fk',
      name: 'self_fkey',
      columnIds: ['c:10:2'],
      refTableId: tableId,
      refColumnIds: ['c:10:1'],
      onDelete: 'no action',
      onUpdate: 'no action',
    });
    expect(kinds((m) => (m.constraints.a = selfFk('t:10', 'a')))).toEqual([
      'addConstraint',
    ]);
    expect(
      kinds((m) => {
        m.tables['new-t'] = {
          id: 'new-t',
          schemaId: 's:1',
          name: 'tree',
          comment: null,
        };
        m.constraints.b = selfFk('new-t', 'b');
      }),
    ).toEqual(['addConstraint']);
  });
});

describe('drop', () => {
  test('a removed constraint yields dropConstraint with the constraint as it was', () => {
    expect(run((m) => delete m.constraints['k:3']).ops).toEqual([
      { kind: 'dropConstraint', constraint: fixtureModel.constraints['k:3'] },
    ]);
  });

  test('constraints of a dropped table go with it, except its foreign key to another table', () => {
    const { ops } = run((m) => {
      delete m.tables['t:20'];
      for (const id of ['k:2', 'k:3', 'k:4']) delete m.constraints[id];
    });
    expect(ops).toEqual([
      { kind: 'dropConstraint', constraint: fixtureModel.constraints['k:2'] },
    ]);
  });

  test('a foreign key between two dropped tables is dropped, so neither drop finds it', () => {
    const { ops } = run((m) => {
      delete m.tables['t:20'];
      delete m.tables['t:10'];
      for (const id of ['k:1', 'k:2', 'k:3', 'k:4']) delete m.constraints[id];
    });
    expect(ops).toEqual([
      { kind: 'dropConstraint', constraint: fixtureModel.constraints['k:2'] },
    ]);
  });

  test('a foreign key from a dropped table to itself needs no operation', () => {
    const { baseline, desired } = editBoth(
      (m) => {
        m.constraints['k:9'] = {
          id: 'k:9',
          tableId: 't:10',
          kind: 'fk',
          name: 'users_parent_fkey',
          columnIds: ['c:10:1'],
          refTableId: 't:10',
          refColumnIds: ['c:10:1'],
          onDelete: 'no action',
          onUpdate: 'no action',
        };
      },
      (m) => {
        delete m.tables['t:10'];
        delete m.constraints['k:9'];
      },
    );
    expect(
      diffConstraints(baseline, desired).ops.filter(
        (o) => o.kind === 'dropConstraint' && o.constraint.id === 'k:9',
      ),
    ).toEqual([]);
  });
});

describe('rename', () => {
  test('a renamed constraint keeps its id and yields renameConstraint', () => {
    expect(
      run((m) => (m.constraints['k:3']!.name = 'positive_total')).ops,
    ).toEqual([
      {
        kind: 'renameConstraint',
        constraintId: 'k:3',
        from: 'invoices_total_check',
        to: 'positive_total',
      },
    ]);
  });
});

describe('a changed constraint is dropped and added again', () => {
  test('a changed foreign key action yields drop + add', () => {
    const { ops } = run((m) => (asFk(m).onDelete = 'restrict'));
    expect(ops.map((o) => o.kind)).toEqual(['dropConstraint', 'addConstraint']);
    expect(ops[0]).toMatchObject({ constraint: { onDelete: 'cascade' } });
    expect(ops[1]).toMatchObject({ constraint: { onDelete: 'restrict' } });
  });

  test.each([
    [
      'its on-update action',
      (m: Parameters<typeof asFk>[0]) => (asFk(m).onUpdate = 'cascade'),
    ],
    [
      'its referenced columns',
      (m: Parameters<typeof asFk>[0]) => (asFk(m).refColumnIds = ['c:10:2']),
    ],
    [
      'its local columns',
      (m: Parameters<typeof asFk>[0]) => (asFk(m).columnIds = ['c:20:3']),
    ],
    [
      'its referenced table',
      (m: Parameters<typeof asFk>[0]) => (asFk(m).refTableId = 't:30'),
    ],
  ])('a foreign key with %s changed', (_label, change) => {
    expect(kinds(change)).toEqual(['dropConstraint', 'addConstraint']);
  });

  test('a changed check expression, and a unique constraint with its columns reordered', () => {
    expect(
      kinds(
        (m) =>
          ((
            m.constraints['k:3'] as Extract<Constraint, { kind: 'check' }>
          ).expression = '(total > 0)'),
      ),
    ).toEqual(['dropConstraint', 'addConstraint']);
    const base: Constraint = {
      ...unique,
      columnIds: ['c:20:2', 'c:20:3'],
      tableId: 't:20',
    };
    const { ops } = ((): { ops: ReturnType<typeof diffConstraints>['ops'] } => {
      const { baseline, desired } = edit(
        (m) => (m.constraints['new-u'] = base),
      );
      baseline.constraints['new-u'] = base;
      desired.constraints['new-u'] = {
        ...base,
        columnIds: ['c:20:3', 'c:20:2'],
      };
      return diffConstraints(baseline, desired);
    })();
    expect(ops.map((o) => o.kind)).toEqual(['dropConstraint', 'addConstraint']);
  });

  test('renaming and changing at once is drop + add, not a rename', () => {
    const { ops } = run((m) => {
      asFk(m).onDelete = 'restrict';
      asFk(m).name = 'renamed_fkey';
    });
    expect(ops.map((o) => o.kind)).toEqual(['dropConstraint', 'addConstraint']);
  });
});

test('sameConstraintDefinition ignores the name only', () => {
  expect(sameConstraintDefinition(fk, { ...fk, name: 'other' })).toBe(true);
  expect(sameConstraintDefinition(fk, { ...fk, onDelete: 'restrict' })).toBe(
    false,
  );
});
