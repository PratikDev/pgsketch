import { randomUUID } from 'node:crypto';
import type {
  Column,
  FkAction,
  Id,
  SchemaModel,
  Table,
} from '../src/model/types';
import { parsePgType } from '../src/sql/pgtype';

/** A column to create. `type` is the text a user would pick, like `integer` or `varchar(20)`. */
export interface ColumnSpec {
  name: string;
  type: string;
  notNull?: boolean;
  /** The SQL as Postgres prints it back, like `0` or `'new'::text`. */
  default?: string;
  identity?: 'always' | 'byDefault';
}

/** A table written as `schema.table`; none of the names used in tests contain a dot. */
type TableRef = string;

/** One edit of the model by names, the way the editor would make it. */
export type Edit =
  | { kind: 'addSchema'; name: string }
  | {
      kind: 'addTable';
      table: TableRef;
      columns: ColumnSpec[];
      pk?: string[];
    }
  | { kind: 'dropTable'; table: TableRef }
  | { kind: 'renameTable'; table: TableRef; to: string }
  | { kind: 'setTableComment'; table: TableRef; comment: string | null }
  | { kind: 'addColumn'; table: TableRef; column: ColumnSpec }
  | { kind: 'dropColumn'; table: TableRef; column: string }
  | { kind: 'renameColumn'; table: TableRef; column: string; to: string }
  | { kind: 'setType'; table: TableRef; column: string; type: string }
  | { kind: 'setNotNull'; table: TableRef; column: string; notNull: boolean }
  | {
      kind: 'setDefault';
      table: TableRef;
      column: string;
      default: string | null;
    }
  | {
      kind: 'setColumnComment';
      table: TableRef;
      column: string;
      comment: string | null;
    }
  | { kind: 'addUnique'; table: TableRef; columns: string[] }
  | { kind: 'addIndex'; table: TableRef; columns: string[]; unique?: boolean }
  | {
      kind: 'addForeignKey';
      table: TableRef;
      columns: string[];
      references: TableRef;
      referencedColumns: string[];
      onDelete?: FkAction;
    }
  | { kind: 'dropConstraint'; table: TableRef; name: string }
  | { kind: 'renameConstraint'; table: TableRef; name: string; to: string }
  | { kind: 'dropIndex'; index: string }
  | { kind: 'renameIndex'; index: string; to: string };

const newId = (): Id => `new:${randomUUID()}`;

function tableNamed(model: SchemaModel, ref: TableRef): Table {
  const [schemaName, name] = ref.split('.');
  const table = Object.values(model.tables).find(
    (t) => t.name === name && model.schemas[t.schemaId]?.name === schemaName,
  );
  if (!table) throw new Error(`No table ${ref}`);
  return table;
}

function columnNamed(model: SchemaModel, ref: TableRef, name: string): Column {
  const tableId = tableNamed(model, ref).id;
  const column = Object.values(model.columns).find(
    (c) => c.tableId === tableId && c.name === name,
  );
  if (!column) throw new Error(`No column ${ref}.${name}`);
  return column;
}

const columnIdsNamed = (model: SchemaModel, ref: TableRef, names: string[]) =>
  names.map((name) => columnNamed(model, ref, name).id);

/** A new column; identity and keys imply NOT NULL, and identity takes no default. */
function newColumn(
  tableId: Id,
  spec: ColumnSpec,
  position: number,
  pkColumns: string[] = [],
): Column {
  return {
    id: newId(),
    tableId,
    name: spec.name,
    position,
    type: parsePgType(spec.type),
    notNull:
      spec.notNull === true ||
      spec.identity !== undefined ||
      pkColumns.includes(spec.name),
    default:
      spec.default === undefined || spec.identity !== undefined
        ? null
        : { kind: 'expression', expression: spec.default },
    identity: spec.identity ?? null,
    comment: null,
  };
}

const nextPosition = (model: SchemaModel, tableId: Id) =>
  1 +
  Math.max(
    0,
    ...Object.values(model.columns)
      .filter((c) => c.tableId === tableId)
      .map((c) => c.position),
  );

/** What removing columns takes with it: constraints and indexes that use them, and foreign keys that point at them. */
function removeColumns(model: SchemaModel, ids: Id[]): void {
  const gone = new Set(ids);
  for (const [id, c] of Object.entries(model.constraints)) {
    if (
      c.columnIds.some((x) => gone.has(x)) ||
      (c.kind === 'fk' && c.refColumnIds.some((x) => gone.has(x)))
    )
      delete model.constraints[id];
  }
  for (const [id, i] of Object.entries(model.indexes)) {
    if (i.columnIds.some((x) => gone.has(x))) delete model.indexes[id];
  }
  for (const id of gone) delete model.columns[id];
}

function removeTable(model: SchemaModel, table: Table): void {
  for (const [id, c] of Object.entries(model.constraints)) {
    if (c.kind === 'fk' && c.refTableId === table.id)
      delete model.constraints[id];
  }
  removeColumns(
    model,
    Object.values(model.columns)
      .filter((c) => c.tableId === table.id)
      .map((c) => c.id),
  );
  delete model.tables[table.id];
}

function constraintNamed(model: SchemaModel, ref: TableRef, name: string) {
  const tableId = tableNamed(model, ref).id;
  const constraint = Object.values(model.constraints).find(
    (c) => c.tableId === tableId && c.name === name,
  );
  if (!constraint) throw new Error(`No constraint ${ref}.${name}`);
  return constraint;
}

function indexNamed(model: SchemaModel, ref: string) {
  const [schemaName, name] = ref.split('.');
  const index = Object.values(model.indexes).find(
    (i) =>
      i.name === name &&
      model.schemas[model.tables[i.tableId]?.schemaId ?? '']?.name ===
        schemaName,
  );
  if (!index) throw new Error(`No index ${ref}`);
  return index;
}

/** Edits `model` in place. A constraint or index created here is auto-named, like the editor does. */
export function applyEdit(model: SchemaModel, edit: Edit): void {
  switch (edit.kind) {
    case 'addSchema': {
      const id = newId();
      model.schemas[id] = { id, name: edit.name };
      return;
    }
    case 'addTable': {
      const [schemaName, name] = edit.table.split('.');
      const schema = Object.values(model.schemas).find(
        (s) => s.name === schemaName,
      );
      if (!schema) throw new Error(`No schema ${schemaName}`);
      const table: Table = {
        id: newId(),
        schemaId: schema.id,
        name: name!,
        comment: null,
      };
      model.tables[table.id] = table;
      const columns = edit.columns.map((spec, i) =>
        newColumn(table.id, spec, i + 1, edit.pk),
      );
      for (const column of columns) model.columns[column.id] = column;
      if (edit.pk) {
        const id = newId();
        model.constraints[id] = {
          id,
          tableId: table.id,
          kind: 'pk',
          name: '',
          autoName: true,
          columnIds: edit.pk.map((n) => columns.find((c) => c.name === n)!.id),
        };
      }
      return;
    }
    case 'dropTable':
      return removeTable(model, tableNamed(model, edit.table));
    case 'renameTable':
      tableNamed(model, edit.table).name = edit.to;
      return;
    case 'setTableComment':
      tableNamed(model, edit.table).comment = edit.comment;
      return;
    case 'addColumn': {
      const tableId = tableNamed(model, edit.table).id;
      const column = newColumn(
        tableId,
        edit.column,
        nextPosition(model, tableId),
      );
      model.columns[column.id] = column;
      return;
    }
    case 'dropColumn':
      return removeColumns(model, [
        columnNamed(model, edit.table, edit.column).id,
      ]);
    case 'renameColumn':
      columnNamed(model, edit.table, edit.column).name = edit.to;
      return;
    case 'setType':
      columnNamed(model, edit.table, edit.column).type = parsePgType(edit.type);
      return;
    case 'setNotNull':
      columnNamed(model, edit.table, edit.column).notNull = edit.notNull;
      return;
    case 'setDefault':
      columnNamed(model, edit.table, edit.column).default =
        edit.default === null
          ? null
          : { kind: 'expression', expression: edit.default };
      return;
    case 'setColumnComment':
      columnNamed(model, edit.table, edit.column).comment = edit.comment;
      return;
    case 'addUnique': {
      const id = newId();
      model.constraints[id] = {
        id,
        tableId: tableNamed(model, edit.table).id,
        kind: 'unique',
        name: '',
        autoName: true,
        columnIds: columnIdsNamed(model, edit.table, edit.columns),
      };
      return;
    }
    case 'addIndex': {
      const id = newId();
      model.indexes[id] = {
        id,
        tableId: tableNamed(model, edit.table).id,
        name: '',
        autoName: true,
        unique: edit.unique ?? false,
        columnIds: columnIdsNamed(model, edit.table, edit.columns),
      };
      return;
    }
    case 'addForeignKey': {
      const id = newId();
      model.constraints[id] = {
        id,
        tableId: tableNamed(model, edit.table).id,
        kind: 'fk',
        name: '',
        autoName: true,
        columnIds: columnIdsNamed(model, edit.table, edit.columns),
        refTableId: tableNamed(model, edit.references).id,
        refColumnIds: columnIdsNamed(
          model,
          edit.references,
          edit.referencedColumns,
        ),
        onDelete: edit.onDelete ?? 'no action',
        onUpdate: 'no action',
      };
      return;
    }
    case 'dropConstraint':
      delete model.constraints[
        constraintNamed(model, edit.table, edit.name).id
      ];
      return;
    case 'renameConstraint':
      constraintNamed(model, edit.table, edit.name).name = edit.to;
      return;
    case 'dropIndex':
      delete model.indexes[indexNamed(model, edit.index).id];
      return;
    case 'renameIndex':
      indexNamed(model, edit.index).name = edit.to;
      return;
    default: {
      const unreachable: never = edit;
      return unreachable;
    }
  }
}

export function applyEdits(model: SchemaModel, edits: Edit[]): void {
  for (const edit of edits) applyEdit(model, edit);
}
