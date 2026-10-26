import { z } from 'zod';
import { isLocalHost } from '../../../../shared/hosts';
import type {
  ConnectionDefaults,
  ConnectionParams,
  SslMode,
} from '../../../../shared/ipc-contract';

export type Mode = 'fields' | 'url' | 'socket';

export interface FormState {
  mode: Mode;
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
  url: string;
  /** `null` until the user picks one: it follows the host. */
  sslMode: SslMode | null;
  sslCaPath: string;
  remember: boolean;
}

export const initialState: FormState = {
  mode: 'fields',
  host: 'localhost',
  port: '5432',
  user: 'postgres',
  password: '',
  database: '',
  url: '',
  sslMode: null,
  sslCaPath: '',
  remember: false,
};

/** The URL in the connection-string field, if it is one. */
function parseUrl(text: string): URL | null {
  try {
    const url = new URL(text.trim());
    return url.protocol === 'postgres:' || url.protocol === 'postgresql:'
      ? url
      : null;
  } catch {
    return null;
  }
}

const hostOf = (state: FormState): string =>
  state.mode === 'url' ? (parseUrl(state.url)?.hostname ?? '') : state.host;

/** `disable` for this machine and for sockets, `require` for anywhere else. */
export const defaultSslMode = (state: FormState): SslMode =>
  state.mode === 'socket' || isLocalHost(hostOf(state)) ? 'disable' : 'require';

export const effectiveSslMode = (state: FormState): SslMode =>
  state.sslMode ?? defaultSslMode(state);

// libpq's names for what the selector offers; `verify-ca` and `allow` are the nearest of its modes
const URL_SSL_MODES: Record<string, SslMode> = {
  disable: 'disable',
  allow: 'prefer',
  prefer: 'prefer',
  require: 'require',
  'verify-ca': 'verify-full',
  'verify-full': 'verify-full',
};

/**
 * A pasted connection string: its `sslmode`, if it has one, sets the selector and is taken out of
 * the text, so the selector alone decides from then on.
 */
export function withUrl(state: FormState, text: string): FormState {
  const url = parseUrl(text);
  const sslmode = url?.searchParams.get('sslmode');
  if (!url || sslmode === null || sslmode === undefined)
    return { ...state, url: text };
  url.searchParams.delete('sslmode');
  return {
    ...state,
    url: url.toString(),
    sslMode: URL_SSL_MODES[sslmode] ?? state.sslMode,
  };
}

/** The local socket is let in by the operating system user, so there is no password to keep. */
export function withMode(
  state: FormState,
  mode: Mode,
  defaults: ConnectionDefaults,
): FormState {
  if (mode !== 'socket' || state.mode === 'socket') return { ...state, mode };
  return {
    ...state,
    mode,
    host: defaults.socketPath,
    user: defaults.osUser,
    password: '',
  };
}

export type FieldErrors = Partial<
  Record<'host' | 'port' | 'user' | 'database' | 'url' | 'sslCaPath', string>
>;

const required = (message: string) => z.string().trim().min(1, message);
const PORT_MESSAGE = 'Enter a port between 1 and 65535';
const port = z
  .string()
  .trim()
  .regex(/^\d+$/, PORT_MESSAGE)
  .transform(Number)
  .pipe(z.number().min(1, PORT_MESSAGE).max(65535, PORT_MESSAGE));

const fields = z.object({
  host: required('Enter a host'),
  port,
  user: required('Enter a user'),
  database: required('Enter a database name'),
});

const socket = fields.extend({
  host: required('Enter the socket directory').startsWith(
    '/',
    'The socket directory is a path starting with /',
  ),
});

const url = z.object({
  url: required('Enter a connection string').refine(
    (text) => parseUrl(text) !== null,
    'A connection string starts with postgres:// or postgresql://',
  ),
});

/** The database a connection string names: the path of the URL. */
const databaseOfUrl = (text: string): string =>
  decodeURIComponent(parseUrl(text)?.pathname.slice(1) ?? '');

/**
 * The connection parameters for the form, or what is wrong with it, field by field. Main checks
 * them again with the contract's own schema.
 */
export function validate(
  state: FormState,
): { params: ConnectionParams } | { errors: FieldErrors } {
  const sslMode = effectiveSslMode(state);
  const sslCaPath = state.sslCaPath.trim();
  const errors: FieldErrors = {};
  const collect = (error: z.ZodError) => {
    for (const issue of error.issues) {
      const key = String(issue.path[0]) as keyof FieldErrors;
      errors[key] ??= issue.message;
    }
  };
  if (sslMode === 'verify-full' && sslCaPath === '')
    errors.sslCaPath = 'Choose the CA certificate file';
  const ssl = { sslMode, ...(sslCaPath === '' ? {} : { sslCaPath }) };

  if (state.mode === 'url') {
    const parsed = url.safeParse(state);
    if (!parsed.success) collect(parsed.error);
    const database = parsed.success ? databaseOfUrl(state.url) : '';
    if (parsed.success && database === '')
      errors.url = 'Add the database to the connection string (…/database)';
    return Object.keys(errors).length > 0
      ? { errors }
      : { params: { kind: 'url', url: state.url.trim(), database, ...ssl } };
  }

  const parsed = (state.mode === 'socket' ? socket : fields).safeParse(state);
  if (!parsed.success) collect(parsed.error);
  if (!parsed.success || Object.keys(errors).length > 0) return { errors };
  const { host, port, user, database } = parsed.data;
  return state.mode === 'socket'
    ? { params: { kind: 'socket', host, port, user, database, ...ssl } }
    : {
        params: {
          kind: 'params',
          host,
          port,
          user,
          database,
          ...(state.password === '' ? {} : { password: state.password }),
          ...ssl,
        },
      };
}
