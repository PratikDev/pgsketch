import type {
  ExpressionColumn,
  ExpressionTarget,
  NormalizedExpression,
} from '@pgsketch/core';
import { toast } from 'sonner';
import { api } from '@/api';
import { schemaStore } from '@/stores/schema';
import { uiStore } from '@/stores/ui';

export interface NormalizeRequest {
  expression: string;
  target: ExpressionTarget;
  /** Every column of the table, pending ones included. */
  columns: ExpressionColumn[];
}

/**
 * What Postgres said, by request. The key has the fingerprint of the loaded schema in it, so
 * nothing outlives a reload of the database it was asked of. Requests in flight are kept too, so
 * asking the same thing twice at once asks once.
 */
const asked = new Map<string, Promise<NormalizedExpression>>();
const answered = new Map<string, NormalizedExpression>();

const keyOf = (r: NormalizeRequest): string =>
  JSON.stringify([
    schemaStore.getState().loadedFingerprint,
    r.expression.trim(),
    r.target,
    r.columns,
  ]);

/** The answer to a request that has been asked before, if there is one. */
export const cachedAnswer = (r: NormalizeRequest) => answered.get(keyOf(r));

/** The canonical form of an expression, from the open database, or the earlier answer to the same request. */
export function normalize(r: NormalizeRequest): Promise<NormalizedExpression> {
  const key = keyOf(r);
  const earlier = asked.get(key);
  if (earlier) return earlier;
  const request = api.expr.normalize(r).then((answer) => {
    answered.set(key, answer);
    if (answer.status === 'raw' && !uiStore.getState().normalizationFallback) {
      uiStore.getState().setNormalizationFallback();
      toast.warning(
        "This database role can't create temporary tables, so expressions are kept as typed and may show up as changes that aren't. Check constraints can't be edited.",
        { id: 'normalization-fallback', duration: Infinity },
      );
    }
    return answer;
  });
  asked.set(key, request);
  // a request that failed is not remembered: asking again may work
  request.catch(() => asked.delete(key));
  return request;
}

/** Forgets every answer; for tests. */
export function clearNormalizeCache(): void {
  asked.clear();
  answered.clear();
}
