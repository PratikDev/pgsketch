import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { firstDifference } from '../src/diff/applied';
import { diff } from '../src/diff';
import { introspect } from '../src/introspect';
import { assignNames } from '../src/model/naming';
import { validateModel } from '../src/model/validate';
import { renderMigration, type Migration } from '../src/render/migration';
import type { SchemaModel } from '../src/model/types';
import { quoteIdent } from '../src/sql/quote';
import type { TestPostgres } from './pg';

export interface RoundTripResult {
  migration: Migration;
  /** The first object where the database after the migration differs from the edited model; `null` when none. */
  difference: string | null;
}

/**
 * The round trip: in a fresh database, run `setup`, load the schema, let `edit` change a copy,
 * generate the migration, run it, load the schema again and compare it with the edited copy by
 * name. An edit that fails validation or diffing, or a migration Postgres rejects, throw with the SQL.
 */
export async function roundTrip(
  pg: TestPostgres,
  setup: string,
  edit: (desired: SchemaModel, baseline: SchemaModel) => void,
): Promise<RoundTripResult> {
  const name = `roundtrip_${randomUUID().replaceAll('-', '')}`;
  await pg.client.query(`CREATE DATABASE ${quoteIdent(name)}`);
  const url = new URL(pg.connectionUri);
  url.pathname = `/${name}`;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  const query = async (sql: string) => (await client.query(sql)).rows;
  try {
    await client.query(setup);
    const { model: baseline, casts } = await introspect(query);
    const desired = structuredClone(baseline);
    edit(desired, baseline);
    const named = assignNames(desired);

    const problems = [
      ...validateModel(named),
      ...diff(baseline, named).errors,
    ].map((e) => e.message);
    if (problems.length > 0)
      throw new Error(`Invalid edits: ${problems.join('; ')}`);

    const migration = renderMigration(diff(baseline, named).ops, {
      baseline,
      desired: named,
      casts,
      generatedAt: 'roundtrip',
      dbName: name,
    });
    try {
      await client.query(migration.text);
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n${migration.text}`,
        { cause: error },
      );
    }
    const { model: after } = await introspect(query);
    return { migration, difference: firstDifference(after, named) };
  } finally {
    await client.end();
    await pg.client.query(`DROP DATABASE ${quoteIdent(name)} WITH (FORCE)`);
  }
}
