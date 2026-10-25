import { describe, expect, test } from 'vitest';
import { diffFkKeyChanges } from '../src/diff/fk-keys';
import type { Constraint, SchemaModel } from '../src/model/types';
import { editBoth } from './diff-helpers';
import { fixtureModel } from './fixtures/model';

const FK = 'k:2'; // invoices.user_id referencing users.id
const PK = 'k:1'; // the primary key of users on id

const run = (
  change: (m: SchemaModel) => void,
  baseline?: (m: SchemaModel) => void,
) => {
  const both = editBoth(baseline ?? (() => {}), change);
  return diffFkKeyChanges(both.baseline, both.desired).ops;
};

const unique: Constraint = {
  id: 'new-u',
  tableId: 't:10',
  kind: 'unique',
  name: 'users_id_key',
  columnIds: ['c:10:1'],
};

const rebuilt = [
  { kind: 'dropConstraint', constraint: fixtureModel.constraints[FK] },
  { kind: 'addConstraint', constraint: fixtureModel.constraints[FK] },
];

describe('a foreign key whose key goes away', () => {
  test('a primary key swapped for a unique constraint rebuilds the foreign key', () => {
    expect(
      run((m) => {
        delete m.constraints[PK];
        m.constraints['new-u'] = unique;
      }),
    ).toEqual(rebuilt);
  });

  test('a primary key dropped without a replacement does too, so validation can report it', () => {
    expect(run((m) => delete m.constraints[PK])).toEqual(rebuilt);
  });

  test('a changed key rebuilds it', () => {
    expect(
      run((m) => (m.constraints[PK]!.columnIds = ['c:10:1', 'c:10:2'])),
    ).toEqual(rebuilt);
  });

  test('a unique index over the referenced column that is dropped rebuilds it', () => {
    const index = (m: SchemaModel) => {
      m.indexes['i:u'] = {
        id: 'i:u',
        tableId: 't:10',
        name: 'users_id_idx',
        unique: true,
        columnIds: ['c:10:1'],
      };
    };
    expect(run((m) => delete m.indexes['i:u'], index)).toHaveLength(2);
    expect(run(() => {}, index)).toEqual([]);
  });
});

describe('nothing to rebuild', () => {
  test('no edits', () => {
    expect(run(() => {})).toEqual([]);
  });

  test('a renamed key still covers the foreign key', () => {
    expect(run((m) => (m.constraints[PK]!.name = 'users_pk'))).toEqual([]);
  });

  test('a key over other columns going away does not matter', () => {
    expect(
      run(
        (m) => delete m.constraints['k:9'],
        (m) => {
          m.constraints['k:9'] = {
            ...unique,
            id: 'k:9',
            columnIds: ['c:10:2'],
          };
        },
      ),
    ).toEqual([]);
  });

  test('a foreign key that is dropped or changed is left to the constraint diff', () => {
    expect(
      run((m) => {
        delete m.constraints[PK];
        delete m.constraints[FK];
      }),
    ).toEqual([]);
    expect(
      run((m) => {
        delete m.constraints[PK];
        (m.constraints[FK] as Extract<Constraint, { kind: 'fk' }>).onDelete =
          'restrict';
      }),
    ).toEqual([]);
  });

  test('a referenced table or column that is dropped is left to the dangling key rule', () => {
    expect(
      run((m) => {
        delete m.tables['t:10'];
        for (const id of ['c:10:1', 'c:10:2']) delete m.columns[id];
        delete m.constraints[PK];
      }),
    ).toEqual([]);
  });

  test('a foreign key already rebuilt for its column types is not rebuilt twice', () => {
    const uuid = { name: 'uuid', isArray: false };
    const text = { name: 'text', isArray: false };
    expect(
      run(
        (m) => {
          delete m.constraints[PK];
          m.columns['c:20:2']!.type = text;
          m.columns['c:10:1']!.type = text;
        },
        (m) => {
          m.columns['c:20:2']!.type = uuid;
          m.columns['c:10:1']!.type = uuid;
        },
      ),
    ).toEqual([]);
  });
});
