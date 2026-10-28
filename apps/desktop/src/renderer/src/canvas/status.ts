import {
  renderPgType,
  type ChangeOp,
  type Id,
  type SchemaModel,
} from '@pgsketch/core';

export type Status = 'added' | 'modified' | 'removed';

/** What a modified object was before, for the hover: only the fields that changed are there. */
export interface OldValues {
  name?: string;
  type?: string;
  notNull?: boolean;
  default?: string | null;
  comment?: string | null;
}

export interface ObjectStatus {
  status: Status;
  old: OldValues;
}

/** The status of every object that has one; an object that isn't in it is unchanged. */
export type StatusMap = Record<Id, ObjectStatus>;

/**
 * What each change does to which object, for the diff highlighting. `baseline` is where the old
 * values come from, since the operations were found against it.
 */
export function statusMapOf(ops: ChangeOp[], baseline: SchemaModel): StatusMap {
  const added = new Set<Id>();
  const removed = new Set<Id>();
  const modified = new Map<Id, OldValues>();
  const modify = (id: Id, old: OldValues) =>
    modified.set(id, { ...modified.get(id), ...old });
  const oldComment = (id: Id) =>
    (baseline.tables[id] ?? baseline.columns[id])?.comment ?? null;

  for (const op of ops) {
    switch (op.kind) {
      case 'createSchema':
        added.add(op.schema.id);
        break;
      case 'createTable':
        added.add(op.table.id);
        op.columns.forEach((c) => added.add(c.id));
        if (op.pk) added.add(op.pk.id);
        break;
      case 'dropTable':
        // what goes with a table has no operation of its own
        removed.add(op.table.id);
        for (const c of Object.values(baseline.columns))
          if (c.tableId === op.table.id) removed.add(c.id);
        for (const k of Object.values(baseline.constraints))
          if (k.tableId === op.table.id) removed.add(k.id);
        for (const i of Object.values(baseline.indexes))
          if (i.tableId === op.table.id) removed.add(i.id);
        break;
      case 'renameTable':
        modify(op.tableId, { name: op.from });
        break;
      case 'addColumn':
        added.add(op.column.id);
        break;
      case 'dropColumn':
        removed.add(op.column.id);
        break;
      case 'renameColumn':
        modify(op.columnId, { name: op.from });
        break;
      case 'alterColumnType':
        modify(op.columnId, { type: renderPgType(op.from) });
        break;
      case 'setNotNull':
        modify(op.columnId, { notNull: false });
        break;
      case 'dropNotNull':
        modify(op.columnId, { notNull: true });
        break;
      case 'setDefault':
      case 'dropDefault':
        modify(op.columnId, {
          default: baseline.columns[op.columnId]?.default?.expression ?? null,
        });
        break;
      case 'addConstraint':
        added.add(op.constraint.id);
        break;
      case 'dropConstraint':
        removed.add(op.constraint.id);
        break;
      case 'renameConstraint':
        modify(op.constraintId, { name: op.from });
        break;
      case 'addIndex':
        added.add(op.index.id);
        break;
      case 'dropIndex':
        removed.add(op.index.id);
        break;
      case 'renameIndex':
        modify(op.indexId, { name: op.from });
        break;
      case 'setComment': {
        const id =
          op.target.kind === 'table' ? op.target.tableId : op.target.columnId;
        modify(id, { comment: oldComment(id) });
        break;
      }
      default: {
        const unreachable: never = op;
        return unreachable;
      }
    }
  }

  const map: StatusMap = {};
  for (const [id, old] of modified) map[id] = { status: 'modified', old };
  for (const id of removed) map[id] = { status: 'removed', old: {} };
  for (const id of added) {
    // dropped and added again, like a key whose columns changed, is one modified object
    map[id] = removed.has(id)
      ? { status: 'modified', old: {} }
      : { status: 'added', old: {} };
  }
  return map;
}
