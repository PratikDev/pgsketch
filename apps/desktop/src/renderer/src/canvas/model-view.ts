import type {
  Column,
  Constraint,
  Id,
  PgType,
  SchemaModel,
} from '@pgsketch/core';
import { stateOf, type ObjectState, type StateSources } from './object-state';

/**
 * Everything the canvas draws: the loaded schema and the edited one together. What the user
 * removed is still in the loaded schema, so it stays on the canvas (struck through, restorable);
 * what was edited or added comes from the edited one.
 */
export function unionOf(
  baseline: SchemaModel,
  desired: SchemaModel,
): SchemaModel {
  return {
    schemas: { ...baseline.schemas, ...desired.schemas },
    tables: { ...baseline.tables, ...desired.tables },
    columns: { ...baseline.columns, ...desired.columns },
    constraints: { ...baseline.constraints, ...desired.constraints },
    indexes: { ...baseline.indexes, ...desired.indexes },
    enums: { ...baseline.enums, ...desired.enums },
    unmodeled: { ...baseline.unmodeled, ...desired.unmodeled },
  };
}

export type ColumnView = {
  id: Id;
  tableId: Id;
  name: string;
  type: string;
  /** The type itself, which `type` is the label of. */
  pgType: PgType;
  primaryKey: boolean;
  notNull: boolean;
  identity: boolean;
  /** The only column of a unique constraint. */
  unique: boolean;
  /** The default as SQL, without `=`. */
  default: string | null;
  /** The columns its foreign keys point at, like `users.id`. */
  references: string[];
  state: ObjectState;
};

export type TableView = {
  id: Id;
  schemaId: Id;
  schema: string;
  name: string;
  columns: ColumnView[];
  state: ObjectState;
};

/** A type as people write it: no quotes, no schema for `public`. */
export function typeLabel(type: PgType): string {
  const name =
    type.schema === undefined || type.schema === 'public'
      ? type.name
      : `${type.schema}.${type.name}`;
  const params = type.params?.length ? `(${type.params.join(',')})` : '';
  return `${name}${params}${type.isArray ? '[]' : ''}`;
}

/** `table.column`, with the schema in front when it isn't the one the foreign key is in. */
function targetOf(model: SchemaModel, fromSchema: Id, columnId: Id): string {
  const column = model.columns[columnId];
  const table = column && model.tables[column.tableId];
  if (!column || !table) return columnId;
  const schema = model.schemas[table.schemaId];
  const prefix =
    table.schemaId === fromSchema || !schema ? '' : `${schema.name}.`;
  return `${prefix}${table.name}.${column.name}`;
}

/** The tables of a model as the canvas shows them, in schema and table name order, with the status the diff and the validation give each table and column. */
export function tableViews(
  model: SchemaModel,
  sources?: StateSources,
): TableView[] {
  const constraints = Object.values(model.constraints);
  const keyColumns = new Set(
    constraints.filter((c) => c.kind === 'pk').flatMap((c) => c.columnIds),
  );
  const uniqueColumns = new Set(
    constraints
      .filter((c) => c.kind === 'unique' && c.columnIds.length === 1)
      .flatMap((c) => c.columnIds),
  );
  const foreignKeys = constraints.filter(
    (c): c is Extract<Constraint, { kind: 'fk' }> => c.kind === 'fk',
  );

  const columnView = (column: Column, schemaId: Id): ColumnView => ({
    id: column.id,
    tableId: column.tableId,
    name: column.name,
    type: typeLabel(column.type),
    pgType: column.type,
    primaryKey: keyColumns.has(column.id),
    notNull: column.notNull,
    identity: column.identity !== null,
    unique: uniqueColumns.has(column.id),
    default: column.default?.expression ?? null,
    references: foreignKeys.flatMap((fk) => {
      const i = fk.columnIds.indexOf(column.id);
      const target = i < 0 ? undefined : fk.refColumnIds[i];
      return target === undefined ? [] : [targetOf(model, schemaId, target)];
    }),
    state: stateOf(column.id, column.readOnly, sources),
  });

  return Object.values(model.tables)
    .map((table) => ({
      id: table.id,
      schemaId: table.schemaId,
      schema: model.schemas[table.schemaId]?.name ?? '',
      name: table.name,
      state: stateOf(table.id, table.readOnly, sources),
      columns: Object.values(model.columns)
        .filter((c) => c.tableId === table.id)
        .sort((a, b) => a.position - b.position)
        .map((c) => columnView(c, table.schemaId)),
    }))
    .sort((a, b) =>
      `${a.schema}.${a.name}` < `${b.schema}.${b.name}` ? -1 : 1,
    );
}
