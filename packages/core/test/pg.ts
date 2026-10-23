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
