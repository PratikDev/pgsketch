import { afterAll, beforeAll, expect, test } from 'vitest';
import { assignNames } from '../src/model/naming';
import type { Constraint, Index, SchemaModel } from '../src/model/types';
import { quoteIdent } from '../src/sql/quote';
import { startPostgres, type TestPostgres } from './pg';

let pg: TestPostgres;

beforeAll(async () => {
  pg = await startPostgres();
});

afterAll(async () => {
  await pg?.stop();
});

interface TableSpec {
  name: string;
  columns: string[];
  pk?: string[];
  uniques?: string[][];
  fks?: { cols: string[]; ref: string; refCols: string[] }[];
  /** Columns each unnamed check references. */
  checks?: string[][];
  namedChecks?: { name: string; cols: string[] }[];
  indexes?: { cols: string[]; unique?: boolean }[];
}

interface Scenario {
  name: string;
  /** Plain tables that already exist and keep their names. */
  existingTables?: string[];
  tables: TableSpec[];
}

const q = quoteIdent;
const list = (cols: string[]) => cols.map(q).join(', ');
// Single-column checks mention their column twice, as `a > 0 AND a < 100` does.
const checkSql = (cols: string[]) =>
  `(${cols.length === 1 ? `${q(cols[0]!)} > 0 AND ${q(cols[0]!)} < 100` : cols.map((c) => `${q(c)} > 0`).join(' AND ')})`;

const long = (ch: string, n: number) => ch.repeat(n);

const scenarios: Scenario[] = [
  {
    name: 'basic',
    tables: [
      { name: 'orgs', columns: ['id'], pk: ['id'] },
      {
        name: 'users',
        columns: ['id', 'email', 'org_id', 'age'],
        pk: ['id'],
        uniques: [['email']],
        fks: [{ cols: ['org_id'], ref: 'orgs', refCols: ['id'] }],
        checks: [['age']],
        indexes: [{ cols: ['email'] }, { cols: ['email'], unique: true }],
      },
    ],
  },
  {
    name: 'composite and repeated names',
    tables: [
      { name: 'p', columns: ['x', 'y'], pk: ['x', 'y'] },
      {
        name: 't',
        columns: ['a', 'b', 'c', 'd'],
        pk: ['a', 'b'],
        uniques: [
          ['c', 'd'],
          ['c', 'd'],
        ],
        fks: [
          { cols: ['c', 'd'], ref: 'p', refCols: ['x', 'y'] },
          { cols: ['c', 'd'], ref: 'p', refCols: ['x', 'y'] },
        ],
        checks: [['a', 'b'], ['a', 'b'], ['c']],
        indexes: [{ cols: ['a', 'b', 'c'] }, { cols: ['a', 'b', 'c'] }],
      },
    ],
  },
  {
    name: 'very long names',
    tables: [
      { name: long('p', 50), columns: [long('k', 40)], pk: [long('k', 40)] },
      {
        name: `tbl_${long('a', 50)}`,
        columns: [long('c', 40), long('d', 40), long('e', 40)],
        pk: [long('c', 40)],
        uniques: [
          [long('c', 40)],
          [long('c', 40), long('d', 40)],
          [long('c', 40), long('d', 40), long('e', 40)],
          [long('c', 40), long('d', 40), long('e', 40)],
        ],
        fks: [
          {
            cols: [long('d', 40)],
            ref: long('p', 50),
            refCols: [long('k', 40)],
          },
        ],
        checks: [[long('c', 40)], [long('c', 40), long('d', 40)]],
        indexes: [
          { cols: [long('c', 40), long('d', 40)] },
          { cols: [long('c', 40), long('d', 40)] },
        ],
      },
    ],
  },
  {
    name: 'same name from different tables',
    tables: [
      {
        name: 'a',
        columns: ['b_c', 'id'],
        pk: ['id'],
        uniques: [['b_c']],
        fks: [{ cols: ['b_c'], ref: 'p', refCols: ['id'] }],
        indexes: [{ cols: ['b_c'] }],
      },
      {
        name: 'a_b',
        columns: ['c', 'id'],
        pk: ['id'],
        uniques: [['c']],
        fks: [{ cols: ['c'], ref: 'p', refCols: ['id'] }],
        indexes: [{ cols: ['c'] }],
      },
      { name: 'p', columns: ['id'], pk: ['id'] },
    ],
  },
  {
    name: 'multibyte names',
    tables: [
      {
        name: long('é', 25),
        columns: [long('ü', 20), long('ö', 20)],
        pk: [long('ü', 20)],
        uniques: [
          [long('ü', 20), long('ö', 20)],
          [long('ü', 20), long('ö', 20)],
        ],
        indexes: [{ cols: [long('ü', 20), long('ö', 20)] }],
        checks: [[long('ü', 20)]],
      },
    ],
  },
  {
    name: 'names already taken',
    existingTables: ['orders_total_key', 'orders_qty_idx'],
    tables: [
      {
        name: 'orders',
        columns: ['total', 'qty'],
        uniques: [['total']],
        indexes: [{ cols: ['qty'] }],
        namedChecks: [{ name: 'orders_total_check', cols: ['total'] }],
        checks: [['total']],
      },
    ],
  },
];

/** Builds the DDL (in the order Postgres should name things) and the matching model. */
function build(scenario: Scenario, schemaName: string) {
  const ddl: string[] = [`CREATE SCHEMA ${q(schemaName)}`];
  const model: SchemaModel = {
    schemas: { s: { id: 's', name: schemaName } },
    tables: {},
    columns: {},
    constraints: {},
    indexes: {},
    enums: {},
    unmodeled: {},
  };
  const at = (t: string) => `${q(schemaName)}.${q(t)}`;
  let n = 0;
  const nextId = () => `n${String(++n).padStart(3, '0')}`;
  const tableIds: Record<string, string> = {};
  const columnIds = (table: string, cols: string[]) =>
    cols.map((c) => `${table}.${c}`);

  const tables = [...scenario.tables].sort((a, b) =>
    a.name < b.name ? -1 : 1,
  );
  for (const name of scenario.existingTables ?? []) {
    ddl.push(`CREATE TABLE ${at(name)} (x bigint)`);
    model.tables[name] = { id: name, schemaId: 's', name, comment: null };
  }
  for (const t of tables) {
    ddl.push(
      `CREATE TABLE ${at(t.name)} (${t.columns.map((c) => `${q(c)} bigint NOT NULL`).join(', ')})`,
    );
    tableIds[t.name] = t.name;
    model.tables[t.name] = {
      id: t.name,
      schemaId: 's',
      name: t.name,
      comment: null,
    };
    for (const c of t.columns) {
      model.columns[`${t.name}.${c}`] = {
        id: `${t.name}.${c}`,
        tableId: t.name,
        name: c,
        position: 1,
        type: { name: 'bigint', isArray: false },
        notNull: true,
        default: null,
        identity: null,
        comment: null,
      };
    }
  }
  const add = (c: Constraint) => (model.constraints[c.id] = c);
  const base = (t: string, cols: string[]) => ({
    id: nextId(),
    tableId: t,
    name: 'placeholder',
    autoName: true,
    columnIds: columnIds(t, cols),
  });
  for (const t of tables) {
    if (t.pk) {
      ddl.push(`ALTER TABLE ${at(t.name)} ADD PRIMARY KEY (${list(t.pk)})`);
      add({ ...base(t.name, t.pk), kind: 'pk' });
    }
    for (const cols of t.uniques ?? []) {
      ddl.push(`ALTER TABLE ${at(t.name)} ADD UNIQUE (${list(cols)})`);
      add({ ...base(t.name, cols), kind: 'unique' });
    }
  }
  for (const t of tables) {
    for (const fk of t.fks ?? []) {
      ddl.push(
        `ALTER TABLE ${at(t.name)} ADD FOREIGN KEY (${list(fk.cols)}) REFERENCES ${at(fk.ref)} (${list(fk.refCols)})`,
      );
      add({
        ...base(t.name, fk.cols),
        kind: 'fk',
        refTableId: fk.ref,
        refColumnIds: columnIds(fk.ref, fk.refCols),
        onDelete: 'no action',
        onUpdate: 'no action',
      });
    }
  }
  for (const t of tables) {
    for (const { name, cols } of t.namedChecks ?? []) {
      ddl.push(
        `ALTER TABLE ${at(t.name)} ADD CONSTRAINT ${q(name)} CHECK ${checkSql(cols)}`,
      );
      add({
        ...base(t.name, cols),
        name,
        autoName: false,
        kind: 'check',
        expression: checkSql(cols),
      });
    }
    for (const cols of t.checks ?? []) {
      ddl.push(`ALTER TABLE ${at(t.name)} ADD CHECK ${checkSql(cols)}`);
      add({ ...base(t.name, cols), kind: 'check', expression: checkSql(cols) });
    }
  }
  for (const t of tables) {
    for (const ix of t.indexes ?? []) {
      ddl.push(
        `CREATE ${ix.unique ? 'UNIQUE ' : ''}INDEX ON ${at(t.name)} (${list(ix.cols)})`,
      );
      const index: Index = { ...base(t.name, ix.cols), unique: !!ix.unique };
      model.indexes[index.id] = index;
    }
  }
  return { ddl, model };
}

test.each(scenarios)(
  'auto names match Postgres: $name',
  async (scenario) => {
    const schemaName = 'sc_' + scenario.name.replace(/\W+/g, '_');
    const { ddl, model } = build(scenario, schemaName);
    for (const statement of ddl) await pg.client.query(statement);

    const constraints = await pg.client.query<{ name: string }>(
      `SELECT c.conname AS name FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = $1 AND c.contype IN ('p', 'u', 'f', 'c') ORDER BY c.oid`,
      [schemaName],
    );
    const indexes = await pg.client.query<{ name: string }>(
      `SELECT i.relname AS name FROM pg_index x
       JOIN pg_class i ON i.oid = x.indexrelid JOIN pg_class t ON t.oid = x.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = $1 AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = x.indexrelid)
      ORDER BY x.indexrelid`,
      [schemaName],
    );

    const named = assignNames(model);
    const byId = <T extends { id: string; name: string }>(
      o: Record<string, T>,
    ) =>
      Object.values(o)
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map((x) => x.name);
    expect(byId(named.constraints)).toEqual(
      constraints.rows.map((r) => r.name),
    );
    expect(byId(named.indexes)).toEqual(indexes.rows.map((r) => r.name));
  },
  60_000,
);
