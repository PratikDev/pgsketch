/** Always double-quoted, so reserved words, mixed case and unicode need no special cases. */
export function quoteIdent(name: string): string {
  if (name === '') throw new Error('Cannot quote an empty identifier');
  if (name.includes('\0')) throw new Error('Identifiers cannot contain NUL');
  return `"${name.replaceAll('"', '""')}"`;
}

/** Safe whether or not the server has `standard_conforming_strings` on (same approach as libpq). */
export function quoteLiteral(value: string): string {
  if (value.includes('\0')) throw new Error('Literals cannot contain NUL');
  const quoted = value.replaceAll("'", "''");
  return value.includes('\\')
    ? `E'${quoted.replaceAll('\\', '\\\\')}'`
    : `'${quoted}'`;
}

export const qualified = (schema: string, name: string): string =>
  `${quoteIdent(schema)}.${quoteIdent(name)}`;
