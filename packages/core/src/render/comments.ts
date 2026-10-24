import type { ChangeOp } from '../diff/ops';
import type { ModelPair } from '../model/types';
import { quoteIdent, quoteLiteral } from '../sql/quote';
import { columnName, tableRef } from './names';

/** A comment is a string literal; clearing one is `IS NULL`. */
export function renderCommentOp(
  op: Extract<ChangeOp, { kind: 'setComment' }>,
  models: ModelPair,
): string[] {
  const text = op.to === null ? 'NULL' : quoteLiteral(op.to);
  if (op.target.kind === 'table') {
    return [
      `COMMENT ON TABLE ${tableRef(models, op.target.tableId)} IS ${text}`,
    ];
  }
  const column = models.desired.columns[op.target.columnId];
  if (!column) throw new Error(`Unknown column ${op.target.columnId}`);
  const name = quoteIdent(columnName(models, column.id));
  return [
    `COMMENT ON COLUMN ${tableRef(models, column.tableId)}.${name} IS ${text}`,
  ];
}
