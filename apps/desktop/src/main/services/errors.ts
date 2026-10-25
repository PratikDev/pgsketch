import { redact } from '../log';

/** Where a connection was going, for the messages that name it. */
export interface ConnectionTarget {
  host: string;
  port: number | null;
  user: string | null;
}

/** A failure to connect or to use the server, with a message meant to be shown to the user as it is. */
export class ConnectionError extends Error {
  constructor(message: string, options?: { cause?: Error }) {
    super(message, options);
    this.name = 'ConnectionError';
  }
}

export class UnsupportedVersionError extends Error {
  constructor(readonly found: string) {
    super(`pgsketch needs Postgres 14 or newer (found ${found})`);
    this.name = 'UnsupportedVersionError';
  }
}

/** What `pg` says when the server answers an SSL request with "no". */
export const SSL_REFUSED = 'The server does not support SSL connections';

// Node's names for a certificate that can't be trusted
const CERTIFICATE_CODES = [
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_UNTRUSTED',
  'CERT_REVOKED',
  'HOSTNAME_MISMATCH',
];

/** The `code` an error carries, if any: a Node error name or a Postgres SQLSTATE. */
function codeOf(error: Error): string | undefined {
  return 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

/**
 * The message for a failed connection, from the signals in the plan's table. Anything not in the
 * table gets the driver's own first line, with any password removed.
 */
export function describeConnectionError(
  error: Error,
  { host, port, user }: ConnectionTarget,
): string {
  if (error instanceof UnsupportedVersionError) return error.message;
  const code = codeOf(error);
  if (code === 'ECONNREFUSED' || code === 'ENOENT')
    return `Couldn't reach Postgres at ${port === null ? host : `${host}:${port}`}. Is it running?`;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'Host not found';
  if (
    code === 'ETIMEDOUT' ||
    /connection timeout|timeout expired/i.test(error.message)
  )
    return 'Connection timed out';
  if (code === '28P01')
    return `Password authentication failed for user${user === null ? '' : ` "${user}"`}`;
  if (code === '28000')
    return 'Authentication rejected (check pg_hba.conf or the peer auth user)';
  if (code === '3D000') return "Database doesn't exist on this server";
  if (error.message === SSL_REFUSED)
    return "The server doesn't accept SSL connections; choose disable or prefer";
  if (
    code !== undefined &&
    (CERTIFICATE_CODES.includes(code) || code.startsWith('ERR_TLS_CERT'))
  )
    return "The server's certificate couldn't be verified with the given CA file";
  return redact(error.message.split('\n')[0] ?? '');
}
