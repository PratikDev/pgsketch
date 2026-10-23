import { schemaId, tableId } from '../model/ids';
import type { ReadOnlyReason, Table } from '../model/types';
import { notExtensionOwned } from './extensions';
import type { Query } from './query';
import { userSchemaSql } from './schemas';

/** SQL condition for a `pg_class` alias: an ordinary or partitioned table in a user schema, not from an extension. */
export const userTableSql = (cls: string): string =>
  `${cls}.relkind IN ('r', 'p')
   AND EXISTS (SELECT 1 FROM pg_namespace n WHERE n.oid = ${cls}.relnamespace AND ${userSchemaSql('n')})
   AND ${notExtensionOwned('pg_class', `${cls}.oid`)}`;

/**
 * SQL for why a table is read-only (or NULL). Everything that belongs to a read-only table,
 * its columns, constraints and indexes, is read-only for the same reason.
 */
export const tableReasonSql = (cls: string): string =>
  `CASE WHEN ${cls}.relispartition THEN 'partition'
        WHEN ${cls}.relkind = 'p' THEN 'partitioned-table' END`;

export async function introspectTables(query: Query): Promise<Table[]> {
  const rows = await query<{
    oid: number | string;
    schema_oid: number | string;
    name: string;
    comment: string | null;
    reason: ReadOnlyReason | null;
  }>(
    `SELECT c.oid, c.relnamespace AS schema_oid, c.relname AS name,
            obj_description(c.oid, 'pg_class') AS comment, ${tableReasonSql('c')} AS reason
       FROM pg_class c WHERE ${userTableSql('c')}
      ORDER BY c.relnamespace, c.relname`,
  );
  return rows.map((r) => ({
    id: tableId(r.oid),
    schemaId: schemaId(r.schema_oid),
    name: r.name,
    comment: r.comment,
    ...(r.reason && { readOnly: r.reason }),
  }));
}
