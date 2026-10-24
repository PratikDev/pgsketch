import type { ChangeOp } from '../diff/ops';
import type { ModelPair } from '../model/types';

/** The twelve stages of a migration, in the order they run. */
export type Phase = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

export interface OrderedOp {
  phase: Phase;
  op: ChangeOp;
}

/**
 * Where an operation runs, so that every statement finds what it needs: schemas first, then the
 * foreign keys and other constraints and indexes that are going away, renames, new tables, column
 * changes, dropped columns and tables, new constraints and indexes, foreign keys last (every
 * table exists by then), and comments at the end.
 */
function phaseOf(op: ChangeOp): Phase {
  switch (op.kind) {
    case 'createSchema':
      return 1;
    case 'dropConstraint':
      return op.constraint.kind === 'fk' ? 2 : 3;
    case 'dropIndex':
      return 3;
    case 'renameTable':
    case 'renameColumn':
    case 'renameConstraint':
    case 'renameIndex':
      return 4;
    case 'createTable':
      return 5;
    case 'addColumn':
      return 6;
    case 'alterColumnType':
    case 'setDefault':
    case 'dropDefault':
    case 'setNotNull':
    case 'dropNotNull':
      return 7;
    case 'dropColumn':
      return 8;
    case 'dropTable':
      return 9;
    case 'addConstraint':
      return op.constraint.kind === 'fk' ? 11 : 10;
    case 'addIndex':
      return 10;
    case 'setComment':
      return 12;
    default: {
      const unreachable: never = op;
      return unreachable;
    }
  }
}

/** Renames run tables first, then columns, constraints and indexes, which refer to the new table names. */
const RENAME_GROUP = {
  renameTable: 0,
  renameColumn: 1,
  renameConstraint: 2,
  renameIndex: 3,
} as const;

/** Statements for one column run as type, default, nullability. */
const COLUMN_STEP = {
  alterColumnType: 0,
  setDefault: 1,
  dropDefault: 1,
  setNotNull: 2,
  dropNotNull: 2,
} as const;

/**
 * Puts the operations in migration order: by phase, then by qualified name, so the same changes
 * always give the same statements whatever order they were found in. The name is only a sort key
 * (`schema.table.column`), built from the edited model where the object still exists and from the
 * loaded one where it doesn't; the operation kind breaks any remaining tie.
 */
export function orderOps(
  ops: ChangeOp[],
  { baseline, desired }: ModelPair,
): OrderedOp[] {
  const schemaName = (id: string) =>
    (desired.schemas[id] ?? baseline.schemas[id])?.name ?? id;
  const tableLabel = (id: string) => {
    const table = desired.tables[id] ?? baseline.tables[id];
    return table ? `${schemaName(table.schemaId)}.${table.name}` : id;
  };
  const columnLabel = (id: string) => {
    const column = desired.columns[id] ?? baseline.columns[id];
    return column ? `${tableLabel(column.tableId)}.${column.name}` : id;
  };
  const constraintLabel = (id: string) => {
    const constraint = desired.constraints[id] ?? baseline.constraints[id];
    return constraint
      ? `${tableLabel(constraint.tableId)}.${constraint.name}`
      : id;
  };
  const indexLabel = (id: string) => {
    const index = desired.indexes[id] ?? baseline.indexes[id];
    const table =
      index &&
      (desired.tables[index.tableId] ?? baseline.tables[index.tableId]);
    return index && table ? `${schemaName(table.schemaId)}.${index.name}` : id;
  };

  const label = (op: ChangeOp): string => {
    switch (op.kind) {
      case 'createSchema':
        return op.schema.name;
      case 'createTable':
      case 'dropTable':
        return `${schemaName(op.table.schemaId)}.${op.table.name}`;
      case 'renameTable':
        return tableLabel(op.tableId);
      case 'addColumn':
      case 'dropColumn':
        return columnLabel(op.column.id);
      case 'renameColumn':
      case 'alterColumnType':
      case 'setNotNull':
      case 'dropNotNull':
      case 'setDefault':
      case 'dropDefault':
        return columnLabel(op.columnId);
      case 'addConstraint':
      case 'dropConstraint':
        return `${tableLabel(op.constraint.tableId)}.${op.constraint.name}`;
      case 'renameConstraint':
        return constraintLabel(op.constraintId);
      case 'addIndex':
      case 'dropIndex':
        return indexLabel(op.index.id);
      case 'renameIndex':
        return indexLabel(op.indexId);
      case 'setComment':
        return op.target.kind === 'table'
          ? tableLabel(op.target.tableId)
          : columnLabel(op.target.columnId);
      default: {
        const unreachable: never = op;
        return unreachable;
      }
    }
  };

  const group = (op: ChangeOp) =>
    op.kind in RENAME_GROUP
      ? RENAME_GROUP[op.kind as keyof typeof RENAME_GROUP]
      : 0;
  const step = (op: ChangeOp) =>
    op.kind in COLUMN_STEP
      ? COLUMN_STEP[op.kind as keyof typeof COLUMN_STEP]
      : 0;

  return ops
    .map((op) => {
      const phase = phaseOf(op);
      return {
        phase,
        op,
        key: `${String(phase).padStart(2, '0')}\0${group(op)}\0${label(op)}\0${step(op)}\0${op.kind}`,
      };
    })
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(({ phase, op }) => ({ phase, op }));
}
