import { introspect, type Introspection } from '@pgsketch/core';
import type { ServerConnection } from './connection';

/**
 * The open database's schema, its cast data and its fingerprint, all read in one snapshot on the
 * main connection. The connection is the section's own while it runs, so nothing else can slip a
 * statement into the snapshot.
 */
export const loadSchema = (
  connection: ServerConnection,
): Promise<Introspection> => connection.exclusive((query) => introspect(query));
