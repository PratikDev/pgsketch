import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Query } from '@pgsketch/core';
import type { ConnectionParams } from '../../shared/ipc-contract';
import { startServer, type TestServer } from '../../../test/postgres';
import { openConnection, type ServerConnection } from './connection';
import { runSingle } from './run-single';
import { openTaskConnection, type TaskConnection } from './task-connection';

let server: TestServer;
let main: ServerConnection;
let task: TaskConnection;

const params = (): ConnectionParams => ({
  kind: 'params',
  host: server.host,
  port: server.port,
  user: server.user,
  password: server.password,
  database: server.database,
  sslMode: 'disable',
});

beforeAll(async () => {
  server = await startServer(process.env.PG_VERSION ?? '16');
  main = await openConnection(params());
  task = await openTaskConnection(params());
});

afterAll(async () => {
  await Promise.all([main?.close(), task?.close()]);
  await server?.stop();
});

/** `ask` is a connection's `query`, or the one a section is handed (a section can't wait for itself). */
const tableExists = async (ask: Query) =>
  (
    await ask<{ t: string | null }>(
      `SELECT to_regclass('public.in_task')::text AS t`,
    )
  )[0]?.t === 'public.in_task';

describe('a task connection', () => {
  test("is a separate connection, with the main one's settings", async () => {
    const pid = async (c: ServerConnection) =>
      (await c.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))[0]
        ?.pid;
    expect(await pid(task)).not.toBe(await pid(main));
    expect(task.originalSearchPath).toBe('"$user", public');
    expect(
      (
        await task.query<{ n: string }>(
          `SELECT current_setting('application_name') AS n`,
        )
      )[0]?.n,
    ).toBe('pgsketch');
    expect(
      (await task.query<{ search_path: string }>('SHOW search_path'))[0]
        ?.search_path,
    ).toBe('""');
  });

  test('its open transaction is invisible to the main connection, and gone after the rollback', async () => {
    const seenMeanwhile = await task.rolledBack(async (query) => {
      await query('CREATE TABLE public.in_task (id int)');
      expect(await tableExists(query)).toBe(true);
      return tableExists(main.query); // while the task's transaction is still open
    });
    expect(seenMeanwhile).toBe(false);
    expect(await tableExists(task.query)).toBe(false);
    expect(await tableExists(main.query)).toBe(false);
  });

  test('is rolled back when the work fails, and usable afterwards', async () => {
    await expect(
      task.rolledBack(async (query) => {
        await query('CREATE TABLE public.in_task (id int)');
        await query('SELECT nope');
      }),
    ).rejects.toThrow();
    expect(await tableExists(task.query)).toBe(false);
    expect(await task.query('SELECT 1 AS one')).toEqual([{ one: 1 }]);
  });

  test('two rolled-back sections never run in each other', async () => {
    const events: string[] = [];
    const section = (name: string, wait: number) =>
      task.rolledBack(async (query) => {
        events.push(`${name} start`);
        await query('SELECT pg_sleep($1)', [wait]);
        events.push(`${name} end`);
      });
    await Promise.all([section('a', 0.1), section('b', 0)]);
    expect(events).toEqual(['a start', 'a end', 'b start', 'b end']);
  });
});

describe('runSingle', () => {
  const sneaky = [
    'SELECT 1; SELECT 2',
    'SELECT 1; COMMIT',
    'SELECT 1; DROP TABLE public.victim',
  ];

  test('refuses several statements in one message, and runs none of them', async () => {
    await main.query('CREATE TABLE public.victim (id int)');
    for (const sql of sneaky) {
      await expect(task.query(sql), sql).rejects.toThrow(/multiple commands/);
    }
    expect(
      (
        await main.query<{ t: string | null }>(
          `SELECT to_regclass('public.victim')::text AS t`,
        )
      )[0]?.t,
    ).toBe('public.victim'); // qualified: the search_path is empty
  });

  test('a COMMIT cannot be smuggled into the rolled-back transaction', async () => {
    await expect(
      task.rolledBack(async (query) => {
        await query('CREATE TABLE public.in_task (id int)');
        await query('SELECT 1; COMMIT');
      }),
    ).rejects.toThrow(/multiple commands/);
    expect(await tableExists(main.query)).toBe(false);
  });

  test('takes parameters, and the same statement without them is still one message', async () => {
    const { Client } = await import('pg');
    const client = new Client({
      connectionString: `postgres://${server.user}:${server.password}@${server.host}:${server.port}/${server.database}`,
    });
    await client.connect();
    try {
      expect(await runSingle(client, 'SELECT $1::int AS n', [7])).toEqual([
        { n: 7 },
      ]);
      expect(await runSingle(client, 'SELECT 1 AS n')).toEqual([{ n: 1 }]);
      // the driver's own default, for comparison: with no values it uses the simple protocol
      await expect(client.query('SELECT 1; SELECT 2')).resolves.toBeDefined();
      await expect(runSingle(client, 'SELECT 1; SELECT 2')).rejects.toThrow(
        /multiple commands/,
      );
    } finally {
      await client.end();
    }
  });
});
