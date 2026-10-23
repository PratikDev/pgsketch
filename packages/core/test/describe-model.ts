import { renderPgType } from '../src/sql/pgtype';
import type { SchemaModel } from '../src/model/types';

/** The model with ids replaced by names, so it reads well and is the same on every Postgres. */
export function describeModel(model: SchemaModel) {
  const schema = (id: string) => model.schemas[id]!.name;
  const table = (id: string) =>
    `${schema(model.tables[id]!.schemaId)}.${model.tables[id]!.name}`;
  const column = (id: string) =>
    `${table(model.columns[id]!.tableId)}.${model.columns[id]!.name}`;
  const columns = (ids: string[]) => ids.map((id) => model.columns[id]!.name);
  const sortBy = <T>(items: T[], key: (item: T) => string) =>
    [...items].sort((a, b) => (key(a) < key(b) ? -1 : 1));

  return {
    schemas: sortBy(Object.values(model.schemas), (s) => s.name).map(
      (s) => s.name,
    ),
    tables: sortBy(Object.values(model.tables), (t) => table(t.id)).map(
      (t) => ({
        table: table(t.id),
        comment: t.comment,
        ...(t.readOnly && { readOnly: t.readOnly }),
        columns: sortBy(
          Object.values(model.columns).filter((c) => c.tableId === t.id),
          (c) => String(c.position).padStart(4, '0'),
        ).map((c) => ({
          name: c.name,
          position: c.position,
          type: renderPgType(c.type),
          notNull: c.notNull,
          default: c.default?.expression ?? null,
          identity: c.identity,
          comment: c.comment,
          ...(c.readOnly && { readOnly: c.readOnly }),
        })),
        constraints: sortBy(
          Object.values(model.constraints).filter((k) => k.tableId === t.id),
          (k) => k.name,
        ).map((k) => ({
          name: k.name,
          kind: k.kind,
          columns: columns(k.columnIds),
          ...(k.readOnly && { readOnly: k.readOnly }),
          ...(k.kind === 'check' && { expression: k.expression }),
          ...(k.kind === 'fk' && {
            references: `${table(k.refTableId)}(${columns(k.refColumnIds).join(', ')})`,
            onDelete: k.onDelete,
            onUpdate: k.onUpdate,
          }),
        })),
        indexes: sortBy(
          Object.values(model.indexes).filter((i) => i.tableId === t.id),
          (i) => i.name,
        ).map((i) => ({
          name: i.name,
          unique: i.unique,
          columns: columns(i.columnIds),
          ...(i.readOnly && { readOnly: i.readOnly }),
        })),
      }),
    ),
    enums: sortBy(
      Object.values(model.enums),
      (e) => `${schema(e.schemaId)}.${e.name}`,
    ).map((e) => ({
      enum: `${schema(e.schemaId)}.${e.name}`,
      labels: e.labels,
    })),
    unmodeled: sortBy(
      Object.values(model.unmodeled),
      (u) => `${u.kind}.${u.name}`,
    ).map((u) => ({
      kind: u.kind,
      name: u.name,
      schema: u.schemaId && schema(u.schemaId),
      tables: u.tableIds.map(table).sort(),
      columns: u.columnIds.map(column).sort(),
    })),
  };
}
