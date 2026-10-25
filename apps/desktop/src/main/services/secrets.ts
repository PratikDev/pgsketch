import type { SafeStorage } from 'electron';

/** The part of `safeStorage` this uses, so tests can use a stand-in. */
export type SafeStorageLike = Pick<
  SafeStorage,
  | 'isEncryptionAvailable'
  | 'getSelectedStorageBackend'
  | 'encryptString'
  | 'decryptString'
>;

/** Why a password can't be remembered or read back right now. */
export type SecretsProblem = 'not-ready' | 'unavailable' | 'weak-backend';

export class SecretsUnavailableError extends Error {
  constructor(readonly problem: SecretsProblem) {
    super(
      {
        'not-ready': 'Passwords can only be stored once the app has started',
        unavailable: 'This system has no way to encrypt passwords',
        'weak-backend':
          'No system keyring is available, so passwords are not stored',
      }[problem],
    );
    this.name = 'SecretsUnavailableError';
  }
}

/**
 * Keyrings that really protect the password. On Linux, without one `safeStorage` falls back to a
 * key written into the app, which protects nothing (`basic_text`), and before the app is ready it
 * can't tell (`unknown`); anything not listed here is treated the same.
 */
const KEYRINGS = ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'];

/**
 * Passwords are encrypted with the system keyring through `safeStorage`, and refused when there
 * isn't one. `isReady` is `app.isReady`: the backend is only asked once it is true, because Electron
 * answers `unknown` before the `ready` event.
 */
export function createSecrets(
  storage: SafeStorageLike,
  isReady: () => boolean,
) {
  /** Whether a password can be remembered now, and if not, why. */
  function problem(): SecretsProblem | null {
    if (!isReady()) return 'not-ready';
    if (!storage.isEncryptionAvailable()) return 'unavailable';
    return KEYRINGS.includes(storage.getSelectedStorageBackend())
      ? null
      : 'weak-backend';
  }

  function assertAvailable(): void {
    const found = problem();
    if (found) throw new SecretsUnavailableError(found);
  }

  return {
    problem,

    /** Encrypts a password for the app database; throws `SecretsUnavailableError` when it can't be kept safely. */
    encrypt(password: string): Uint8Array {
      assertAvailable();
      return storage.encryptString(password);
    },

    /** The password behind what `encrypt` returned. */
    decrypt(encrypted: Uint8Array): string {
      assertAvailable();
      return storage.decryptString(Buffer.from(encrypted));
    },
  };
}

export type Secrets = ReturnType<typeof createSecrets>;
