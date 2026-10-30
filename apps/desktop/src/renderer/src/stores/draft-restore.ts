import type { Introspection, SchemaModel } from '@pgsketch/core';
import type { Draft } from '../../../shared/ipc-contract';

const COLLECTIONS = [
  'schemas',
  'tables',
  'columns',
  'constraints',
  'indexes',
  'enums',
  'unmodeled',
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Whether text is a schema model: each collection there, and every object in it under its own id. */
function isModel(value: unknown): value is SchemaModel {
  return (
    isRecord(value) &&
    COLLECTIONS.every((name) => {
      const collection = value[name];
      return (
        isRecord(collection) &&
        Object.entries(collection).every(
          ([id, object]) => isRecord(object) && object.id === id,
        )
      );
    })
  );
}

/** An id that comes from a Postgres identifier (`t:16394`, `c:16394:2`); objects made in the editor get a random one. */
const FROM_DATABASE = /^[a-z]:\d/;

/**
 * The edited schema of a draft, if it fits the database that was just loaded: it was made on that
 * very schema (the same fingerprint, which includes every object's OID), and every object in it
 * that came from the database is still in it. Anything else is stale, and is `null`.
 */
export function restoreDraft(
  draft: Draft,
  loaded: Introspection,
): SchemaModel | null {
  if (draft.fingerprint !== loaded.fingerprint) return null;
  let desired: unknown;
  try {
    desired = JSON.parse(draft.desiredJson);
  } catch {
    return null;
  }
  if (!isModel(desired)) return null;
  const stillThere = COLLECTIONS.every((name) =>
    Object.keys(desired[name]).every(
      (id) => !FROM_DATABASE.test(id) || id in loaded.model[name],
    ),
  );
  return stillThere ? desired : null;
}
