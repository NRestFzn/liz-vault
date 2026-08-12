import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { AccountRow, UserRow } from '../../shared/types';


export function nowUtc(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

interface ConfigData {
  googleClientId: string;
  googleClientSecret: string;
  activeUserId: number | null;
  users: UserRow[];
  accounts: AccountRow[];
  app_state: Record<string, string>;
  nextUserId: number;
  nextAccountId: number;
}

function emptyConfig(): ConfigData {
  return {
    googleClientId: '',
    googleClientSecret: '',
    activeUserId: null,
    users: [],
    accounts: [],
    app_state: {},
    nextUserId: 1,
    nextAccountId: 1,
  };
}

let dir: string | null = null;
let data: ConfigData = emptyConfig();

function userDataDir(): string {
  if (dir) return dir;
  dir = app.getPath('userData');
  return dir;
}

function configPath(): string {
  return path.join(userDataDir(), 'config.json');
}

export function initConfig(overrideDir?: string): void {
  if (overrideDir) dir = overrideDir;
  const file = configPath();
  if (fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
      data = { ...emptyConfig(), ...parsed };
    } catch (e) {
      console.error('[Config] Failed to read config.json — starting fresh:', e);
      data = emptyConfig();
    }
  }
  data.nextUserId = Math.max(0, ...data.users.map(u => u.id)) + 1;
  data.nextAccountId = Math.max(0, ...data.accounts.map(a => a.id)) + 1;
  saveConfig();
}

function saveConfig(): void {
  const file = configPath();
  const tmp = `${file}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, file);
  } catch (e) {
    console.error('[Config] Failed to write config.json:', e);
  }
}


export function getGoogleCredentials(): { clientId: string; clientSecret: string } {
  return { clientId: data.googleClientId, clientSecret: data.googleClientSecret };
}

export function setGoogleCredentials(clientId: string, clientSecret: string): void {
  data.googleClientId = clientId;
  data.googleClientSecret = clientSecret;
  saveConfig();
}


export function getActiveUserId(): number | null {
  return data.activeUserId;
}

export function setActiveUserId(id: number | null): void {
  data.activeUserId = id;
  saveConfig();
}


export function addUser(user: Omit<UserRow, 'id' | 'added_at'>): UserRow {
  if (data.accounts.some(a => a.email === user.email)) {
    throw new Error(`This Google account (${user.email}) is already connected as a drive storage account. Use a different account to log in.`);
  }
  const existing = data.users.find(u => u.email === user.email);
  if (existing) {
    existing.refresh_token = user.refresh_token;
    existing.display_name = user.display_name;
    existing.avatar_url = user.avatar_url;
    if (user.root_folder_id != null) existing.root_folder_id = user.root_folder_id;
    saveConfig();
    return existing;
  }
  const row: UserRow = {
    id: data.nextUserId++,
    email: user.email,
    refresh_token: user.refresh_token,
    display_name: user.display_name,
    avatar_url: user.avatar_url,
    root_folder_id: user.root_folder_id,
    added_at: nowUtc(),
  };
  data.users.push(row);
  saveConfig();
  return row;
}

export function getUser(id: number): UserRow | undefined {
  return data.users.find(u => u.id === id);
}

export function setUserRootFolder(userId: number, rootFolderId: string | null): void {
  const user = data.users.find(u => u.id === userId);
  if (!user) return;
  user.root_folder_id = rootFolderId;
  saveConfig();
}

export function removeUser(id: number): void {
  data.accounts = data.accounts.filter(a => a.user_id !== id);
  data.users = data.users.filter(u => u.id !== id);
  if (data.activeUserId === id) data.activeUserId = null;
  saveConfig();
}


export function addAccount(account: Omit<AccountRow, 'id' | 'added_at' | 'token_ok' | 'last_checked_at'>): AccountRow {
  const existing = data.accounts.find(a => a.email === account.email);
  const now = new Date().toISOString();
  if (existing) {
    existing.user_id = account.user_id;
    existing.refresh_token = account.refresh_token;
    existing.total_bytes = account.total_bytes;
    existing.used_bytes = account.used_bytes;
    existing.root_folder_id = account.root_folder_id;
    existing.token_ok = 1;
    existing.last_checked_at = now;
    saveConfig();
    return existing;
  }
  const row: AccountRow = {
    id: data.nextAccountId++,
    user_id: account.user_id,
    email: account.email,
    refresh_token: account.refresh_token,
    total_bytes: account.total_bytes,
    used_bytes: account.used_bytes,
    root_folder_id: account.root_folder_id,
    added_at: now,
    token_ok: 1,
    last_checked_at: now,
  };
  data.accounts.push(row);
  saveConfig();
  return row;
}

export function setAccountTokenStatus(accountId: number, ok: boolean): void {
  const account = data.accounts.find(a => a.id === accountId);
  if (!account) return;
  account.token_ok = ok ? 1 : 0;
  account.last_checked_at = new Date().toISOString();
  saveConfig();
}

export function getAccount(id: number, userId: number): AccountRow | undefined {
  return data.accounts.find(a => a.id === id && a.user_id === userId);
}

export function getAccountByEmail(email: string): AccountRow | undefined {
  return data.accounts.find(a => a.email === email);
}

export function getAllAccounts(userId: number): AccountRow[] {
  return data.accounts.filter(a => a.user_id === userId);
}

export function removeAccount(id: number, userId: number): void {
  data.accounts = data.accounts.filter(a => !(a.id === id && a.user_id === userId));
  saveConfig();
}

export function updateAccountUsage(id: number, userId: number, usedBytes: number, totalBytes?: number): void {
  const account = data.accounts.find(a => a.id === id && a.user_id === userId);
  if (!account) return;
  account.used_bytes = usedBytes;
  if (totalBytes !== undefined) account.total_bytes = totalBytes;
  saveConfig();
}

export function updateAccountRootFolder(accountId: number, userId: number, rootFolderId: string): void {
  const account = data.accounts.find(a => a.id === accountId && a.user_id === userId);
  if (!account) return;
  account.root_folder_id = rootFolderId;
  saveConfig();
}


export function getAppState(key: string): string | null {
  return data.app_state[key] ?? null;
}

export function setAppState(key: string, value: string): void {
  data.app_state[key] = value;
  saveConfig();
}

export function deleteAppState(key: string): void {
  delete data.app_state[key];
  saveConfig();
}
