import { describe, expect, test } from 'vitest';
import type { ChangeOp } from '../src/diff/ops';
import type { Constraint, ModelPair, SchemaModel } from '../src/model/types';
import { renderConstraintOp } from '../src/render/constraints';
import { fixtureModel } from './fixtures/model';

function pair(change: (m: SchemaModel) => void = () => {}): ModelPair {
  const desired: SchemaModel = structuredClone(fixtureModel);
  change(desired);
  return { baseline: fixtureModel, desired };
}
const render = (op: ChangeOp, models = pair()) =>
  renderConstraintOp(op as Parameters<typeof renderConstraintOp>[0], models);
const fk = fixtureModel.constraints['k:2'] as Extract<
  Constraint,
  { kind: 'fk' }
>;

describe('adding', () => {
  test('a composite foreign key with actions', () => {
    const composite: Constraint = {
      ...fk,
      name: 'invoices_ref_fkey',
      columnIds: ['c:20:2', 'c:20:3'],
      refColumnIds: ['c:10:1', 'c:10:2'],
      onDelete: 'cascade',
      onUpdate: 'set null',
    };
    expect(render({ kind: 'addConstraint', constraint: composite })).toEqual([
      'ALTER TABLE "billing"."invoices" ADD CONSTRAINT "invoices_ref_fkey" FOREIGN KEY ("user_id", "total") REFERENCES "public"."users" ("id", "status") ON DELETE CASCADE ON UPDATE SET NULL',
    ]);
  });

  test('NO ACTION is left out, and only the non-default action is written', () => {
    const sql = (onDelete: typeof fk.onDelete, onUpdate: typeof fk.onUpdate) =>
      render({
        kind: 'addConstraint',
        constraint: { ...fk, onDelete, onUpdate },
      })[0];
    expect(sql('no action', 'no action')).toBe(
      'ALTER TABLE "billing"."invoices" ADD CONSTRAINT "invoices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users" ("id")',
    );
    expect(sql('restrict', 'no action')).toMatch(
      /\("id"\) ON DELETE RESTRICT$/,
    );
    expect(sql('no action', 'set default')).toMatch(
      /\("id"\) ON UPDATE SET DEFAULT$/,
    );
  });

  test('primary key, unique and check', () => {
    const base = {
      tableId: 't:10',
      name: 'k',
      columnIds: ['c:10:1', 'c:10:2'],
    };
    expect(
      render({
        kind: 'addConstraint',
        constraint: { ...base, id: 'a', kind: 'pk' },
      })[0],
    ).toBe(
      'ALTER TABLE "public"."users" ADD CONSTRAINT "k" PRIMARY KEY ("id", "status")',
    );
    expect(
      render({
        kind: 'addConstraint',
        constraint: { ...base, id: 'b', kind: 'unique' },
      })[0],
    ).toBe(
      'ALTER TABLE "public"."users" ADD CONSTRAINT "k" UNIQUE ("id", "status")',
    );
    expect(
      render({
        kind: 'addConstraint',
        constraint: {
          ...base,
          id: 'c',
          kind: 'check',
          columnIds: ['c:10:1'],
          expression: '(id > 0) AND (id < 9)',
        },
      })[0],
    ).toBe(
      'ALTER TABLE "public"."users" ADD CONSTRAINT "k" CHECK ((id > 0) AND (id < 9))',
    );
  });

  test('tables and columns are written by their names after the renames, and odd names are quoted', () => {
    const models = pair((m) => {
      m.tables['t:10']!.name = 'My "Users"';
      m.columns['c:10:1']!.name = 'order';
    });
    expect(
      render({ kind: 'addConstraint', constraint: { ...fk } }, models)[0],
    ).toBe(
      'ALTER TABLE "billing"."invoices" ADD CONSTRAINT "invoices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."My ""Users""" ("order") ON DELETE CASCADE',
    );
  });

  test('an exclusion constraint is never rendered: it is read-only', () => {
    expect(() =>
      render({
        kind: 'addConstraint',
        constraint: fixtureModel.constraints['k:4'],
      }),
    ).toThrow('read-only');
  });
});

describe('dropping and renaming', () => {
  test("drop runs before the renames, so it uses the table's old name; no CASCADE", () => {
    const models = pair((m) => (m.tables['t:20']!.name = 'bills'));
    expect(render({ kind: 'dropConstraint', constraint: fk }, models)).toEqual([
      'ALTER TABLE "billing"."invoices" DROP CONSTRAINT "invoices_user_id_fkey"',
    ]);
  });

  test('rename runs after the table renames, so it uses the new table name', () => {
    const models = pair((m) => {
      m.tables['t:20']!.name = 'bills';
      m.constraints['k:3']!.name = 'positive_total';
    });
    expect(
      render(
        {
          kind: 'renameConstraint',
          constraintId: 'k:3',
          from: 'invoices_total_check',
          to: 'positive_total',
        },
        models,
      ),
    ).toEqual([
      'ALTER TABLE "billing"."bills" RENAME CONSTRAINT "invoices_total_check" TO "positive_total"',
    ]);
  });

  test('a constraint that is not in the edited model cannot be renamed', () => {
    expect(() =>
      render({
        kind: 'renameConstraint',
        constraintId: 'nope',
        from: 'a',
        to: 'b',
      }),
    ).toThrow('Unknown constraint');
  });
});
