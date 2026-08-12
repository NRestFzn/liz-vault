import { ChunkRow, FileRow, SearchResultRow, StorageCategories, UserRow } from '../../shared/types';
import { getFileCategory, splitFileName } from '../../shared/fileCategory';
import { getDriveClient, findOrCreateFolder } from '../google/auth';
import { getActiveUserId, getUser, nowUtc, setUserRootFolder } from './config';


const MANIFEST_FILE_NAME = 'manifest.json';
const VAULT_FOLDER_NAME = 'LizVault';
const LEGACY_FOLDER_NAME = 'LizVault_Data';

interface VaultManifest {
  version: number;
  updatedAt: string;
  files: FileRow[];
  chunks: ChunkRow[];
}

let files: FileRow[] = [];
let chunks: ChunkRow[] = [];
let nextFileId = 1;
let nextChunkId = 1;
let loaded = false;
const manifestFileIds = new Map<number, string>();
let dirty = false;
let saveTimer: NodeJS.Timeout | null = null;
let flushChain: Promise<void> | null = null;

export function initManifest(): void {
  files = [];
  chunks = [];
  nextFileId = 1;
  nextChunkId = 1;
  loaded = false;
  manifestFileIds.clear();
}

export function invalidateManifestLoaded(): void {
  loaded = false;
}

export async function ensureManifestLoaded(): Promise<void> {
  if (loaded) return;
  const userId = getActiveUserId();
  if (userId == null) {
    loaded = true;
    return;
  }
  const user = getUser(userId);
  if (user && user.refresh_token) {
    const rootFolderId = user.root_folder_id ?? (await ensureVaultFolderForUser(user));
    if (rootFolderId) {
      try {
        const drive = getDriveClient(user.refresh_token);
        const fileId = await findManifestFile(drive, rootFolderId);
        if (fileId) {
          const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
          const buffer = await streamToBuffer(res.data);
          const parsed = tryParseManifest(buffer.toString('utf-8'));
          if (!parsed) {
            console.error(`[Manifest] ${user.email}: manifest.json is corrupt or invalid — skipping`);
          } else {
            importManifest(parsed);
            manifestFileIds.set(userId, fileId);
            loaded = true;
            console.log(`[Manifest] Loaded vault from ${user.email}: ${files.length} files, ${chunks.length} chunks`);
            return;
          }
        }
      } catch (e: any) {
        console.warn(`[Manifest] Failed to load manifest from ${user.email}:`, e?.message || e);
      }
    }
  }
  loaded = true;
  console.log('[Manifest] No vault manifest found on Drive — starting empty');
}

function tryParseManifest(raw: string): VaultManifest | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.files) && Array.isArray(parsed.chunks)) {
      return parsed as VaultManifest;
    }
  } catch {
  }
  return null;
}

function importManifest(manifest: VaultManifest): void {
  const activeUserId = getActiveUserId();
  files = (manifest.files || []).map(f => ({ ...f, user_id: activeUserId ?? f.user_id }));
  chunks = manifest.chunks || [];
  nextFileId = Math.max(1, ...files.map(f => f.id), 0) + 1;
  nextChunkId = Math.max(1, ...chunks.map(c => c.id), 0) + 1;
}

export function resetVaultStore(): void {
  initManifest();
}


async function findManifestFile(drive: any, rootFolderId: string): Promise<string | null> {
  const list = await drive.files.list({
    q: `name='${MANIFEST_FILE_NAME}' and '${rootFolderId}' in parents and trashed=false`,
    spaces: 'drive',
    fields: 'files(id)',
  });
  return list.data.files?.[0]?.id ?? null;
}

async function createManifestFile(drive: any, rootFolderId: string, payload: VaultManifest): Promise<string> {
  const created = await drive.files.create({
    requestBody: { name: MANIFEST_FILE_NAME, parents: [rootFolderId] },
    media: { mimeType: 'application/json', body: JSON.stringify(payload) },
    fields: 'id',
  });
  return created.data.id!;
}

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

export async function ensureVaultFolderForUser(user: UserRow): Promise<string | null> {
  if (user.root_folder_id) return user.root_folder_id;
  try {
    const drive = getDriveClient(user.refresh_token);
    const { id } = await findOrCreateFolder(drive, VAULT_FOLDER_NAME, LEGACY_FOLDER_NAME);
    setUserRootFolder(user.id, id);
    console.log(`[Manifest] Ensured ${VAULT_FOLDER_NAME} folder on ${user.email}:`, id);
    return id;
  } catch (e: any) {
    console.error(`[Manifest] Failed to ensure vault folder for ${user.email}:`, e?.message || e);
    return null;
  }
}

async function ensureManifestFile(user: UserRow, payload: VaultManifest): Promise<string | null> {
  let rootFolderId = user.root_folder_id ?? (await ensureVaultFolderForUser(user));
  if (!rootFolderId) return null;
  try {
    const drive = getDriveClient(user.refresh_token);
    const existing = manifestFileIds.get(user.id) ?? (await findManifestFile(drive, rootFolderId));
    if (existing) {
      try {
        await drive.files.update({
          fileId: existing,
          media: { mimeType: 'application/json', body: JSON.stringify(payload) },
          fields: 'id',
        });
        return existing;
      } catch (err: any) {
        if (err.code === 404) {
          manifestFileIds.delete(user.id);
        } else {
          throw err;
        }
      }
    }
    try {
      const id = await createManifestFile(drive, rootFolderId, payload);
      manifestFileIds.set(user.id, id);
      return id;
    } catch (err: any) {
      if (err.code === 404) {
        setUserRootFolder(user.id, null);
        rootFolderId = await ensureVaultFolderForUser(user);
        if (!rootFolderId) return null;
        const id = await createManifestFile(drive, rootFolderId, payload);
        manifestFileIds.set(user.id, id);
        return id;
      }
      throw err;
    }
  } catch (e: any) {
    console.error(`[Manifest] Failed to save manifest for ${user.email}:`, e?.message || e);
    return null;
  }
}

export async function seedManifestForUser(user: UserRow): Promise<boolean> {
  const id = await ensureManifestFile(user, buildManifest());
  return id != null;
}

function buildManifest(): VaultManifest {
  return { version: 1, updatedAt: new Date().toISOString(), files, chunks };
}

export function queueManifestSave(): void {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flushManifestSave().catch(err => console.error('[Manifest] Save failed:', err));
  }, 1200);
}

export function cancelScheduledSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
}

export function flushNow(): Promise<void> {
  cancelScheduledSave();
  return flushManifestSave();
}

export async function flushManifestSave(): Promise<void> {
  const run = async (): Promise<void> => {
    while (dirty) {
      dirty = false;
      const userId = getActiveUserId();
      const user = userId != null ? getUser(userId) : undefined;
      if (!user || !user.refresh_token) return;
      await ensureManifestFile(user, buildManifest());
    }
  };

  if (flushChain) {
    flushChain = flushChain.then(run, run);
  } else {
    flushChain = run();
  }
  return flushChain;
}


export function addFile(file: Omit<FileRow, 'id' | 'created_at' | 'updated_at'> & { created_at?: string, updated_at?: string }): FileRow {
  const now = nowUtc();
  const row: FileRow = {
    id: nextFileId++,
    user_id: file.user_id,
    name: file.name,
    size_bytes: file.size_bytes,
    mime_type: file.mime_type,
    status: file.status,
    created_at: file.created_at ?? now,
    updated_at: file.updated_at ?? null,
    is_folder: file.is_folder,
    parent_folder_id: file.parent_folder_id,
    is_starred: file.is_starred,
  };
  files.push(row);
  queueManifestSave();
  return row;
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
    is_starred: 0,
  });
}

export function getFile(id: number, userId: number): FileRow | undefined {
  return files.find(f => f.id === id && f.user_id === userId);
}

export function getAllFiles(userId: number): FileRow[] {
  return files
    .filter(f => f.user_id === userId && f.is_folder === 0)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function getFilesInFolder(userId: number, folderId: number | null): FileRow[] {
  return files
    .filter(f => f.user_id === userId && f.parent_folder_id === folderId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function getChildIds(userId: number, parentFolderId: number): number[] {
  return files.filter(f => f.user_id === userId && f.parent_folder_id === parentFolderId).map(f => f.id);
}

export function getFolderItemCounts(userId: number, folderIds: number[]): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const fid of folderIds) {
    counts[fid] = files.filter(f => f.user_id === userId && f.parent_folder_id === fid).length;
  }
  return counts;
}

export function getFolderPath(userId: number, folderId: number | null): FileRow[] {
  if (folderId === null) return [];
  const path: FileRow[] = [];
  let current = getFile(folderId, userId);
  const guard = new Set<number>();
  while (current && current.is_folder === 1 && !guard.has(current.id)) {
    guard.add(current.id);
    path.unshift(current);
    if (current.parent_folder_id == null) break;
    current = getFile(current.parent_folder_id, userId);
  }
  return path;
}

export function toggleStarred(id: number, userId: number, starred: boolean): FileRow | undefined {
  const file = getFile(id, userId);
  if (!file) return undefined;
  file.is_starred = starred ? 1 : 0;
  file.updated_at = nowUtc();
  queueManifestSave();
  return file;
}

export function getStarredFiles(userId: number): FileRow[] {
  return files
    .filter(f => f.user_id === userId && f.is_starred === 1)
    .sort((a, b) => (b.updated_at || b.created_at).localeCompare(a.updated_at || a.created_at));
}

export function getStorageStats(userId: number): StorageCategories {
  const stats: StorageCategories = { photo: 0, video: 0, document: 0, other: 0 };
  for (const f of files) {
    if (f.user_id !== userId || f.is_folder === 1) continue;
    const cat = getFileCategory(f.name);
    if (cat === 'image') stats.photo += f.size_bytes;
    else if (cat === 'video') stats.video += f.size_bytes;
    else if (cat === 'document') stats.document += f.size_bytes;
    else stats.other += f.size_bytes;
  }
  return stats;
}

export function searchFilesAndFolders(userId: number, query: string, limit = 25): SearchResultRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const matched = files.filter(f => f.user_id === userId && f.name.toLowerCase().includes(q));
  matched.sort((a, b) => {
    if (a.is_folder !== b.is_folder) return b.is_folder - a.is_folder;
    const aPrefix = a.name.toLowerCase().startsWith(q) ? 0 : 1;
    const bPrefix = b.name.toLowerCase().startsWith(q) ? 0 : 1;
    if (aPrefix !== bPrefix) return aPrefix - bPrefix;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
  const rows = matched.slice(0, limit);
  const pathCache = new Map<number | null, string[]>();
  return rows.map(row => {
    if (!pathCache.has(row.parent_folder_id)) {
      pathCache.set(row.parent_folder_id, getFolderPath(userId, row.parent_folder_id).map(f => f.name));
    }
    return {
      ...row,
      parent_name: row.parent_folder_id != null ? getFile(row.parent_folder_id, userId)?.name ?? null : null,
      parent_path: pathCache.get(row.parent_folder_id) ?? [],
    };
  });
}

export function renameFile(id: number, userId: number, newName: string): FileRow | undefined {
  const file = getFile(id, userId);
  if (!file) return undefined;
  file.name = newName;
  file.updated_at = nowUtc();
  queueManifestSave();
  return file;
}

export function findDuplicateName(userId: number, name: string, parentFolderId: number | null, isFolder: boolean, excludeId?: number): FileRow | undefined {
  const lower = name.toLowerCase();
  return files.find(f =>
    f.user_id === userId &&
    f.name.toLowerCase() === lower &&
    f.is_folder === (isFolder ? 1 : 0) &&
    f.parent_folder_id === parentFolderId &&
    (excludeId === undefined || f.id !== excludeId)
  );
}

export function getUniqueName(userId: number, name: string, parentFolderId: number | null, isFolder: boolean, excludeId?: number): string {
  if (!findDuplicateName(userId, name, parentFolderId, isFolder, excludeId)) return name;
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
  const file = getFile(id, userId);
  if (!file) return;
  file.status = status;
  queueManifestSave();
}

export function removeFile(id: number, userId: number): void {
  const doomed = new Set<number>([id]);
  let frontier = [id];
  while (frontier.length > 0) {
    const next: number[] = [];
    for (const parentId of frontier) {
      for (const f of files) {
        if (f.user_id === userId && f.parent_folder_id === parentId && !doomed.has(f.id)) {
          doomed.add(f.id);
          next.push(f.id);
        }
      }
    }
    frontier = next;
  }
  files = files.filter(f => !doomed.has(f.id));
  chunks = chunks.filter(c => !doomed.has(c.file_id));
  queueManifestSave();
}

export function removeFilesForUser(userId: number): void {
  const ids = new Set(files.filter(f => f.user_id === userId).map(f => f.id));
  if (ids.size === 0) return;
  files = files.filter(f => !ids.has(f.id));
  chunks = chunks.filter(c => !ids.has(c.file_id));
  queueManifestSave();
}


export function addChunk(chunk: Omit<ChunkRow, 'id'>): ChunkRow {
  const row: ChunkRow = { id: nextChunkId++, ...chunk };
  chunks.push(row);
  queueManifestSave();
  return row;
}

export function getChunk(id: number): ChunkRow | undefined {
  return chunks.find(c => c.id === id);
}

export function getChunksForFile(fileId: number): ChunkRow[] {
  return chunks.filter(c => c.file_id === fileId).sort((a, b) => a.sequence - b.sequence);
}

export function getChunksForAccount(accountEmail: string): ChunkRow[] {
  return chunks.filter(c => c.account_email === accountEmail);
}

export function updateChunkStatus(id: number, status: ChunkRow['status']): void {
  const chunk = getChunk(id);
  if (!chunk) return;
  chunk.status = status;
  queueManifestSave();
}
