import { parsePgType } from '../sql/pgtype';
import { typeKey, type CastData } from '../sql/coercion';
import type { Query } from './query';

type Oid = number | string;

export interface TypeRow {
  oid: Oid;
  /** `format_type(oid, NULL)`, schema-qualified for user types. */
  name: string;
  category: string;
  /** Non-zero for a domain. */
  base_oid: Oid;
}

export interface CastRow {
  source: Oid;
  target: Oid;
  context: 'i' | 'a' | 'e';
}

export function buildCastData(types: TypeRow[], casts: CastRow[]): CastData {
  const keys = new Map<string, string>();
  const data: CastData = { categories: {}, domains: {}, casts: {} };
  for (const t of types) {
    try {
      const key = typeKey(parsePgType(t.name));
      keys.set(String(t.oid), key);
      data.categories[key] = t.category;
    } catch {
      // a type the model can't represent can't be picked, so it needs no cast data
    }
  }
  for (const t of types) {
    const key = keys.get(String(t.oid));
    const base = keys.get(String(t.base_oid));
    if (key && base && String(t.base_oid) !== '0') data.domains[key] = base;
  }
  for (const c of casts) {
    const source = keys.get(String(c.source));
    const target = keys.get(String(c.target));
    if (source && target) data.casts[`${source}>${target}`] = c.context;
  }
  return data;
}

/** All of `pg_cast` and the types it relates, so even types the user picks later are covered. */
export async function introspectCasts(query: Query): Promise<CastData> {
  const types = await query<TypeRow>(
    `SELECT t.oid, format_type(t.oid, NULL) AS name, t.typcategory AS category, t.typbasetype AS base_oid
       FROM pg_type t
      WHERE t.typtype IN ('b', 'd', 'e') AND t.typcategory <> 'A'`,
  );
  const casts = await query<CastRow>(
    `SELECT castsource AS source, casttarget AS target, castcontext AS context FROM pg_cast`,
  );
  return buildCastData(types, casts);
}
