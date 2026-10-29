import {
  normalizeExpression,
  type ExpressionColumn,
  type ExpressionTarget,
  type NormalizedExpression,
} from '@pgsketch/core';
import type { TaskConnection } from './task-connection';

/** How long the connection waits for another request before it is closed. */
export const IDLE_MS = 30_000;

export interface NormalizeRequest {
  expression: string;
  target: ExpressionTarget;
  /** Every column of the table, pending ones included. */
  columns: ExpressionColumn[];
}

/**
 * Asks Postgres for the canonical form of default and check expressions, on one task connection
 * that stays open for the next request and is closed after `idleMs` with none. Requests queue on
 * the connection, and each runs in its own `BEGIN … ROLLBACK` (`normalizeExpression`).
 *
 * `open` makes the connection; it is told if the connection breaks, so the next request opens a
 * new one instead of using a dead one.
 */
export function createNormalizer(
  open: (onLost: (error: Error) => void) => Promise<TaskConnection>,
  idleMs = IDLE_MS,
) {
  let connection: Promise<TaskConnection> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = 0;

  const release = (): Promise<void> => {
    const closing = connection;
    connection = null;
    return (
      closing?.then((c) => c.close()).catch(() => undefined) ??
      Promise.resolve()
    );
  };

  const connect = (): Promise<TaskConnection> => {
    if (connection) return connection;
    const opening: Promise<TaskConnection> = open(() => {
      if (connection === opening) connection = null;
    });
    // a connection that fails to open is not kept: the next request tries again
    opening.catch(() => {
      if (connection === opening) connection = null;
    });
    connection = opening;
    return opening;
  };

  return {
    async normalize(request: NormalizeRequest): Promise<NormalizedExpression> {
      clearTimeout(timer);
      inFlight++;
      try {
        const task = await connect();
        return await task.exclusive((query) =>
          normalizeExpression(query, request.expression, request.target, {
            columns: request.columns,
            searchPath: task.originalSearchPath,
          }),
        );
      } finally {
        inFlight--;
        if (inFlight === 0) {
          timer = setTimeout(() => void release(), idleMs);
          // an idle connection must not keep the app from quitting
          timer.unref();
        }
      }
    },

    /** Closes the connection now, if there is one. */
    async close(): Promise<void> {
      clearTimeout(timer);
      await release();
    },
  };
}

export type Normalizer = ReturnType<typeof createNormalizer>;
