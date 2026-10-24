import { describe, expect, test } from 'vitest';
import { diffComments } from '../src/diff/comments';
import type { Column } from '../src/model/types';
import { partRunner } from './diff-helpers';

const run = partRunner(diffComments);

const table = (tableId: string) => ({ kind: 'table' as const, tableId });
const column = (columnId: string) => ({ kind: 'column' as const, columnId });

test('no edits, no operations', () => {
  expect(run(() => {})).toEqual({ ops: [], errors: [] });
});

describe('tables', () => {
  test('set: a table without a comment gets one', () => {
    expect(
      run((m) => (m.tables['t:10']!.comment = 'Registered users')).ops,
    ).toEqual([
      { kind: 'setComment', target: table('t:10'), to: 'Registered users' },
    ]);
  });

  test('change: a table with a comment gets another', () => {
    expect(
      run((m) => (m.tables['t:20']!.comment = 'Sent invoices')).ops,
    ).toEqual([
      { kind: 'setComment', target: table('t:20'), to: 'Sent invoices' },
    ]);
  });

  test('clear: removing the comment gives null', () => {
    expect(run((m) => (m.tables['t:20']!.comment = null)).ops).toEqual([
      { kind: 'setComment', target: table('t:20'), to: null },
    ]);
  });

  test('an empty string is the same as no comment', () => {
    expect(run((m) => (m.tables['t:10']!.comment = '')).ops).toEqual([]);
    expect(run((m) => (m.tables['t:20']!.comment = '')).ops).toEqual([
      { kind: 'setComment', target: table('t:20'), to: null },
    ]);
  });
});

describe('columns', () => {
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

  test('set, change and clear', () => {
    expect(
      run((m) => (m.columns['c:10:1']!.comment = 'Primary key')).ops,
    ).toEqual([
      { kind: 'setComment', target: column('c:10:1'), to: 'Primary key' },
    ]);
    expect(run((m) => (m.columns['c:10:1']!.comment = null)).ops).toEqual([]);
  });

  test('a new column with a comment gets a setComment; one without gets nothing', () => {
    expect(
      run((m) => (m.columns['new-c'] = newColumn({ comment: 'Display name' })))
        .ops,
    ).toEqual([
      { kind: 'setComment', target: column('new-c'), to: 'Display name' },
    ]);
    expect(run((m) => (m.columns['new-c'] = newColumn())).ops).toEqual([]);
  });

  test('a new table and its columns get comments after they are created', () => {
    const { ops } = run((m) => {
      m.tables['new-t'] = {
        id: 'new-t',
        schemaId: 's:1',
        name: 'orders',
        comment: 'Customer orders',
      };
      m.columns['new-c'] = newColumn({ tableId: 'new-t', comment: 'Order id' });
    });
    expect(ops).toEqual([
      { kind: 'setComment', target: table('new-t'), to: 'Customer orders' },
      { kind: 'setComment', target: column('new-c'), to: 'Order id' },
    ]);
  });

  test('a dropped table and its columns need no comment operations', () => {
    const { ops } = run((m) => {
      delete m.tables['t:20'];
      for (const id of ['c:20:1', 'c:20:2', 'c:20:3']) delete m.columns[id];
    });
    expect(ops).toEqual([]);
  });

  test('a comment containing quotes and newlines is passed through unchanged', () => {
    const text = `it's a "note"\nsecond line`;
    expect(run((m) => (m.columns['c:10:1']!.comment = text)).ops).toEqual([
      { kind: 'setComment', target: column('c:10:1'), to: text },
    ]);
  });
});
