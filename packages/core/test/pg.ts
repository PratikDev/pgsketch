import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import type { Query } from '../src/introspect/query';

export interface TestPostgres {
  /** Major version under test, from `PG_VERSION` (default 16). */
  version: string;
  client: Client;
  /** The same connection as `client`, in the shape core's introspection expects. */
  query: Query;
  connectionUri: string;
  stop: () => Promise<void>;
}

export async function startPostgres(): Promise<TestPostgres> {
  const version = process.env.PG_VERSION ?? '16';
  const container = await new PostgreSqlContainer(
    `postgres:${version}`,
  ).start();
  const connectionUri = container.getConnectionUri();
  const client = new Client({ connectionString: connectionUri });
  await client.connect();
  return {
    version,
    client,
    query: async (sql, params) =>
      (await client.query(sql, params ? [...params] : undefined)).rows,
    connectionUri,
    stop: async () => {
      await client.end();
      await container.stop();
    },
  };
}

/** The oid an expression like `'public.t'::regclass::oid` evaluates to. */
export async function oidOf(query: Query, expr: string): Promise<number> {
  const [row] = await query<{ oid: number | string }>(`SELECT ${expr} AS oid`);
  if (!row) throw new Error(`No oid for ${expr}`);
  return Number(row.oid);
}
