import { assignNames, diff } from '@pgsketch/core';
import { describe, expect, test } from 'vitest';
import { statusMapOf } from './status';
import { fixtureModel } from '@/test-model';
import { footerOf } from './footer-view';
import { tableViews } from './model-view';

describe('footerOf', () => {
  // t:20 is billing.invoices
  const invoices = footerOf(fixtureModel, 't:20');

  test('lists the indexes of the table by name, with their columns in order', () => {
    expect(invoices.indexes.map((i) => [i.name, i.columns, i.unique])).toEqual([
      ['invoices_open_idx', ['total'], false],
      ['invoices_user_id_idx', ['user_id'], false],
    ]);
  });

  test('a read-only index says so, and keeps the definition Postgres gave', () => {
    const partial = invoices.indexes.find(
      (i) => i.name === 'invoices_open_idx',
    )!;
    expect(partial.state.readOnly).toBe('partial-index');
    expect(partial.definition).toMatch(/WHERE \(total > 0\)/);
    expect(
      invoices.indexes.find((i) => i.name === 'invoices_user_id_idx')!.state
        .readOnly,
    ).toBeNull();
  });

  test('lists the checks, and the constraints that are read-only, but not the keys', () => {
    expect(
      invoices.constraints.map((c) => [c.name, c.kind, c.expression]),
    ).toEqual([
      ['invoices_excl', 'exclusion', null],
      ['invoices_total_check', 'check', '(total >= 0)'],
    ]);
    expect(invoices.constraints[0]!.state.readOnly).toBe('exclusion');
    expect(footerOf(fixtureModel, 't:10').constraints).toEqual([]);
  });

  test('lists what depends on the table and is not edited, without the sequences behind its columns', () => {
    expect(invoices.unmodeled).toEqual([
      { kind: 'view', name: 'open_invoices' },
    ]);
    const model = structuredClone(fixtureModel);
    model.unmodeled['u:2'] = {
      id: 'u:2',
      kind: 'sequence',
      schemaId: 's:2',
      name: 'invoices_id_seq',
      ownerTableId: null,
      tableIds: ['t:20'],
      columnIds: ['c:20:1'],
    };
    expect(footerOf(model, 't:20').unmodeled).toHaveLength(1);
  });

  test('a table with none of it has an empty footer', () => {
    expect(footerOf(fixtureModel, 't:10')).toEqual({
      indexes: [],
      constraints: [],
      unmodeled: [],
    });
  });

  test('a new index or check has the name the database would give it', () => {
    const desired = structuredClone(fixtureModel);
    desired.indexes['n:1'] = {
      id: 'n:1',
      tableId: 't:20',
      name: '',
      autoName: true,
      unique: true,
      columnIds: ['c:20:2', 'c:20:3'],
    };
    const named = assignNames(desired);
    const { ops } = diff(fixtureModel, named);
    const sources = {
      statuses: statusMapOf(ops, fixtureModel),
      errors: [],
      named,
    };
    const added = footerOf(desired, 't:20', sources).indexes.find(
      (i) => i.id === 'n:1',
    )!;
    expect(added.name).toBe('invoices_user_id_total_idx');
    expect(added.state.status?.status).toBe('added');
  });
});

describe('an error on an index or constraint', () => {
  test('is on the table too, so the node shows it, and on its own row', () => {
    const errors = [
      { code: 'name-duplicate' as const, objectId: 'i:1', message: 'taken' },
    ];
    const invoices = tableViews(fixtureModel, { statuses: {}, errors }).find(
      (t) => t.id === 't:20',
    )!;
    expect(invoices.state.error).toBe('taken');
    expect(
      invoices.footer.indexes.find((i) => i.id === 'i:1')!.state.error,
    ).toBe('taken');
    // another table is untouched
    expect(
      tableViews(fixtureModel, { statuses: {}, errors }).find(
        (t) => t.id === 't:10',
      )!.state.error,
    ).toBeNull();
  });

  test("the table's own error comes first", () => {
    const errors = [
      { code: 'name-duplicate' as const, objectId: 'i:1', message: 'index' },
      { code: 'name-empty' as const, objectId: 't:20', message: 'table' },
    ];
    expect(
      tableViews(fixtureModel, { statuses: {}, errors }).find(
        (t) => t.id === 't:20',
      )!.state.error,
    ).toBe('table');
  });
});
