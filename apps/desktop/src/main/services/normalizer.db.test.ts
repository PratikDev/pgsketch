import { randomUUID } from 'node:crypto';
import { quoteIdent, type ExpressionColumn } from '@pgsketch/core';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { ConnectionParams } from '../../shared/ipc-contract';
import { startServer, type TestServer } from '../../../test/postgres';
import { createNormalizer } from './normalizer';
import { openTaskConnection, type TaskConnection } from './task-connection';

let server: TestServer;

const paramsFor = (
  user = server.user,
  password = server.password,
  database = server.database,
): ConnectionParams => ({
  kind: 'params',
  host: server.host,
  port: server.port,
  user,
  password,
  database,
  sslMode: 'disable',
});

/** A normalizer that counts the connections it opens and closes. */
const counted = (params: ConnectionParams, idleMs?: number) => {
  const counts = { opened: 0, closed: 0 };
  const normalizer = createNormalizer(async (onLost) => {
    const task = await openTaskConnection(params, { onLost });
    counts.opened++;
    const close = task.close.bind(task);
    return {
      ...task,
      close: async () => {
        counts.closed++;
        await close();
      },
    } satisfies TaskConnection;
  }, idleMs);
  return { normalizer, counts };
};

const column = (id: string, name: string, type: string): ExpressionColumn => ({
  id,
  name,
  type: { name: type, isArray: false },
});
const status = column('c1', 'status', 'text');
const price = column('c2', 'price', 'integer');
const qty = column('c3', 'qty', 'integer');

beforeAll(async () => {
  server = await startServer(process.env.PG_VERSION ?? '16');
});
afterAll(async () => {
  await server?.stop();
});

describe('the normalizer on a real server', () => {
  test('gives the text Postgres reads a default back as', async () => {
    const { normalizer } = counted(paramsFor());
    expect(
      await normalizer.normalize({
        expression: "'active'",
        target: { kind: 'default', columnId: 'c1' },
        columns: [status],
      }),
    ).toEqual({
      status: 'normalized',
      expression: "'active'::text",
      columnIds: [],
    });
    await normalizer.close();
  });

  test("gives a check's text and the columns it uses, in the order Postgres stores them", async () => {
    const { normalizer } = counted(paramsFor());
    expect(
      await normalizer.normalize({
        expression: 'qty > 0 AND price > 0',
        target: { kind: 'check' },
        columns: [price, qty],
      }),
    ).toMatchObject({ status: 'normalized', columnIds: ['c3', 'c2'] });
    await normalizer.close();
  });

  test('says what Postgres says when the expression is wrong, and works again after', async () => {
    const { normalizer } = counted(paramsFor());
    const bad = await normalizer.normalize({
      expression: 'nonsense(',
      target: { kind: 'default', columnId: 'c1' },
      columns: [status],
    });
    expect(bad).toMatchObject({ status: 'invalid' });
    expect(bad.status === 'invalid' && bad.message).toMatch(/syntax error/);
    expect(
      await normalizer.normalize({
        expression: "'x'",
        target: { kind: 'default', columnId: 'c1' },
        columns: [status],
      }),
    ).toMatchObject({ status: 'normalized' });
    await normalizer.close();
  });

  test('runs many requests at once on one connection, each in a transaction of its own', async () => {
    const { normalizer, counts } = counted(paramsFor());
    const answers = await Promise.all(
      [1, 2, 3, 4, 5, 6].map((n) =>
        normalizer.normalize({
          expression: `${n}`,
          target: { kind: 'default', columnId: 'c2' },
          columns: [price],
        }),
      ),
    );
    expect(
      answers.map((a) => a.status === 'normalized' && a.expression),
    ).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(counts.opened).toBe(1);
    // nothing was left behind: no temporary table, no open transaction
    await normalizer.close();
    expect(counts.closed).toBe(1);
  });

  test('closes the connection after it has been idle, and opens a new one for the next request', async () => {
    const { normalizer, counts } = counted(paramsFor(), 150);
    const ask = () =>
      normalizer.normalize({
        expression: '1',
        target: { kind: 'default', columnId: 'c2' },
        columns: [price],
      });
    await ask();
    await ask();
    expect(counts).toEqual({ opened: 1, closed: 0 });
    await new Promise((r) => setTimeout(r, 400));
    expect(counts).toEqual({ opened: 1, closed: 1 });
    await ask();
    expect(counts.opened).toBe(2);
    await normalizer.close();
  });

  test('keeps the text as typed for a role that cannot create temporary tables', async () => {
    const name = `notemp_${randomUUID().replaceAll('-', '')}`;
    const role = `role_${name}`;
    await server.admin.query(`CREATE DATABASE ${quoteIdent(name)}`);
    await server.admin.query(
      `REVOKE TEMPORARY ON DATABASE ${quoteIdent(name)} FROM PUBLIC`,
    );
    await server.admin.query(
      `CREATE ROLE ${quoteIdent(role)} LOGIN PASSWORD 'test'`,
    );
    const { normalizer } = counted(paramsFor(role, 'test', name));
    try {
      expect(
        await normalizer.normalize({
          expression: '  now()  ',
          target: { kind: 'default', columnId: 'c1' },
          columns: [status],
        }),
      ).toEqual({ status: 'raw', expression: 'now()' });
    } finally {
      await normalizer.close();
      await server.admin.query(
        `DROP DATABASE ${quoteIdent(name)} WITH (FORCE)`,
      );
      await server.admin.query(`DROP ROLE ${quoteIdent(role)}`);
    }
  });
});
