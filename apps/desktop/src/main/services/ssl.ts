import type { ConnectionOptions } from 'node:tls';
import type { SslMode } from '../../shared/ipc-contract';

/** The `ssl` option of `pg`: `false` for plaintext, otherwise TLS options. */
export type SslConfig = false | ConnectionOptions;

/**
 * What to try, in order, for an SSL mode, with the libpq meanings. The mode is never handed to
 * `pg` as `sslmode`, whose parser reads the weaker modes as `verify-full`.
 *
 * - `disable`: plaintext.
 * - `prefer`: encrypted, and plaintext only if the server refuses SSL.
 * - `require`: encrypted, and the server isn't verified.
 * - `verify-full`: encrypted, with the certificate checked against the CA file and the host name.
 */
export function sslAttempts(
  mode: SslMode,
  ca: string | undefined,
): SslConfig[] {
  switch (mode) {
    case 'disable':
      return [false];
    case 'prefer':
      return [{ rejectUnauthorized: false }, false];
    case 'require':
      return [{ rejectUnauthorized: false }];
    case 'verify-full':
      if (ca === undefined)
        throw new Error('verify-full needs a CA certificate');
      return [{ ca, rejectUnauthorized: true }];
  }
}
