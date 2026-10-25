import { describe, expect, test } from 'vitest';
import { SSL_MODES } from '../../shared/ipc-contract';
import { sslAttempts } from './ssl';

describe('sslAttempts', () => {
  test('disable is plaintext only', () => {
    expect(sslAttempts('disable', undefined)).toEqual([false]);
  });

  test('require is encrypted without verifying the server', () => {
    expect(sslAttempts('require', undefined)).toEqual([
      { rejectUnauthorized: false },
    ]);
  });

  test('prefer tries encrypted first and plaintext second', () => {
    expect(sslAttempts('prefer', undefined)).toEqual([
      { rejectUnauthorized: false },
      false,
    ]);
  });

  test('verify-full checks the certificate against the CA file, and needs one', () => {
    expect(sslAttempts('verify-full', 'PEM')).toEqual([
      { ca: 'PEM', rejectUnauthorized: true },
    ]);
    expect(() => sslAttempts('verify-full', undefined)).toThrow(
      'CA certificate',
    );
  });

  test('every mode in the contract is handled, and none is passed on as sslmode', () => {
    for (const mode of SSL_MODES) {
      const attempts = sslAttempts(mode, 'PEM');
      expect(attempts.length).toBeGreaterThan(0);
      expect(JSON.stringify(attempts)).not.toContain('sslmode');
    }
  });
});
