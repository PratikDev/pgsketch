import { schemaId } from '../model/ids';
import type { Schema } from '../model/types';
import { notExtensionOwned } from './extensions';
import type { Query } from './query';

/** SQL condition for a `pg_namespace` alias: true for schemas users own, false for system ones. */
export const userSchemaSql = (nsp: string): string =>
  `${nsp}.nspname NOT IN ('pg_catalog', 'information_schema')
   AND ${nsp}.nspname NOT LIKE 'pg\\_toast%' AND ${nsp}.nspname NOT LIKE 'pg\\_temp\\_%'`;

export async function introspectSchemas(query: Query): Promise<Schema[]> {
  const rows = await query<{ oid: number | string; name: string }>(
    `SELECT n.oid, n.nspname AS name FROM pg_namespace n
      WHERE ${userSchemaSql('n')} AND ${notExtensionOwned('pg_namespace', 'n.oid')}
      ORDER BY n.nspname`,
  );
  return rows.map((r) => ({ id: schemaId(r.oid), name: r.name }));
}
