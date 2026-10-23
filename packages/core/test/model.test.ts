import { expect, test } from 'vitest';
import type { Column, Constraint, SchemaModel } from '../src/index';
import { fixtureModel } from './fixtures/model';

test('a fixture model typechecks and its references resolve', () => {
  const model: SchemaModel = fixtureModel;
  for (const column of Object.values(model.columns))
    expect(model.tables[column.tableId]).toBeDefined();
  for (const c of Object.values(model.constraints)) {
    expect(model.tables[c.tableId]).toBeDefined();
    if (c.kind === 'fk') expect(model.tables[c.refTableId]).toBeDefined();
  }
  for (const u of Object.values(model.unmodeled)) {
    for (const id of u.columnIds) expect(model.columns[id]).toBeDefined();
  }
});

// These only have to typecheck: `pnpm typecheck` fails if the types stop rejecting them.
test('the types reject invalid models', () => {
  // @ts-expect-error unknown identity kind
  const badIdentity: Column['identity'] = 'sometimes';
  // @ts-expect-error unknown read-only reason
  const badReason: Column['readOnly'] = 'because';
  // @ts-expect-error an fk needs its referenced table
  const badFk: Constraint = {
    id: 'k',
    tableId: 't',
    kind: 'fk',
    name: 'x',
    columnIds: [],
  };
  expect([badIdentity, badReason, badFk]).toHaveLength(3);
});
