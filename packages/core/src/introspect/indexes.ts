import { columnId, indexId, tableId } from '../model/ids';
import type { Index, ReadOnlyReason } from '../model/types';
import type { Query } from './query';
import { tableReasonSql, userTableSql } from './tables';

type Oid = number | string;

/**
 * SQL for why an index is read-only (or NULL), judged by what it contains: pgsketch only models
 * plain ascending B-tree indexes with default operator classes. `x` is the `pg_index` alias, `ic`
 * the index's `pg_class` row and `am` its `pg_am` row. Constraint-backed indexes use it too.
 */
export const indexReasonSql = (x: string, ic: string, am: string): string =>
  `CASE
     WHEN ${am}.amname <> 'btree' THEN 'non-btree-index'
     WHEN ${x}.indexprs IS NOT NULL THEN 'expression-index'
     WHEN ${x}.indpred IS NOT NULL THEN 'partial-index'
     WHEN EXISTS (SELECT 1 FROM unnest(${x}.indoption::int2[]) WITH ORDINALITY AS o(v, n)
                   WHERE o.n <= ${x}.indnkeyatts AND o.v <> 0) THEN 'desc-index'
     WHEN ${x}.indnatts > ${x}.indnkeyatts THEN 'include-index'
     WHEN EXISTS (SELECT 1 FROM unnest(${x}.indclass::oid[]) WITH ORDINALITY AS o(v, n)
                    JOIN pg_opclass oc ON oc.oid = o.v
                   WHERE o.n <= ${x}.indnkeyatts AND NOT oc.opcdefault) THEN 'opclass-index'
     WHEN ${ic}.reloptions IS NOT NULL OR ${ic}.reltablespace <> 0 THEN 'storage-options-index'
     WHEN COALESCE((to_jsonb(${x}) ->> 'indnullsnotdistinct')::boolean, false) THEN 'nulls-not-distinct-index'
   END`;

export interface IndexRow {
  oid: Oid;
  table_oid: Oid;
  name: string;
  is_unique: boolean;
  /** `indkey`: key columns then INCLUDE columns, 0 for an expression. */
  key_attnums: number[];
  /** Columns the index depends on beyond `key_attnums`: those inside expressions and predicates. */
  other_attnums: number[] | null;
  definition: string;
  table_reason: ReadOnlyReason | null;
  index_reason: ReadOnlyReason | null;
}

/** Turns one catalog row into an index, deciding whether pgsketch can edit it. */
export function toIndex(row: IndexRow): Index {
  const attnums = [
    ...row.key_attnums.filter((n) => n > 0),
    ...(row.other_attnums ?? []).filter((n) => !row.key_attnums.includes(n)),
  ];
  const readOnly = row.table_reason ?? row.index_reason ?? undefined;
  return {
    id: indexId(row.oid),
    tableId: tableId(row.table_oid),
    name: row.name,
    unique: row.is_unique,
    columnIds: attnums.map((n) => columnId(row.table_oid, n)),
    ...(readOnly && { readOnly, definition: row.definition }),
  };
}

/** Indexes that back a PK, unique or exclusion constraint are part of that constraint, so they are left out. */
export async function introspectIndexes(query: Query): Promise<Index[]> {
  const rows = await query<IndexRow>(
    `SELECT ic.oid, x.indrelid AS table_oid, ic.relname AS name, x.indisunique AS is_unique,
            x.indkey::int2[] AS key_attnums,
            (SELECT array_agg(d.refobjsubid::int2 ORDER BY d.refobjsubid) FROM pg_depend d
              WHERE d.classid = 'pg_class'::regclass AND d.objid = ic.oid
                AND d.refclassid = 'pg_class'::regclass AND d.refobjid = x.indrelid
                AND d.refobjsubid > 0) AS other_attnums,
            pg_get_indexdef(ic.oid) AS definition,
            ${tableReasonSql('t')} AS table_reason,
            ${indexReasonSql('x', 'ic', 'am')} AS index_reason
       FROM pg_index x
       JOIN pg_class ic ON ic.oid = x.indexrelid
       JOIN pg_class t ON t.oid = x.indrelid
       JOIN pg_am am ON am.oid = ic.relam
      WHERE ${userTableSql('t')}
        AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = x.indexrelid)
      ORDER BY x.indrelid, ic.oid`,
  );
  return rows.map(toIndex);
}
