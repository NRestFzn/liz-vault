import { test, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encryptToken, decryptToken, setSafeStorageBackendForTests } from '../src/main/db/crypto';
import { initConfig, addUser, getUser, addAccount, getAccount } from '../src/main/db/config';

function fakeBackend() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) => Buffer.from(`enc(${plain})`),
    decryptString: (buf: Buffer) => buf.toString().replace(/^enc\(/, '').replace(/\)$/, ''),
  };
}

function freshConfig(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lizvault-crypto-test-'));
}

afterEach(() => {
  setSafeStorageBackendForTests(null);
});

test('encrypt/decrypt round-trips through the backend', () => {
  setSafeStorageBackendForTests(fakeBackend());
  const enc = encryptToken('secret-token');
  assert.ok(enc.startsWith('lv1:'));
  assert.notStrictEqual(enc, 'secret-token');
  assert.strictEqual(decryptToken(enc), 'secret-token');
});

test('without a backend, tokens pass through as plaintext (Linux fallback)', () => {
  setSafeStorageBackendForTests(null);
  assert.strictEqual(encryptToken('secret-token'), 'secret-token');
  assert.strictEqual(decryptToken('secret-token'), 'secret-token');
});

test('empty tokens are never encrypted', () => {
  setSafeStorageBackendForTests(fakeBackend());
  assert.strictEqual(encryptToken(''), '');
});

test('legacy plaintext (no prefix) is returned as-is for migration', () => {
  setSafeStorageBackendForTests(fakeBackend());
  assert.strictEqual(decryptToken('plain-value'), 'plain-value');
});

test('undecryptable value (bad key) yields an empty token, not garbage', () => {
  setSafeStorageBackendForTests({
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) => Buffer.from(`enc(${plain})`),
    decryptString: () => {
      throw new Error('bad key');
    },
  });
  assert.strictEqual(decryptToken('lv1:AAAA'), '');
});

test('config stores tokens encrypted on disk and decrypts them on reload', () => {
  setSafeStorageBackendForTests(fakeBackend());
  const dir = freshConfig();
  initConfig(dir);
  const u = addUser({ email: 'a@b.com', refresh_token: 'USER-SECRET', display_name: null, avatar_url: null, root_folder_id: null });
  const a = addAccount({ user_id: u.id, email: 's@b.com', refresh_token: 'ACCOUNT-SECRET', total_bytes: 1e9, used_bytes: 0, root_folder_id: null });

  const raw = fs.readFileSync(path.join(dir, 'config.json'), 'utf-8');
  assert.ok(!raw.includes('USER-SECRET'), 'user token leaked to disk');
  assert.ok(!raw.includes('ACCOUNT-SECRET'), 'account token leaked to disk');
  assert.ok(raw.includes('lv1:'), 'expected encrypted prefix on disk');

  initConfig(dir); // simulate app restart
  assert.strictEqual(getUser(u.id)?.refresh_token, 'USER-SECRET');
  assert.strictEqual(getAccount(a.id, u.id)?.refresh_token, 'ACCOUNT-SECRET');
});

test('legacy plaintext config is migrated to encrypted on next save', () => {
  setSafeStorageBackendForTests(fakeBackend());
  const dir = freshConfig();
  const legacy = {
    googleClientId: '',
    googleClientSecret: '',
    activeUserId: 1,
    users: [
      { id: 1, user_id: 1, email: 'a@b.com', refresh_token: 'PLAIN-TOKEN', display_name: null, avatar_url: null, root_folder_id: null, added_at: '' },
    ],
    accounts: [],
    app_state: {},
    nextUserId: 2,
    nextAccountId: 1,
  };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(legacy), 'utf-8');

  initConfig(dir); // loads (plaintext passthrough) and immediately saves → encrypted
  assert.strictEqual(getUser(1)?.refresh_token, 'PLAIN-TOKEN');

  const raw = fs.readFileSync(path.join(dir, 'config.json'), 'utf-8');
  assert.ok(!raw.includes('PLAIN-TOKEN'), 'plaintext token still on disk after migration');
  assert.ok(raw.includes('lv1:'), 'expected encrypted prefix after migration');
});
