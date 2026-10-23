import { notExtensionOwned } from '../introspect/extensions';
import { indexReasonSql } from '../introspect/indexes';
import type { Query } from '../introspect/query';
import { userSchemaSql } from '../introspect/schemas';
import { userTableSql } from '../introspect/tables';
import { DEPENDENCIES_SQL, OBJECTS_SQL } from '../introspect/unmodeled';

// One md5 per kind of object, over rows rendered as `format('%L|%L|...')` (NULL stays distinct from
// text) and sorted, so the result doesn't depend on row order. Only definitions and OIDs are
// hashed: never statistics such as reltuples or relpages, which VACUUM and ANALYZE change.
const section = (rows: string): string =>
  `(SELECT md5(coalesce(string_agg(r, E'\\n' ORDER BY r), '')) FROM (${rows}) AS rows(r))`;

const fields = (count: number) => Array(count).fill('%L').join('|');

const DESCRIPTION = (objoid: string, subid: string) =>
  `LEFT JOIN pg_description d ON d.objoid = ${objoid} AND d.classoid = 'pg_class'::regclass AND d.objsubid = ${subid}`;

/**
 * Hashes everything introspection reads except cast data, which is read fresh whenever SQL is
 * generated. Unmodeled objects (views, triggers, functions, policies...) only contribute their
 * OID, name, kind and dependencies, so editing a function body or a policy doesn't change it.
 * Run it on a connection with `search_path = ''`, like introspection, so definition text matches.
 */
export const FINGERPRINT_SQL = `
SELECT md5(concat_ws('#',
  ${section(`SELECT format('${fields(2)}', n.oid, n.nspname)
               FROM pg_namespace n WHERE ${userSchemaSql('n')} AND ${notExtensionOwned('pg_namespace', 'n.oid')}`)},
  ${section(`SELECT format('${fields(5)}', c.oid, c.relnamespace, c.relname, c.relkind::text || c.relispartition::text, d.description)
               FROM pg_class c ${DESCRIPTION('c.oid', '0')} WHERE ${userTableSql('c')}`)},
  ${section(`SELECT format('${fields(10)}', a.attrelid, a.attnum, a.attname, a.atttypid,
                           format_type(a.atttypid, a.atttypmod), a.attnotnull, a.attidentity::text || a.attgenerated::text,
                           pg_get_expr(ad.adbin, ad.adrelid), d.description,
                           CASE WHEN k.oid IS NOT NULL THEN k.convalidated::text || k.connoinherit::text END)
               FROM pg_attribute a
               JOIN pg_class t ON t.oid = a.attrelid
               LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
               ${DESCRIPTION('a.attrelid', 'a.attnum')}
               LEFT JOIN pg_constraint k ON k.conrelid = a.attrelid AND k.contype = 'n' AND a.attnum = ANY (k.conkey)
              WHERE a.attnum > 0 AND NOT a.attisdropped AND ${userTableSql('t')}`)},
  ${section(`SELECT format('${fields(13)}', c.oid, c.conrelid, c.conname, c.contype, c.conkey, c.confrelid,
                           c.confkey, c.confdeltype::text || c.confupdtype::text || c.confmatchtype::text,
                           c.condeferrable, c.convalidated, c.connoinherit,
                           to_jsonb(c) ->> 'confdelsetcols', pg_get_constraintdef(c.oid))
               FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
              WHERE c.contype IN ('p', 'u', 'c', 'f', 'x') AND ${userTableSql('t')}`)},
  ${section(`SELECT format('${fields(10)}', ic.oid, x.indrelid, ic.relname, x.indisunique, x.indkey, am.amname,
                           pg_get_indexdef(ic.oid), ic.reloptions, ic.reltablespace, ${indexReasonSql('x', 'ic', 'am')})
               FROM pg_index x
               JOIN pg_class ic ON ic.oid = x.indexrelid
               JOIN pg_class t ON t.oid = x.indrelid
               JOIN pg_am am ON am.oid = ic.relam
              WHERE ${userTableSql('t')}`)},
  ${section(`SELECT format('${fields(4)}', t.oid, t.typnamespace, t.typname,
                           (SELECT string_agg(e.enumlabel::text, ',' ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid = t.oid))
               FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
              WHERE t.typtype = 'e' AND ${userSchemaSql('n')} AND ${notExtensionOwned('pg_type', 't.oid')}`)},
  ${section(`SELECT format('${fields(7)}', o.kind, o.catalog, o.oid, o.schema_oid, o.name, o.table_oid, o.attnums)
               FROM (${OBJECTS_SQL}) AS o`)},
  ${section(`SELECT format('${fields(4)}', d.catalog, d.oid, d.table_oid, d.attnum)
               FROM (${DEPENDENCIES_SQL}) AS d`)}
)) AS fingerprint`;

export async function fingerprint(query: Query): Promise<string> {
  const rows = await query<{ fingerprint: string }>(FINGERPRINT_SQL);
  return rows[0]!.fingerprint;
}

/** The catalog tables (from the database's own list) whose names appear in any of the SQL texts. */
export function catalogsRead(sqlTexts: string[], catalogs: string[]): string[] {
  const text = sqlTexts.join('\n');
  // `\b` treats `_` as a word character, so `pg_get_expr` or `pg_class_x` never match `pg_class`
  return catalogs.filter((name) => new RegExp(`\\b${name}\\b`).test(text));
}

/** Catalog tables that introspection reads but the fingerprint SQL never mentions. */
export function uncoveredCatalogs(
  introspectionSql: string[],
  fingerprintSql: string,
  catalogs: string[],
): string[] {
  const covered = new Set(catalogsRead([fingerprintSql], catalogs));
  return catalogsRead(introspectionSql, catalogs).filter(
    (name) => !covered.has(name),
  );
}
