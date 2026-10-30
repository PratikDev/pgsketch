import { readFileSync } from 'node:fs';
import { Client, type ClientConfig } from 'pg';
import { parse as parseConnectionString } from 'pg-connection-string';
import { currentSearchPath, type Query, type QueryParam } from '@pgsketch/core';
import type { ConnectionParams } from '../../shared/ipc-contract';
import { splitConnectionUrl } from '../store/connections';
import {
  ConnectionError,
  describeConnectionError,
  SSL_REFUSED,
  UnsupportedVersionError,
  type ConnectionTarget,
} from './errors';
import { runSingle } from './run-single';
import { sslAttempts, type SslConfig } from './ssl';

/** How long to wait for the server before giving up. */
const CONNECT_TIMEOUT_MS = 5_000;
const MIN_VERSION_NUM = 140_000;

export interface ServerConnection {
  /** The server's version, like `16.4`. */
  readonly serverVersion: string;
  /** The `search_path` the connection had before it was pinned to empty. */
  readonly originalSearchPath: string;
  /**
   * Runs `work` with the connection to itself: calls queue, so a transaction made of several
   * statements is never mixed with another caller's.
   */
  exclusive<T>(work: (query: Query) => Promise<T>): Promise<T>;
  /** One statement, queued like everything else. */
  query: Query;
  close(): Promise<void>;
}

export interface ConnectionOptions {
  /** Called when an open connection breaks (the server went away, the backend was terminated). */
  onLost?: (error: Error) => void;
  /** For tests; reads the CA certificate file for `verify-full`. */
  readFile?: (path: string) => string;
}

interface Prepared {
  config: ClientConfig;
  target: ConnectionTarget;
}

/** The `pg` options for the parameters, without the SSL part. A URL's password and `sslmode` are never passed on. */
export function clientConfigFor(params: ConnectionParams): Prepared {
  const common = {
    database: params.database,
    application_name: 'pgsketch',
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  };
  if (params.kind === 'url') {
    const { url, password } = splitConnectionUrl(params.url);
    const parsed = parseConnectionString(url);
    // an absent part comes back as an empty string
    const host = parsed.host || undefined;
    const user = parsed.user || undefined;
    const port = parsed.port ? Number(parsed.port) : undefined;
    return {
      config: { ...common, host, port, user, password: password ?? undefined },
      target: {
        host: host ?? 'localhost',
        port: port ?? 5432,
        user: user ?? null,
      },
    };
  }
  return {
    config: {
      ...common,
      host: params.host,
      port: params.port,
      user: params.user,
      // a socket connection is let in by the operating system user, not a password
      password: params.kind === 'params' ? params.password : undefined,
    },
    target: { host: params.host, port: params.port, user: params.user },
  };
}

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

/** Opens a connection with the first SSL setting that works, so `prefer` can fall back to plaintext. */
async function connect(
  config: ClientConfig,
  attempts: SslConfig[],
): Promise<Client> {
  for (const [i, ssl] of attempts.entries()) {
    const client = new Client({ ...config, ssl });
    try {
      await client.connect();
      return client;
    } catch (error) {
      const failure = asError(error);
      const refused = failure.message === SSL_REFUSED;
      if (!refused || i === attempts.length - 1) throw failure;
    }
  }
  throw new Error('No way to connect');
}

/**
 * A connection to the server, for the main connection of a window and for task connections alike:
 * opened with explicit SSL options, checked for a supported
 * version, and with its `search_path` recorded and then pinned to empty, so definitions are always
 * read fully qualified. Anything that goes wrong comes back as a `ConnectionError` whose message
 * can be shown as it is.
 */
export async function openConnection(
  params: ConnectionParams,
  {
    onLost,
    readFile = (path) => readFileSync(path, 'utf8'),
  }: ConnectionOptions = {},
): Promise<ServerConnection> {
  const { config, target } = clientConfigFor(params);
  const fail = (error: Error): never => {
    throw new ConnectionError(describeConnectionError(error, target), {
      cause: error,
    });
  };

  let ca: string | undefined;
  if (params.sslMode === 'verify-full' && params.sslCaPath !== undefined) {
    try {
      ca = readFile(params.sslCaPath);
    } catch {
      throw new ConnectionError("Couldn't read the CA certificate file");
    }
  }

  let client: Client;
  try {
    client = await connect(config, sslAttempts(params.sslMode, ca));
  } catch (error) {
    return fail(asError(error));
  }

  const query: Query = (sql: string, values?: readonly QueryParam[]) =>
    runSingle(client, sql, values);
  try {
    const [version] = await query<{ num: string; text: string }>(
      `SELECT current_setting('server_version_num') AS num, current_setting('server_version') AS text`,
    );
    if (!version || Number(version.num) < MIN_VERSION_NUM)
      throw new UnsupportedVersionError(
        /^[\d.]+/.exec(version?.text ?? '')?.[0] ?? 'an unknown version',
      );
    const originalSearchPath = await currentSearchPath(query);
    await query(`SET search_path = ''`);

    // `pg` raises an unhandled error when a connection that nobody is waiting on breaks, and can
    // raise more than one for the same break; only the first is reported, and none after `close`
    let reported = false;
    const lost = (error: Error) => {
      if (reported) return;
      reported = true;
      onLost?.(error);
    };
    client.on('error', lost);
    // a server that stops can close the connection without saying why
    client.on('end', () => lost(new Error('The server closed the connection')));

    let tail: Promise<unknown> = Promise.resolve();
    const exclusive = <T>(work: (q: Query) => Promise<T>): Promise<T> => {
      const run = tail.then(() => work(query));
      tail = run.catch(() => undefined);
      return run;
    };
    return {
      serverVersion: /^[\d.]+/.exec(version.text)?.[0] ?? version.text,
      originalSearchPath,
      exclusive,
      query: (sql, values) => exclusive((q) => q(sql, values)),
      close: () => {
        reported = true;
        return client.end();
      },
    };
  } catch (error) {
    await client.end().catch(() => undefined);
    return fail(asError(error));
  }
}
