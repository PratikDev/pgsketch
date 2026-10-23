import { afterAll, beforeAll, expect, test } from 'vitest';
import { fingerprint } from '../src/fingerprint/fingerprint';
import { startPostgres, type TestPostgres } from './pg';

let pg: TestPostgres;

beforeAll(async () => {
  pg = await startPostgres();
  // like the app's connection: an empty search_path, so definition text is schema-qualified
  await pg.query(`SET search_path = ''`);
  await pg.query(`
    CREATE SCHEMA app;
    CREATE TABLE app.t (a int, b int);
    CREATE TABLE app.log (id int PRIMARY KEY, note text);
    INSERT INTO app.t SELECT g, g FROM generate_series(1, 200) g;
  `);
});

afterAll(async () => {
  await pg?.stop();
});

const fp = () => fingerprint(pg.query);

test('the fingerprint is a stable md5 when nothing changes', async () => {
  const first = await fp();
  expect(first).toMatch(/^[0-9a-f]{32}$/);
  expect(await fp()).toBe(first);
});

test.each([
  'INSERT INTO app.t VALUES (1000, 1000)',
  'UPDATE app.t SET b = b + 1',
  'DELETE FROM app.t WHERE a > 150',
  'ANALYZE app.t',
  'VACUUM app.t',
  'VACUUM FULL app.t',
  'REINDEX TABLE app.log',
  'TRUNCATE app.log',
  'CREATE TEMP TABLE temp_probe (a int)',
  // not something pgsketch reads: the flag itself, as opposed to the policies
  'ALTER TABLE app.log ENABLE ROW LEVEL SECURITY',
])('the fingerprint does not change after: %s', async (statement) => {
  const before = await fp();
  await pg.query(statement);
  expect(await fp()).toBe(before);
});

// Each statement builds on the previous ones, and each must change the fingerprint.
const ddl = [
  'CREATE SCHEMA other',
  'CREATE TABLE app.u (a int, b int)',
  'ALTER TABLE app.u ADD COLUMN c text',
  'ALTER TABLE app.u RENAME COLUMN c TO d',
  'ALTER TABLE app.u ALTER COLUMN d TYPE varchar(10)',
  'ALTER TABLE app.u ALTER COLUMN a SET NOT NULL',
  'ALTER TABLE app.u ALTER COLUMN b SET DEFAULT 1',
  "COMMENT ON TABLE app.u IS 'hello'",
  "COMMENT ON COLUMN app.u.a IS 'column note'",
  'ALTER TABLE app.u ADD PRIMARY KEY (a)',
  'ALTER TABLE app.u ADD CONSTRAINT u_b UNIQUE (b)',
  'ALTER TABLE app.u ADD CONSTRAINT u_check CHECK (b > 0)',
  'ALTER TABLE app.u ADD CONSTRAINT u_fk FOREIGN KEY (b) REFERENCES app.log (id)',
  'ALTER TABLE app.u ALTER CONSTRAINT u_fk DEFERRABLE',
  'CREATE INDEX u_d ON app.u (d)',
  'ALTER INDEX app.u_d RENAME TO u_d2',
  'DROP INDEX app.u_d2',
  "CREATE TYPE app.mood AS ENUM ('happy')",
  "ALTER TYPE app.mood ADD VALUE 'sad'",
  'ALTER TABLE app.u RENAME TO v',
  'CREATE VIEW app.vw AS SELECT a FROM app.v',
  'CREATE SEQUENCE app.s',
  'CREATE FUNCTION app.f() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$',
  'CREATE TRIGGER trg BEFORE UPDATE ON app.v FOR EACH ROW EXECUTE FUNCTION app.f()',
  'CREATE POLICY pol ON app.v USING (a > 0)',
  'ALTER TABLE app.v ADD COLUMN idn int GENERATED ALWAYS AS IDENTITY',
  'ALTER TABLE app.v DROP COLUMN b',
  'DROP TABLE app.v CASCADE',
];

test('the fingerprint changes after each kind of DDL', async () => {
  const unchanged: string[] = [];
  for (const statement of ddl) {
    const before = await fp();
    await pg.query(statement);
    if ((await fp()) === before) unchanged.push(statement);
  }
  expect(unchanged).toEqual([]);
});

test('dropping and recreating an identical table changes the fingerprint (new OIDs)', async () => {
  await pg.query('CREATE TABLE app.twin (a int PRIMARY KEY, b text)');
  const before = await fp();
  await pg.query(
    'DROP TABLE app.twin; CREATE TABLE app.twin (a int PRIMARY KEY, b text)',
  );
  expect(await fp()).not.toBe(before);
});

test('editing a function body or a policy does not change the fingerprint', async () => {
  await pg.query(`
    CREATE TABLE app.guarded (a int);
    ALTER TABLE app.guarded ENABLE ROW LEVEL SECURITY;
    CREATE POLICY guard ON app.guarded USING (a > 0);
    CREATE FUNCTION app.calc() RETURNS int LANGUAGE plpgsql AS $$ BEGIN RETURN 1; END $$;
  `);
  const before = await fp();
  await pg.query(
    `CREATE OR REPLACE FUNCTION app.calc() RETURNS int LANGUAGE plpgsql AS $$ BEGIN RETURN 2; END $$`,
  );
  expect(await fp()).toBe(before);
  await pg.query('ALTER POLICY guard ON app.guarded USING (a > 5)');
  expect(await fp()).toBe(before);
});

test('a view whose dependencies change flips it; one whose text changes but not its dependencies does not', async () => {
  await pg.query(
    `CREATE TABLE app.base (a int, b int); CREATE VIEW app.watch AS SELECT a FROM app.base`,
  );
  const before = await fp();
  await pg.query(
    'CREATE OR REPLACE VIEW app.watch AS SELECT a FROM app.base WHERE a > 0',
  );
  expect(await fp()).toBe(before);
  await pg.query(
    'CREATE OR REPLACE VIEW app.watch AS SELECT a, b FROM app.base WHERE a > 0',
  );
  expect(await fp()).not.toBe(before);
});

test('installing an extension does not change the fingerprint', async () => {
  const before = await fp();
  await pg.query('CREATE EXTENSION pg_trgm SCHEMA public');
  expect(await fp()).toBe(before);
});
