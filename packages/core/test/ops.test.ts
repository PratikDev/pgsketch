import { expect, test } from 'vitest';
import type { ChangeOp } from '../src/index';
import { fixtureModel } from './fixtures/model';

const users = fixtureModel.tables['t:10'];
const idColumn = fixtureModel.columns['c:10:1'];
const pk = fixtureModel.constraints['k:1'];
const index = fixtureModel.indexes['i:1'];
const type = { name: 'integer', isArray: false };

// One of every operation. `pnpm typecheck` fails if a member of the union is missing a field
// or the examples stop matching it.
const examples: ChangeOp[] = [
  { kind: 'createSchema', schema: fixtureModel.schemas['s:1'] },
  { kind: 'createTable', table: users, columns: [idColumn], pk },
  { kind: 'renameTable', tableId: 't:10', from: 'users', to: 'people' },
  { kind: 'dropTable', table: users },
  { kind: 'addColumn', column: idColumn },
  { kind: 'renameColumn', columnId: 'c:10:1', from: 'id', to: 'uid' },
  {
    kind: 'alterColumnType',
    columnId: 'c:10:1',
    from: type,
    to: { name: 'bigint', isArray: false },
  },
  { kind: 'setNotNull', columnId: 'c:10:1' },
  { kind: 'dropNotNull', columnId: 'c:10:1' },
  {
    kind: 'setDefault',
    columnId: 'c:10:1',
    to: { kind: 'constant', expression: '1' },
  },
  { kind: 'dropDefault', columnId: 'c:10:1' },
  { kind: 'dropColumn', column: idColumn },
  { kind: 'addConstraint', constraint: pk },
  { kind: 'renameConstraint', constraintId: 'k:1', from: 'a', to: 'b' },
  { kind: 'dropConstraint', constraint: pk },
  { kind: 'addIndex', index },
  { kind: 'renameIndex', indexId: 'i:1', from: 'a', to: 'b' },
  { kind: 'dropIndex', index },
  { kind: 'setComment', target: { kind: 'table', tableId: 't:10' }, to: 'x' },
  {
    kind: 'setComment',
    target: { kind: 'column', columnId: 'c:10:1' },
    to: null,
  },
];

/** Exhaustive: adding an operation to the union without handling it here fails the typecheck. */
function describeOp(op: ChangeOp): string {
  switch (op.kind) {
    case 'createSchema':
    case 'createTable':
    case 'renameTable':
    case 'dropTable':
    case 'addColumn':
    case 'renameColumn':
    case 'alterColumnType':
    case 'setNotNull':
    case 'dropNotNull':
    case 'setDefault':
    case 'dropDefault':
    case 'dropColumn':
    case 'addConstraint':
    case 'renameConstraint':
    case 'dropConstraint':
    case 'addIndex':
    case 'renameIndex':
    case 'dropIndex':
    case 'setComment':
      return op.kind;
    default: {
      const unreachable: never = op;
      return unreachable;
    }
  }
}

test('the union has one member per operation in the plan', () => {
  expect(new Set(examples.map(describeOp)).size).toBe(19);
});

test('the types reject malformed operations', () => {
  const missingName = {
    kind: 'renameTable',
    tableId: 't:1',
    from: 'a',
  } as const;
  const enumOp = { kind: 'createEnum' } as const;
  const badTarget = {
    kind: 'setComment',
    target: { kind: 'index', id: 'i:1' },
    to: null,
  } as const;
  // @ts-expect-error a rename needs both names
  const a: ChangeOp = missingName;
  // @ts-expect-error there is no enum operation in 0.1.0
  const b: ChangeOp = enumOp;
  // @ts-expect-error a comment target is a table or a column
  const c: ChangeOp = badTarget;
  expect([a, b, c]).toHaveLength(3);
});
