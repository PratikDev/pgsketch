import { describe, expect, test } from 'vitest';
import {
  describeConnectionError,
  SSL_REFUSED,
  UnsupportedVersionError,
} from './errors';

const target = { host: 'db.local', port: 5432, user: 'alice' };

/** An error the way `pg` and Node raise them: a message and a `code`. */
const failure = (message: string, code?: string): Error =>
  Object.assign(new Error(message), code === undefined ? {} : { code });

describe('describeConnectionError', () => {
  test.each([
    [
      failure('connect ECONNREFUSED 127.0.0.1:5432', 'ECONNREFUSED'),
      "Couldn't reach Postgres at db.local:5432. Is it running?",
    ],
    [failure('getaddrinfo ENOTFOUND db.local', 'ENOTFOUND'), 'Host not found'],
    [
      failure('Connection terminated due to connection timeout'),
      'Connection timed out',
    ],
    [failure('timeout expired'), 'Connection timed out'],
    [
      failure('connect ETIMEDOUT 10.0.0.1:5432', 'ETIMEDOUT'),
      'Connection timed out',
    ],
    [
      failure('password authentication failed for user "alice"', '28P01'),
      'Password authentication failed for user "alice"',
    ],
    [
      failure('no pg_hba.conf entry for host', '28000'),
      'Authentication rejected (check pg_hba.conf or the peer auth user)',
    ],
    [
      failure('database "nope" does not exist', '3D000'),
      "Database doesn't exist on this server",
    ],
    [
      failure(SSL_REFUSED),
      "The server doesn't accept SSL connections; choose disable or prefer",
    ],
    [
      failure('self-signed certificate', 'DEPTH_ZERO_SELF_SIGNED_CERT'),
      "The server's certificate couldn't be verified with the given CA file",
    ],
    [
      failure(
        'self-signed certificate in certificate chain',
        'SELF_SIGNED_CERT_IN_CHAIN',
      ),
      "The server's certificate couldn't be verified with the given CA file",
    ],
    [
      failure(
        'unable to verify the first certificate',
        'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      ),
      "The server's certificate couldn't be verified with the given CA file",
    ],
    [
      failure('certificate has expired', 'CERT_HAS_EXPIRED'),
      "The server's certificate couldn't be verified with the given CA file",
    ],
    [
      failure(
        "Hostname/IP does not match certificate's altnames",
        'ERR_TLS_CERT_ALTNAME_INVALID',
      ),
      "The server's certificate couldn't be verified with the given CA file",
    ],
    [
      new UnsupportedVersionError('13.14'),
      'pgsketch needs Postgres 14 or newer (found 13.14)',
    ],
  ])('%s', (error, message) => {
    expect(describeConnectionError(error, target)).toBe(message);
  });

  test('a socket has no port in the message when there is none, and an unknown user is left out', () => {
    expect(
      describeConnectionError(failure('x', 'ENOENT'), {
        host: '/var/run/postgresql',
        port: null,
        user: null,
      }),
    ).toBe("Couldn't reach Postgres at /var/run/postgresql. Is it running?");
    expect(
      describeConnectionError(failure('x', '28P01'), {
        host: 'h',
        port: 1,
        user: null,
      }),
    ).toBe('Password authentication failed for user');
  });

  test('a statement or lock timeout is not a connection timeout', () => {
    expect(
      describeConnectionError(
        failure('canceling statement due to lock timeout', '55P03'),
        target,
      ),
    ).toBe('canceling statement due to lock timeout');
  });

  test('a signal is read from its code, not from words that happen to be in a message', () => {
    expect(
      describeConnectionError(
        failure('ECONNREFUSED in the middle of a sentence'),
        target,
      ),
    ).toBe('ECONNREFUSED in the middle of a sentence');
  });

  test('anything else is the first line of the driver message, with passwords removed', () => {
    expect(
      describeConnectionError(
        failure(
          'invalid connection for postgres://alice:hunter2@h/db\nat somewhere',
        ),
        target,
      ),
    ).toBe('invalid connection for postgres://alice:***@h/db');
    expect(describeConnectionError(failure('boom'), target)).toBe('boom');
    expect(describeConnectionError(failure(''), target)).toBe('');
  });
});
