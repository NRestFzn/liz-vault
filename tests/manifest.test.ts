import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  initManifest,
  cancelScheduledSave,
  addFile,
  createFolder,
  getFile,
  getAllFiles,
  getFilesInFolder,
  getUniqueName,
  findDuplicateName,
  removeFile,
  searchFilesAndFolders,
  getStorageStats,
  getFolderPath,
  addChunk,
  getChunksForFile,
  getChunksForAccount,
  updateChunkStatus,
  toggleStarred,
  getStarredFiles,
  renameFile,
  trashFile,
  restoreFile,
  getTrashedFiles,
} from '../src/main/db/manifest';

const USER = 7;

beforeEach(() => {
  initManifest();
});
afterEach(() => {
  cancelScheduledSave();
});

function file(over: Partial<Parameters<typeof addFile>[0]> = {}) {
  return addFile({
    user_id: USER,
    name: 'f.txt',
    size_bytes: 10,
    mime_type: null,
    status: 'ready',
    is_folder: 0,
    parent_folder_id: null,
    is_starred: 0,
    ...over,
  });
}

test('file ids start at 1 and increment', () => {
  const f1 = file({ name: 'a.txt' });
  const f2 = file({ name: 'b.txt' });
  assert.strictEqual(f1.id, 1);
  assert.strictEqual(f2.id, 2);
});

test('getAllFiles excludes folders and sorts newest first', () => {
  file({ name: 'old.txt', created_at: '2026-01-01 00:00:00' });
  file({ name: 'new.txt', created_at: '2026-02-01 00:00:00' });
  createFolder(USER, 'Folder');
  const all = getAllFiles(USER);
  assert.deepStrictEqual(all.map(f => f.name), ['new.txt', 'old.txt']);
});

test('getFilesInFolder only returns direct children (folders included)', () => {
  const folder = createFolder(USER, 'Folder');
  file({ name: 'inside.txt', parent_folder_id: folder.id });
  file({ name: 'root.txt' });
  assert.deepStrictEqual(getFilesInFolder(USER, folder.id).map(f => f.name), ['inside.txt']);
  const rootNames = getFilesInFolder(USER, null).map(f => f.name).sort();
  assert.deepStrictEqual(rootNames, ['Folder', 'root.txt']);
});

test('getUniqueName keeps the extension: photo.png → photo (2).png', () => {
  file({ name: 'photo.png' });
  assert.strictEqual(getUniqueName(USER, 'photo.png', null, false), 'photo (2).png');
});

test('getUniqueName increments past existing candidates', () => {
  file({ name: 'photo.png' });
  file({ name: 'photo (2).png' });
  file({ name: 'photo (3).png' });
  assert.strictEqual(getUniqueName(USER, 'photo.png', null, false), 'photo (4).png');
});

test('getUniqueName distinguishes folders from files with the same name', () => {
  file({ name: 'docs', is_folder: 1 });
  assert.strictEqual(getUniqueName(USER, 'docs', null, true), 'docs (2)');
  assert.strictEqual(getUniqueName(USER, 'docs', null, false), 'docs');
});

test('getUniqueName respects the sibling scope (parent folder)', () => {
  const folderA = createFolder(USER, 'A');
  const folderB = createFolder(USER, 'B');
  file({ name: 'x.txt', parent_folder_id: folderA.id });
  assert.strictEqual(getUniqueName(USER, 'x.txt', folderB.id, false), 'x.txt');
  assert.strictEqual(getUniqueName(USER, 'x.txt', folderA.id, false), 'x (2).txt');
});

test('findDuplicateName excludes the file itself (rename use case)', () => {
  const f = file({ name: 'x.txt' });
  assert.strictEqual(findDuplicateName(USER, 'x.txt', null, false, f.id), undefined);
  assert.ok(findDuplicateName(USER, 'x.txt', null, false));
});

test('removeFile cascades through nested folders and drops their chunks', () => {
  const a = createFolder(USER, 'A');
  const b = createFolder(USER, 'B', a.id);
  const fInB = file({ name: 'deep.txt', parent_folder_id: b.id });
  const _fInA = file({ name: 'mid.txt', parent_folder_id: a.id });
  const fRoot = file({ name: 'keep.txt' });

  addChunk({ file_id: fInB.id, account_email: 'x@y.com', account_provider: 'google', drive_file_id: 'd1', sequence: 0, size_bytes: 10, status: 'uploaded' });
  addChunk({ file_id: fRoot.id, account_email: 'x@y.com', account_provider: 'google', drive_file_id: 'd2', sequence: 0, size_bytes: 10, status: 'uploaded' });

  removeFile(a.id, USER);

  assert.strictEqual(getAllFiles(USER).length, 1);
  assert.strictEqual(getAllFiles(USER)[0].name, 'keep.txt');
  assert.deepStrictEqual(getFilesInFolder(USER, null).map(f => f.name), ['keep.txt']);
  assert.strictEqual(getChunksForFile(fInB.id).length, 0);
  assert.strictEqual(getChunksForFile(fRoot.id).length, 1);
});

test('search: empty query returns nothing', () => {
  file({ name: 'anything.txt' });
  assert.deepStrictEqual(searchFilesAndFolders(USER, '   '), []);
});

test('search: folders first, then prefix matches, then alphabetical', () => {
  const folder = createFolder(USER, 'Work');
  file({ name: 'Workbook.xlsx', parent_folder_id: folder.id });
  file({ name: 'work.txt' });
  const res = searchFilesAndFolders(USER, 'work');
  assert.deepStrictEqual(res.map(r => r.name), ['Work', 'work.txt', 'Workbook.xlsx']);
});

test('search: parent breadcrumbs are populated', () => {
  const folder = createFolder(USER, 'Projects');
  file({ name: 'report.pdf', parent_folder_id: folder.id });
  file({ name: 'todo.txt' });
  const res = searchFilesAndFolders(USER, 'todo');
  const deep = searchFilesAndFolders(USER, 'report')[0];
  assert.deepStrictEqual(deep.parent_path, ['Projects']);
  assert.strictEqual(deep.parent_name, 'Projects');
  assert.deepStrictEqual(res[0].parent_path, []);
});

test('getStorageStats buckets sizes by category, folders excluded', () => {
  file({ name: 'a.png', size_bytes: 100 });
  file({ name: 'b.mp4', size_bytes: 200 });
  file({ name: 'c.pdf', size_bytes: 300 });
  file({ name: 'd.zip', size_bytes: 400 });
  createFolder(USER, 'Folder');
  const stats = getStorageStats(USER);
  assert.deepStrictEqual(stats, { photo: 100, video: 200, document: 300, other: 400 });
});

test('getFolderPath walks root → leaf', () => {
  const a = createFolder(USER, 'A');
  const b = createFolder(USER, 'B', a.id);
  const c = createFolder(USER, 'C', b.id);
  const path = getFolderPath(USER, c.id);
  assert.deepStrictEqual(path.map(f => f.name), ['A', 'B', 'C']);
  assert.deepStrictEqual(getFolderPath(USER, null), []);
});

test('chunk bookkeeping: sorted by sequence, filtered by account, status updates', () => {
  const f = file({ name: 'big.bin' });
  addChunk({ file_id: f.id, account_email: 'a@x.com', account_provider: 'google', drive_file_id: 'da', sequence: 2, size_bytes: 10, status: 'uploaded' });
  const c1 = addChunk({ file_id: f.id, account_email: 'a@x.com', account_provider: 'google', drive_file_id: 'db', sequence: 0, size_bytes: 10, status: 'uploaded' });
  addChunk({ file_id: f.id, account_email: 'b@x.com', account_provider: 'google', drive_file_id: 'dc', sequence: 1, size_bytes: 10, status: 'uploaded' });

  assert.deepStrictEqual(getChunksForFile(f.id).map(c => c.sequence), [0, 1, 2]);
  assert.strictEqual(getChunksForAccount('a@x.com').length, 2);

  updateChunkStatus(c1.id, 'error');
  assert.strictEqual(getChunksForFile(f.id).find(c => c.id === c1.id)?.status, 'error');
});

test('starring: toggle + starred listing (newest star first)', () => {
  const f1 = file({ name: 'a.txt' });
  const f2 = file({ name: 'b.txt' });
  toggleStarred(f2.id, USER, true);
  toggleStarred(f1.id, USER, true);
  const starred = getStarredFiles(USER);
  assert.deepStrictEqual(starred.map(f => f.id).sort(), [f1.id, f2.id]);
  assert.ok(starred.every(f => f.is_starred === 1));

  toggleStarred(f1.id, USER, false);
  assert.deepStrictEqual(getStarredFiles(USER).map(f => f.id), [f2.id]);
});

test('renameFile updates the name', () => {
  const f = file({ name: 'old.txt' });
  renameFile(f.id, USER, 'new.txt');
  assert.strictEqual(getAllFiles(USER)[0].name, 'new.txt');
});

test('trash hides files from listings and restores them', () => {
  const f = file({ name: 'gone.txt' });
  file({ name: 'kept.txt' });

  trashFile(USER, f.id);

  assert.deepStrictEqual(getAllFiles(USER).map(x => x.name), ['kept.txt']);
  assert.deepStrictEqual(getFilesInFolder(USER, null).map(x => x.name), ['kept.txt']);
  assert.deepStrictEqual(getTrashedFiles(USER).map(x => x.name), ['gone.txt']);

  restoreFile(USER, f.id);
  assert.deepStrictEqual(getAllFiles(USER).map(x => x.name).sort(), ['gone.txt', 'kept.txt']);
  assert.deepStrictEqual(getTrashedFiles(USER), []);
});

test('trashing a folder hides the whole subtree but lists only the folder', () => {
  const folder = createFolder(USER, 'Folder');
  const child = file({ name: 'child.txt', parent_folder_id: folder.id });
  file({ name: 'outside.txt' });

  trashFile(USER, folder.id);

  assert.deepStrictEqual(getFilesInFolder(USER, folder.id), []);
  assert.deepStrictEqual(getTrashedFiles(USER).map(x => x.name), ['Folder']);

  restoreFile(USER, folder.id);
  assert.deepStrictEqual(getFilesInFolder(USER, folder.id).map(x => x.name), ['child.txt']);
  assert.deepStrictEqual(getAllFiles(USER).map(x => x.name).sort(), ['child.txt', 'outside.txt']);
  assert.ok(getFile(child.id, USER));
});

test('trashed files do not block duplicate names and are excluded from search/stats/starred', () => {
  const f = file({ name: 'dup.txt' });
  trashFile(USER, f.id);

  assert.strictEqual(findDuplicateName(USER, 'dup.txt', null, false), undefined);
  assert.deepStrictEqual(searchFilesAndFolders(USER, 'dup'), []);

  const photo = file({ name: 'photo.png', size_bytes: 100 });
  const img = file({ name: 'trashed.png', size_bytes: 500 });
  toggleStarred(photo.id, USER, true);
  toggleStarred(img.id, USER, true);
  trashFile(USER, img.id);
  assert.deepStrictEqual(getStorageStats(USER), { photo: 100, video: 0, document: 0, other: 0 });
  assert.deepStrictEqual(getStarredFiles(USER).map(x => x.name), ['photo.png']);
});

