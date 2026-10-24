import type { ChangeOp } from '../diff/ops';
import type { Constraint, FkAction, ModelPair } from '../model/types';
import { quoteIdent } from '../sql/quote';
import { columnName, tableRef } from './names';

type ConstraintOp = Extract<
  ChangeOp,
  { kind: 'addConstraint' | 'renameConstraint' | 'dropConstraint' }
>;

const ACTIONS: Record<FkAction, string> = {
  'no action': 'NO ACTION',
  restrict: 'RESTRICT',
  cascade: 'CASCADE',
  'set null': 'SET NULL',
  'set default': 'SET DEFAULT',
};

const names = (models: ModelPair, columnIds: string[]) =>
  columnIds.map((id) => quoteIdent(columnName(models, id))).join(', ');

/** NO ACTION is what Postgres does anyway, so it is left out. */
const action = (clause: string, value: FkAction) =>
  value === 'no action' ? '' : ` ${clause} ${ACTIONS[value]}`;

function definition(constraint: Constraint, models: ModelPair): string {
  switch (constraint.kind) {
    case 'pk':
      return `PRIMARY KEY (${names(models, constraint.columnIds)})`;
    case 'unique':
      return `UNIQUE (${names(models, constraint.columnIds)})`;
    // the expression is already normalized by the database; parentheses keep `a > 0 AND b > 0` one expression
    case 'check':
      return `CHECK (${constraint.expression})`;
    case 'fk':
      return (
        `FOREIGN KEY (${names(models, constraint.columnIds)}) ` +
        `REFERENCES ${tableRef(models, constraint.refTableId)} (${names(models, constraint.refColumnIds)})` +
        action('ON DELETE', constraint.onDelete) +
        action('ON UPDATE', constraint.onUpdate)
      );
    case 'exclusion':
      throw new Error(
        `Exclusion constraint "${constraint.name}" is read-only and can't be created`,
      );
  }
}

/**
 * Dropping runs before the renames, so the table has its old name; adding and renaming run after
 * them and use the new ones. A constraint is dropped by name only: it never needs CASCADE,
 * because foreign keys that depended on a key were dropped first.
 */
export function renderConstraintOp(
  op: ConstraintOp,
  models: ModelPair,
): string[] {
  switch (op.kind) {
    case 'dropConstraint':
      return [
        `ALTER TABLE ${tableRef(models, op.constraint.tableId, 'baseline')} DROP CONSTRAINT ${quoteIdent(op.constraint.name)}`,
      ];
    case 'renameConstraint': {
      const tableId = models.desired.constraints[op.constraintId]?.tableId;
      if (!tableId) throw new Error(`Unknown constraint ${op.constraintId}`);
      return [
        `ALTER TABLE ${tableRef(models, tableId)} RENAME CONSTRAINT ${quoteIdent(op.from)} TO ${quoteIdent(op.to)}`,
      ];
    }
    case 'addConstraint':
      return [
        `ALTER TABLE ${tableRef(models, op.constraint.tableId)} ADD CONSTRAINT ${quoteIdent(op.constraint.name)} ${definition(op.constraint, models)}`,
      ];
  }
}
