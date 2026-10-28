import {
  blockersOfColumn,
  type DefaultValue,
  type Id,
  type PgType,
} from '@pgsketch/core';
import type { StateCreator } from 'zustand';
import type { SchemaStore } from '.';
import { removeColumnDependents, restoreColumnDependents } from './cascade';
import { firstFree, nextPosition } from './helpers';

/** What an action that can be refused returns: why not, or `null` when it was done. */
type Refusal = string | null;

const INTEGERS = ['smallint', 'int2', 'integer', 'int4', 'bigint', 'int8'];

export interface ColumnsSlice {
  /** A new nullable `text` column at the end of the table. Returns its id. */
  addColumn: (tableId: Id) => Id;
  renameColumn: (columnId: Id, name: string) => void;
  /** An identity column stays an integer. */
  setColumnType: (columnId: Id, type: PgType) => Refusal;
  /** A column in the primary key or an identity column is always NOT NULL. */
  setNotNull: (columnId: Id, notNull: boolean) => Refusal;
  /**
   * Puts the column in the table's primary key (making one if there is none), which makes it NOT
   * NULL; or takes it out, which leaves it NOT NULL. Never changes the column's type.
   */
  setPrimaryKey: (columnId: Id, primaryKey: boolean) => void;
  /** An identity column takes no default. */
  setColumnDefault: (columnId: Id, value: DefaultValue | null) => Refusal;
  setColumnComment: (columnId: Id, comment: string | null) => void;
  /**
   * Removes a column with what is built on it. Returns why not, if a view or a read-only foreign
   * key elsewhere depends on it.
   */
  removeColumn: (columnId: Id) => Refusal;
  /** Puts a removed column back as it was loaded, with what was built on it. */
  restoreColumn: (columnId: Id) => void;
}

export const createColumnsSlice: StateCreator<
  SchemaStore,
  [],
  [],
  ColumnsSlice
> = (_, get) => {
  /** Changes one column, if it is there. */
  const change = (
    columnId: Id,
    apply: (column: SchemaStore['desired']['columns'][Id]) => void,
  ) => {
    if (!get().desired.columns[columnId]) return;
    get().edit((d) => apply(d.columns[columnId]!));
  };

  const primaryKeyOf = (tableId: Id) =>
    Object.values(get().desired.constraints).find(
      (c) => c.tableId === tableId && c.kind === 'pk',
    );

  return {
    addColumn: (tableId) => {
      const columnId = crypto.randomUUID();
      get().edit((d) => {
        d.columns[columnId] = {
          id: columnId,
          tableId,
          name: firstFree(
            'new_column',
            Object.values(d.columns)
              .filter((c) => c.tableId === tableId)
              .map((c) => c.name),
          ),
          position: nextPosition(d, tableId),
          type: { name: 'text', isArray: false },
          notNull: false,
          default: null,
          identity: null,
          comment: null,
        };
      });
      return columnId;
    },

    renameColumn: (columnId, name) =>
      change(columnId, (column) => void (column.name = name)),

    setColumnType: (columnId, type) => {
      const column = get().desired.columns[columnId];
      if (
        column?.identity &&
        (type.schema !== undefined ||
          type.isArray ||
          !INTEGERS.includes(type.name))
      )
        return `"${column.name}" is an identity column, so it has to be smallint, integer or bigint`;
      change(columnId, (c) => void (c.type = type));
      return null;
    },

    setNotNull: (columnId, notNull) => {
      const column = get().desired.columns[columnId];
      if (column && !notNull) {
        if (column.identity)
          return `"${column.name}" is an identity column, so it can't be nullable`;
        if (primaryKeyOf(column.tableId)?.columnIds.includes(columnId))
          return `"${column.name}" is in the primary key, so it can't be nullable`;
      }
      change(columnId, (c) => void (c.notNull = notNull));
      return null;
    },

    setPrimaryKey: (columnId, primaryKey) => {
      const column = get().desired.columns[columnId];
      if (!column) return;
      get().edit((d) => {
        const key = Object.values(d.constraints).find(
          (c) => c.tableId === column.tableId && c.kind === 'pk',
        );
        if (primaryKey) {
          d.columns[columnId]!.notNull = true;
          if (!key) {
            const id = crypto.randomUUID();
            d.constraints[id] = {
              id,
              tableId: column.tableId,
              kind: 'pk',
              name: '',
              autoName: true,
              columnIds: [columnId],
            };
          } else if (!key.columnIds.includes(columnId)) {
            key.columnIds.push(columnId);
          }
        } else if (key?.columnIds.includes(columnId)) {
          key.columnIds = key.columnIds.filter((id) => id !== columnId);
          if (key.columnIds.length === 0) delete d.constraints[key.id];
        }
      });
    },

    setColumnDefault: (columnId, value) => {
      const column = get().desired.columns[columnId];
      if (column?.identity && value !== null)
        return `"${column.name}" is an identity column, so it can't have a default`;
      change(columnId, (c) => void (c.default = value));
      return null;
    },

    setColumnComment: (columnId, comment) =>
      change(columnId, (column) => void (column.comment = comment)),

    removeColumn: (columnId) => {
      const { baseline, desired, edit } = get();
      const column = desired.columns[columnId];
      if (!column) return null;
      const blockers = blockersOfColumn(baseline, desired, column);
      if (blockers.length > 0)
        return `Can't delete column "${column.name}": ${blockers.join(', ')} still depend${blockers.length === 1 ? 's' : ''} on it`;
      edit((d) => {
        removeColumnDependents(d, columnId);
        delete d.columns[columnId];
      });
      return null;
    },

    restoreColumn: (columnId) => {
      const { baseline, desired, edit } = get();
      const column = baseline.columns[columnId];
      if (
        !column ||
        desired.columns[columnId] ||
        !desired.tables[column.tableId]
      )
        return;
      edit((d) => {
        d.columns[columnId] = structuredClone(column);
        restoreColumnDependents(baseline, d, columnId);
      });
    },
  };
};
