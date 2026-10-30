import type { NormalizedExpression } from '@pgsketch/core';
import { useEffect, useRef, useState } from 'react';
import {
  cachedAnswer,
  normalize,
  type NormalizeRequest,
} from './normalize-cache';

/** How long after the last key the expression is sent to the database. */
export const NORMALIZE_DELAY_MS = 400;

export type ExpressionState =
  /** Nothing typed, so nothing to ask. */
  | { status: 'idle' }
  /** Typed, and the answer has not come yet (or is waiting for typing to stop). */
  | { status: 'pending' }
  /** The request itself failed, with no answer from Postgres. */
  | { status: 'failed'; message: string }
  | { status: 'done'; answer: NormalizedExpression };

/**
 * Asks the open database for the canonical form of the expression 400 ms after the last change,
 * and calls `onAnswer` with each answer, a cached one included, and with `null` as soon as the
 * text changes, since the answer it had belongs to the text before. The same request is not asked
 * twice.
 */
export function useNormalizedExpression(
  request: NormalizeRequest,
  onAnswer?: (answer: NormalizedExpression | null) => void,
): ExpressionState {
  const [state, setState] = useState<ExpressionState>({ status: 'idle' });
  const latest = useRef(onAnswer);
  latest.current = onAnswer;
  const key = JSON.stringify(request);

  useEffect(() => {
    const finish = (answer: NormalizedExpression) => {
      setState({ status: 'done', answer });
      latest.current?.(answer);
    };
    latest.current?.(null);
    if (request.expression.trim() === '') {
      setState({ status: 'idle' });
      return;
    }
    const earlier = cachedAnswer(request);
    if (earlier) {
      finish(earlier);
      return;
    }
    setState({ status: 'pending' });
    let current = true;
    const timer = setTimeout(() => {
      normalize(request).then(
        (answer) => current && finish(answer),
        (error: unknown) =>
          current &&
          setState({
            status: 'failed',
            message: error instanceof Error ? error.message : String(error),
          }),
      );
    }, NORMALIZE_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
    // the request is read through its key: a new object with the same content is the same request
  }, [key]);

  return state;
}
