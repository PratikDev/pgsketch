import { enumId, schemaId } from '../model/ids';
import type { EnumType } from '../model/types';
import { notExtensionOwned } from './extensions';
import type { Query } from './query';
import { userSchemaSql } from './schemas';

export async function introspectEnums(query: Query): Promise<EnumType[]> {
  const rows = await query<{
    oid: number | string;
    schema_oid: number | string;
    name: string;
    labels: string[];
  }>(
    `SELECT t.oid, t.typnamespace AS schema_oid, t.typname AS name,
            (SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid = t.oid) AS labels
       FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE t.typtype = 'e' AND ${userSchemaSql('n')} AND ${notExtensionOwned('pg_type', 't.oid')}
      ORDER BY t.typnamespace, t.typname`,
  );
  return rows.map((r) => ({
    id: enumId(r.oid),
    schemaId: schemaId(r.schema_oid),
    name: r.name,
    labels: r.labels ?? [],
  }));
}
