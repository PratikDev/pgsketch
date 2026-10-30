import type { DefaultValue, ExpressionColumn } from '@pgsketch/core';
import { normalize } from '@/editors/ExpressionInput/normalize-cache';
import { showRefusal } from '@/lib/refusal';
import { schemaStore } from '@/stores/schema';

/**
 * Sets the default of a column to an expression, in the form Postgres reads it back as (asked of
 * the database, or remembered from an earlier ask), so that the diff has nothing false to find.
 * Resolves to why not, if the expression is wrong or the store refuses it, and `null` when it is set.
 */
export async function applyDefault(
  columnId: string,
  columns: ExpressionColumn[],
  value:
    | { kind: 'preset'; preset: string; expression: string }
    | { kind: 'constant' | 'expression'; expression: string },
): Promise<string | null> {
  const answer = await normalize({
    expression: value.expression,
    target: { kind: 'default', columnId },
    columns,
  });
  if (answer.status === 'invalid') return answer.message;
  const normalized: DefaultValue = { ...value, expression: answer.expression };
  const refusal = schemaStore.getState().setColumnDefault(columnId, normalized);
  showRefusal(refusal);
  return refusal;
}
