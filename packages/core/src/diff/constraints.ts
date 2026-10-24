import { sameIds } from '../model/lookup';
import type { Constraint, SchemaModel } from '../model/types';
import type { DiffPart } from './ops';

/** Whether two constraints are the same in everything but their name. */
export function sameConstraintDefinition(
  a: Constraint,
  b: Constraint,
): boolean {
  if (
    a.kind !== b.kind ||
    a.tableId !== b.tableId ||
    !sameIds(a.columnIds, b.columnIds)
  )
    return false;
  if (a.kind === 'check' && b.kind === 'check')
    return a.expression === b.expression;
  if (a.kind === 'fk' && b.kind === 'fk') {
    return (
      a.refTableId === b.refTableId &&
      sameIds(a.refColumnIds, b.refColumnIds) &&
      a.onDelete === b.onDelete &&
      a.onUpdate === b.onUpdate
    );
  }
  return true;
}

/**
 * Constraints on tables that exist before and after, plus the new ones on tables being created
 * (a new table's primary key is part of its `createTable`). Postgres can't alter a constraint, so
 * a changed one is dropped and added again; a renamed one keeps its id and is a rename. A dropped
 * table takes its constraints with it.
 */
export function diffConstraints(
  baseline: SchemaModel,
  desired: SchemaModel,
): DiffPart {
  const part: DiffPart = { ops: [], errors: [] };
  for (const constraint of Object.values(desired.constraints)) {
    if (baseline.constraints[constraint.id]) continue;
    const tableIsNew = !baseline.tables[constraint.tableId];
    if (tableIsNew && constraint.kind === 'pk') continue;
    part.ops.push({ kind: 'addConstraint', constraint });
  }
  for (const before of Object.values(baseline.constraints)) {
    if (!desired.tables[before.tableId]) continue;
    const after = desired.constraints[before.id];
    if (!after) {
      part.ops.push({ kind: 'dropConstraint', constraint: before });
    } else if (!sameConstraintDefinition(before, after)) {
      part.ops.push(
        { kind: 'dropConstraint', constraint: before },
        { kind: 'addConstraint', constraint: after },
      );
    } else if (before.name !== after.name) {
      part.ops.push({
        kind: 'renameConstraint',
        constraintId: before.id,
        from: before.name,
        to: after.name,
      });
    }
  }
  return part;
}
