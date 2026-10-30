import {
  assignNames,
  matchesByName,
  type Introspection,
  type SchemaModel,
} from '@pgsketch/core';
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

/** What a draft saved last time comes to now that the schema has been loaded again. */
export type DraftOutcome =
  /** It was made on this very schema: the edits are put back. */
  | { kind: 'restore'; desired: SchemaModel }
  /** The database changed, but is now what the edits asked for (the SQL was run while the app was closed). */
  | { kind: 'applied'; desired: SchemaModel }
  /** The database changed, and the edits no longer fit it, or can't be read. */
  | { kind: 'discard' };

/**
 * Decides what to do with a draft: restore it if it was made on the schema that has just been
 * loaded, that is, the same fingerprint, which has every OID in it, and every object in it that
 * has an id from the database is still in it; call it applied if the database now matches it by
 * name; otherwise discard it.
 */
export function classifyDraft(
  draft: Draft,
  loaded: Introspection,
): DraftOutcome {
  let desired: unknown;
  try {
    desired = JSON.parse(draft.desiredJson);
  } catch {
    return { kind: 'discard' };
  }
  if (!isModel(desired)) return { kind: 'discard' };
  const stillThere = COLLECTIONS.every((name) =>
    Object.keys(desired[name]).every(
      (id) => !FROM_DATABASE.test(id) || id in loaded.model[name],
    ),
  );
  if (draft.fingerprint === loaded.fingerprint && stillThere)
    return { kind: 'restore', desired };
  return matchesByName(loaded.model, assignNames(desired))
    ? { kind: 'applied', desired }
    : { kind: 'discard' };
}
