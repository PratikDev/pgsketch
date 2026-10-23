import type { PgType } from '../model/types';

/** What the coercion rules need from `pg_cast` and `pg_type`, keyed by `typeKey`. Plain JSON, so it can cross IPC. */
export interface CastData {
  /** `pg_type.typcategory`; `S` is the string category. */
  categories: Record<string, string>;
  /** Domain key to the key of its base type. */
  domains: Record<string, string>;
  /** `<source key>><target key>` to the cast context: `i` implicit, `a` assignment, `e` explicit only. */
  casts: Record<string, 'i' | 'a' | 'e'>;
}

export const typeKey = (type: PgType): string =>
  type.schema === undefined ? type.name : `${type.schema}.${type.name}`;

function baseKey(key: string, data: CastData): string {
  for (let seen = 0; data.domains[key] !== undefined && seen < 32; seen++)
    key = data.domains[key]!;
  return key;
}

/**
 * Whether `ALTER COLUMN ... TYPE` from one type to another needs `USING`, i.e. whether Postgres has
 * no implicit or assignment conversion. Anything, an array included, converts to a string type
 * without it. Otherwise an array never converts to a non-array, and the other way round. The same
 * type with another length or precision needs none; arrays follow their element types and domains
 * their base type; a string to anything else needs it; the rest is a `pg_cast` lookup.
 */
export function needsUsing(from: PgType, to: PgType, data: CastData): boolean {
  const fromKey = baseKey(typeKey(from), data);
  const toKey = baseKey(typeKey(to), data);
  const toIsString = data.categories[toKey] === 'S';
  if (toIsString && !to.isArray) return false;
  if (from.isArray !== to.isArray) return true;
  if (fromKey === toKey || toIsString) return false;
  if (data.categories[fromKey] === 'S') return true;
  const context = data.casts[`${fromKey}>${toKey}`];
  return context !== 'i' && context !== 'a';
}
