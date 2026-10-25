import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import {
  sslModeSchema,
  type ConnectionParams,
  type SavedConnection,
} from '../../shared/ipc-contract';

/** What is left of a connection string once the password and `sslmode` are taken out. */
export interface SplitUrl {
  url: string;
  password: string | null;
}

/**
 * Takes the password out of a connection string, from the user info or from `?password=`, and
 * removes `sslmode` too: the SSL selector alone decides from then on. The errors never repeat the
 * text, which may hold a password.
 */
export function splitConnectionUrl(text: string): SplitUrl {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error('Not a valid connection string');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:')
    throw new Error(
      'A connection string starts with postgres:// or postgresql://',
    );
  const fromQuery = url.searchParams.get('password');
  const raw = url.password !== '' ? url.password : fromQuery;
  let password: string | null = null;
  if (raw) {
    try {
      password = decodeURIComponent(raw);
    } catch {
      password = raw;
    }
  }
  url.password = '';
  for (const name of ['password', 'sslpassword', 'sslmode'])
    url.searchParams.delete(name);
  return { url: url.toString(), password };
}

export interface NewConnection {
  params: ConnectionParams;
  label: string;
  /** The password as `safeStorage` encrypted it; never the password itself. */
  passwordEnc: Uint8Array | null;
}

const rowSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(['params', 'url', 'socket']),
  host: z.string().nullable(),
  port: z.number().nullable(),
  user_name: z.string().nullable(),
  database: z.string(),
  url: z.string().nullable(),
  ssl_mode: sslModeSchema,
  ssl_ca_path: z.string().nullable(),
  has_password: z.number(),
  last_used_at: z.number(),
});

const COLUMNS = `id, label, kind, host, port, user_name, database, url, ssl_mode, ssl_ca_path,
                 password_enc IS NOT NULL AS has_password, last_used_at`;

function toSaved(row: unknown): SavedConnection {
  const r = rowSchema.parse(row);
  return {
    id: r.id,
    label: r.label,
    kind: r.kind,
    host: r.host,
    port: r.port,
    user: r.user_name,
    database: r.database,
    url: r.url,
    sslMode: r.ssl_mode,
    sslCaPath: r.ssl_ca_path,
    hasPassword: r.has_password === 1,
    lastUsedAt: r.last_used_at,
  };
}

/** The columns a connection is stored in; a URL is stored without its password and `sslmode`. */
function columnsOf(params: ConnectionParams) {
  const common = {
    database: params.database,
    sslMode: params.sslMode,
    sslCaPath: params.sslCaPath ?? null,
  };
  return params.kind === 'url'
    ? {
        ...common,
        host: null,
        port: null,
        user: null,
        url: splitConnectionUrl(params.url).url,
      }
    : {
        ...common,
        host: params.host,
        port: params.port,
        user: params.user,
        url: null,
      };
}

export function createConnectionsRepo(
  db: DatabaseSync,
  now: () => number = Date.now,
  newId: () => string = randomUUID,
) {
  function get(id: string): SavedConnection | undefined {
    const row = db
      .prepare(`SELECT ${COLUMNS} FROM connections WHERE id = ?`)
      .get(id);
    return row === undefined ? undefined : toSaved(row);
  }

  return {
    get,

    add({ params, label, passwordEnc }: NewConnection): SavedConnection {
      const id = newId();
      const c = columnsOf(params);
      db.prepare(
        `INSERT INTO connections
           (id, label, kind, host, port, user_name, database, url, ssl_mode, ssl_ca_path, password_enc, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        label,
        params.kind,
        c.host,
        c.port,
        c.user,
        c.database,
        c.url,
        c.sslMode,
        c.sslCaPath,
        passwordEnc,
        now(),
      );
      const saved = get(id);
      if (!saved) throw new Error('The connection was not saved');
      return saved;
    },

    /** Most recently used first; of two used at the same moment, the one saved later. */
    list(): SavedConnection[] {
      return db
        .prepare(
          `SELECT ${COLUMNS} FROM connections ORDER BY last_used_at DESC, rowid DESC`,
        )
        .all()
        .map(toSaved);
    },

    /** Marks a connection as just used, so it moves to the top of the list. */
    touch(id: string): void {
      db.prepare('UPDATE connections SET last_used_at = ? WHERE id = ?').run(
        now(),
        id,
      );
    },

    /** Whether there was one to remove. */
    remove(id: string): boolean {
      return (
        Number(
          db.prepare('DELETE FROM connections WHERE id = ?').run(id).changes,
        ) > 0
      );
    },

    /** The encrypted password, for the main process to decrypt; it is not part of `SavedConnection`. */
    passwordEnc(id: string): Uint8Array | null {
      const row = z
        .object({ password_enc: z.instanceof(Uint8Array).nullable() })
        .optional()
        .parse(
          db
            .prepare('SELECT password_enc FROM connections WHERE id = ?')
            .get(id),
        );
      return row?.password_enc ?? null;
    },
  };
}

export type ConnectionsRepo = ReturnType<typeof createConnectionsRepo>;
