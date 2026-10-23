import { columnId, schemaId, tableId, unmodeledId } from '../model/ids';
import type { Id, UnmodeledKind, UnmodeledObject } from '../model/types';
import { notExtensionOwned } from './extensions';
import type { Query } from './query';
import { userSchemaSql } from './schemas';
import { userTableSql } from './tables';

type Oid = number | string;

export interface ObjectRow {
  kind: UnmodeledKind;
  /** The catalog the object lives in; with `oid` it is the object's identity. */
  catalog: string;
  oid: Oid;
  schema_oid: Oid | null;
  name: string;
  /** The table a trigger or policy is on. */
  table_oid: Oid | null;
  /** Columns named directly, such as a trigger's `UPDATE OF` list. */
  attnums: number[] | null;
}

export interface DependencyRow {
  catalog: string;
  oid: Oid;
  table_oid: Oid;
  /** 0 when the object depends on the whole table. */
  attnum: number;
}

const sorted = (ids: Iterable<Id>) => [...new Set(ids)].sort();

export function toUnmodeled(
  objects: ObjectRow[],
  dependencies: DependencyRow[],
): UnmodeledObject[] {
  const byObject = new Map<string, DependencyRow[]>();
  for (const d of dependencies) {
    const key = `${d.catalog}:${d.oid}`;
    byObject.set(key, [...(byObject.get(key) ?? []), d]);
  }
  return objects.map((o) => {
    const deps = byObject.get(`${o.catalog}:${o.oid}`) ?? [];
    const tableOids = [
      ...deps.map((d) => d.table_oid),
      ...(o.table_oid === null ? [] : [o.table_oid]),
    ];
    const columns = [
      ...deps
        .filter((d) => d.attnum > 0)
        .map((d) => columnId(d.table_oid, d.attnum)),
      ...(o.table_oid === null
        ? []
        : (o.attnums ?? []).map((n) => columnId(o.table_oid!, n))),
    ];
    return {
      id: unmodeledId(o.kind, o.oid),
      kind: o.kind,
      schemaId: o.schema_oid === null ? null : schemaId(o.schema_oid),
      name: o.name,
      tableIds: sorted(tableOids.map(tableId)),
      columnIds: sorted(columns),
    };
  });
}

const OBJECTS_SQL = `
  SELECT CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized-view'
                        WHEN 'f' THEN 'foreign-table' ELSE 'sequence' END AS kind,
         'pg_class' AS catalog, c.oid, c.relnamespace AS schema_oid, c.relname AS name,
         NULL::oid AS table_oid, NULL::int2[] AS attnums
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('v', 'm', 'f', 'S') AND ${userSchemaSql('n')} AND ${notExtensionOwned('pg_class', 'c.oid')}
  UNION ALL
  SELECT 'function', 'pg_proc', p.oid, p.pronamespace, p.proname, NULL, NULL
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE ${userSchemaSql('n')} AND ${notExtensionOwned('pg_proc', 'p.oid')}
  UNION ALL
  SELECT 'trigger', 'pg_trigger', g.oid, NULL, g.tgname, g.tgrelid, g.tgattr::int2[]
    FROM pg_trigger g JOIN pg_class t ON t.oid = g.tgrelid
   WHERE NOT g.tgisinternal AND ${userTableSql('t')}
  UNION ALL
  SELECT 'policy', 'pg_policy', pol.oid, NULL, pol.polname, pol.polrelid, NULL
    FROM pg_policy pol JOIN pg_class t ON t.oid = pol.polrelid
   WHERE ${userTableSql('t')}
  ORDER BY 1, 4, 5`;

// A view depends on tables through its rewrite rule; everything else depends on them directly.
const DEPENDENCIES_SQL = `
  SELECT cl.relname AS catalog, d.objid AS oid, d.refobjid AS table_oid, d.refobjsubid AS attnum
    FROM pg_depend d
    JOIN pg_class cl ON cl.oid = d.classid
    JOIN pg_class t ON t.oid = d.refobjid
   WHERE d.refclassid = 'pg_class'::regclass AND ${userTableSql('t')}
     AND d.classid IN ('pg_class'::regclass, 'pg_proc'::regclass, 'pg_trigger'::regclass, 'pg_policy'::regclass)
  UNION ALL
  SELECT 'pg_class', r.ev_class, d.refobjid, d.refobjsubid
    FROM pg_depend d
    JOIN pg_rewrite r ON d.classid = 'pg_rewrite'::regclass AND d.objid = r.oid
    JOIN pg_class t ON t.oid = d.refobjid
   WHERE d.refclassid = 'pg_class'::regclass AND ${userTableSql('t')}`;

export async function introspectUnmodeled(
  query: Query,
): Promise<UnmodeledObject[]> {
  const objects = await query<ObjectRow>(OBJECTS_SQL);
  const dependencies = await query<DependencyRow>(DEPENDENCIES_SQL);
  return toUnmodeled(objects, dependencies);
}
