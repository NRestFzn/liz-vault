import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  initConfig,
  addUser,
  getUser,
  addAccount,
  getAccount,
  getAllAccounts,
  updateAccountUsage,
  updateAccountRootFolder,
  setActiveUserId,
  getActiveUserId,
  setGoogleCredentials,
  getGoogleCredentials,
  setOneDriveCredentials,
  getOneDriveCredentials,
  setAppState,
  getAppState,
  deleteAppState,
  setAccountTokenStatus,
  ensureUserManifestKey,
} from '../src/main/db/config';

function freshConfig(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lizvault-config-test-'));
}

test('addUser creates a user with sequential ids', () => {
  initConfig(freshConfig());
  const u1 = addUser({ email: 'a@b.com', refresh_token: 'tok1', display_name: null, avatar_url: null, root_folder_id: null });
  const u2 = addUser({ email: 'c@d.com', refresh_token: 'tok2', display_name: 'C', avatar_url: null, root_folder_id: 'fid' });
  assert.strictEqual(u1.id, 1);
  assert.strictEqual(u2.id, 2);
  assert.strictEqual(getUser(u1.id)?.email, 'a@b.com');
});

test('ensureUserManifestKey generates once, persists, and survives reload', () => {
  const dir = freshConfig();
  initConfig(dir);
  const u = addUser({ email: 'a@b.com', refresh_token: 'tok1', display_name: null, avatar_url: null, root_folder_id: null });
  const k1 = ensureUserManifestKey(u.id);
  assert.ok(k1.length > 16);
  assert.strictEqual(ensureUserManifestKey(u.id), k1); // idempotent

  initConfig(dir); // reload from disk
  assert.strictEqual(getUser(u.id)?.manifest_key, k1);
});

test('re-adding the same email upserts without duplicating', () => {
  const dir = freshConfig();
  initConfig(dir);
  const u1 = addUser({ email: 'a@b.com', refresh_token: 'tok1', display_name: null, avatar_url: null, root_folder_id: null });
  const u2 = addUser({ email: 'a@b.com', refresh_token: 'tok2', display_name: 'New', avatar_url: null, root_folder_id: 'fid' });
  assert.strictEqual(u2.id, u1.id);
  const parsed = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf-8'));
  assert.strictEqual(parsed.users.length, 1);
  assert.strictEqual(u2.refresh_token, 'tok2');
  assert.strictEqual(u2.display_name, 'New');
  assert.strictEqual(u2.root_folder_id, 'fid');
});

test('null root_folder_id on upsert never erases an existing one', () => {
  initConfig(freshConfig());
  addUser({ email: 'a@b.com', refresh_token: 'tok1', display_name: null, avatar_url: null, root_folder_id: 'fid' });
  const u2 = addUser({ email: 'a@b.com', refresh_token: 'tok2', display_name: null, avatar_url: null, root_folder_id: null });
  assert.strictEqual(u2.root_folder_id, 'fid');
});

test('a storage account email cannot log in as the main account', () => {
  initConfig(freshConfig());
  addAccount({ user_id: 1, email: 'storage@gmail.com', refresh_token: 't', total_bytes: 15e9, used_bytes: 0, root_folder_id: 'f' });
  assert.throws(
    () => addUser({ email: 'storage@gmail.com', refresh_token: 't2', display_name: null, avatar_url: null, root_folder_id: null }),
    /already connected as a drive storage account/
  );
});

test('addAccount upserts by email and sets token status', () => {
  initConfig(freshConfig());
  const a1 = addAccount({ user_id: 1, email: 's@gmail.com', refresh_token: 't', total_bytes: 15e9, used_bytes: 3e9, root_folder_id: 'f1' });
  const a2 = addAccount({ user_id: 1, email: 's@gmail.com', refresh_token: 't2', total_bytes: 15e9, used_bytes: 5e9, root_folder_id: 'f2' });
  assert.strictEqual(a2.id, a1.id);
  assert.strictEqual(a2.used_bytes, 5e9);
  assert.strictEqual(getAllAccounts(1).length, 1);
  setAccountTokenStatus(a2.id, false);
  assert.strictEqual(getAccount(a2.id, 1)?.token_ok, 0);
});

test('updateAccountUsage and updateAccountRootFolder mutate persisted state', () => {
  initConfig(freshConfig());
  const a = addAccount({ user_id: 1, email: 's@gmail.com', refresh_token: 't', total_bytes: 15e9, used_bytes: 0, root_folder_id: 'f1' });
  updateAccountUsage(a.id, 1, 8e9);
  assert.strictEqual(getAccount(a.id, 1)?.used_bytes, 8e9);
  updateAccountRootFolder(a.id, 1, 'f2');
  assert.strictEqual(getAccount(a.id, 1)?.root_folder_id, 'f2');
});

test('onedrive credentials are stored separately from google', () => {
  initConfig(freshConfig());
  setOneDriveCredentials('od-cid', 'od-secret');
  setGoogleCredentials('g-cid', 'g-secret');
  assert.deepStrictEqual(getOneDriveCredentials(), { clientId: 'od-cid', clientSecret: 'od-secret' });
  assert.deepStrictEqual(getGoogleCredentials(), { clientId: 'g-cid', clientSecret: 'g-secret' });

  initConfig(freshConfig());
  assert.deepStrictEqual(getOneDriveCredentials(), { clientId: '', clientSecret: '' });
  setOneDriveCredentials('od-cid', 'od-secret');

  const dir = freshConfig();
  initConfig(dir);
  setOneDriveCredentials('persisted', 'secret');
  initConfig(dir);
  assert.deepStrictEqual(getOneDriveCredentials(), { clientId: 'persisted', clientSecret: 'secret' });
});

test('accounts default to google provider and persist provider across reload', () => {
  const dir = freshConfig();
  initConfig(dir);
  const a = addAccount({ user_id: 1, email: 's@gmail.com', refresh_token: 't', total_bytes: 15e9, used_bytes: 0, root_folder_id: 'f' });
  assert.strictEqual(a.provider, 'google');
  const od = addAccount({ user_id: 1, email: 'od@outlook.com', refresh_token: 't', total_bytes: 1e12, used_bytes: 0, root_folder_id: 'f', provider: 'onedrive' });
  assert.strictEqual(od.provider, 'onedrive');

  initConfig(dir);
  const loaded = getAllAccounts(1);
  assert.strictEqual(loaded.find(x => x.id === a.id)?.provider, 'google');
  assert.strictEqual(loaded.find(x => x.id === od.id)?.provider, 'onedrive');
});

test('active user, credentials and app state persist', () => {
  initConfig(freshConfig());
  const u = addUser({ email: 'a@b.com', refresh_token: 't', display_name: null, avatar_url: null, root_folder_id: null });
  setActiveUserId(u.id);
  setGoogleCredentials('cid', 'csecret');
  setAppState('confirmDelete', '0');
  assert.strictEqual(getActiveUserId(), u.id);
  assert.deepStrictEqual(getGoogleCredentials(), { clientId: 'cid', clientSecret: 'csecret' });
  assert.strictEqual(getAppState('confirmDelete'), '0');
  deleteAppState('confirmDelete');
  assert.strictEqual(getAppState('confirmDelete'), null);
});

test('config round-trips to disk (reload keeps state)', () => {
  const dir = freshConfig();
  initConfig(dir);
  const u = addUser({ email: 'a@b.com', refresh_token: 't', display_name: 'A', avatar_url: null, root_folder_id: 'fid' });
  addAccount({ user_id: u.id, email: 's@gmail.com', refresh_token: 't2', total_bytes: 15e9, used_bytes: 0, root_folder_id: 'f2' });
  setActiveUserId(u.id);

  initConfig(dir); // simulate app restart
  assert.strictEqual(getActiveUserId(), u.id);
  assert.strictEqual(getUser(u.id)?.root_folder_id, 'fid');
  assert.strictEqual(getAllAccounts(u.id)[0]?.email, 's@gmail.com');
});

