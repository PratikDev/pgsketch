import { afterAll, beforeAll, expect, test } from 'vitest';
import { quoteIdent, quoteLiteral } from '../src/sql/quote';
import { startPostgres, type TestPostgres } from './pg';

let pg: TestPostgres;

beforeAll(async () => {
  pg = await startPostgres();
});

afterAll(async () => {
  await pg?.stop();
});

const tricky = [
  "it's",
  'a\\b',
  "a\\'b",
  '\\',
  "'; DROP TABLE x; --",
  'line\nbreak',
  'café 😀',
  '',
];

for (const setting of ['on', 'off']) {
  test(`literals round-trip with standard_conforming_strings = ${setting}`, async () => {
    await pg.client.query(`SET standard_conforming_strings = ${setting}`);
    for (const value of tricky) {
      const { rows } = await pg.client.query<{ v: string }>(
        `SELECT ${quoteLiteral(value)} AS v`,
      );
      expect(rows[0]?.v).toBe(value);
    }
  });
}

test('identifiers round-trip through a real table', async () => {
  const names = ['select', 'Mixed Case', 'say "hi"', "it's", 'café 😀', 'a\\b'];
  for (const name of names) {
    const { fields } = await pg.client.query(`SELECT 1 AS ${quoteIdent(name)}`);
    expect(fields[0]?.name).toBe(name);
  }
});
