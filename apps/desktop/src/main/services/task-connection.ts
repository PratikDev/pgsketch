import type { Query } from '@pgsketch/core';
import type { ConnectionParams } from '../../shared/ipc-contract';
import {
  openConnection,
  type ConnectionOptions,
  type ServerConnection,
} from './connection';

/**
 * A connection of its own, with the same settings as the main one (SSL, `application_name`, the
 * version check, `search_path` recorded and pinned), for work that opens a transaction: Validate's
 * dry run and expression normalization. It is never the main connection, so a transaction opened
 * here can't be seen by the poller or ended by anything else, and what is sent through it goes
 * one statement per message.
 */
export interface TaskConnection extends ServerConnection {
  /**
   * Runs `work` inside `BEGIN` and always `ROLLBACK`, whether it finishes, fails or the
   * connection is already broken, and with the connection to itself meanwhile.
   */
  rolledBack<T>(work: (query: Query) => Promise<T>): Promise<T>;
}

export async function openTaskConnection(
  params: ConnectionParams,
  options?: ConnectionOptions,
): Promise<TaskConnection> {
  const connection = await openConnection(params, options);
  return {
    ...connection,
    rolledBack: (work) =>
      connection.exclusive(async (query) => {
        await query('BEGIN');
        try {
          return await work(query);
        } finally {
          await query('ROLLBACK').catch(() => undefined);
        }
      }),
  };
}
