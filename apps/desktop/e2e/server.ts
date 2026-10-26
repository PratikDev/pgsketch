import { startServer, type TestServer } from '../test/postgres';

// the container's own user, password and database are all "test", which is no use for
// checking that a password never shows up somewhere
export const E2E_USER = 'e2e_user';
export const E2E_PASSWORD = 'pw-9f3c1d7a-e2e';

/** A Postgres in a container with a user whose password is easy to look for. */
export async function startE2eServer(): Promise<TestServer> {
  const server = await startServer(process.env.PG_VERSION ?? '16');
  await server.admin.query(
    `CREATE ROLE ${E2E_USER} LOGIN PASSWORD '${E2E_PASSWORD}'`,
  );
  await server.admin.query(
    `GRANT CONNECT ON DATABASE ${server.database} TO ${E2E_USER}`,
  );
  return server;
}
