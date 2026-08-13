import { getAccount } from '../db/queries';
import { getDriveClient, findOrCreateFolder as googleEnsureFolder } from '../google/auth';
import { errorMessage } from '../errors';
import {
  dropboxDeleteItem,
  dropboxDownloadStream,
  dropboxEnsureFolder,
  dropboxListChildren,
  dropboxTestConnection,
  dropboxUploadChunk,
} from '../dropbox/drive';
import {
  koofrDeleteItem,
  koofrDownloadStream,
  koofrEnsureFolder,
  koofrListChildren,
  koofrTestConnection,
  koofrUploadChunk,
} from '../koofr/drive';
import { PROVIDER_NAMES } from '../../shared/types';
import type { AccountProvider, AccountRow } from '../../shared/types';

const KOOFR_FOLDER_PATH = '/LizVault';

export function sanitizeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/[. ]+$/g, '');
}

export function chunkName(fileName: string, index: number, provider: AccountProvider): string {
  const base = `${fileName}.chunk${index}`;
  return provider === 'google' ? base : sanitizeName(base);
}

interface Backend {
  uploadChunk(account: AccountRow, name: string, stream: NodeJS.ReadableStream, size: number): Promise<string>;
  downloadChunkStream(account: AccountRow, driveFileId: string): Promise<NodeJS.ReadableStream>;
  deleteChunkFile(account: AccountRow, driveFileId: string): Promise<void>;
  listFolderFiles(account: AccountRow, folderId: string): Promise<{ id: string; name: string }[]>;
  ensureStorageFolder(account: AccountRow, preferredName: string, legacyName: string): Promise<{ id: string; created: boolean }>;
  testConnection(account: AccountRow): Promise<void>;
}

const BACKENDS: Record<AccountProvider, Backend> = {
  google: {
    async uploadChunk(account, name, stream) {
      const drive = getDriveClient(account.refresh_token);
      const res = await drive.files.create({
        requestBody: { name, parents: account.root_folder_id ? [account.root_folder_id] : undefined },
        media: { mimeType: 'application/octet-stream', body: stream },
        fields: 'id',
      });
      const id = res.data.id;
      if (!id) throw new Error('Drive did not return an id for the uploaded chunk.');
      return id;
    },
    async downloadChunkStream(account, driveFileId) {
      const drive = getDriveClient(account.refresh_token);
      const res = await drive.files.get({ fileId: driveFileId, alt: 'media' }, { responseType: 'stream' });
      return res.data;
    },
    async deleteChunkFile(account, driveFileId) {
      const drive = getDriveClient(account.refresh_token);
      await drive.files.delete({ fileId: driveFileId }).catch(err => {
        if (err.code !== 404) throw err;
      });
    },
    async listFolderFiles(account, folderId) {
      const drive = getDriveClient(account.refresh_token);
      const res = await drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        spaces: 'drive',
        fields: 'files(id,name)',
      });
      return (res.data.files || []).map(f => ({ id: f.id ?? '', name: f.name ?? '' })).filter(f => f.id);
    },
    ensureStorageFolder(account, preferredName, legacyName) {
      return googleEnsureFolder(getDriveClient(account.refresh_token), preferredName, legacyName);
    },
    async testConnection(account) {
      const drive = getDriveClient(account.refresh_token);
      await drive.about.get({ fields: 'user' });
    },
  },
  dropbox: {
    uploadChunk(account, name, stream, size) {
      return dropboxUploadChunk(account.refresh_token, account.root_folder_id ?? '/', name, size, stream);
    },
    downloadChunkStream(account, driveFileId) {
      return dropboxDownloadStream(account.refresh_token, driveFileId);
    },
    deleteChunkFile(account, driveFileId) {
      return dropboxDeleteItem(account.refresh_token, driveFileId);
    },
    listFolderFiles(account, folderId) {
      return dropboxListChildren(account.refresh_token, folderId);
    },
    ensureStorageFolder(account, preferredName, legacyName) {
      return dropboxEnsureFolder(account.refresh_token, preferredName, legacyName);
    },
    testConnection(account) {
      return dropboxTestConnection(account.refresh_token);
    },
  },
  koofr: {
    uploadChunk(account, name, stream) {
      return koofrUploadChunk(account.email, account.refresh_token, account.root_folder_id ?? '', KOOFR_FOLDER_PATH, name, stream);
    },
    downloadChunkStream(account, driveFileId) {
      return koofrDownloadStream(account.email, account.refresh_token, account.root_folder_id ?? '', driveFileId);
    },
    deleteChunkFile(account, driveFileId) {
      return koofrDeleteItem(account.email, account.refresh_token, account.root_folder_id ?? '', driveFileId);
    },
    listFolderFiles(account) {
      return koofrListChildren(account.email, account.refresh_token, account.root_folder_id ?? '', KOOFR_FOLDER_PATH);
    },
    ensureStorageFolder(account, preferredName, legacyName) {
      return koofrEnsureFolder(account.email, account.refresh_token, preferredName, legacyName);
    },
    testConnection(account) {
      return koofrTestConnection(account.email, account.refresh_token);
    },
  },
};

function backend(account: AccountRow): Backend {
  return BACKENDS[account.provider];
}

export function uploadChunk(account: AccountRow, name: string, stream: NodeJS.ReadableStream, size: number): Promise<string> {
  return backend(account).uploadChunk(account, name, stream, size);
}

export function downloadChunkStream(account: AccountRow, driveFileId: string): Promise<NodeJS.ReadableStream> {
  return backend(account).downloadChunkStream(account, driveFileId);
}

export function deleteChunkFile(account: AccountRow, driveFileId: string): Promise<void> {
  return backend(account).deleteChunkFile(account, driveFileId);
}

export function listFolderFiles(account: AccountRow, folderId: string): Promise<{ id: string; name: string }[]> {
  return backend(account).listFolderFiles(account, folderId);
}

export function ensureStorageFolder(account: AccountRow, preferredName: string, legacyName: string): Promise<{ id: string; created: boolean }> {
  return backend(account).ensureStorageFolder(account, preferredName, legacyName);
}

export async function testAccountToken(userId: number, accountId: number): Promise<{ ok: boolean; expired?: boolean; error?: string }> {
  let account: AccountRow | undefined;
  try {
    account = getAccount(accountId, userId);
    if (!account) return { ok: false, expired: true, error: 'Account not found.' };
    await backend(account).testConnection(account);
    return { ok: true };
  } catch (e) {
    const msg = errorMessage(e);
    const providerLabel = PROVIDER_NAMES[account?.provider ?? 'google'];
    if (/unauthorized_client|invalid_grant|invalid_client|expired_access_token|invalid_refresh_token/i.test(msg)) {
      return { ok: false, expired: true, error: `Your ${providerLabel} login has expired or was revoked. Re-login to continue.` };
    }
    return { ok: false, expired: false, error: msg };
  }
}
