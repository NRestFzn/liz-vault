import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initConfig, addUser, setAppState, getAppState } from '../src/main/db/config';
import { initManifest, addFile, trashFile, restoreFile, getTrashedFiles, getFile, cancelScheduledSave } from '../src/main/db/manifest';
import { sweepExpiredTrash } from '../src/main/vault/delete';

const USER = 7;

function freshConfig(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lizvault-trash-sweep-'));
}

beforeEach(() => {
  initConfig(freshConfig());
  initManifest();
  addUser({ email: 'a@b.com', refresh_token: 'tok1', display_name: null, avatar_url: null, root_folder_id: null });
  setAppState('autoEmptyTrashDays', '7');
});
afterEach(() => {
  cancelScheduledSave();
});

function file(name: string) {
  return addFile({
    user_id: USER,
    name,
    size_bytes: 10,
    mime_type: null,
    status: 'ready',
    is_folder: 0,
    parent_folder_id: null,
    is_starred: 0,
  });
}

test('sweep deletes only items older than the retention window', async () => {
  assert.strictEqual(getAppState('autoEmptyTrashDays'), '7');

  const fresh = file('fresh.txt');
  const old = file('old.txt');
  trashFile(USER, fresh.id);
  trashFile(USER, old.id);

  const oldRow = getFile(old.id, USER);
  assert.ok(oldRow);
  oldRow.deleted_at = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');

  await sweepExpiredTrash(USER);

  assert.strictEqual(getFile(old.id, USER), undefined);
  assert.deepStrictEqual(getTrashedFiles(USER).map(x => x.name), ['fresh.txt']);
});

test('sweep is a no-op when auto-empty is disabled', async () => {
  setAppState('autoEmptyTrashDays', '0');
  const old = file('old.txt');
  trashFile(USER, old.id);
  const row = getFile(old.id, USER);
  assert.ok(row);
  row.deleted_at = '2020-01-01 00:00:00';

  await sweepExpiredTrash(USER);

  assert.ok(getFile(old.id, USER));
});

test('restored items are never swept', async () => {
  const f = file('restored.txt');
  trashFile(USER, f.id);
  const row = getFile(f.id, USER);
  assert.ok(row);
  row.deleted_at = '2020-01-01 00:00:00';
  restoreFile(USER, f.id);

  await sweepExpiredTrash(USER);

  assert.ok(getFile(f.id, USER));
  assert.deepStrictEqual(getTrashedFiles(USER), []);
});
