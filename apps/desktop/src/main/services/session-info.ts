import { createHash } from 'node:crypto';
import type {
  ConnectionParams,
  SavedConnection,
  SessionInfo,
} from '../../shared/ipc-contract';
import { clientConfigFor } from './connection';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];

/** The host and port a connection goes to, as messages and keys name them. */
export function targetOf(params: ConnectionParams) {
  return clientConfigFor(params).target;
}

/** A socket directory, an address on this machine, or somewhere else: Validate asks first for the last. */
export function hostKindOf(params: ConnectionParams): SessionInfo['hostKind'] {
  if (params.kind === 'socket') return 'socket';
  const { host } = targetOf(params);
  if (host.startsWith('/')) return 'socket';
  return LOCAL_HOSTS.includes(host.toLowerCase()) ? 'local' : 'remote';
}

/**
 * Identifies one database for drafts and layouts: the saved connection and the database, or for a
 * connection that isn't saved a hash of where it goes and who connects.
 */
export function dbKeyFor(
  params: ConnectionParams,
  savedId: string | null,
): string {
  if (savedId !== null) return `${savedId}:${params.database}`;
  const { host, port, user } = targetOf(params);
  return createHash('sha256')
    .update(JSON.stringify([host, port, user, params.database]))
    .digest('hex');
}

/** What a saved connection is called in the list: `user@host:port/database`. */
export function labelFor(params: ConnectionParams): string {
  const { host, port, user } = targetOf(params);
  return `${user === null ? '' : `${user}@`}${host}${params.kind === 'socket' || port === null ? '' : `:${port}`}/${params.database}`;
}

/** The password a connection carries, if any: in its own field, or inside a connection string. */
export function passwordOf(params: ConnectionParams): string | undefined {
  const { password } = clientConfigFor(params).config;
  return typeof password === 'string' ? password : undefined;
}

/** The parameters to open a saved connection with, given the password read back from storage. */
export function paramsOfSaved(
  saved: SavedConnection,
  password: string | undefined,
): ConnectionParams {
  const common = {
    database: saved.database,
    sslMode: saved.sslMode,
    sslCaPath: saved.sslCaPath ?? undefined,
  };
  if (saved.kind === 'url') {
    if (saved.url === null)
      throw new Error('The saved connection is incomplete');
    const url = new URL(saved.url);
    if (password !== undefined) url.password = password;
    return { kind: 'url', url: url.toString(), ...common };
  }
  if (saved.host === null || saved.port === null || saved.user === null)
    throw new Error('The saved connection is incomplete');
  const fields = { host: saved.host, port: saved.port, user: saved.user };
  return saved.kind === 'socket'
    ? { kind: 'socket', ...fields, ...common }
    : { kind: 'params', ...fields, password, ...common };
}
