import type { PgType } from '../model/types';
import { samePgType } from '../sql/pgtype';

/** `lossy`: the data can change or be cut. `may-fail`: it depends on the data, or on a cast we haven't classified. */
export type TypeChangeRisk = 'safe' | 'lossy' | 'may-fail';

const INTEGER_SIZE: Record<string, number> = {
  smallint: 1,
  integer: 2,
  bigint: 3,
};
const FLOATS = ['real', 'double precision'];

const is = (type: PgType, ...names: string[]) =>
  !type.isArray && type.schema === undefined && names.includes(type.name);

/** `varchar(n)` has a length; plain `varchar` has none, which counts as larger than any length. */
const length = (type: PgType): number => type.params?.[0] ?? Infinity;

const precision = (type: PgType) => type.params?.[0];
const scale = (type: PgType) =>
  type.params ? (type.params[1] ?? 0) : undefined;

type Rule = (from: PgType, to: PgType) => boolean;

/** smallint -> integer -> bigint keeps every value, but Postgres rewrites the table to do it. */
const INTEGER_WIDENING: Rule = (from, to) =>
  is(from, ...Object.keys(INTEGER_SIZE)) &&
  is(to, ...Object.keys(INTEGER_SIZE)) &&
  INTEGER_SIZE[from.name]! < INTEGER_SIZE[to.name]!;

/** Changes that keep every value and need no rewrite: only a type modifier grows, or the types share a representation. */
const NO_REWRITE_WIDENINGS: Rule[] = [
  // varchar(n) -> varchar(m > n), or no length at all
  (from, to) =>
    is(from, 'varchar') && is(to, 'varchar') && length(to) > length(from),
  // varchar -> text, and text -> varchar with no length, which holds the same values
  (from, to) => is(from, 'varchar') && is(to, 'text'),
  (from, to) =>
    is(from, 'text') && is(to, 'varchar') && length(to) === Infinity,
  // numeric with more digits and the same scale
  (from, to) =>
    is(from, 'numeric') &&
    is(to, 'numeric') &&
    precision(from) !== undefined &&
    precision(to) !== undefined &&
    precision(to)! > precision(from)! &&
    scale(to) === scale(from),
];

/** Changes that keep every value. */
const SAFE_WIDENINGS: Rule[] = [INTEGER_WIDENING, ...NO_REWRITE_WIDENINGS];

/** Changes that round or cut values. */
const LOSSY_CONVERSIONS: Rule[] = [
  // numeric scale decrease
  (from, to) =>
    is(from, 'numeric') &&
    is(to, 'numeric') &&
    scale(from) !== undefined &&
    scale(to) !== undefined &&
    scale(to)! < scale(from)!,
  // float -> integer
  (from, to) => is(from, ...FLOATS) && is(to, ...Object.keys(INTEGER_SIZE)),
  // timestamp, timestamptz -> date
  (from, to) => is(from, 'timestamp', 'timestamptz') && is(to, 'date'),
  // text -> varchar(n)
  (from, to) =>
    is(from, 'text') && is(to, 'varchar') && length(to) !== Infinity,
];

/**
 * How risky it is to change a column from one type to another. Only the two lists above are
 * known: a pair in neither, including anything with arrays or user-defined types, is `may-fail`,
 * so an unknown change is always a warning and never silently safe.
 */
export function classifyTypeChange(from: PgType, to: PgType): TypeChangeRisk {
  if (samePgType(from, to)) return 'safe';
  if (LOSSY_CONVERSIONS.some((rule) => rule(from, to))) return 'lossy';
  if (SAFE_WIDENINGS.some((rule) => rule(from, to))) return 'safe';
  return 'may-fail';
}

/**
 * Whether the change has to rewrite or scan the whole table, holding a lock while it does. Only
 * the widenings that change a type modifier or share a representation avoid it; anything else is
 * assumed to rewrite, which only ever adds a warning.
 */
export function typeChangeRewritesTable(from: PgType, to: PgType): boolean {
  return (
    !samePgType(from, to) &&
    !NO_REWRITE_WIDENINGS.some((rule) => rule(from, to))
  );
}
