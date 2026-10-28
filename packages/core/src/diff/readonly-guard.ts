import type { ValidationError } from '../model/errors';
import type { Column, Id, SchemaModel, Table } from '../model/types';
import type { ChangeOp, DiffPart } from './ops';

// Sequences behind a column go with it, and foreign tables depend on nothing, so neither blocks.
const BLOCKING_KINDS = [
  'view',
  'materialized-view',
  'policy',
  'trigger',
  'function',
];

/** What depends on a column, outside what drops with it: views, policies, triggers, other tables' read-only FKs. */
export function blockersOfColumn(
  baseline: SchemaModel,
  desired: SchemaModel,
  column: Column,
): string[] {
  const names = Object.values(baseline.unmodeled)
    .filter(
      (o) => BLOCKING_KINDS.includes(o.kind) && o.columnIds.includes(column.id),
    )
    .map((o) => `${o.kind} "${o.name}"`);
  for (const c of Object.values(baseline.constraints)) {
    // a read-only FK on the same table goes with the column; one on a table that stays blocks it
    if (
      c.kind === 'fk' &&
      c.readOnly &&
      c.tableId !== column.tableId &&
      desired.tables[c.tableId] &&
      c.refColumnIds.includes(column.id)
    ) {
      names.push(`foreign key "${c.name}"`);
    }
  }
  return names;
}

/** The same for a table. A trigger or policy on the table itself drops with it; one on another table that reads it does not. */
export function blockersOfTable(
  baseline: SchemaModel,
  desired: SchemaModel,
  table: Table,
): string[] {
  const names = Object.values(baseline.unmodeled)
    .filter(
      (o) =>
        BLOCKING_KINDS.includes(o.kind) &&
        o.tableIds.includes(table.id) &&
        o.ownerTableId !== table.id,
    )
    .map((o) => `${o.kind} "${o.name}"`);
  for (const c of Object.values(baseline.constraints)) {
    if (
      c.kind === 'fk' &&
      c.readOnly &&
      c.refTableId === table.id &&
      c.tableId !== table.id &&
      desired.tables[c.tableId]
    ) {
      names.push(`foreign key "${c.name}"`);
    }
  }
  return names;
}

/**
 * Read-only objects are never modified or recreated, and are only dropped together with their own
 * table or column. This takes the operations the other diffs produced and removes the ones that
 * would break that, reporting each as a blocking error: changing a read-only object, or dropping
 * a table or column something read-only still depends on (a view, a policy, another table's FK).
 */
export function guardReadOnly(
  baseline: SchemaModel,
  desired: SchemaModel,
  ops: ChangeOp[],
): DiffPart {
  const errors = new Map<string, ValidationError>();
  const nameOf = (id: Id) =>
    (
      baseline.tables[id] ??
      baseline.columns[id] ??
      baseline.constraints[id] ??
      baseline.indexes[id]
    )?.name ?? id;
  const isReadOnly = (id: Id) =>
    Boolean(
      (
        baseline.tables[id] ??
        baseline.columns[id] ??
        baseline.constraints[id] ??
        baseline.indexes[id]
      )?.readOnly,
    );

  const changed = (id: Id): boolean => {
    if (!isReadOnly(id)) return false;
    errors.set(`changed:${id}`, {
      code: 'read-only-changed',
      objectId: id,
      message: `"${nameOf(id)}" is read-only and can't be changed`,
    });
    return true;
  };
  const blocked = (id: Id, what: string, blockers: string[]): boolean => {
    if (blockers.length === 0) return false;
    errors.set(`dependency:${id}`, {
      code: 'read-only-dependency',
      objectId: id,
      message: `Can't drop ${what}: ${blockers.join(', ')} still depend${blockers.length === 1 ? 's' : ''} on it`,
    });
    return true;
  };

  const kept = ops.filter((op) => {
    switch (op.kind) {
      case 'renameTable':
        return !changed(op.tableId);
      case 'renameColumn':
      case 'alterColumnType':
      case 'setNotNull':
      case 'dropNotNull':
      case 'setDefault':
      case 'dropDefault':
        return !changed(op.columnId);
      case 'renameConstraint':
        return !changed(op.constraintId);
      case 'renameIndex':
        return !changed(op.indexId);
      case 'setComment':
        return !changed(
          op.target.kind === 'table' ? op.target.tableId : op.target.columnId,
        );
      // dropped and added again means changed; just dropped (gone from the edited model) is fine
      case 'dropConstraint':
        return !(
          desired.constraints[op.constraint.id] && changed(op.constraint.id)
        );
      case 'dropIndex':
        return !(desired.indexes[op.index.id] && changed(op.index.id));
      case 'addConstraint':
        return !(
          baseline.constraints[op.constraint.id] && changed(op.constraint.id)
        );
      case 'addIndex':
        return !(baseline.indexes[op.index.id] && changed(op.index.id));
      case 'dropColumn':
        return !blocked(
          op.column.id,
          `column "${op.column.name}"`,
          blockersOfColumn(baseline, desired, op.column),
        );
      case 'dropTable':
        return !blocked(
          op.table.id,
          `table "${op.table.name}"`,
          blockersOfTable(baseline, desired, op.table),
        );
      default:
        return true;
    }
  });
  return { ops: kept, errors: [...errors.values()] };
}
