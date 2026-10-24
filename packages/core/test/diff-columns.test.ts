import { describe, expect, test } from 'vitest';
import { diffColumns } from '../src/diff/columns';
import type { Column } from '../src/model/types';
import { partRunner } from './diff-helpers';
import { fixtureModel } from './fixtures/model';

const run = partRunner(diffColumns);

const newColumn = (over: Partial<Column> = {}): Column => ({
  id: 'new-c',
  tableId: 't:10',
  name: 'nickname',
  position: 9,
  type: { name: 'text', isArray: false },
  notNull: false,
  default: null,
  identity: null,
  comment: null,
  ...over,
});

test('no edits, no operations', () => {
  expect(run(() => {})).toEqual({ ops: [], errors: [] });
});

describe('add', () => {
  test('a new column yields addColumn with the whole column', () => {
    const { ops } = run((m) => (m.columns['new-c'] = newColumn()));
    expect(ops).toEqual([{ kind: 'addColumn', column: newColumn() }]);
  });

  test('a new identity column keeps its identity in the operation', () => {
    const { ops } = run(
      (m) =>
        (m.columns['new-c'] = newColumn({ identity: 'always', notNull: true })),
    );
    expect(ops).toMatchObject([
      { kind: 'addColumn', column: { identity: 'always', notNull: true } },
    ]);
  });

  test('columns of a table being created belong to its createTable, not to addColumn', () => {
    const { ops } = run((m) => {
      m.tables['new-t'] = {
        id: 'new-t',
        schemaId: 's:1',
        name: 'orders',
        comment: null,
      };
      m.columns['new-c'] = newColumn({ tableId: 'new-t' });
    });
    expect(ops).toEqual([]);
  });
});

describe('drop', () => {
  test('a removed column yields dropColumn with the column as it was', () => {
    const { ops } = run((m) => delete m.columns['c:10:2']);
    expect(ops).toEqual([
      { kind: 'dropColumn', column: fixtureModel.columns['c:10:2'] },
    ]);
  });

  test('columns of a dropped table go with it and get no operation', () => {
    const { ops } = run((m) => {
      delete m.tables['t:20'];
      for (const id of ['c:20:1', 'c:20:2', 'c:20:3']) delete m.columns[id];
    });
    expect(ops).toEqual([]);
  });

  test('a read-only column can be dropped: it is its own column being removed', () => {
    const { ops } = run((m) => delete m.columns['c:20:1']);
    expect(ops).toMatchObject([
      {
        kind: 'dropColumn',
        column: { id: 'c:20:1', readOnly: 'nextval-default' },
      },
    ]);
  });
});

describe('rename', () => {
  test('a renamed column keeps its id and yields renameColumn, not drop + add', () => {
    const { ops } = run((m) => (m.columns['c:10:2']!.name = 'state'));
    expect(ops).toEqual([
      { kind: 'renameColumn', columnId: 'c:10:2', from: 'status', to: 'state' },
    ]);
  });

  test('renaming a table does not touch its columns', () => {
    const { ops } = run((m) => (m.tables['t:10']!.name = 'people'));
    expect(ops).toEqual([]);
  });
});

test('add, drop and rename in one edit give one operation each', () => {
  const { ops } = run((m) => {
    m.columns['new-c'] = newColumn();
    delete m.columns['c:20:2'];
    m.columns['c:20:3']!.name = 'amount';
  });
  expect(ops.map((o) => o.kind).sort()).toEqual([
    'addColumn',
    'dropColumn',
    'renameColumn',
  ]);
});

describe('changes to an existing column (E5)', () => {
  const text = { name: 'text', isArray: false };

  test('a type change yields alterColumnType with both types', () => {
    const { ops } = run((m) => (m.columns['c:10:2']!.type = text));
    expect(ops).toEqual([
      {
        kind: 'alterColumnType',
        columnId: 'c:10:2',
        from: fixtureModel.columns['c:10:2'].type,
        to: text,
      },
    ]);
  });

  test('a change in length, precision or array-ness counts as a type change', () => {
    const numeric = (params: number[], isArray = false) => ({
      name: 'numeric',
      params,
      isArray,
    });
    const kinds = (type: Column['type']) =>
      run((m) => (m.columns['c:20:3']!.type = type)).ops.map((o) => o.kind);
    expect(kinds(numeric([10, 2]))).toEqual([]); // the same type again
    expect(kinds(numeric([10, 3]))).toEqual(['alterColumnType']);
    expect(kinds(numeric([12, 2]))).toEqual(['alterColumnType']);
    expect(kinds(numeric([10, 2], true))).toEqual(['alterColumnType']);
  });

  test('NOT NULL on and off yield setNotNull and dropNotNull', () => {
    expect(run((m) => (m.columns['c:20:3']!.notNull = true)).ops).toEqual([
      { kind: 'setNotNull', columnId: 'c:20:3' },
    ]);
    expect(run((m) => (m.columns['c:20:2']!.notNull = false)).ops).toEqual([
      { kind: 'dropNotNull', columnId: 'c:20:2' },
    ]);
  });

  test('default changes: set, change, drop', () => {
    const now = { kind: 'expression' as const, expression: 'now()' };
    expect(run((m) => (m.columns['c:20:2']!.default = now)).ops).toEqual([
      { kind: 'setDefault', columnId: 'c:20:2', to: now },
    ]);
    expect(
      run(
        (m) =>
          (m.columns['c:20:3']!.default = {
            kind: 'constant',
            expression: '1',
          }),
      ).ops,
    ).toEqual([
      {
        kind: 'setDefault',
        columnId: 'c:20:3',
        to: { kind: 'constant', expression: '1' },
      },
    ]);
    expect(run((m) => (m.columns['c:20:3']!.default = null)).ops).toEqual([
      { kind: 'dropDefault', columnId: 'c:20:3' },
    ]);
  });

  test('the same default text is no change, whatever kind it is labelled', () => {
    const { ops } = run(
      (m) =>
        (m.columns['c:20:3']!.default = {
          kind: 'expression',
          expression: '0',
        }),
    );
    expect(ops).toEqual([]);
  });

  test('one operation per changed property, in the order they run', () => {
    const { ops } = run((m) => {
      const c = m.columns['c:20:3']!;
      c.type = { name: 'bigint', isArray: false };
      c.default = { kind: 'constant', expression: '5' };
      c.notNull = true;
    });
    expect(ops.map((o) => o.kind)).toEqual([
      'alterColumnType',
      'setDefault',
      'setNotNull',
    ]);
  });

  test('a rename together with other changes gives the rename plus one operation each', () => {
    const { ops } = run((m) => {
      m.columns['c:20:3']!.name = 'amount';
      m.columns['c:20:3']!.notNull = true;
    });
    expect(ops.map((o) => o.kind)).toEqual(['renameColumn', 'setNotNull']);
  });

  test('changes in different columns are separate', () => {
    const { ops } = run((m) => {
      m.columns['c:10:2']!.type = text;
      m.columns['c:20:3']!.notNull = true;
    });
    expect(
      ops.map((o) => `${o.kind}:${'columnId' in o ? o.columnId : ''}`).sort(),
    ).toEqual(['alterColumnType:c:10:2', 'setNotNull:c:20:3']);
  });

  test('turning identity on, off or between kinds is a blocking error with no operation', () => {
    const on = run((m) => (m.columns['c:10:2']!.identity = 'always'));
    expect(on.ops).toEqual([]);
    expect(on.errors).toMatchObject([
      { code: 'column-identity-changed', objectId: 'c:10:2' },
    ]);
    expect(
      run((m) => (m.columns['c:10:1']!.identity = null)).errors,
    ).toHaveLength(1);
    expect(
      run((m) => (m.columns['c:10:1']!.identity = 'byDefault')).errors,
    ).toHaveLength(1);
  });

  test('changes to columns of a dropped table are not reported', () => {
    const { ops, errors } = run((m) => {
      delete m.tables['t:20'];
      m.columns['c:20:3']!.notNull = true;
    });
    expect(ops).toEqual([]);
    expect(errors).toEqual([]);
  });
});
