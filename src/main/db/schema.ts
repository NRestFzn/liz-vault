import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';

let db: Database.Database | null = null;

export function initDb(): Database.Database {
  if (db) return db;

  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'vault.db');
  
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run migrations
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      email TEXT UNIQUE NOT NULL,
      refresh_token TEXT NOT NULL,
      total_bytes INTEGER,
      used_bytes INTEGER,
      root_folder_id TEXT,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      mime_type TEXT,
      status TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME,
      is_folder INTEGER DEFAULT 0,
      parent_folder_id INTEGER REFERENCES files(id) ON DELETE CASCADE,
      is_starred INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER,
      account_id INTEGER,
      drive_file_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      size_bytes INTEGER NOT NULL,
      status TEXT,
      FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );
  `);

  // Users table — login identity, separate from drive storage accounts.
  // One user can own multiple drive accounts. An email already in `accounts`
  // (drive) is blocked from being used as a login user.
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      refresh_token TEXT NOT NULL,
      display_name TEXT,
      avatar_url TEXT,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Migration guards for databases created before folders/starred columns existed
  const fileColumns = db.pragma('table_info(files)') as { name: string }[];
  if (!fileColumns.some(c => c.name === 'is_folder')) {
    db.exec('ALTER TABLE files ADD COLUMN is_folder INTEGER DEFAULT 0');
  }
  if (!fileColumns.some(c => c.name === 'parent_folder_id')) {
    db.exec('ALTER TABLE files ADD COLUMN parent_folder_id INTEGER REFERENCES files(id) ON DELETE CASCADE');
  }
  if (!fileColumns.some(c => c.name === 'is_starred')) {
    db.exec('ALTER TABLE files ADD COLUMN is_starred INTEGER DEFAULT 0');
  }

  // Migration guards for databases created before token-health columns existed
  const accountColumns = db.pragma('table_info(accounts)') as { name: string }[];
  if (!accountColumns.some(c => c.name === 'token_ok')) {
    db.exec('ALTER TABLE accounts ADD COLUMN token_ok INTEGER NOT NULL DEFAULT 1');
  }
  if (!accountColumns.some(c => c.name === 'last_checked_at')) {
    db.exec('ALTER TABLE accounts ADD COLUMN last_checked_at DATETIME');
  }

  return db;
}

export function getDb(): Database.Database {
  if (!db) {
    throw new Error("Database has not been initialized. Call initDb() first.");
  }
  return db;
}
