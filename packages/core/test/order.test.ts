import { describe, expect, test } from 'vitest';
import type { ChangeOp } from '../src/diff/ops';
import { orderOps } from '../src/order/order';
import type { Constraint, SchemaModel, Table } from '../src/model/types';
import { fixtureModel as m } from './fixtures/model';

const models = { baseline: m, desired: m };
const table = (id: string, name: string, schemaId = 's:1'): Table => ({
  id,
  schemaId,
  name,
  comment: null,
});
const fk = m.constraints['k:2'] as Constraint;
const pk = m.constraints['k:1'] as Constraint;
const check = m.constraints['k:3'] as Constraint;
const type = { name: 'integer', isArray: false };

const phaseOf = (op: ChangeOp) => orderOps([op], models)[0]!.phase;

/** One example of every operation, with the phase it belongs to. */
const examples: [ChangeOp, number][] = [
  [{ kind: 'createSchema', schema: m.schemas['s:1'] }, 1],
  [{ kind: 'dropConstraint', constraint: fk }, 2],
  [{ kind: 'dropConstraint', constraint: pk }, 3],
  [{ kind: 'dropConstraint', constraint: check }, 3],
  [{ kind: 'dropIndex', index: m.indexes['i:1'] }, 3],
  [{ kind: 'renameTable', tableId: 't:10', from: 'a', to: 'b' }, 4],
  [{ kind: 'renameColumn', columnId: 'c:10:1', from: 'a', to: 'b' }, 4],
  [{ kind: 'renameConstraint', constraintId: 'k:1', from: 'a', to: 'b' }, 4],
  [{ kind: 'renameIndex', indexId: 'i:1', from: 'a', to: 'b' }, 4],
  [{ kind: 'createTable', table: table('new', 'n'), columns: [] }, 5],
  [{ kind: 'addColumn', column: m.columns['c:10:1'] }, 6],
  [{ kind: 'alterColumnType', columnId: 'c:10:1', from: type, to: type }, 7],
  [
    {
      kind: 'setDefault',
      columnId: 'c:10:1',
      to: { kind: 'constant', expression: '1' },
    },
    7,
  ],
  [{ kind: 'dropDefault', columnId: 'c:10:1' }, 7],
  [{ kind: 'setNotNull', columnId: 'c:10:1' }, 7],
  [{ kind: 'dropNotNull', columnId: 'c:10:1' }, 7],
  [{ kind: 'dropColumn', column: m.columns['c:10:1'] }, 8],
  [{ kind: 'dropTable', table: m.tables['t:10'] }, 9],
  [{ kind: 'addConstraint', constraint: pk }, 10],
  [{ kind: 'addConstraint', constraint: check }, 10],
  [{ kind: 'addIndex', index: m.indexes['i:1'] }, 10],
  [{ kind: 'addConstraint', constraint: fk }, 11],
  [
    { kind: 'setComment', target: { kind: 'table', tableId: 't:10' }, to: 'x' },
    12,
  ],
];

/** A small deterministic shuffle, so a failing order can be reproduced. */
function shuffled<T>(items: T[], seed: number): T[] {
  const copy = [...items];
  let state = seed;
  for (let i = copy.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const j = state % (i + 1);
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

describe('phases', () => {
  test.each(examples)('%j runs in phase %i', (op, phase) => {
    expect(phaseOf(op)).toBe(phase);
  });

  test('operations come out grouped by phase in ascending order', () => {
    const ordered = orderOps(
      shuffled(
        examples.map(([op]) => op),
        7,
      ),
      models,
    );
    const phases = ordered.map((o) => o.phase);
    expect(phases).toEqual([...phases].sort((a, b) => a - b));
    expect(new Set(phases).size).toBe(12);
  });

  test('a foreign key is added after the table it points at is created', () => {
    const ops: ChangeOp[] = [
      { kind: 'addConstraint', constraint: fk },
      {
        kind: 'createTable',
        table: table('t:20', 'invoices', 's:2'),
        columns: [],
      },
      { kind: 'createTable', table: table('t:10', 'users'), columns: [] },
    ];
    expect(orderOps(ops, models).map((o) => o.op.kind)).toEqual([
      'createTable',
      'createTable',
      'addConstraint',
    ]);
  });

  test('foreign keys are dropped before other constraints and indexes, and everything before renames', () => {
    const ops: ChangeOp[] = [
      { kind: 'renameTable', tableId: 't:10', from: 'a', to: 'b' },
      { kind: 'dropIndex', index: m.indexes['i:1'] },
      { kind: 'dropConstraint', constraint: check },
      { kind: 'dropConstraint', constraint: fk },
    ];
    expect(orderOps(ops, models).map((o) => o.phase)).toEqual([2, 3, 3, 4]);
  });
});

describe('within a phase', () => {
  test('operations are sorted by qualified name, schema first', () => {
    const ops: ChangeOp[] = [
      { kind: 'createTable', table: table('t3', 'b', 's:2'), columns: [] },
      { kind: 'createTable', table: table('t2', 'z', 's:1'), columns: [] },
      { kind: 'createTable', table: table('t1', 'a', 's:1'), columns: [] },
    ];
    // "billing" sorts before "public"
    expect(
      orderOps(ops, models).map((o) =>
        o.op.kind === 'createTable' ? o.op.table.id : '',
      ),
    ).toEqual(['t3', 't1', 't2']);
  });

  test('renames run tables, then columns, then constraints, then indexes, whatever their names', () => {
    const ops: ChangeOp[] = [
      { kind: 'renameIndex', indexId: 'i:1', from: 'a', to: 'b' },
      { kind: 'renameConstraint', constraintId: 'k:3', from: 'a', to: 'b' },
      { kind: 'renameColumn', columnId: 'c:10:2', from: 'a', to: 'b' },
      { kind: 'renameTable', tableId: 't:30', from: 'a', to: 'b' },
    ];
    expect(orderOps(ops, models).map((o) => o.op.kind)).toEqual([
      'renameTable',
      'renameColumn',
      'renameConstraint',
      'renameIndex',
    ]);
  });

  test('the statements for one column run as type, default, then nullability, and stay together', () => {
    const ops: ChangeOp[] = [
      { kind: 'setNotNull', columnId: 'c:10:2' },
      { kind: 'setNotNull', columnId: 'c:10:1' },
      {
        kind: 'setDefault',
        columnId: 'c:10:2',
        to: { kind: 'constant', expression: '1' },
      },
      { kind: 'alterColumnType', columnId: 'c:10:2', from: type, to: type },
      { kind: 'alterColumnType', columnId: 'c:10:1', from: type, to: type },
    ];
    expect(
      orderOps(ops, models).map(
        (o) => `${o.op.kind}:${'columnId' in o.op ? o.op.columnId : ''}`,
      ),
    ).toEqual([
      'alterColumnType:c:10:1',
      'setNotNull:c:10:1',
      'alterColumnType:c:10:2',
      'setDefault:c:10:2',
      'setNotNull:c:10:2',
    ]);
  });

  test('a dropped table is sorted by the name it had, a renamed one by its new name', () => {
    const baseline: SchemaModel = structuredClone(m);
    const desired: SchemaModel = structuredClone(m);
    desired.tables['t:10']!.name = 'aaa'; // renamed from "users"
    delete desired.tables['t:30']; // dropped; was "events"
    const ops: ChangeOp[] = [
      { kind: 'renameTable', tableId: 't:10', from: 'users', to: 'aaa' },
      { kind: 'dropTable', table: baseline.tables['t:30']! },
      { kind: 'dropTable', table: baseline.tables['t:20']! },
    ];
    // the rename is phase 4, then both drops, billing.invoices before public.events
    expect(orderOps(ops, { baseline, desired }).map((o) => o.op.kind)).toEqual([
      'renameTable',
      'dropTable',
      'dropTable',
    ]);
    expect(
      orderOps(ops, { baseline, desired })
        .slice(1)
        .map((o) => (o.op.kind === 'dropTable' ? o.op.table.id : '')),
    ).toEqual(['t:20', 't:30']);
  });
});

describe('determinism', () => {
  test('the same operations give the same order whatever order they arrive in', () => {
    const ops = examples.map(([op]) => op);
    const expected = orderOps(ops, models);
    for (let seed = 1; seed <= 40; seed++) {
      expect(orderOps(shuffled(ops, seed), models)).toEqual(expected);
    }
  });

  test('no operation is lost or duplicated', () => {
    const ops = examples.map(([op]) => op);
    const ordered = orderOps(shuffled(ops, 3), models).map((o) => o.op);
    expect(ordered).toHaveLength(ops.length);
    for (const op of ops)
      expect(ordered.filter((o) => o === op)).toHaveLength(1);
  });

  test('the input array is not modified', () => {
    const ops = shuffled(
      examples.map(([op]) => op),
      5,
    );
    const copy = [...ops];
    orderOps(ops, models);
    expect(ops).toEqual(copy);
  });
});
