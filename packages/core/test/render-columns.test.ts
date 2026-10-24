import { describe, expect, test } from 'vitest';
import type { ChangeOp } from '../src/diff/ops';
import type { Column, PgType, SchemaModel } from '../src/model/types';
import type { CastData } from '../src/sql/coercion';
import { renderColumnOp } from '../src/render/columns';
import type { RenderContext } from '../src/render/names';
import { fixtureModel } from './fixtures/model';

const t = (name: string, over: Partial<PgType> = {}): PgType => ({
  name,
  isArray: false,
  ...over,
});

const casts: CastData = {
  categories: {
    integer: 'N',
    bigint: 'N',
    text: 'S',
    varchar: 'S',
    uuid: 'U',
    'public.mood': 'E',
  },
  domains: {},
  casts: { 'integer>bigint': 'i', 'bigint>integer': 'a' },
};

/** The fixture as the loaded schema, and a copy with `change` applied as the edited one. */
function context(change: (m: SchemaModel) => void = () => {}): RenderContext {
  const desired: SchemaModel = structuredClone(fixtureModel);
  change(desired);
  return { baseline: fixtureModel, desired, casts };
}
const render = (op: ChangeOp, ctx = context()) =>
  renderColumnOp(op as Parameters<typeof renderColumnOp>[0], ctx);

const newColumn = (over: Partial<Column> = {}): Column => ({
  id: 'new-c',
  tableId: 't:10',
  name: 'nickname',
  position: 9,
  type: t('text'),
  notNull: false,
  default: null,
  identity: null,
  comment: null,
  ...over,
});

describe('add, rename and drop', () => {
  test('a new column is added with its full definition', () => {
    expect(render({ kind: 'addColumn', column: newColumn() })).toEqual([
      'ALTER TABLE "public"."users" ADD COLUMN "nickname" text',
    ]);
    expect(
      render({
        kind: 'addColumn',
        column: newColumn({
          type: t('varchar', { params: [40] }),
          notNull: true,
          default: { kind: 'constant', expression: "'n/a'::character varying" },
        }),
      }),
    ).toEqual([
      `ALTER TABLE "public"."users" ADD COLUMN "nickname" varchar(40) NOT NULL DEFAULT 'n/a'::character varying`,
    ]);
  });

  test('a new identity column', () => {
    expect(
      render({
        kind: 'addColumn',
        column: newColumn({
          name: 'seq',
          type: t('bigint'),
          identity: 'always',
          notNull: true,
        }),
      }),
    ).toEqual([
      'ALTER TABLE "public"."users" ADD COLUMN "seq" bigint GENERATED ALWAYS AS IDENTITY',
    ]);
  });

  test('rename, with the table written by the name it has after its own rename', () => {
    const op: ChangeOp = {
      kind: 'renameColumn',
      columnId: 'c:10:2',
      from: 'status',
      to: 'state',
    };
    const ctx = context((m) => {
      m.columns['c:10:2']!.name = 'state';
    });
    expect(render(op, ctx)).toEqual([
      'ALTER TABLE "public"."users" RENAME COLUMN "status" TO "state"',
    ]);
    const renamedTable = context((m) => {
      m.columns['c:10:2']!.name = 'state';
      m.tables['t:10']!.name = 'people';
    });
    expect(render(op, renamedTable)).toEqual([
      'ALTER TABLE "public"."people" RENAME COLUMN "status" TO "state"',
    ]);
  });

  test("drop keeps the column's own name and the table's new one", () => {
    const op: ChangeOp = {
      kind: 'dropColumn',
      column: fixtureModel.columns['c:10:2'],
    };
    const ctx = context((m) => {
      delete m.columns['c:10:2'];
      m.tables['t:10']!.name = 'people';
    });
    expect(render(op, ctx)).toEqual([
      'ALTER TABLE "public"."people" DROP COLUMN "status"',
    ]);
  });

  test('names are quoted whatever they contain', () => {
    const ctx = context((m) => {
      m.tables['t:10']!.name = 'My "Users"';
    });
    expect(
      render({ kind: 'addColumn', column: newColumn({ name: 'order' }) }, ctx),
    ).toEqual(['ALTER TABLE "public"."My ""Users""" ADD COLUMN "order" text']);
  });
});

describe('type changes: USING only when there is no assignment conversion', () => {
  const alter = (from: PgType, to: PgType, ctx = context()) =>
    render({ kind: 'alterColumnType', columnId: 'c:10:2', from, to }, ctx)[0];

  test('text to integer includes USING', () => {
    expect(alter(t('text'), t('integer'))).toBe(
      'ALTER TABLE "public"."users" ALTER COLUMN "status" TYPE integer USING "status"::integer',
    );
  });

  test('varchar(50) to varchar(20) does not', () => {
    expect(
      alter(t('varchar', { params: [50] }), t('varchar', { params: [20] })),
    ).toBe(
      'ALTER TABLE "public"."users" ALTER COLUMN "status" TYPE varchar(20)',
    );
  });

  test.each([
    ['integer to bigint (implicit cast)', t('integer'), t('bigint'), false],
    ['bigint to integer (assignment cast)', t('bigint'), t('integer'), false],
    ['integer to text (anything to a string)', t('integer'), t('text'), false],
    ['uuid to varchar(36)', t('uuid'), t('varchar', { params: [36] }), false],
    ['an array to text', t('integer', { isArray: true }), t('text'), false],
    ['text to uuid (a string to anything else)', t('text'), t('uuid'), true],
    ['text to an enum', t('text'), t('mood', { schema: 'public' }), true],
    ['integer to uuid (no cast)', t('integer'), t('uuid'), true],
  ])('%s', (_label, from, to, usingExpected) => {
    expect(alter(from, to)!.includes(' USING ')).toBe(usingExpected);
  });

  test('USING repeats the type, quoted when it is a user type', () => {
    expect(alter(t('text'), t('mood', { schema: 'public' }))).toBe(
      'ALTER TABLE "public"."users" ALTER COLUMN "status" TYPE "public"."mood" USING "status"::"public"."mood"',
    );
  });

  test('the column and table are written by their names after the renames', () => {
    const ctx = context((m) => {
      m.columns['c:10:2']!.name = 'state';
      m.tables['t:10']!.name = 'people';
    });
    expect(alter(t('text'), t('integer'), ctx)).toBe(
      'ALTER TABLE "public"."people" ALTER COLUMN "state" TYPE integer USING "state"::integer',
    );
  });
});

describe('nullability and defaults', () => {
  const alterOp = (op: ChangeOp) => render(op)[0];

  test('NOT NULL on and off', () => {
    expect(alterOp({ kind: 'setNotNull', columnId: 'c:20:3' })).toBe(
      'ALTER TABLE "billing"."invoices" ALTER COLUMN "total" SET NOT NULL',
    );
    expect(alterOp({ kind: 'dropNotNull', columnId: 'c:20:3' })).toBe(
      'ALTER TABLE "billing"."invoices" ALTER COLUMN "total" DROP NOT NULL',
    );
  });

  test('default set to the normalized expression, and dropped', () => {
    expect(
      alterOp({
        kind: 'setDefault',
        columnId: 'c:20:3',
        to: { kind: 'expression', expression: '(1 + 1)' },
      }),
    ).toBe(
      'ALTER TABLE "billing"."invoices" ALTER COLUMN "total" SET DEFAULT (1 + 1)',
    );
    expect(alterOp({ kind: 'dropDefault', columnId: 'c:20:3' })).toBe(
      'ALTER TABLE "billing"."invoices" ALTER COLUMN "total" DROP DEFAULT',
    );
  });
});

test('a column that is not in the edited model is an error, not guessed SQL', () => {
  expect(() => render({ kind: 'setNotNull', columnId: 'nope' })).toThrow(
    'Unknown column',
  );
  expect(() =>
    render({ kind: 'renameColumn', columnId: 'nope', from: 'a', to: 'b' }),
  ).toThrow('Unknown column');
});
