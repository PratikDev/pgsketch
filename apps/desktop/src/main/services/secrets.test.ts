import { describe, expect, test, vi } from 'vitest';
import {
  createSecrets,
  SecretsUnavailableError,
  type SafeStorageLike,
} from './secrets';

type Backend = ReturnType<SafeStorageLike['getSelectedStorageBackend']>;

/** A keyring that "encrypts" by reversing the bytes, with a backend and availability to choose. */
function storage(backend: Backend, available = true) {
  return {
    isEncryptionAvailable: vi.fn(() => available),
    getSelectedStorageBackend: vi.fn(() => backend),
    encryptString: vi.fn((text: string) => Buffer.from(text).reverse()),
    decryptString: vi.fn((data: Buffer) =>
      Buffer.from(data).reverse().toString(),
    ),
  } satisfies SafeStorageLike;
}

const refused = (run: () => unknown, problem: string) => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(SecretsUnavailableError);
    expect((error as SecretsUnavailableError).problem).toBe(problem);
    return;
  }
  throw new Error('was not refused');
};

describe('remembering a password', () => {
  test.each(['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'] as const)(
    'works with the %s keyring, and reads back',
    (backend) => {
      const secrets = createSecrets(storage(backend), () => true);
      expect(secrets.problem()).toBeNull();
      const encrypted = secrets.encrypt('hunter2');
      expect(Buffer.from(encrypted).toString()).not.toContain('hunter2');
      expect(secrets.decrypt(encrypted)).toBe('hunter2');
    },
  );

  test.each(['basic_text', 'unknown'] as const)(
    'is refused with %s, and nothing is encrypted',
    (backend) => {
      const s = storage(backend);
      const secrets = createSecrets(s, () => true);
      expect(secrets.problem()).toBe('weak-backend');
      refused(() => secrets.encrypt('hunter2'), 'weak-backend');
      refused(() => secrets.decrypt(new Uint8Array([1])), 'weak-backend');
      expect(s.encryptString).not.toHaveBeenCalled();
      expect(s.decryptString).not.toHaveBeenCalled();
    },
  );

  test('is refused when the system cannot encrypt at all', () => {
    const s = storage('gnome_libsecret', false);
    const secrets = createSecrets(s, () => true);
    expect(secrets.problem()).toBe('unavailable');
    refused(() => secrets.encrypt('x'), 'unavailable');
    expect(s.getSelectedStorageBackend).not.toHaveBeenCalled();
  });

  test('a backend that is not on the list is treated like basic_text', () => {
    const odd = storage('keyring_of_the_future' as Backend);
    expect(createSecrets(odd, () => true).problem()).toBe('weak-backend');
  });

  test('the error says what is wrong without a password in it', () => {
    const secrets = createSecrets(storage('basic_text'), () => true);
    try {
      secrets.encrypt('hunter2');
    } catch (error) {
      expect((error as Error).message).toContain('No system keyring');
      expect((error as Error).message).not.toContain('hunter2');
    }
  });
});

describe('the keyring check', () => {
  test('never runs before the app is ready, and runs once it is', () => {
    const s = storage('gnome_libsecret');
    let ready = false;
    const secrets = createSecrets(s, () => ready);

    expect(secrets.problem()).toBe('not-ready');
    refused(() => secrets.encrypt('x'), 'not-ready');
    refused(() => secrets.decrypt(new Uint8Array([1])), 'not-ready');
    expect(s.getSelectedStorageBackend).not.toHaveBeenCalled();
    expect(s.isEncryptionAvailable).not.toHaveBeenCalled();
    expect(s.encryptString).not.toHaveBeenCalled();

    ready = true;
    expect(secrets.problem()).toBeNull();
    expect(s.getSelectedStorageBackend).toHaveBeenCalledTimes(1);
  });

  test('is asked again each time, so a keyring that appears later is used', () => {
    let backend: Backend = 'basic_text';
    const s = storage('basic_text');
    s.getSelectedStorageBackend.mockImplementation(() => backend);
    const secrets = createSecrets(s, () => true);
    expect(secrets.problem()).toBe('weak-backend');
    backend = 'kwallet6';
    expect(secrets.problem()).toBeNull();
  });
});
