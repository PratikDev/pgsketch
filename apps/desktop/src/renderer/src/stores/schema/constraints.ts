import type { FkAction, Id } from '@pgsketch/core';
import type { StateCreator } from 'zustand';
import type { SchemaStore } from '.';
import { constraintConnected } from './cascade';

export interface ConstraintsSlice {
  /** Adds or removes the unique constraint on just this column. */
  setUnique: (columnId: Id, unique: boolean) => void;
  /** A foreign key between columns of any two tables, the same table included. Returns its id. */
  addForeignKey: (key: {
    tableId: Id;
    columnIds: Id[];
    refTableId: Id;
    refColumnIds: Id[];
  }) => Id;
  setForeignKeyActions: (
    constraintId: Id,
    actions: { onDelete?: FkAction; onUpdate?: FkAction },
  ) => void;
  /** A check with the expression and the columns it uses, as the database normalized them. Returns its id. */
  addCheck: (tableId: Id, check: { expression: string; columnIds: Id[] }) => Id;
  /** Naming a constraint yourself stops its name following the table and columns. */
  renameConstraint: (constraintId: Id, name: string) => void;
  removeConstraint: (constraintId: Id) => void;
  /** Puts a removed constraint back as it was loaded, if what it is built on is there. */
  restoreConstraint: (constraintId: Id) => void;
}

export const createConstraintsSlice: StateCreator<
  SchemaStore,
  [],
  [],
  ConstraintsSlice
> = (_, get) => ({
  setUnique: (columnId, unique) => {
    const column = get().desired.columns[columnId];
    if (!column) return;
    get().edit((d) => {
      const existing = Object.values(d.constraints).find(
        (c) =>
          c.kind === 'unique' &&
          c.columnIds.length === 1 &&
          c.columnIds[0] === columnId,
      );
      if (unique && !existing) {
        const id = crypto.randomUUID();
        d.constraints[id] = {
          id,
          tableId: column.tableId,
          kind: 'unique',
          name: '',
          autoName: true,
          columnIds: [columnId],
        };
      } else if (!unique && existing) {
        delete d.constraints[existing.id];
      }
    });
  },

  addForeignKey: ({ tableId, columnIds, refTableId, refColumnIds }) => {
    const id = crypto.randomUUID();
    get().edit((d) => {
      d.constraints[id] = {
        id,
        tableId,
        kind: 'fk',
        name: '',
        autoName: true,
        columnIds,
        refTableId,
        refColumnIds,
        onDelete: 'no action',
        onUpdate: 'no action',
      };
    });
    return id;
  },

  setForeignKeyActions: (constraintId, actions) => {
    if (get().desired.constraints[constraintId]?.kind !== 'fk') return;
    get().edit((d) => {
      const key = d.constraints[constraintId];
      if (key?.kind !== 'fk') return;
      key.onDelete = actions.onDelete ?? key.onDelete;
      key.onUpdate = actions.onUpdate ?? key.onUpdate;
    });
  },

  addCheck: (tableId, { expression, columnIds }) => {
    const id = crypto.randomUUID();
    get().edit((d) => {
      d.constraints[id] = {
        id,
        tableId,
        kind: 'check',
        name: '',
        autoName: true,
        columnIds,
        expression,
      };
    });
    return id;
  },

  renameConstraint: (constraintId, name) => {
    if (!get().desired.constraints[constraintId]) return;
    get().edit((d) => {
      const c = d.constraints[constraintId];
      if (!c) return;
      c.name = name;
      c.autoName = false;
    });
  },

  removeConstraint: (constraintId) => {
    if (!get().desired.constraints[constraintId]) return;
    get().edit((d) => void delete d.constraints[constraintId]);
  },

  restoreConstraint: (constraintId) => {
    const { baseline, desired, edit } = get();
    const constraint = baseline.constraints[constraintId];
    if (
      !constraint ||
      desired.constraints[constraintId] ||
      !constraintConnected(desired, constraint)
    )
      return;
    edit((d) => {
      d.constraints[constraintId] = structuredClone(constraint);
    });
  },
});
