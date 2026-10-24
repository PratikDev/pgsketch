import { describe, expect, test } from 'vitest';
import type { ChangeOp } from '../src/diff/ops';
import type { ModelPair, SchemaModel } from '../src/model/types';
import { renderCommentOp } from '../src/render/comments';
import { fixtureModel } from './fixtures/model';

function pair(change: (m: SchemaModel) => void = () => {}): ModelPair {
  const desired: SchemaModel = structuredClone(fixtureModel);
  change(desired);
  return { baseline: fixtureModel, desired };
}
const table = (to: string | null, models = pair()) =>
  renderCommentOp(
    { kind: 'setComment', target: { kind: 'table', tableId: 't:20' }, to },
    models,
  );
const column = (to: string | null, models = pair()) =>
  renderCommentOp(
    { kind: 'setComment', target: { kind: 'column', columnId: 'c:20:3' }, to },
    models,
  );

describe('table and column comments', () => {
  test('set a table comment', () => {
    expect(table('Issued invoices')).toEqual([
      'COMMENT ON TABLE "billing"."invoices" IS \'Issued invoices\'',
    ]);
  });

  test('set a column comment', () => {
    expect(column('Amount in euros')).toEqual([
      `COMMENT ON COLUMN "billing"."invoices"."total" IS 'Amount in euros'`,
    ]);
  });

  test('clearing a comment is IS NULL', () => {
    expect(table(null)).toEqual([
      'COMMENT ON TABLE "billing"."invoices" IS NULL',
    ]);
    expect(column(null)).toEqual([
      'COMMENT ON COLUMN "billing"."invoices"."total" IS NULL',
    ]);
  });
});

describe('the text is quoted as a literal', () => {
  test('a quote inside the comment is doubled', () => {
    expect(table(`it's a "note"`)).toEqual([
      `COMMENT ON TABLE "billing"."invoices" IS 'it''s a "note"'`,
    ]);
  });

  test('a backslash switches to an escape string with the backslash doubled', () => {
    expect(table('C:\\temp')).toEqual([
      `COMMENT ON TABLE "billing"."invoices" IS E'C:\\\\temp'`,
    ]);
  });

  test('newlines, unicode and an empty string pass through', () => {
    expect(table('line one\nline two')[0]).toBe(
      `COMMENT ON TABLE "billing"."invoices" IS 'line one\nline two'`,
    );
    expect(table('café 😀')[0]).toContain(`'café 😀'`);
    expect(table('')[0]).toBe(`COMMENT ON TABLE "billing"."invoices" IS ''`);
  });

  test('text that looks like SQL stays inside the literal', () => {
    expect(table(`'; DROP TABLE x; --`)).toEqual([
      `COMMENT ON TABLE "billing"."invoices" IS '''; DROP TABLE x; --'`,
    ]);
  });
});

describe('names after the renames', () => {
  const models = pair((m) => {
    m.tables['t:20']!.name = 'My "Bills"';
    m.columns['c:20:3']!.name = 'order';
  });

  test('table and column are written by their new names, quoted', () => {
    expect(table('x', models)[0]).toBe(
      `COMMENT ON TABLE "billing"."My ""Bills""" IS 'x'`,
    );
    expect(column('x', models)[0]).toBe(
      `COMMENT ON COLUMN "billing"."My ""Bills"""."order" IS 'x'`,
    );
  });

  test('a column or table that is not in the edited model is an error', () => {
    expect(() =>
      renderCommentOp(
        {
          kind: 'setComment',
          target: { kind: 'column', columnId: 'nope' },
          to: 'x',
        } as ChangeOp as never,
        pair(),
      ),
    ).toThrow('Unknown column');
    expect(() =>
      renderCommentOp(
        {
          kind: 'setComment',
          target: { kind: 'table', tableId: 'nope' },
          to: 'x',
        },
        pair(),
      ),
    ).toThrow('Unknown table');
  });
});
