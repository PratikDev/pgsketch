import type { PgType } from '@pgsketch/core';

/** A built-in type the picker offers, by the name the model uses, and what its parameters are called. */
export interface BuiltinType {
  name: string;
  params: string[];
}

const simple = (...names: string[]): BuiltinType[] =>
  names.map((name) => ({ name, params: [] }));

/** The short names `format_type` gives, in the order the picker lists them. */
export const BUILTIN_TYPES: BuiltinType[] = [
  ...simple('smallint', 'integer', 'bigint'),
  { name: 'numeric', params: ['Precision', 'Scale'] },
  ...simple('real', 'double precision', 'money'),
  { name: 'varchar', params: ['Length'] },
  { name: 'bpchar', params: ['Length'] },
  ...simple('text', 'boolean', 'uuid', 'json', 'jsonb', 'bytea', 'date'),
  { name: 'timestamp', params: ['Precision'] },
  { name: 'timestamptz', params: ['Precision'] },
  { name: 'time', params: ['Precision'] },
  { name: 'timetz', params: ['Precision'] },
  ...simple('interval', 'inet', 'cidr', 'macaddr'),
];

/** The built-in type a column type is, if it is one (a type with a schema is a user's). */
export const builtinOf = (type: PgType): BuiltinType | undefined =>
  type.schema === undefined
    ? BUILTIN_TYPES.find((b) => b.name === type.name)
    : undefined;

/** The parameters from inputs filled in from the first: a scale without a precision means nothing. */
export function paramsFrom(
  values: (number | undefined)[],
): number[] | undefined {
  const params: number[] = [];
  for (const value of values) {
    if (value === undefined) break;
    params.push(value);
  }
  return params.length > 0 ? params : undefined;
}
