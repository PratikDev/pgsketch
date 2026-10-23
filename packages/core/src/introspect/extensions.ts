import type { Query } from './query';

export interface ExtensionOwned {
  /** The catalog the object lives in, for example `pg_proc` or `pg_type`. */
  catalog: string;
  oid: number;
}

/** Every object that belongs to an installed extension. */
export async function listExtensionOwned(
  query: Query,
): Promise<ExtensionOwned[]> {
  const rows = await query<{ catalog: string; oid: number | string }>(
    `SELECT c.relname AS catalog, d.objid AS oid
       FROM pg_depend d JOIN pg_class c ON c.oid = d.classid
      WHERE d.deptype = 'e' AND d.refclassid = 'pg_extension'::regclass
      ORDER BY 1, 2`,
  );
  return rows.map((r) => ({ catalog: r.catalog, oid: Number(r.oid) }));
}

/**
 * SQL condition that is true unless the object is owned by an extension. `catalog` is a catalog
 * table name written by our own code, never user input.
 */
export const notExtensionOwned = (catalog: string, oidExpr: string): string =>
  `NOT EXISTS (SELECT 1 FROM pg_depend ext WHERE ext.deptype = 'e'
     AND ext.classid = '${catalog}'::regclass AND ext.objid = ${oidExpr})`;
