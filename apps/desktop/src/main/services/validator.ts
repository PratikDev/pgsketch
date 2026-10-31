import { fingerprint } from '@pgsketch/core';
import type {
  StatementResult,
  ValidateResult,
} from '../../shared/ipc-contract';
import { redact } from '../log';
import type { TaskConnection } from './task-connection';

/** How long a statement may wait for a lock, and how long it may run. */
const LOCK_TIMEOUT = '3s';
const STATEMENT_TIMEOUT = '30s';

/** The error Postgres raised: its message without passwords, and its SQLSTATE. */
function failure(error: unknown): StatementResult {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    error instanceof Error && 'code' in error && typeof error.code === 'string'
      ? error.code
      : null;
  return { status: 'failed', message: redact(message), code };
}

/**
 * Runs the statements of a migration for real but never keeps them: on a task connection of its
 * own, inside `BEGIN … ROLLBACK`, with the connection's original `search_path` so that it
 * predicts the user's own run. The connection is closed when the run ends.
 *
 * The statements go one at a time (the task connection's `query` allows one per message), and the
 * run stops at the first that fails; the ones after it are `not-run`. If the database is not
 * what `expected` says, nothing is run.
 */
export function createValidator(open: () => Promise<TaskConnection>) {
  return {
    async validate(
      statements: readonly string[],
      expected: string,
    ): Promise<ValidateResult> {
      const task = await open();
      try {
        return await task.rolledBack(async (query): Promise<ValidateResult> => {
          // before the search_path is set: the fingerprint is made with it empty
          if ((await fingerprint(query)) !== expected)
            return { status: 'stale' };
          await query(`SELECT set_config('lock_timeout', $1, true)`, [
            LOCK_TIMEOUT,
          ]);
          await query(`SELECT set_config('statement_timeout', $1, true)`, [
            STATEMENT_TIMEOUT,
          ]);
          await query(`SELECT set_config('search_path', $1, true)`, [
            task.originalSearchPath,
          ]);
          const results: StatementResult[] = [];
          for (const statement of statements) {
            if (results.some((r) => r.status === 'failed')) {
              results.push({ status: 'not-run' });
              continue;
            }
            try {
              await query(statement);
              results.push({ status: 'passed' });
            } catch (error) {
              results.push(failure(error));
            }
          }
          return { status: 'done', results };
        });
      } finally {
        await task.close().catch(() => undefined);
      }
    },
  };
}

export type Validator = ReturnType<typeof createValidator>;
