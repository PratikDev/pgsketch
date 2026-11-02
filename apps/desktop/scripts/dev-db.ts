// A throwaway Postgres in Docker to point the dev app at. Usage: node scripts/dev-db.ts up|load|down
//   up    starts it detached and waits until it takes connections
//   load  (re)creates the database `pgsketch` from packages/core/test/fixtures/basic.sql
//   down  stops and removes it (the data goes with it)
// Connect with host localhost, user postgres, password test, database pgsketch. PG_VERSION (default 16) and PG_PORT
// (default 5432) change the server. Node runs this file as it is (it only uses syntax that can be erased), and it
// calls no shell, so it works the same in bash, PowerShell and cmd.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const NAME = 'pgsketch-dev-pg';

export const runArgs = (version: string, port: string): string[] => [
  ...['run', '-d', '--rm', '--name', NAME],
  ...['-e', 'POSTGRES_PASSWORD=test', '-p', `${port}:5432`],
  `postgres:${version}`,
];

/** The image runs a temporary server to set itself up and then the real one: it is ready at the second line. */
export const readyCount = (logs: string): number =>
  logs.split('ready to accept connections').length - 1;

export const psqlArgs = (...rest: string[]): string[] => [
  ...['exec', '-i', NAME, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'],
  ...rest,
];

const FIXTURE = fileURLToPath(
  new URL('../../../packages/core/test/fixtures/basic.sql', import.meta.url),
);

const docker = (args: string[], input?: string) =>
  spawnSync('docker', args, { encoding: 'utf8', input });

const listed = (all: boolean) =>
  docker([
    'ps',
    all ? '-aq' : '-q',
    '--filter',
    `name=^${NAME}$`,
  ]).stdout.trim() !== '';

function must(result: ReturnType<typeof docker>, what: string): void {
  if (result.status === 0) return;
  console.error(result.stderr || `${what} failed`);
  process.exit(result.status ?? 1);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function up(version: string, port: string): Promise<void> {
  if (listed(false))
    return console.log(`${NAME} is already running on port ${port}`);
  must(docker(runArgs(version, port)), 'docker run');
  for (;;) {
    // Postgres logs to stderr, which `docker logs` passes on as its own
    const logs = docker(['logs', NAME]);
    if (readyCount(`${logs.stdout}${logs.stderr}`) >= 2) break;
    if (!listed(false)) {
      console.error(`${NAME} stopped at startup`);
      process.exit(1);
    }
    await sleep(1000);
  }
  console.log(
    [
      `Postgres ${version} is ready:`,
      `localhost:${port}`,
      'user postgres',
      'password test',
      'database pgsketch',
    ].join('\n'),
  );
}

function load(): void {
  must(
    docker(
      psqlArgs(
        '-q',
        '-c',
        'DROP DATABASE IF EXISTS pgsketch',
        '-c',
        'CREATE DATABASE pgsketch',
      ),
    ),
    'recreating the database',
  );
  must(
    docker(psqlArgs('-q', '-d', 'pgsketch'), readFileSync(FIXTURE, 'utf8')),
    'loading basic.sql',
  );
  console.log('Loaded basic.sql into the database pgsketch');
}

function down(): void {
  if (!listed(true)) return console.log(`${NAME} was not running`);
  must(docker(['rm', '-f', NAME]), 'docker rm');
  console.log(`${NAME} removed`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [verb] = process.argv.slice(2);
  const version = process.env.PG_VERSION ?? '16';
  const port = process.env.PG_PORT ?? '5432';
  if (verb === 'up') await up(version, port);
  else if (verb === 'load') load();
  else if (verb === 'down') down();
  else {
    console.error('Usage: node scripts/dev-db.ts up|load|down');
    process.exit(2);
  }
}
