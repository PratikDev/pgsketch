import { describe, expect, test } from 'vitest';
import { diff } from '../src/diff';
import type { ChangeOp } from '../src/diff/ops';
import type { Column, SchemaModel } from '../src/model/types';
import {
  renderMigration,
  type MigrationContext,
} from '../src/render/migration';
import type { CastData } from '../src/sql/coercion';
import { fixtureModel } from './fixtures/model';

const casts: CastData = {
  categories: {
    integer: 'N',
    bigint: 'N',
    numeric: 'N',
    text: 'S',
    varchar: 'S',
  },
  domains: {},
  casts: { 'numeric>bigint': 'a', 'integer>bigint': 'i' },
};

function contextFor(
  desired: SchemaModel,
  over: Partial<MigrationContext> = {},
): MigrationContext {
  return {
    baseline: fixtureModel,
    desired,
    casts,
    generatedAt: '2026-01-02T03:04:05.000Z',
    dbName: 'shop',
    ...over,
  };
}

const column = (
  id: string,
  tableId: string,
  name: string,
  over: Partial<Column> = {},
): Column => ({
  id,
  tableId,
  name,
  position: 1,
  type: { name: 'text', isArray: false },
  notNull: false,
  default: null,
  identity: null,
  comment: null,
  ...over,
});

/** One edit of every kind of change the diff can produce. */
function everything(): SchemaModel {
  const m: SchemaModel = structuredClone(fixtureModel);
  m.schemas.rep = { id: 'rep', name: 'reporting' };
  m.tables['new-t'] = {
    id: 'new-t',
    schemaId: 'rep',
    name: 'audit',
    comment: 'Audit trail',
  };
  m.columns['new-id'] = column('new-id', 'new-t', 'id', {
    type: { name: 'bigint', isArray: false },
    identity: 'always',
    notNull: true,
  });
  m.columns['new-user'] = column('new-user', 'new-t', 'user_id', {
    type: { name: 'bigint', isArray: false },
    comment: 'Who did it',
  });
  m.constraints['new-pk'] = {
    id: 'new-pk',
    tableId: 'new-t',
    kind: 'pk',
    name: 'audit_pkey',
    columnIds: ['new-id'],
  };
  m.constraints['new-fk'] = {
    id: 'new-fk',
    tableId: 'new-t',
    kind: 'fk',
    name: 'audit_user_id_fkey',
    columnIds: ['new-user'],
    refTableId: 't:10',
    refColumnIds: ['c:10:1'],
    onDelete: 'cascade',
    onUpdate: 'no action',
  };
  m.tables['t:10']!.name = 'people';
  m.columns['c:10:2']!.name = 'state';
  delete m.tables['t:30']; // dropped
  m.columns['new-c'] = column('new-c', 't:20', 'note', {
    type: { name: 'varchar', params: [40], isArray: false },
    notNull: true,
    default: { kind: 'constant', expression: "'n/a'::character varying" },
  });
  m.columns['c:20:3']!.type = { name: 'bigint', isArray: false };
  m.columns['c:20:3']!.notNull = true;
  m.columns['c:20:3']!.default = null;
  m.columns['c:20:2']!.notNull = false;
  m.columns['c:20:2']!.default = { kind: 'constant', expression: '0' };
  delete m.columns['c:20:1'];
  m.constraints['new-u'] = {
    id: 'new-u',
    tableId: 't:20',
    kind: 'unique',
    name: 'invoices_note_key',
    columnIds: ['new-c'],
  };
  m.constraints['k:3']!.name = 'positive_total';
  delete m.constraints['k:2'];
  m.indexes['new-i'] = {
    id: 'new-i',
    tableId: 't:20',
    name: 'invoices_total_idx',
    unique: false,
    columnIds: ['c:20:3'],
  };
  m.indexes['i:1']!.name = 'by_user';
  delete m.indexes['i:2'];
  m.tables['t:20']!.comment = null;
  m.columns['c:20:2']!.comment = 'Owner';
  return m;
}

const migrationFor = (
  desired: SchemaModel,
  over: Partial<MigrationContext> = {},
) => {
  const { ops, errors } = diff(fixtureModel, desired);
  expect(errors).toEqual([]);
  return { ops, ...renderMigration(ops, contextFor(desired, over)) };
};

describe('a migration with every kind of change', () => {
  test('matches the reviewed text', () => {
    expect(migrationFor(everything()).text).toMatchSnapshot();
  });

  test('is byte-identical across runs and whatever order the operations were found in', () => {
    const desired = everything();
    const { ops, text } = migrationFor(desired);
    expect(renderMigration(ops, contextFor(desired)).text).toBe(text);
    let state = 11;
    for (let run = 0; run < 20; run++) {
      const shuffled = [...ops];
      for (let i = shuffled.length - 1; i > 0; i--) {
        state = (state * 1103515245 + 12345) % 2147483648;
        const j = state % (i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
      }
      expect(renderMigration(shuffled, contextFor(desired)).text).toBe(text);
    }
  });

  test('statements are listed alone: no BEGIN, COMMIT or trailing semicolon, each once in the text', () => {
    const { statements, text } = migrationFor(everything());
    expect(statements.length).toBeGreaterThan(20);
    for (const statement of statements) {
      expect(statement).not.toMatch(/^(BEGIN|COMMIT)/);
      expect(statement.endsWith(';')).toBe(false);
      expect(text.split(`${statement};\n`)).toHaveLength(2);
    }
  });

  test('runs in phase order: schema first, foreign key after its table, comments last', () => {
    const { statements } = migrationFor(everything());
    const at = (needle: string) =>
      statements.findIndex((s) => s.includes(needle));
    expect(at('CREATE SCHEMA')).toBe(0);
    expect(at('DROP CONSTRAINT "invoices_user_id_fkey"')).toBeLessThan(
      at('RENAME TO "people"'),
    );
    expect(at('CREATE TABLE "reporting"."audit"')).toBeLessThan(
      at('FOREIGN KEY ("user_id")'),
    );
    const firstComment = statements.findIndex((s) =>
      s.startsWith('COMMENT ON'),
    );
    expect(
      statements.slice(firstComment).every((s) => s.startsWith('COMMENT ON')),
    ).toBe(true);
    expect(statements.at(-1)).toMatch(/^COMMENT ON/);
  });
});

describe('the file around the statements', () => {
  test('header, then BEGIN, the statements, COMMIT', () => {
    const desired = structuredClone(fixtureModel) as SchemaModel;
    desired.schemas.rep = { id: 'rep', name: 'reporting' };
    expect(migrationFor(desired).text).toBe(
      [
        '-- Generated by pgsketch',
        '-- Generated at: 2026-01-02T03:04:05.000Z',
        '-- Database: shop',
        '-- Operations: 1',
        '-- Risks: none',
        '',
        'BEGIN;',
        '',
        'CREATE SCHEMA "reporting";',
        '',
        'COMMIT;',
        '',
      ].join('\n'),
    );
  });

  test('no changes gives an empty transaction and no statements', () => {
    const r = renderMigration([], contextFor(fixtureModel));
    expect(r.statements).toEqual([]);
    expect(r.text).toContain(
      '-- Operations: 0\n-- Risks: none\n\nBEGIN;\n\nCOMMIT;\n',
    );
  });

  test('the timestamp and database name are used as given', () => {
    const { text } = migrationFor(everything(), {
      generatedAt: 'sometime',
      dbName: 'My DB',
    });
    expect(text).toContain('-- Generated at: sometime\n-- Database: My DB\n');
  });

  test('a database name cannot break out of its comment line', () => {
    const { text } = migrationFor(everything(), {
      dbName: 'x\nDROP TABLE users;\r\n-- ',
      generatedAt: 'a b',
    });
    const header = text.slice(0, text.indexOf('BEGIN;')).split('\n');
    expect(
      header
        .filter((line) => line !== '')
        .every((line) => line.startsWith('--')),
    ).toBe(true);
    expect(text).toContain('-- Database: x DROP TABLE users; -- \n');
  });
});

test('every operation kind in the diff can be rendered', () => {
  const kinds = new Set(
    diff(fixtureModel, everything()).ops.map((o: ChangeOp) => o.kind),
  );
  expect([...kinds].sort()).toEqual(
    [
      'addColumn',
      'addConstraint',
      'addIndex',
      'alterColumnType',
      'createSchema',
      'createTable',
      'dropColumn',
      'dropConstraint',
      'dropDefault',
      'dropIndex',
      'dropNotNull',
      'dropTable',
      'renameColumn',
      'renameConstraint',
      'renameIndex',
      'renameTable',
      'setComment',
      'setDefault',
      'setNotNull',
    ].sort(),
  );
});

describe('risk warnings and counts', () => {
  const lineBefore = (text: string, statement: string) => {
    const lines = text.split('\n');
    return lines[lines.findIndex((line) => line.startsWith(statement)) - 1];
  };

  test('a -- WARNING sits right above a DROP COLUMN', () => {
    const { text } = migrationFor(everything());
    expect(
      lineBefore(text, 'ALTER TABLE "billing"."invoices" DROP COLUMN "id"'),
    ).toBe(
      '-- WARNING (destructive): Drops column "billing"."invoices"."id" and the data in it',
    );
  });

  test('every risk gets its own warning line, above the first statement of its operation, in order', () => {
    const desired: SchemaModel = structuredClone(fixtureModel);
    desired.columns['c:20:3']!.notNull = true;
    const { text } = migrationFor(desired);
    expect(text).toContain(
      [
        '-- WARNING (may fail): Setting NOT NULL on "billing"."invoices"."total" fails if any row has no value there',
        '-- WARNING (locks or slow): Setting NOT NULL on "billing"."invoices"."total" scans the whole table while holding a lock',
        'ALTER TABLE "billing"."invoices" ALTER COLUMN "total" SET NOT NULL;',
      ].join('\n'),
    );
  });

  test('a safe statement has no warning, and the header says so', () => {
    const desired: SchemaModel = structuredClone(fixtureModel);
    desired.schemas.rep = { id: 'rep', name: 'reporting' };
    const { text } = migrationFor(desired);
    expect(text).not.toContain('WARNING');
    expect(text).toContain('-- Risks: none');
  });

  test('the header counts the risks by level, worst first, and only the levels that occur', () => {
    const { text } = migrationFor(everything());
    const counts = text
      .split('\n')
      .find((line) => line.startsWith('-- Risks:'));
    expect(counts).toBe(`-- Risks: ${EVERYTHING_RISKS}`);
    // the same number of warning lines as risks counted
    const total = [...EVERYTHING_RISKS.matchAll(/(\d+) /g)].reduce(
      (sum, m) => sum + Number(m[1]),
      0,
    );
    expect(
      text.split('\n').filter((line) => line.startsWith('-- WARNING')),
    ).toHaveLength(total);
  });

  test('warnings are only in the text: the statements list stays plain SQL', () => {
    const { statements } = migrationFor(everything());
    expect(
      statements.some((s) => s.includes('WARNING') || s.startsWith('--')),
    ).toBe(false);
  });

  test('an object name cannot break out of a warning line', () => {
    const baseline: SchemaModel = structuredClone(fixtureModel);
    baseline.tables['t:30']!.name = 'x\nDROP TABLE users;\r\n--';
    const desired: SchemaModel = structuredClone(baseline);
    delete desired.tables['t:30'];
    const { ops, errors } = diff(baseline, desired);
    expect(errors).toEqual([]);
    const { text } = renderMigration(ops, { ...contextFor(desired), baseline });
    const warning = text
      .split('\n')
      .filter((line) => line.startsWith('-- WARNING'));
    expect(warning).toEqual([
      '-- WARNING (destructive): Drops table "public"."x DROP TABLE users; --" and all its data',
    ]);
    // the statement itself holds the name inside a quoted identifier, which is valid SQL
    expect(text).toContain('DROP TABLE "public"."x\nDROP TABLE users;\r\n--";');
  });
});
// counted by hand from the reviewed snapshot: 3 drops, 3 may-fail (type change, NOT NULL, unique), 2 renames, 4 locks
const EVERYTHING_RISKS =
  '3 destructive, 3 may fail, 2 breaks app code, 4 locks or slow';
