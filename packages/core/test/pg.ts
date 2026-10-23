import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';

export interface TestPostgres {
  /** Major version under test, from `PG_VERSION` (default 16). */
  version: string;
  client: Client;
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
    connectionUri,
    stop: async () => {
      await client.end();
      await container.stop();
    },
  };
}
