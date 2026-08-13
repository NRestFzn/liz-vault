import { test } from 'node:test';
import assert from 'node:assert';
import {
  generateManifestKey,
  encryptManifest,
  decryptManifest,
  isEncryptedManifest,
} from '../src/main/db/manifestCrypto';

test('encrypt → decrypt round-trip restores the exact plaintext', () => {
  const key = generateManifestKey();
  const plain = JSON.stringify({ version: 1, files: [{ id: 1, name: 'a.txt' }], chunks: [] });
  const stored = encryptManifest(plain, key);
  assert.strictEqual(decryptManifest(stored, key), plain);
});

test('ciphertext is prefixed and not plaintext', () => {
  const key = generateManifestKey();
  const plain = '{"a":1}';
  const stored = encryptManifest(plain, key);
  assert.strictEqual(isEncryptedManifest(stored), true);
  assert.notStrictEqual(stored, plain);
  assert.ok(!stored.includes(plain));
});

test('every encryption uses a fresh IV (non-deterministic)', () => {
  const key = generateManifestKey();
  const a = encryptManifest('same', key);
  const b = encryptManifest('same', key);
  assert.notStrictEqual(a, b);
});

test('legacy plaintext manifests pass through unchanged', () => {
  const plain = '{"version":1,"files":[],"chunks":[]}';
  assert.strictEqual(isEncryptedManifest(plain), false);
  assert.strictEqual(decryptManifest(plain, generateManifestKey()), plain);
});

test('wrong key → null (not garbage)', () => {
  const stored = encryptManifest('secret', generateManifestKey());
  assert.strictEqual(decryptManifest(stored, generateManifestKey()), null);
});

test('tampered ciphertext → null', () => {
  const key = generateManifestKey();
  const stored = encryptManifest('secret', key);
  const tampered = stored.slice(0, -2) + (stored.endsWith('AA') ? 'BB' : 'AA');
  assert.strictEqual(decryptManifest(tampered, key), null);
});

test('malformed encrypted payload → null', () => {
  assert.strictEqual(decryptManifest('lv1m:not-enough-parts', generateManifestKey()), null);
});

test('generateManifestKey returns a 32-byte base64 key', () => {
  const key = generateManifestKey();
  assert.strictEqual(Buffer.from(key, 'base64').length, 32);
});
