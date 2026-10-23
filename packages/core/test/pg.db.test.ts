import { afterAll, beforeAll, expect, test } from 'vitest';
import { startPostgres, type TestPostgres } from './pg';

let pg: TestPostgres;

beforeAll(async () => {
  pg = await startPostgres();
});

afterAll(async () => {
  await pg?.stop();
});

test('SELECT version() returns the expected major version', async () => {
  const { rows } = await pg.client.query<{ version: string }>(
    'SELECT version()',
  );
  expect(rows[0]?.version).toMatch(new RegExp(`^PostgreSQL ${pg.version}[. ]`));
});
