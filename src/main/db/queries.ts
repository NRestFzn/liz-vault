import { getDb } from './schema';
import { AccountRow, FileRow, ChunkRow, StorageCategories, UserRow, SearchResultRow } from '../../shared/types';
import { getFileCategory, splitFileName } from '../../shared/fileCategory';

// Accounts
export function addAccount(account: Omit<AccountRow, 'id' | 'added_at'>): AccountRow {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO accounts (user_id, email, refresh_token, total_bytes, used_bytes, root_folder_id)
    VALUES (@user_id, @email, @refresh_token, @total_bytes, @used_bytes, @root_folder_id)
  `);
  const info = stmt.run(account);
  return getAccount(info.lastInsertRowid as number, account.user_id)!;
}

export function getAccount(id: number, userId: number): AccountRow | undefined {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?');
  return stmt.get(id, userId) as AccountRow | undefined;
}

export function getAllAccounts(userId: number): AccountRow[] {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM accounts WHERE user_id = ?');
  return stmt.all(userId) as AccountRow[];
}

export function removeAccount(id: number, userId: number): void {
  const db = getDb();
  const stmt = db.prepare('DELETE FROM accounts WHERE id = ? AND user_id = ?');
  stmt.run(id, userId);
}

export function updateAccountUsage(id: number, userId: number, usedBytes: number, totalBytes?: number): void {
  const db = getDb();
  if (totalBytes !== undefined) {
    const stmt = db.prepare('UPDATE accounts SET used_bytes = ?, total_bytes = ? WHERE id = ? AND user_id = ?');
    stmt.run(usedBytes, totalBytes, id, userId);
  } else {
    const stmt = db.prepare('UPDATE accounts SET used_bytes = ? WHERE id = ? AND user_id = ?');
    stmt.run(usedBytes, id, userId);
  }
}

// Files
export function addFile(file: Omit<FileRow, 'id' | 'created_at' | 'updated_at'> & { created_at?: string, updated_at?: string }): FileRow {
  const db = getDb();
  if (file.created_at && file.updated_at) {
    const stmt = db.prepare(`
      INSERT INTO files (user_id, name, size_bytes, mime_type, status, is_folder, parent_folder_id, is_starred, created_at, updated_at)
      VALUES (@user_id, @name, @size_bytes, @mime_type, @status, @is_folder, @parent_folder_id, @is_starred, @created_at, @updated_at)
    `);
    const info = stmt.run(file);
    return getFile(info.lastInsertRowid as number, file.user_id)!;
  } else {
    const stmt = db.prepare(`
      INSERT INTO files (user_id, name, size_bytes, mime_type, status, is_folder, parent_folder_id, is_starred)
      VALUES (@user_id, @name, @size_bytes, @mime_type, @status, @is_folder, @parent_folder_id, @is_starred)
    `);
    const info = stmt.run(file);
    return getFile(info.lastInsertRowid as number, file.user_id)!;
  }
}

export function createFolder(userId: number, name: string, parentFolderId: number | null = null): FileRow {
  return addFile({
    user_id: userId,
    name: name.trim(),
    size_bytes: 0,
    mime_type: 'application/vnd.google-apps.folder',
    status: 'ready',
    is_folder: 1,
    parent_folder_id: parentFolderId,
    is_starred: 0
  });
}

// Maps folder id -> number of direct children (files + subfolders).
export function getFolderItemCounts(userId: number, folderIds: number[]): Record<number, number> {
  const db = getDb();
  if (folderIds.length === 0) return {};
  const placeholders = folderIds.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT parent_folder_id AS folder_id, COUNT(*) AS cnt
     FROM files WHERE user_id = ? AND parent_folder_id IN (${placeholders})
     GROUP BY parent_folder_id`
  ).all(userId, ...folderIds) as { folder_id: number; cnt: number }[];
  const counts: Record<number, number> = {};
  for (const row of rows) counts[row.folder_id] = row.cnt;
  return counts;
}

/**
 * Ancestor chain of a folder, ordered root → leaf (e.g. [A, B, C] for
 * All Files / A / B / C). Returns [] for a null folder (the root level).
 */
export function getFolderPath(userId: number, folderId: number | null): FileRow[] {
  if (folderId === null) return [];
  const path: FileRow[] = [];
  let current: FileRow | undefined = getFile(folderId, userId);
  const guard = new Set<number>(); // cycle safety
  while (current && current.is_folder === 1 && !guard.has(current.id)) {
    guard.add(current.id);
    path.unshift(current);
    if (current.parent_folder_id == null) break;
    current = getFile(current.parent_folder_id, userId);
  }
  return path;
}

/** Direct children (files + subfolders) of a folder, by id only. */
export function getChildIds(userId: number, parentFolderId: number): number[] {
  const db = getDb();
  const rows = db.prepare('SELECT id FROM files WHERE user_id = ? AND parent_folder_id = ?').all(userId, parentFolderId) as { id: number }[];
  return rows.map(r => r.id);
}

export function getFilesInFolder(userId: number, folderId: number | null): FileRow[] {
  const db = getDb();
  if (folderId === null) {
    return db.prepare('SELECT * FROM files WHERE user_id = ? AND parent_folder_id IS NULL ORDER BY created_at DESC').all(userId) as FileRow[];
  }
  return db.prepare('SELECT * FROM files WHERE user_id = ? AND parent_folder_id = ? ORDER BY created_at DESC').all(userId, folderId) as FileRow[];
}

export function toggleStarred(id: number, userId: number, starred: boolean): FileRow | undefined {
  const db = getDb();
  db.prepare('UPDATE files SET is_starred = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?').run(starred ? 1 : 0, id, userId);
  return getFile(id, userId);
}

export function getStarredFiles(userId: number): FileRow[] {
  const db = getDb();
  // Folders can be starred too.
  return db.prepare('SELECT * FROM files WHERE user_id = ? AND is_starred = 1 ORDER BY updated_at DESC').all(userId) as FileRow[];
}

// Storage usage bucketed by file-type category.
export function getStorageStats(userId: number): StorageCategories {
  const db = getDb();
  const rows = db.prepare('SELECT name, size_bytes FROM files WHERE user_id = ? AND is_folder = 0').all(userId) as { name: string; size_bytes: number }[];
  const stats: StorageCategories = { photo: 0, video: 0, document: 0, other: 0 };
  for (const row of rows) {
    const cat = getFileCategory(row.name);
    if (cat === 'image') stats.photo += row.size_bytes;
    else if (cat === 'video') stats.video += row.size_bytes;
    else if (cat === 'document') stats.document += row.size_bytes;
    else stats.other += row.size_bytes; // audio + other
  }
  return stats;
}

export function getFile(id: number, userId: number): FileRow | undefined {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM files WHERE id = ? AND user_id = ?');
  return stmt.get(id, userId) as FileRow | undefined;
}

export function getAllFiles(userId: number): FileRow[] {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM files WHERE user_id = ? AND is_folder = 0 ORDER BY created_at DESC');
  return stmt.all(userId) as FileRow[];
}

/**
 * Global search across folders AND files, with the immediate parent folder
 * name attached so the UI can render a breadcrumb. Ranked: folders first,
 * then prefix matches, then alphabetically. Query is LIKE-escaped.
 */
export function searchFilesAndFolders(userId: number, query: string, limit = 25): SearchResultRow[] {
  const db = getDb();
  const escaped = query.replace(/[\\%_]/g, (m) => '\\' + m);
  const rows = db.prepare(`
    SELECT f.*, p.name AS parent_name
    FROM files f
    LEFT JOIN files p ON p.id = f.parent_folder_id
    WHERE f.user_id = ? AND f.name LIKE ? ESCAPE '\\'
    ORDER BY
      (f.is_folder = 1) DESC,
      CASE WHEN f.name LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END,
      f.name COLLATE NOCASE ASC
    LIMIT ?
  `).all(userId, `%${escaped}%`, `${escaped}%`, limit) as SearchResultRow[];

  // Attach the FULL ancestor chain (root → immediate parent) so the UI can
  // render a breadcrumb like "All Files / Random / Apalah".
  const pathCache = new Map<number | null, string[]>();
  for (const row of rows) {
    if (!pathCache.has(row.parent_folder_id)) {
      pathCache.set(row.parent_folder_id, getFolderPath(userId, row.parent_folder_id).map(f => f.name));
    }
    row.parent_path = pathCache.get(row.parent_folder_id) ?? [];
  }
  return rows;
}

export function renameFile(id: number, userId: number, newName: string): FileRow | undefined {
  const db = getDb();
  db.prepare('UPDATE files SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?').run(newName, id, userId);
  return getFile(id, userId);
}

/**
 * Returns the first SAME-KIND sibling (file vs folder) in the same parent
 * folder whose name matches, case-insensitively. Files and folders with the
 * same name coexist (e.g. a folder "Random" and a file "Random"). Used for
 * duplicate detection on upload, folder creation and rename.
 */
export function findDuplicateName(userId: number, name: string, parentFolderId: number | null, isFolder: boolean, excludeId?: number): FileRow | undefined {
  const db = getDb();
  const params: unknown[] = [userId, name, isFolder ? 1 : 0];
  let sql: string;
  if (parentFolderId === null) {
    sql = "SELECT * FROM files WHERE user_id = ? AND name = ? COLLATE NOCASE AND is_folder = ? AND parent_folder_id IS NULL";
  } else {
    sql = "SELECT * FROM files WHERE user_id = ? AND name = ? COLLATE NOCASE AND is_folder = ? AND parent_folder_id = ?";
    params.push(parentFolderId);
  }
  if (excludeId !== undefined) {
    sql += " AND id != ?";
    params.push(excludeId);
  }
  return db.prepare(sql).get(...params) as FileRow | undefined;
}

/**
 * Returns `name`, or `name (2)`, `name (3)`, … so the result is unique among
 * same-kind siblings. Keeps the file extension intact (photo.png → photo (2).png).
 */
export function getUniqueName(userId: number, name: string, parentFolderId: number | null, isFolder: boolean, excludeId?: number): string {
  if (!findDuplicateName(userId, name, parentFolderId, isFolder, excludeId)) return name;
  // Reuse the shared split so extension handling stays in one place.
  const { base, ext } = splitFileName(name);
  let counter = 2;
  let candidate = `${base} (${counter})${ext}`;
  while (findDuplicateName(userId, candidate, parentFolderId, isFolder, excludeId)) {
    counter++;
    candidate = `${base} (${counter})${ext}`;
  }
  return candidate;
}

export function updateFileStatus(id: number, userId: number, status: FileRow['status']): void {
  const db = getDb();
  const stmt = db.prepare("UPDATE files SET status = ? WHERE id = ? AND user_id = ?");
  stmt.run(status, id, userId);
}

export function removeFile(id: number, userId: number): void {
  const db = getDb();
  const stmt = db.prepare('DELETE FROM files WHERE id = ? AND user_id = ?');
  stmt.run(id, userId);
}

// Chunks
export function addChunk(chunk: Omit<ChunkRow, 'id'>): ChunkRow {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO chunks (file_id, account_id, drive_file_id, sequence, size_bytes, status)
    VALUES (@file_id, @account_id, @drive_file_id, @sequence, @size_bytes, @status)
  `);
  const info = stmt.run(chunk);
  return getChunk(info.lastInsertRowid as number)!;
}

export function getChunk(id: number): ChunkRow | undefined {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM chunks WHERE id = ?');
  return stmt.get(id) as ChunkRow | undefined;
}

export function getChunksForFile(fileId: number): ChunkRow[] {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM chunks WHERE file_id = ? ORDER BY sequence ASC');
  return stmt.all(fileId) as ChunkRow[];
}

export function getChunksForAccount(accountId: number): ChunkRow[] {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM chunks WHERE account_id = ?');
  return stmt.all(accountId) as ChunkRow[];
}

export function updateChunkStatus(id: number, status: ChunkRow['status']): void {
  const db = getDb();
  const stmt = db.prepare('UPDATE chunks SET status = ? WHERE id = ?');
  stmt.run(status, id);
}

// Users — login identity (separate from drive storage accounts)

export function addUser(user: Omit<UserRow, 'id' | 'added_at'>): UserRow {
  const db = getDb();
  // Block email already used as a drive storage account
  const existingAccount = db.prepare('SELECT id FROM accounts WHERE email = ?').get(user.email);
  if (existingAccount) {
    throw new Error(`This Google account (${user.email}) is already connected as a drive storage account. Use a different account to log in.`);
  }
  const stmt = db.prepare(`
    INSERT INTO users (email, refresh_token, display_name, avatar_url)
    VALUES (@email, @refresh_token, @display_name, @avatar_url)
    ON CONFLICT(email) DO UPDATE SET
      refresh_token = excluded.refresh_token,
      display_name = excluded.display_name,
      avatar_url = excluded.avatar_url
  `);
  stmt.run(user);
  return db.prepare('SELECT * FROM users WHERE email = ?').get(user.email) as UserRow;
}

export function getUser(id: number): UserRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

export function removeUser(id: number): void {
  const db = getDb();
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

// app_state — key/value store for persistent UI state (e.g. active user)

export function getAppState(key: string): string | null {
  const db = getDb();
  const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setAppState(key: string, value: string): void {
  const db = getDb();
  db.prepare('INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

export function deleteAppState(key: string): void {
  const db = getDb();
  db.prepare('DELETE FROM app_state WHERE key = ?').run(key);
}
