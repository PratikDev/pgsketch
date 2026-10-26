import { z } from 'zod';
import { isLocalHost } from '../../../../shared/hosts';
import {
  sslModeSchema,
  type ConnectionParams,
  type SslMode,
} from '../../../../shared/ipc-contract';

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

/** The database a connection string names: the path of the URL. */
const databaseOfUrl = (text: string): string =>
  decodeURIComponent(parseUrl(text)?.pathname.slice(1) ?? '');

const required = (message: string) => z.string().trim().min(1, message);
const PORT_MESSAGE = 'Enter a port between 1 and 65535';
const port = z
  .string()
  .trim()
  .regex(/^\d+$/, PORT_MESSAGE)
  .transform(Number)
  .pipe(z.number().min(1, PORT_MESSAGE).max(65535, PORT_MESSAGE));

/** Every field of the form, as typed; each mode then checks the ones it uses. */
const everything = z.object({
  host: z.string(),
  port: z.string(),
  user: z.string(),
  password: z.string(),
  database: z.string(),
  url: z.string(),
  /** `null` until the user picks one: it follows the host. */
  sslMode: sslModeSchema.nullable(),
  sslCaPath: z.string(),
  remember: z.boolean(),
});

const fieldsMode = everything.extend({
  mode: z.literal('fields'),
  host: required('Enter a host'),
  port,
  user: required('Enter a user'),
  database: required('Enter a database name'),
});

const socketMode = fieldsMode.extend({
  mode: z.literal('socket'),
  host: required('Enter the socket directory').startsWith(
    '/',
    'The socket directory is a path starting with /',
  ),
});

const urlMode = everything.extend({
  mode: z.literal('url'),
  url: required('Enter a connection string').refine(
    (text) => parseUrl(text) !== null,
    'A connection string starts with postgres:// or postgresql://',
  ),
});

/** What the SSL default depends on, which the input and the checked values both have. */
interface SslInputs {
  mode: 'fields' | 'url' | 'socket';
  host: string;
  url: string;
  sslMode: SslMode | null;
}

const hostOf = (v: SslInputs): string =>
  v.mode === 'url' ? (parseUrl(v.url)?.hostname ?? '') : v.host;

/** `disable` for this machine and for sockets, `require` for anywhere else. */
export const defaultSslMode = (v: SslInputs): SslMode =>
  v.mode === 'socket' || isLocalHost(hostOf(v)) ? 'disable' : 'require';

export const effectiveSslMode = (v: SslInputs): SslMode =>
  v.sslMode ?? defaultSslMode(v);

/**
 * The form's values: one schema, a union by mode, with a message for each field. What it makes of
 * them is the connection parameters and whether to remember them.
 */
export const connectSchema = z
  .discriminatedUnion('mode', [fieldsMode, socketMode, urlMode])
  .superRefine((v, ctx) => {
    if (effectiveSslMode(v) === 'verify-full' && v.sslCaPath.trim() === '')
      ctx.addIssue({
        code: 'custom',
        path: ['sslCaPath'],
        message: 'Choose the CA certificate file',
      });
    if (v.mode === 'url' && databaseOfUrl(v.url) === '')
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message: 'Add the database to the connection string (…/database)',
      });
  })
  .transform((v): { params: ConnectionParams; remember: boolean } => {
    const caPath = v.sslCaPath.trim();
    const ssl = {
      sslMode: effectiveSslMode(v),
      ...(caPath === '' ? {} : { sslCaPath: caPath }),
    };
    const params: ConnectionParams =
      v.mode === 'url'
        ? {
            kind: 'url',
            url: v.url.trim(),
            database: databaseOfUrl(v.url),
            ...ssl,
          }
        : v.mode === 'socket'
          ? {
              kind: 'socket',
              host: v.host,
              port: v.port,
              user: v.user,
              database: v.database,
              ...ssl,
            }
          : {
              kind: 'params',
              host: v.host,
              port: v.port,
              user: v.user,
              database: v.database,
              ...(v.password === '' ? {} : { password: v.password }),
              ...ssl,
            };
    return { params, remember: v.remember };
  });

export type ConnectValues = z.input<typeof connectSchema>;
export type Mode = ConnectValues['mode'];

export const initialValues: ConnectValues = {
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
 * The `sslmode` of a pasted connection string, as a selector value (null for one that isn't
 * known), with the string as it is without it. `null` when the text has no `sslmode` to move.
 */
export function takeSslMode(
  text: string,
): { text: string; sslMode: SslMode | null } | null {
  const url = parseUrl(text);
  const sslmode = url?.searchParams.get('sslmode');
  if (!url || sslmode === null || sslmode === undefined) return null;
  url.searchParams.delete('sslmode');
  return { text: url.toString(), sslMode: URL_SSL_MODES[sslmode] ?? null };
}
