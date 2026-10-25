import type { Client } from 'pg';
import type { QueryParam } from '@pgsketch/core';

/**
 * Runs one statement and returns its rows. It always uses the extended protocol, which takes
 * exactly one statement per message: `pg` only does that when there are parameter values or
 * `queryMode` is set, and an empty values array falls back to the simple protocol, which runs
 * several statements sent together. So a statement can't carry a `COMMIT` or anything else with it.
 */
export async function runSingle<Row>(
  client: Pick<Client, 'query'>,
  sql: string,
  params: readonly QueryParam[] = [],
): Promise<Row[]> {
  // a variable, not an inline object: `queryMode` works in `pg` but is missing from its types
  const config = {
    text: sql,
    values: [...params],
    queryMode: 'extended' as const,
  };
  return (await client.query(config)).rows;
}
