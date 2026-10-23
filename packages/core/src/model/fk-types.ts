import type { PgType } from './types';

const INTS = ['smallint', 'integer', 'bigint'];
const FLOATS = ['real', 'double precision'];

// For each built-in type: the other built-in key types a column of it can reference (besides its
// own). Taken from what Postgres accepts, which is one-way for numbers and times.
const CAN_REFERENCE: Record<string, string[]> = {
  smallint: [...INTS, 'numeric', ...FLOATS],
  integer: [...INTS, 'numeric', ...FLOATS],
  bigint: [...INTS, 'numeric', ...FLOATS],
  numeric: FLOATS,
  real: FLOATS,
  'double precision': FLOATS,
  text: ['varchar', 'bpchar'],
  varchar: ['text', 'bpchar'],
  bpchar: ['text', 'varchar'],
  date: ['timestamp', 'timestamptz'],
  timestamp: ['date', 'timestamptz'],
  timestamptz: ['date', 'timestamp'],
  time: ['timetz', 'interval'],
};

/** Whether a foreign key column of type `fkType` can reference a key column of type `keyType`. Length and precision don't matter. */
export function fkTypesCompatible(fkType: PgType, keyType: PgType): boolean {
  if (fkType.isArray !== keyType.isArray) return false;
  if (fkType.schema === keyType.schema && fkType.name === keyType.name)
    return true;
  // Arrays only match the same element type, and user-defined types only match themselves.
  if (
    fkType.isArray ||
    fkType.schema !== undefined ||
    keyType.schema !== undefined
  )
    return false;
  return CAN_REFERENCE[fkType.name]?.includes(keyType.name) ?? false;
}
