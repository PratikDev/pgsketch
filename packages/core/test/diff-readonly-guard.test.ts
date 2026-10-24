import { describe, expect, test } from 'vitest';
import { diffColumns } from '../src/diff/columns';
import { diffComments } from '../src/diff/comments';
import { diffConstraints } from '../src/diff/constraints';
import { diffIndexes } from '../src/diff/indexes';
import { guardReadOnly } from '../src/diff/readonly-guard';
import { diffTables } from '../src/diff/tables';
import type { Constraint, SchemaModel } from '../src/model/types';
import { editBoth } from './diff-helpers';

/** Every diff part that can touch existing objects, then the guard. */
function guarded(
  changeBaseline: (m: SchemaModel) => void,
  change: (m: SchemaModel) => void,
) {
  const { baseline, desired } = editBoth(changeBaseline, change);
  const ops = [
    diffTables,
    diffColumns,
    diffConstraints,
    diffIndexes,
    diffComments,
  ].flatMap((part) => part(baseline, desired).ops);
  return guardReadOnly(baseline, desired, ops);
}
const none = () => {};
const codes = (r: { errors: { code: string; objectId: string }[] }) =>
  r.errors.map((e) => `${e.code}@${e.objectId}`);
const kinds = (r: { ops: { kind: string }[] }) => r.ops.map((o) => o.kind);

const readOnlyFk = (m: SchemaModel) => {
  (m.constraints['k:2'] as Constraint).readOnly = 'deferrable';
};

describe('dropping what read-only objects depend on', () => {
  test('a column used by a view returns a blocking error and no operation', () => {
    const r = guarded(none, (m) => delete m.columns['c:20:3']);
    expect(kinds(r)).not.toContain('dropColumn');
    expect(codes(r)).toEqual(['read-only-dependency@c:20:3']);
    expect(r.errors[0]!.message).toContain('view "open_invoices"');
  });

  test('a column referenced by a read-only FK on another table returns a blocking error and no operation', () => {
    const r = guarded(readOnlyFk, (m) => delete m.columns['c:10:1']);
    expect(kinds(r)).not.toContain('dropColumn');
    expect(codes(r)).toEqual(['read-only-dependency@c:10:1']);
    expect(r.errors[0]!.message).toContain(
      'foreign key "invoices_user_id_fkey"',
    );
  });

  test('an editable FK on another table does not block: the editor removes it with the column', () => {
    const r = guarded(none, (m) => {
      delete m.columns['c:10:1'];
      delete m.constraints['k:1']; // the primary key on that column
      delete m.constraints['k:2']; // the foreign key that references it
    });
    expect(r.errors).toEqual([]);
    expect(kinds(r)).toEqual([
      'dropColumn',
      'dropConstraint',
      'dropConstraint',
    ]);
  });

  test('a partial index on the same table is dropped with the column, not blocked', () => {
    const r = guarded(
      (m) => {
        m.indexes['i:1']!.readOnly = 'partial-index';
      },
      (m) => {
        delete m.columns['c:20:2'];
        delete m.indexes['i:1'];
        delete m.constraints['k:2'];
        delete m.constraints['k:4'];
      },
    );
    expect(r.errors).toEqual([]);
    expect(r.ops).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'dropColumn' }),
        expect.objectContaining({
          kind: 'dropIndex',
          index: expect.objectContaining({ readOnly: 'partial-index' }),
        }),
        expect.objectContaining({
          kind: 'dropConstraint',
          constraint: expect.objectContaining({
            id: 'k:4',
            readOnly: 'exclusion',
          }),
        }),
      ]),
    );
  });

  test('a table used by a view is blocked; a table with its own trigger and policy is not', () => {
    expect(codes(guarded(none, (m) => delete m.tables['t:20']))).toEqual([
      'read-only-dependency@t:20',
    ]);
    const own = guarded(
      (m) => {
        delete m.unmodeled['u:1'];
        m.unmodeled['u:trg'] = {
          id: 'u:trg',
          kind: 'trigger',
          schemaId: null,
          name: 'trg',
          ownerTableId: 't:20',
          tableIds: ['t:20'],
          columnIds: ['c:20:3'],
        };
        m.unmodeled['u:pol'] = {
          id: 'u:pol',
          kind: 'policy',
          schemaId: null,
          name: 'pol',
          ownerTableId: 't:20',
          tableIds: ['t:20'],
          columnIds: [],
        };
      },
      (m) => delete m.tables['t:20'],
    );
    expect(own.errors).toEqual([]);
    expect(kinds(own)).toEqual(['dropTable']);
  });

  test('a policy on another table that reads this one blocks dropping it', () => {
    const r = guarded(
      (m) => {
        delete m.unmodeled['u:1'];
        m.unmodeled['u:pol'] = {
          id: 'u:pol',
          kind: 'policy',
          schemaId: null,
          name: 'pol',
          ownerTableId: 't:30',
          tableIds: ['t:20', 't:30'],
          columnIds: [],
        };
      },
      (m) => delete m.tables['t:20'],
    );
    expect(codes(r)).toEqual(['read-only-dependency@t:20']);
  });

  test('a trigger listing the column in UPDATE OF blocks dropping it; the sequence behind a column does not', () => {
    const base = (m: SchemaModel) => {
      delete m.unmodeled['u:1'];
      m.unmodeled['u:trg'] = {
        id: 'u:trg',
        kind: 'trigger',
        schemaId: null,
        name: 'trg',
        ownerTableId: 't:20',
        tableIds: ['t:20'],
        columnIds: ['c:20:2'],
      };
      m.unmodeled['u:seq'] = {
        id: 'u:seq',
        kind: 'sequence',
        schemaId: 's:2',
        name: 'invoices_id_seq',
        ownerTableId: null,
        tableIds: ['t:20'],
        columnIds: ['c:20:1'],
      };
    };
    expect(codes(guarded(base, (m) => delete m.columns['c:20:2']))).toEqual([
      'read-only-dependency@c:20:2',
    ]);
    expect(guarded(base, (m) => delete m.columns['c:20:1']).errors).toEqual([]);
  });

  test('a read-only FK on a table that is dropped too does not block', () => {
    const r = guarded(
      (m) => {
        readOnlyFk(m);
        delete m.unmodeled['u:1']; // the view over invoices would block dropping it
      },
      (m) => {
        delete m.tables['t:10'];
        delete m.tables['t:20'];
      },
    );
    expect(r.errors).toEqual([]);
  });
});

describe('changing read-only objects', () => {
  test('renaming, retyping or commenting a read-only column is blocked', () => {
    const r = guarded(none, (m) => {
      const c = m.columns['c:20:1']!; // the serial column, read-only
      c.name = 'invoice_id';
      c.type = { name: 'bigint', isArray: false };
      c.comment = 'note';
    });
    expect(r.ops).toEqual([]);
    expect(codes(r)).toEqual(['read-only-changed@c:20:1']);
  });

  test('renaming or commenting a read-only table is blocked', () => {
    const r = guarded(none, (m) => {
      m.tables['t:30']!.name = 'log';
      m.tables['t:30']!.comment = 'x';
    });
    expect(r.ops).toEqual([]);
    expect(codes(r)).toEqual(['read-only-changed@t:30']);
  });

  test('renaming a read-only constraint or index is blocked', () => {
    const r = guarded(none, (m) => {
      m.constraints['k:4']!.name = 'renamed';
      m.indexes['i:2']!.name = 'renamed';
    });
    expect(r.ops).toEqual([]);
    expect(codes(r).sort()).toEqual([
      'read-only-changed@i:2',
      'read-only-changed@k:4',
    ]);
  });

  test('changing the definition of a read-only constraint would drop and recreate it, so it is blocked', () => {
    const r = guarded(
      none,
      (m) => (m.constraints['k:4']!.columnIds = ['c:20:3']),
    );
    expect(r.ops).toEqual([]);
    expect(codes(r)).toEqual(['read-only-changed@k:4']);
  });
});

test('changes to editable objects pass through untouched', () => {
  const r = guarded(none, (m) => {
    m.tables['t:10']!.name = 'people';
    m.columns['c:10:2']!.name = 'state';
    m.columns['c:20:3']!.notNull = true;
    m.constraints['k:3']!.name = 'positive';
    m.tables['t:10']!.comment = 'x';
  });
  expect(r.errors).toEqual([]);
  expect(kinds(r).sort()).toEqual([
    'renameColumn',
    'renameConstraint',
    'renameTable',
    'setComment',
    'setNotNull',
  ]);
});

test('removing a read-only object together with its own column is fine', () => {
  const r = guarded(none, (m) => {
    delete m.columns['c:20:1']; // read-only serial column, not used by anything
  });
  expect(r.errors).toEqual([]);
  expect(kinds(r)).toEqual(['dropColumn']);
});
