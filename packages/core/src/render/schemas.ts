import type { ChangeOp } from '../diff/ops';
import { quoteIdent } from '../sql/quote';

export function renderSchemaOp(
  op: Extract<ChangeOp, { kind: 'createSchema' }>,
): string[] {
  return [`CREATE SCHEMA ${quoteIdent(op.schema.name)}`];
}
