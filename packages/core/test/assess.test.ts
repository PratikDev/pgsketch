import { describe, expect, test } from 'vitest';
import type { ChangeOp } from '../src/diff/ops';
import type { Column, Constraint, Index, PgType } from '../src/model/types';
import { assessRisk, RISK_LABELS, type RiskLevel } from '../src/risk/assess';
import { fixtureModel as m } from './fixtures/model';

const t = (name: string, params?: number[]): PgType => ({
  name,
  ...(params && { params }),
  isArray: false,
});
const levels = (op: ChangeOp) => assessRisk(op, m).map((r) => r.level);
const messages = (op: ChangeOp) => assessRisk(op, m).map((r) => r.message);

const newColumn = (over: Partial<Column> = {}): Column => ({
  id: 'new-c',
  tableId: 't:20',
  name: 'note',
  position: 9,
  type: t('text'),
  notNull: false,
  default: null,
  identity: null,
  comment: null,
  ...over,
});
const unique = (tableId: string): Constraint => ({
  id: 'new-k',
  tableId,
  kind: 'unique',
  name: 'invoices_note_key',
  columnIds: ['c:20:3'],
});
const index = (tableId: string, over: Partial<Index> = {}): Index => ({
  id: 'new-i',
  tableId,
  name: 'invoices_total_idx',
  unique: false,
  columnIds: ['c:20:3'],
  ...over,
});
const alter = (from: PgType, to: PgType): ChangeOp => ({
  kind: 'alterColumnType',
  columnId: 'c:20:3',
  from,
  to,
});

describe('destructive: data is lost', () => {
  test('dropping a table or a column', () => {
    expect(levels({ kind: 'dropTable', table: m.tables['t:20'] })).toEqual([
      'destructive',
    ]);
    expect(levels({ kind: 'dropColumn', column: m.columns['c:20:3'] })).toEqual(
      ['destructive'],
    );
  });

  test('the messages name the table and the column', () => {
    expect(messages({ kind: 'dropTable', table: m.tables['t:20'] })[0]).toBe(
      'Drops table "billing"."invoices" and all its data',
    );
    expect(
      messages({ kind: 'dropColumn', column: m.columns['c:20:3'] })[0],
    ).toBe('Drops column "billing"."invoices"."total" and the data in it');
  });

  test('a lossy type change, together with the rewrite it needs', () => {
    expect(levels(alter(t('numeric', [10, 2]), t('numeric', [10, 1])))).toEqual(
      ['destructive', 'locks'],
    );
    expect(levels(alter(t('real'), t('integer')))).toEqual([
      'destructive',
      'locks',
    ]);
  });

  test('a read-only constraint or index dropped with its own table or column is listed by name', () => {
    const excl = assessRisk(
      { kind: 'dropConstraint', constraint: m.constraints['k:4'] },
      m,
    );
    expect(excl).toEqual([
      {
        level: 'destructive',
        message: `Drops "invoices_excl", which pgsketch can't recreate`,
      },
    ]);
    expect(messages({ kind: 'dropIndex', index: m.indexes['i:2'] })).toEqual([
      `Drops "invoices_open_idx", which pgsketch can't recreate`,
    ]);
  });
});

describe('may fail: it depends on the data', () => {
  test('NOT NULL on a column that may have nulls, with the scan that costs', () => {
    expect(levels({ kind: 'setNotNull', columnId: 'c:20:3' })).toEqual([
      'may-fail',
      'locks',
    ]);
  });

  test('a new NOT NULL column with no default fails if the table has rows', () => {
    expect(
      levels({ kind: 'addColumn', column: newColumn({ notNull: true }) }),
    ).toEqual(['may-fail']);
    expect(
      messages({ kind: 'addColumn', column: newColumn({ notNull: true }) })[0],
    ).toContain('"billing"."invoices"');
  });

  test('a new column that can be null, has a default or is an identity is safe', () => {
    expect(levels({ kind: 'addColumn', column: newColumn() })).toEqual([]);
    expect(
      levels({
        kind: 'addColumn',
        column: newColumn({
          notNull: true,
          default: { kind: 'constant', expression: "'n/a'::text" },
        }),
      }),
    ).toEqual([]);
    expect(
      levels({
        kind: 'addColumn',
        column: newColumn({
          notNull: true,
          identity: 'always',
          type: t('bigint'),
        }),
      }),
    ).toEqual([]);
  });

  test.each(['pk', 'unique', 'check', 'fk'] as const)(
    'adding a %s constraint to an existing table fails on bad data and scans it',
    (kind) => {
      const constraint = {
        id: 'new-k',
        tableId: 't:20',
        name: 'k',
        columnIds: ['c:20:3'],
        kind,
        expression: '(x)',
        refTableId: 't:10',
        refColumnIds: ['c:10:1'],
        onDelete: 'no action',
        onUpdate: 'no action',
      } as Constraint;
      expect(levels({ kind: 'addConstraint', constraint })).toEqual([
        'may-fail',
        'locks',
      ]);
    },
  );

  test('a type change with no known classification may fail, and rewrites', () => {
    expect(levels(alter(t('bigint'), t('integer')))).toEqual([
      'may-fail',
      'locks',
    ]);
    expect(levels(alter(t('uuid'), t('text')))).toEqual(['may-fail', 'locks']);
  });

  test('a unique index fails on duplicates, and a plain one does not', () => {
    expect(
      levels({ kind: 'addIndex', index: index('t:20', { unique: true }) }),
    ).toEqual(['may-fail', 'locks']);
  });
});

describe('breaks app code', () => {
  test('renaming a table or a column', () => {
    expect(
      levels({
        kind: 'renameTable',
        tableId: 't:10',
        from: 'users',
        to: 'people',
      }),
    ).toEqual(['breaks-app']);
    expect(
      levels({
        kind: 'renameColumn',
        columnId: 'c:10:2',
        from: 'status',
        to: 'state',
      }),
    ).toEqual(['breaks-app']);
    expect(
      messages({
        kind: 'renameTable',
        tableId: 't:10',
        from: 'users',
        to: 'people',
      })[0],
    ).toBe(
      'Renaming table "users" to "people" breaks code that still uses the old name',
    );
  });
});

describe('locks or slow on large tables', () => {
  test('addIndex blocks writes while it builds', () => {
    expect(levels({ kind: 'addIndex', index: index('t:20') })).toEqual([
      'locks',
    ]);
    expect(messages({ kind: 'addIndex', index: index('t:20') })[0]).toBe(
      'Creating index "invoices_total_idx" blocks writes to "billing"."invoices" until it finishes',
    );
  });

  test('widening an integer is safe for the data but rewrites the table', () => {
    expect(levels(alter(t('smallint'), t('integer')))).toEqual(['locks']);
    expect(levels(alter(t('integer'), t('bigint')))).toEqual(['locks']);
  });

  test('changes that only grow a type modifier or share a representation need no rewrite', () => {
    expect(levels(alter(t('varchar', [10]), t('varchar', [20])))).toEqual([]);
    expect(levels(alter(t('varchar', [10]), t('text')))).toEqual([]);
    expect(levels(alter(t('text'), t('varchar')))).toEqual([]);
    expect(levels(alter(t('numeric', [10, 2]), t('numeric', [12, 2])))).toEqual(
      [],
    );
    expect(levels(alter(t('integer'), t('integer')))).toEqual([]);
  });
});

describe('safe', () => {
  test('constraints and indexes on a table created in the same migration are safe: it is empty', () => {
    expect(
      levels({ kind: 'addConstraint', constraint: unique('new-table') }),
    ).toEqual([]);
    expect(
      levels({ kind: 'addIndex', index: index('new-table', { unique: true }) }),
    ).toEqual([]);
  });

  test('dropping an editable constraint or index', () => {
    expect(
      levels({ kind: 'dropConstraint', constraint: m.constraints['k:3'] }),
    ).toEqual([]);
    expect(levels({ kind: 'dropIndex', index: m.indexes['i:1'] })).toEqual([]);
  });

  test.each<[string, ChangeOp]>([
    ['createSchema', { kind: 'createSchema', schema: m.schemas['s:1'] }],
    [
      'createTable',
      { kind: 'createTable', table: m.tables['t:10'], columns: [] },
    ],
    ['dropNotNull', { kind: 'dropNotNull', columnId: 'c:20:3' }],
    [
      'setDefault',
      {
        kind: 'setDefault',
        columnId: 'c:20:3',
        to: { kind: 'constant', expression: '1' },
      },
    ],
    ['dropDefault', { kind: 'dropDefault', columnId: 'c:20:3' }],
    [
      'renameConstraint',
      { kind: 'renameConstraint', constraintId: 'k:3', from: 'a', to: 'b' },
    ],
    [
      'renameIndex',
      { kind: 'renameIndex', indexId: 'i:1', from: 'a', to: 'b' },
    ],
    [
      'setComment',
      {
        kind: 'setComment',
        target: { kind: 'table', tableId: 't:10' },
        to: 'x',
      },
    ],
  ])('%s', (_label, op) => {
    expect(assessRisk(op, m)).toEqual([]);
  });
});

describe('robustness', () => {
  test('an operation on something the loaded schema does not have still gives a message, not an error', () => {
    expect(
      assessRisk({ kind: 'setNotNull', columnId: 'missing' }, m)[0]!.message,
    ).toContain('missing');
    expect(
      assessRisk(
        {
          kind: 'dropColumn',
          column: newColumn({ id: 'gone', tableId: 'nowhere' }),
        },
        m,
      ),
    ).toHaveLength(1);
  });

  test('an empty or odd name in a half-edited model does not throw', () => {
    expect(() =>
      assessRisk(
        { kind: 'renameTable', tableId: 't:10', from: '', to: 'a"b' },
        m,
      ),
    ).not.toThrow();
    expect(() =>
      assessRisk({ kind: 'addIndex', index: index('t:20', { name: '' }) }, m),
    ).not.toThrow();
  });

  test('every level is used, and has a label', () => {
    const seen = new Set<RiskLevel>();
    for (const op of [
      { kind: 'dropTable', table: m.tables['t:20'] },
      { kind: 'setNotNull', columnId: 'c:20:3' },
      { kind: 'renameTable', tableId: 't:10', from: 'a', to: 'b' },
      { kind: 'addIndex', index: index('t:20') },
    ] as ChangeOp[]) {
      for (const r of assessRisk(op, m)) seen.add(r.level);
    }
    expect([...seen].sort()).toEqual([
      'breaks-app',
      'destructive',
      'locks',
      'may-fail',
    ]);
    expect(Object.keys(RISK_LABELS).sort()).toEqual([...seen].sort());
  });
});
