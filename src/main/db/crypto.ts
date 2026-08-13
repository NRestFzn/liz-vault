import { safeStorage } from 'electron';
import { errorMessage } from '../errors';

/**
 * Refresh tokens are encrypted on disk with Electron `safeStorage` (OS-backed:
 * DPAPI on Windows, Keychain on macOS). The decryption key is tied to the OS
 * user account, so a copied config.json is useless on another machine.
 *
 * - `encryptToken` / `decryptToken` are no-ops when safeStorage is unavailable
 *   (e.g. Linux without a secret store, or tests) — tokens stay plaintext.
 * - Legacy plaintext tokens are detected (no prefix) and re-encrypted on the
 *   next save automatically.
 */

const PREFIX = 'lv1:';

interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

let backend: SafeStorageLike | null | undefined ; // undefined = not resolved yet

function resolveBackend(): SafeStorageLike | null {
  if (backend !== undefined) return backend;
  try {
    if (safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable()) {
      backend = safeStorage as SafeStorageLike;
    } else {
      backend = null;
    }
  } catch {
    backend = null;
  }
  return backend;
}

/** Test hook: inject a fake safeStorage backend, or null to force plaintext. */
export function setSafeStorageBackendForTests(b: SafeStorageLike | null): void {
  backend = b;
}

export function isTokenEncryptionAvailable(): boolean {
  return resolveBackend() != null;
}

export function encryptToken(plain: string): string {
  if (!plain) return plain;
  const b = resolveBackend();
  if (!b) return plain;
  try {
    return PREFIX + b.encryptString(plain).toString('base64');
  } catch (e) {
    console.warn('[Crypto] Token encryption failed — storing plaintext:', errorMessage(e));
    return plain;
  }
}

export function decryptToken(stored: string): string {
  if (!stored?.startsWith(PREFIX)) return stored; // legacy plaintext — migrate on next save
  const b = resolveBackend();
  if (!b) return stored;
  try {
    return b.decryptString(Buffer.from(stored.slice(PREFIX.length), 'base64'));
  } catch (e) {
    console.warn('[Crypto] Token decryption failed — token unusable, re-login required:', errorMessage(e));
    return '';
  }
}
