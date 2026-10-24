import { describe, expect, test } from 'vitest';
import type { ChangeOp } from '../src/diff/ops';
import type { Index, ModelPair, SchemaModel } from '../src/model/types';
import { renderIndexOp } from '../src/render/indexes';
import { fixtureModel } from './fixtures/model';

function pair(change: (m: SchemaModel) => void = () => {}): ModelPair {
  const desired: SchemaModel = structuredClone(fixtureModel);
  change(desired);
  return { baseline: fixtureModel, desired };
}
const render = (op: ChangeOp, models = pair()) =>
  renderIndexOp(op as Parameters<typeof renderIndexOp>[0], models);
const index: Index = {
  id: 'new-i',
  tableId: 't:20',
  name: 'invoices_idx',
  unique: false,
  columnIds: ['c:20:2', 'c:20:3'],
};

describe('create', () => {
  test('a plain composite index keeps its column order', () => {
    expect(render({ kind: 'addIndex', index })).toEqual([
      'CREATE INDEX "invoices_idx" ON "billing"."invoices" ("user_id", "total")',
    ]);
    expect(
      render({
        kind: 'addIndex',
        index: { ...index, columnIds: ['c:20:3', 'c:20:2'] },
      })[0],
    ).toContain('("total", "user_id")');
  });

  test('a unique index', () => {
    expect(
      render({ kind: 'addIndex', index: { ...index, unique: true } })[0],
    ).toBe(
      'CREATE UNIQUE INDEX "invoices_idx" ON "billing"."invoices" ("user_id", "total")',
    );
  });

  test('the table and columns are written by their new names, and odd names are quoted', () => {
    const models = pair((m) => {
      m.tables['t:20']!.name = 'My "Bills"';
      m.columns['c:20:3']!.name = 'order';
    });
    expect(render({ kind: 'addIndex', index }, models)[0]).toBe(
      'CREATE INDEX "invoices_idx" ON "billing"."My ""Bills""" ("user_id", "order")',
    );
  });
});

describe('rename and drop', () => {
  test('an index rename keeps the schema and unqualified new name', () => {
    expect(
      render({
        kind: 'renameIndex',
        indexId: 'i:1',
        from: 'invoices_user_id_idx',
        to: 'by_user',
      }),
    ).toEqual([
      'ALTER INDEX "billing"."invoices_user_id_idx" RENAME TO "by_user"',
    ]);
  });

  test('drop uses the schema it had and no CASCADE', () => {
    expect(
      render({ kind: 'dropIndex', index: fixtureModel.indexes['i:1'] }),
    ).toEqual(['DROP INDEX "billing"."invoices_user_id_idx"']);
  });

  test('an unknown index cannot be renamed', () => {
    expect(() =>
      render({ kind: 'renameIndex', indexId: 'nope', from: 'a', to: 'b' }),
    ).toThrow('Unknown index');
  });
});
