import { ipcMain } from 'electron';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs';
import { errorMessage } from '../errors';
import {
  getAllAccounts, removeAccount, setAccountTokenStatus,
  getAllFiles, searchFilesAndFolders, getFile,
  createFolder, getFilesInFolder, getFolderItemCounts, getFolderPath, toggleStarred, getStarredFiles, getStorageStats,
  renameFile, findDuplicateName, getUniqueName, getUser, getAppState, setAppState, 
  ensureManifestLoaded, invalidateManifestLoaded, resetVaultStore, getActiveUserId, setActiveUserId,
  getGoogleCredentials, setGoogleCredentials,
  getDropboxCredentials, setDropboxCredentials,
  trashFile, restoreFile, getTrashedFiles
} from '../db/queries';
import { initiateOAuthFlow, initiateLoginFlow } from '../google/auth';
import { initiateDropboxOAuthFlow } from '../dropbox/auth';
import { connectKoofrAccount } from '../koofr/auth';
import { OAuthCancelledError, abortActiveOAuthFlow } from '../oauth/loopback';
import { testAccountToken } from '../vault/storage';
import type { 
  IpcAccountRemoveRequest, IpcAccountTestResponse, IpcFileDeleteRequest, IpcAccountRemoveResponse,
  IpcFileDeleteResponse, IpcFilesDeleteManyRequest, IpcFilesDeleteManyResponse,
  IpcFileRestoreRequest, IpcFileRestoreResponse, IpcTrashEmptyResponse, IpcTrashListResponse,
  IpcFileUploadRequest, IpcFileUploadResponse, IpcFileDownloadRequest, IpcFileDownloadResponse,
  IpcFolderCreateRequest, IpcFolderCreateResponse,
  IpcFilesInFolderRequest, IpcFilesInFolderResponse,
  IpcFolderItemCountsRequest, IpcFolderItemCountsResponse,
  IpcFolderPathRequest, IpcFolderPathResponse,
  IpcFileStarRequest, IpcFileStarResponse,
  IpcFilesSearchAllRequest, IpcFilesSearchAllResponse,
  IpcFileRenameRequest, IpcFileRenameResponse,
  IpcSettingsGetResponse, IpcSettingsSetRequest, IpcSettingsSetResponse,
  IpcCredentialsGetRequest, IpcCredentialsGetResponse, IpcCredentialsSetRequest, IpcCredentialsSetResponse,
  IpcAccountAddResponse
} from '../../shared/types';
import type { AccountRow } from '../../shared/types';
import { uploadFile, uploadFolder } from '../vault/upload';
import { downloadFile } from '../vault/download';
import { deleteFileChunks, sweepExpiredTrash } from '../vault/delete';
import { getThumbnailDataUrl, invalidateThumbnail } from '../vault/thumbnail';
import { logE2E, logE2EError } from '../e2eLog';

function requireUserId(): number {
  const id = getActiveUserId();
  if (id == null) throw new Error('Not logged in. Please log in first.');
  return id;
}

function isDirectory(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

export function registerIpcHandlers(mainWindow: BrowserWindow) {

  ipcMain.handle('oauth:cancel', async () => {
    abortActiveOAuthFlow();
    return { success: true };
  });

  const connectAccount = async (flow: () => Promise<{ account: AccountRow; folderCreated: boolean }>): Promise<IpcAccountAddResponse> => {
    logE2E('connect.start', { userId: requireUserId() });
    try {
      const { account, folderCreated } = await flow();
      logE2E('connect.success', { provider: account.provider, email: account.email, accountId: account.id, folderCreated, totalBytes: account.total_bytes, usedBytes: account.used_bytes });
      invalidateManifestLoaded();
      await ensureManifestLoaded();
      mainWindow.webContents.send('account:added', { account });
      return { account, folderCreated };
    } catch (e) {
      if (e instanceof OAuthCancelledError) {
        logE2E('connect.cancelled');
        return { cancelled: true };
      }
      logE2EError('connect.error', e);
      return { error: errorMessage(e) };
    }
  };

  ipcMain.handle('account:add', () => connectAccount(async () => {
    return initiateOAuthFlow(requireUserId());
  }));

  ipcMain.handle('account:connect-dropbox', () => connectAccount(async () => {
    return initiateDropboxOAuthFlow(requireUserId());
  }));

  ipcMain.handle('account:connect-koofr', (_event: IpcMainInvokeEvent, payload: { email: string; password: string }) => connectAccount(async () => {
    return connectKoofrAccount(requireUserId(), payload.email, payload.password);
  }));

  ipcMain.handle('account:test', async (_event: IpcMainInvokeEvent, payload: { accountId: number }): Promise<IpcAccountTestResponse> => {
    try {
      const userId = requireUserId();
      const result = await testAccountToken(userId, payload.accountId);
      logE2E('token.test', { accountId: payload.accountId, ok: result.ok, expired: result.expired, error: result.error });
      if (result.ok) setAccountTokenStatus(payload.accountId, true);
      else if (result.expired) setAccountTokenStatus(payload.accountId, false);
      return result;
    } catch (e) {
      logE2EError('token.test.error', e);
      return { ok: false, expired: false, error: errorMessage(e) };
    }
  });

  ipcMain.handle('account:remove', async (_event: IpcMainInvokeEvent, payload: IpcAccountRemoveRequest): Promise<IpcAccountRemoveResponse> => {
    try {
      const userId = requireUserId();
      removeAccount(payload.accountId, userId);
      mainWindow.webContents.send('account:removed', { accountId: payload.accountId });
      return { success: true };
    } catch (e) {
      return { error: errorMessage(e) };
    }
  });

  ipcMain.handle('accounts:list', async () => {
    try {
      const userId = requireUserId();
      return { accounts: getAllAccounts(userId) };
    } catch (_e) {
      return { accounts: [] };
    }
  });


  ipcMain.handle('user:login', async () => {
    logE2E('login.start');
    try {
      const { user, folderCreated } = await initiateLoginFlow();
      setActiveUserId(user.id);
      resetVaultStore();
      await ensureManifestLoaded();
      sweepExpiredTrash(user.id).catch(() => {});
      mainWindow.webContents.send('user:changed', { user });
      logE2E('login.success', { userId: user.id, email: user.email, folderCreated });
      return { user, folderCreated };
    } catch (e) {
      if (e instanceof OAuthCancelledError) {
        logE2E('login.cancelled');
        return { cancelled: true };
      }
      logE2EError('login.error', e);
      return { error: errorMessage(e) };
    }
  });

  ipcMain.handle('user:logout', async () => {
    try {
      setActiveUserId(null);
      resetVaultStore();
      mainWindow.webContents.send('user:changed', { user: null });
      logE2E('logout.success');
      return { success: true };
    } catch (e) {
      logE2EError('logout.error', e);
      return { error: errorMessage(e) };
    }
  });

  ipcMain.handle('user:current', async () => {
    try {
      const userId = getActiveUserId();
      if (userId == null) return { user: null };
      const user = getUser(userId);
      return { user: user ?? null };
    } catch {
      return { user: null };
    }
  });

  ipcMain.handle('storage:stats', async () => {
    try {
      await ensureManifestLoaded();
      const userId = requireUserId();
      return { categories: getStorageStats(userId) };
    } catch (_e) {
      return { categories: { photo: 0, video: 0, document: 0, other: 0 } };
    }
  });

  
  ipcMain.handle('files:list', async () => {
    try {
      await ensureManifestLoaded();
      const userId = requireUserId();
      return { files: getAllFiles(userId) };
    } catch (_e) {
      return { files: [] };
    }
  });

  ipcMain.handle('files:search-all', async (_event: IpcMainInvokeEvent, payload: IpcFilesSearchAllRequest): Promise<IpcFilesSearchAllResponse> => {
    try {
      await ensureManifestLoaded();
      const userId = requireUserId();
      const query = (payload.query || '').trim();
      if (!query) return { results: [] };
      return { results: searchFilesAndFolders(userId, query) };
    } catch (_e) {
      return { results: [] };
    }
  });

  ipcMain.handle('folder:create', async (_event: IpcMainInvokeEvent, payload: IpcFolderCreateRequest): Promise<IpcFolderCreateResponse> => {
    try {
      await ensureManifestLoaded();
      const userId = requireUserId();
      const name = payload.name.trim();
      if (!name) return { error: 'Folder name cannot be empty' };

      const parentId = payload.parentFolderId ?? null;
      const autoRename = getAppState('autoRenameDuplicates') !== '0';
      if (findDuplicateName(userId, name, parentId, true)) {
        if (!autoRename) {
          return { duplicate: true, error: 'A folder with this name already exists here.' };
        }
        return { folder: createFolder(userId, getUniqueName(userId, name, parentId, true), parentId) };
      }
      return { folder: createFolder(userId, name, parentId) };
    } catch (e) {
      return { error: errorMessage(e) };
    }
  });

  ipcMain.handle('files:in-folder', async (_event: IpcMainInvokeEvent, payload: IpcFilesInFolderRequest): Promise<IpcFilesInFolderResponse> => {
    try {
      await ensureManifestLoaded();
      const userId = requireUserId();
      return { items: getFilesInFolder(userId, payload.folderId) };
    } catch (_e) {
      return { items: [] };
    }
  });

  ipcMain.handle('folders:item-counts', async (_event: IpcMainInvokeEvent, payload: IpcFolderItemCountsRequest): Promise<IpcFolderItemCountsResponse> => {
    try {
      await ensureManifestLoaded();
      const userId = requireUserId();
      return { counts: getFolderItemCounts(userId, payload.folderIds ?? []) };
    } catch (_e) {
      return { counts: {} };
    }
  });

  ipcMain.handle('folders:path', async (_event: IpcMainInvokeEvent, payload: IpcFolderPathRequest): Promise<IpcFolderPathResponse> => {
    try {
      await ensureManifestLoaded();
      const userId = requireUserId();
      return { path: getFolderPath(userId, payload.folderId ?? null) };
    } catch (_e) {
      return { path: [] };
    }
  });

  ipcMain.handle('files:starred', async () => {
    try {
      await ensureManifestLoaded();
      const userId = requireUserId();
      return { files: getStarredFiles(userId) };
    } catch (_e) {
      return { files: [] };
    }
  });

  ipcMain.handle('file:star', async (_event: IpcMainInvokeEvent, payload: IpcFileStarRequest): Promise<IpcFileStarResponse> => {
    try {
      await ensureManifestLoaded();
      const userId = requireUserId();
      const file = toggleStarred(payload.fileId, userId, payload.starred);
      if (!file) return { error: 'File not found' };
      mainWindow.webContents.send('file:starred', { file });
      return { file };
    } catch (e) {
      return { error: errorMessage(e) };
    }
  });


  ipcMain.handle('file:delete', async (_event: IpcMainInvokeEvent, payload: IpcFileDeleteRequest): Promise<IpcFileDeleteResponse> => {
    try {
      await ensureManifestLoaded();
      const userId = requireUserId();
      const target = getFile(payload.fileId, userId);
      if (!target) return { error: 'File not found' };

      trashFile(userId, payload.fileId);
      mainWindow.webContents.send('file:deleted', { fileId: payload.fileId });
      logE2E('delete.trash', { fileId: payload.fileId, name: target.name, isFolder: target.is_folder === 1 });
      return { success: true };
    } catch (e) {
      logE2EError('delete.error', e, { fileId: payload.fileId });
      return { error: errorMessage(e) };
    }
  });

  ipcMain.handle('file:delete-many', async (_event: IpcMainInvokeEvent, payload: IpcFilesDeleteManyRequest): Promise<IpcFilesDeleteManyResponse> => {
    try {
      await ensureManifestLoaded();
      const userId = requireUserId();
      const ids = (payload.fileIds || []).filter((id, idx, arr) => arr.indexOf(id) === idx);
      if (ids.length === 0) return { success: true };

      for (const id of ids) {
        trashFile(userId, id);
        mainWindow.webContents.send('file:deleted', { fileId: id });
      }
      return { success: true };
    } catch (e) {
      return { error: errorMessage(e) };
    }
  });

  ipcMain.handle('trash:list', async (): Promise<IpcTrashListResponse> => {
    try {
      await ensureManifestLoaded();
      const userId = requireUserId();
      await sweepExpiredTrash(userId).catch(() => {});
      const items = getTrashedFiles(userId).map(f => ({
        ...f,
        parent_path: getFolderPath(userId, f.parent_folder_id).map(p => p.name)
      }));
      return { items };
    } catch (_e) {
      return { items: [] };
    }
  });

  ipcMain.handle('file:restore', async (_event: IpcMainInvokeEvent, payload: IpcFileRestoreRequest): Promise<IpcFileRestoreResponse> => {
    try {
      await ensureManifestLoaded();
      const userId = requireUserId();
      const target = getFile(payload.fileId, userId);
      if (!target) return { error: 'File not found' };
      restoreFile(userId, payload.fileId);
      mainWindow.webContents.send('file:restored', { fileId: payload.fileId });
      logE2E('restore.success', { fileId: payload.fileId, name: target.name });
      return { success: true };
    } catch (e) {
      logE2EError('restore.error', e, { fileId: payload.fileId });
      return { error: errorMessage(e) };
    }
  });

  ipcMain.handle('trash:empty', async (): Promise<IpcTrashEmptyResponse> => {
    try {
      await ensureManifestLoaded();
      const userId = requireUserId();
      const ids = getTrashedFiles(userId).map(f => f.id);
      for (const id of ids) {
        const deletedIds = await deleteFileChunks(userId, id);
        for (const did of deletedIds) invalidateThumbnail(did);
        mainWindow.webContents.send('file:deleted', { fileId: id });
      }
      logE2E('trash.empty', { count: ids.length });
      return { success: true };
    } catch (e) {
      logE2EError('trash.empty.error', e);
      return { error: errorMessage(e) };
    }
  });

  ipcMain.handle('file:delete-forever', async (_event: IpcMainInvokeEvent, payload: IpcFileDeleteRequest): Promise<IpcFileDeleteResponse> => {
    try {
      await ensureManifestLoaded();
      const userId = requireUserId();
      const target = getFile(payload.fileId, userId);
      if (!target) return { error: 'File not found' };

      const deletedIds = await deleteFileChunks(userId, payload.fileId);
      for (const id of deletedIds) invalidateThumbnail(id);
      mainWindow.webContents.send('file:deleted', { fileId: payload.fileId });
      logE2E('delete.forever', { fileId: payload.fileId, name: target.name, affectedIds: deletedIds.length });
      return { success: true };
    } catch (e) {
      logE2EError('delete.error', e, { fileId: payload.fileId });
      return { error: errorMessage(e) };
    }
  });


  ipcMain.handle('file:rename', async (_event: IpcMainInvokeEvent, payload: IpcFileRenameRequest): Promise<IpcFileRenameResponse> => {
    try {
      await ensureManifestLoaded();
      const userId = requireUserId();
      const newName = payload.newName.trim();
      if (!newName) return { error: 'Name cannot be empty' };

      const current = getFile(payload.fileId, userId);
      if (!current) return { error: 'File not found' };
      if (newName === current.name) return { file: current };

      const autoRename = getAppState('autoRenameDuplicates') !== '0';
      const isFolder = current.is_folder === 1;
      let finalName = newName;
      if (findDuplicateName(userId, newName, current.parent_folder_id, isFolder, current.id)) {
        if (!autoRename) {
          return { duplicate: true, error: 'A file with this name already exists here.' };
        }
        finalName = getUniqueName(userId, newName, current.parent_folder_id, isFolder, current.id);
      }

      const file = renameFile(payload.fileId, userId, finalName);
      if (!file) return { error: 'File not found' };

      invalidateThumbnail(payload.fileId);
      mainWindow.webContents.send('file:renamed', { file });
      return { file };
    } catch (e) {
      return { error: errorMessage(e) };
    }
  });


  ipcMain.handle('settings:get', async (): Promise<IpcSettingsGetResponse> => {
    try {
      const days = parseInt(getAppState('autoEmptyTrashDays') ?? '0', 10);
      return {
        confirmDelete: getAppState('confirmDelete') !== '0',
        autoRenameDuplicates: getAppState('autoRenameDuplicates') !== '0',
        autoRefreshQuota: getAppState('autoRefreshQuota') !== '0',
        autoEmptyTrashDays: Number.isFinite(days) && days > 0 ? days : 0
      };
    } catch {
      return { confirmDelete: true, autoRenameDuplicates: true, autoRefreshQuota: true, autoEmptyTrashDays: 0 };
    }
  });

  ipcMain.handle('settings:set', async (_event: IpcMainInvokeEvent, payload: IpcSettingsSetRequest): Promise<IpcSettingsSetResponse> => {
    try {
      if (payload.confirmDelete !== undefined) {
        setAppState('confirmDelete', payload.confirmDelete ? '1' : '0');
      }
      if (payload.autoRenameDuplicates !== undefined) {
        setAppState('autoRenameDuplicates', payload.autoRenameDuplicates ? '1' : '0');
      }
      if (payload.autoRefreshQuota !== undefined) {
        setAppState('autoRefreshQuota', payload.autoRefreshQuota ? '1' : '0');
      }
      if (payload.autoEmptyTrashDays !== undefined) {
        const days = Math.max(0, Math.floor(payload.autoEmptyTrashDays));
        setAppState('autoEmptyTrashDays', days > 0 ? String(days) : '0');
        if (days > 0) {
          await ensureManifestLoaded();
          const userId = getActiveUserId();
          if (userId != null) sweepExpiredTrash(userId).catch(() => {});
        }
      }
      return { success: true };
    } catch (e) {
      return { error: errorMessage(e) };
    }
  });


  ipcMain.handle('credentials:get', async (_event: IpcMainInvokeEvent, payload: IpcCredentialsGetRequest): Promise<IpcCredentialsGetResponse> => {
    return (payload?.provider ?? 'google') === 'dropbox' ? getDropboxCredentials() : getGoogleCredentials();
  });

  ipcMain.handle('credentials:set', async (_event: IpcMainInvokeEvent, payload: IpcCredentialsSetRequest): Promise<IpcCredentialsSetResponse> => {
    try {
      const clientId = (payload.clientId || '').trim();
      const clientSecret = (payload.clientSecret || '').trim();
      if ((payload.provider ?? 'google') === 'dropbox') {
        setDropboxCredentials(clientId, clientSecret);
      } else {
        setGoogleCredentials(clientId, clientSecret);
      }
      return { success: true };
    } catch (e) {
      return { error: errorMessage(e) };
    }
  });

  ipcMain.handle('file:thumbnail', async (_event: IpcMainInvokeEvent, payload: { fileId: number }) => {
    try {
      await ensureManifestLoaded();
      const userId = requireUserId();
      const dataUrl = await getThumbnailDataUrl(userId, payload.fileId);
      return { dataUrl };
    } catch (_e) {
      return { dataUrl: null };
    }
  });

  ipcMain.handle('file:upload', async (_event: IpcMainInvokeEvent, payload: IpcFileUploadRequest): Promise<IpcFileUploadResponse> => {
    try {
      await ensureManifestLoaded();
      const userId = requireUserId();
      const parentId = payload.parentFolderId ?? null;

      const autoRename = getAppState('autoRenameDuplicates') !== '0';
      const dir = isDirectory(payload.filePath);
      let fileName = payload.fileName;
      if (dir) {
        if (findDuplicateName(userId, fileName, parentId, true)) {
          if (!autoRename) {
            return { duplicate: true, error: 'A folder with this name already exists here.' };
          }
          fileName = getUniqueName(userId, fileName, parentId, true);
        }
      } else if (findDuplicateName(userId, fileName, parentId, false)) {
        if (!autoRename) {
          return { duplicate: true, error: 'A file with this name already exists here.' };
        }
        fileName = getUniqueName(userId, fileName, parentId, false);
      }

      logE2E('upload.request', { fileName, parentId, path: payload.filePath, isDirectory: dir });
      const uploadPromise = dir
        ? uploadFolder(userId, mainWindow, payload.filePath, parentId, fileName)
        : uploadFile(userId, mainWindow, payload.filePath, fileName, parentId);
      uploadPromise.catch(err => {
        console.error(err);
        logE2EError('upload.request.error', err, { fileName, path: payload.filePath });
      });
      return {};
    } catch (e) {
      return { error: errorMessage(e) };
    }
  });

  ipcMain.handle('file:download', async (_event: IpcMainInvokeEvent, payload: IpcFileDownloadRequest): Promise<IpcFileDownloadResponse> => {
    try {
      await ensureManifestLoaded();
      const userId = requireUserId();
      const target = getFile(payload.fileId, userId);
      logE2E('download.request', { fileId: payload.fileId, name: target?.name, savePath: payload.savePath });
      downloadFile(userId, mainWindow, payload.fileId, payload.savePath).catch(err => {
        console.error(err);
        logE2EError('download.request.error', err, { fileId: payload.fileId });
      });
      return { success: true };
    } catch (e) {
      return { error: errorMessage(e) };
    }
  });

  const pickPath = async (title: string, properties: ('openFile' | 'openDirectory')[]) => {
    const { dialog } = require('electron');
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title,
      properties
    });
    if (canceled || filePaths.length === 0) {
      return { filePath: null, fileName: null };
    }
    const path = require('node:path');
    const filePath = filePaths[0];
    const fileName = path.basename(filePath);
    return { filePath, fileName };
  };

  ipcMain.handle('file:pick', async () => pickPath('Select File to Upload', ['openFile']));

  ipcMain.handle('folder:pick', async () => pickPath('Select Folder to Upload', ['openDirectory']));

  ipcMain.handle('file:pick-download-path', async (_event: IpcMainInvokeEvent, fileName: string) => {
    const { dialog } = require('electron');
    const path = require('node:path');
    const ext = path.extname(fileName).toLowerCase().replace('.', '');
    const filters = ext ? [{ name: `${ext.toUpperCase()} File`, extensions: [ext] }, { name: 'All Files', extensions: ['*'] }] : [{ name: 'All Files', extensions: ['*'] }];
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Download File',
      defaultPath: fileName,
      filters: filters
    });
    return { filePath };
  });

}
