import type { ValidationError } from '@pgsketch/core';

/**
 * Why SQL can't be generated now, in words for the user, or `null` when it can. The connection and
 * the schema being trustworthy come first: SQL made from a schema that has changed under the edits
 * would be for a database that isn't there any more.
 */
export function generateBlocker({
  changes,
  errors,
  stale,
  lost,
}: {
  changes: number;
  errors: ValidationError[];
  stale: boolean;
  lost: string | null;
}): string | null {
  if (lost !== null) return 'The connection to the database was lost.';
  if (stale)
    return 'The database changed outside pgsketch. Reload, or finish applying the changes there.';
  if (errors[0]) return `Fix this first: ${errors[0].message}`;
  if (changes === 0) return 'There are no changes to generate SQL for.';
  return null;
}
