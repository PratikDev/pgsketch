import { quoteLiteral, type PgType } from '@pgsketch/core';

/** A default offered for a type: what it is called, and the SQL that Postgres is asked to normalize. */
export interface Preset {
  id: string;
  label: string;
  expression: string;
}

const preset = (
  id: string,
  expression: string,
  label = expression,
): Preset => ({
  id,
  label,
  expression,
});

const NUMBERS = [
  'smallint',
  'integer',
  'bigint',
  'numeric',
  'real',
  'double precision',
];

/** The defaults worth offering for a type, by name; an enum's are its labels, which the caller knows. */
export function presetsFor(type: PgType, enumLabels: string[] = []): Preset[] {
  if (type.isArray) return [preset('empty-array', "'{}'")];
  if (type.schema !== undefined)
    return enumLabels.map((label) =>
      preset(`enum:${label}`, quoteLiteral(label)),
    );
  if (NUMBERS.includes(type.name)) return [preset('zero', '0')];
  switch (type.name) {
    case 'boolean':
      return [preset('false', 'false'), preset('true', 'true')];
    case 'text':
    case 'varchar':
    case 'bpchar':
      return [preset('empty', "''", "'' (empty)")];
    case 'uuid':
      return [preset('gen_random_uuid', 'gen_random_uuid()')];
    case 'timestamp':
    case 'timestamptz':
      return [preset('now', 'now()')];
    case 'date':
      return [preset('current_date', 'CURRENT_DATE')];
    case 'time':
      return [preset('localtime', 'LOCALTIME')];
    case 'timetz':
      return [preset('current_time', 'CURRENT_TIME')];
    case 'json':
    case 'jsonb':
      return [preset('empty-object', "'{}'"), preset('empty-array', "'[]'")];
    default:
      return [];
  }
}

/** A value typed as a constant, as the SQL for it: numbers and booleans as they are, anything else as a quoted string. */
export function constantExpression(type: PgType, text: string): string {
  const plain =
    !type.isArray &&
    type.schema === undefined &&
    (NUMBERS.includes(type.name) || type.name === 'boolean');
  return plain ? text.trim() : quoteLiteral(text);
}
