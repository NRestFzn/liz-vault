import { getDb } from './schema';
import { AccountRow, FileRow, ChunkRow } from '../../shared/types';

// Accounts
export function addAccount(account: Omit<AccountRow, 'id' | 'added_at'>): AccountRow {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO accounts (email, refresh_token, total_bytes, used_bytes, root_folder_id)
    VALUES (@email, @refresh_token, @total_bytes, @used_bytes, @root_folder_id)
  `);
  const info = stmt.run(account);
  return getAccount(info.lastInsertRowid as number)!;
}

export function getAccount(id: number): AccountRow | undefined {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM accounts WHERE id = ?');
  return stmt.get(id) as AccountRow | undefined;
}

export function getAllAccounts(): AccountRow[] {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM accounts');
  return stmt.all() as AccountRow[];
}

export function removeAccount(id: number): void {
  const db = getDb();
  const stmt = db.prepare('DELETE FROM accounts WHERE id = ?');
  stmt.run(id);
}

export function updateAccountUsage(id: number, usedBytes: number, totalBytes?: number): void {
  const db = getDb();
  if (totalBytes !== undefined) {
    const stmt = db.prepare('UPDATE accounts SET used_bytes = ?, total_bytes = ? WHERE id = ?');
    stmt.run(usedBytes, totalBytes, id);
  } else {
    const stmt = db.prepare('UPDATE accounts SET used_bytes = ? WHERE id = ?');
    stmt.run(usedBytes, id);
  }
}

// Files
export function addFile(file: Omit<FileRow, 'id' | 'created_at' | 'updated_at'>): FileRow {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO files (name, size_bytes, mime_type, status)
    VALUES (@name, @size_bytes, @mime_type, @status)
  `);
  const info = stmt.run(file);
  return getFile(info.lastInsertRowid as number)!;
}

export function getFile(id: number): FileRow | undefined {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM files WHERE id = ?');
  return stmt.get(id) as FileRow | undefined;
}

export function getAllFiles(): FileRow[] {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM files ORDER BY created_at DESC');
  return stmt.all() as FileRow[];
}

export function searchFiles(query: string): FileRow[] {
  const db = getDb();
  const stmt = db.prepare("SELECT * FROM files WHERE name LIKE ? ORDER BY created_at DESC");
  return stmt.all(`%${query}%`) as FileRow[];
}

export function updateFileStatus(id: number, status: FileRow['status']): void {
  const db = getDb();
  const stmt = db.prepare("UPDATE files SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
  stmt.run(status, id);
}

export function removeFile(id: number): void {
  const db = getDb();
  const stmt = db.prepare('DELETE FROM files WHERE id = ?');
  stmt.run(id);
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
