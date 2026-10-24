import { describe, expect, test } from 'vitest';
import { diffFkTypeChanges } from '../src/diff/fk-type-changes';
import { guardReadOnly } from '../src/diff/readonly-guard';
import type { Constraint, PgType, SchemaModel } from '../src/model/types';
import { editBoth } from './diff-helpers';

const t = (name: string): PgType => ({ name, isArray: false });
const FK_COLUMN = 'c:20:2'; // invoices.user_id, referencing users.id
const KEY_COLUMN = 'c:10:1';

/** Both columns start with `from`; `change` then edits the types in the edited model. */
function run(
  from: string,
  change: (m: SchemaModel) => void,
  baseline?: (m: SchemaModel) => void,
) {
  const both = editBoth((m) => {
    m.columns[FK_COLUMN]!.type = t(from);
    m.columns[KEY_COLUMN]!.type = t(from);
    baseline?.(m);
  }, change);
  return { ...both, part: diffFkTypeChanges(both.baseline, both.desired) };
}
const retype = (column: string, to: string) => (m: SchemaModel) =>
  (m.columns[column]!.type = t(to));

describe('only one side changes', () => {
  test('integer to bigint on the key alone emits no extra operations', () => {
    expect(run('integer', retype(KEY_COLUMN, 'bigint')).part.ops).toEqual([]);
  });

  test('integer to bigint on the foreign key column alone emits none either', () => {
    expect(run('integer', retype(FK_COLUMN, 'bigint')).part.ops).toEqual([]);
  });
});

describe('both sides change', () => {
  const both = (to: string) => (m: SchemaModel) => {
    m.columns[FK_COLUMN]!.type = t(to);
    m.columns[KEY_COLUMN]!.type = t(to);
  };

  test('uuid to text on both sides emits drop + add of the same foreign key', () => {
    const { part, baseline, desired } = run('uuid', both('text'));
    expect(part.ops).toEqual([
      { kind: 'dropConstraint', constraint: baseline.constraints['k:2'] },
      { kind: 'addConstraint', constraint: desired.constraints['k:2'] },
    ]);
  });

  test('integer to bigint on both sides emits none: Postgres can compare the types in between', () => {
    expect(run('integer', both('bigint')).part.ops).toEqual([]);
  });

  test('integer to numeric on both sides needs the rebuild: a numeric column cannot reference an integer key', () => {
    expect(run('integer', both('numeric')).part.ops.map((o) => o.kind)).toEqual(
      ['dropConstraint', 'addConstraint'],
    );
  });

  test('text to varchar on both sides emits none', () => {
    expect(run('text', both('varchar')).part.ops).toEqual([]);
  });
});

describe('what is left to other parts', () => {
  const both = (m: SchemaModel) => {
    m.columns[FK_COLUMN]!.type = t('text');
    m.columns[KEY_COLUMN]!.type = t('text');
  };

  test('a foreign key that also changed another way is handled by the constraint diff', () => {
    const { part } = run('uuid', (m) => {
      both(m);
      (m.constraints['k:2'] as Extract<Constraint, { kind: 'fk' }>).onDelete =
        'restrict';
    });
    expect(part.ops).toEqual([]);
  });

  test('a removed foreign key, and type changes unrelated to any key, emit nothing', () => {
    expect(
      run('uuid', (m) => {
        both(m);
        delete m.constraints['k:2'];
      }).part.ops,
    ).toEqual([]);
    expect(run('uuid', retype('c:20:3', 'text')).part.ops).toEqual([]);
  });
});

test('every column pair of a composite foreign key is checked', () => {
  const addPair = (m: SchemaModel) => {
    m.columns['c:10:2']!.type = t('uuid'); // users.status
    const fk = m.constraints['k:2'] as Extract<Constraint, { kind: 'fk' }>;
    fk.columnIds = [FK_COLUMN, 'c:20:3'];
    fk.refColumnIds = [KEY_COLUMN, 'c:10:2'];
    m.columns['c:20:3']!.type = t('uuid');
  };
  const { part } = run(
    'integer',
    (m) => {
      m.columns['c:10:2']!.type = t('text');
      m.columns['c:20:3']!.type = t('text');
    },
    addPair,
  );
  expect(part.ops.map((o) => o.kind)).toEqual([
    'dropConstraint',
    'addConstraint',
  ]);
});

test('a read-only foreign key is never recreated: the guard blocks the rebuild', () => {
  const { baseline, desired, part } = run(
    'uuid',
    (m) => {
      m.columns[FK_COLUMN]!.type = t('text');
      m.columns[KEY_COLUMN]!.type = t('text');
    },
    (m) => ((m.constraints['k:2'] as Constraint).readOnly = 'deferrable'),
  );
  const guarded = guardReadOnly(baseline, desired, part.ops);
  expect(guarded.ops).toEqual([]);
  expect(guarded.errors).toMatchObject([
    { code: 'read-only-changed', objectId: 'k:2' },
  ]);
});
