import { ipcMain, BrowserWindow } from 'electron';import {
  getAllAccounts, removeAccount, setAccountTokenStatus,
  getAllFiles, searchFilesAndFolders, removeFile, getFile,
  createFolder, getFilesInFolder, getFolderItemCounts, getFolderPath, toggleStarred, getStarredFiles, getStorageStats,
  renameFile, findDuplicateName, getUniqueName,
  addUser, getUser, removeUser, getAppState, setAppState, deleteAppState
} from '../db/queries';
import { initiateOAuthFlow, initiateLoginFlow, OAuthCancelledError, abortActiveOAuthFlow, testAccountToken } from '../google/auth';
import { 
  IpcAccountRemoveRequest, IpcAccountTestResponse, IpcFileDeleteRequest, IpcAccountRemoveResponse,
  IpcFileDeleteResponse, IpcFilesDeleteManyRequest, IpcFilesDeleteManyResponse,
  IpcFileUploadRequest, IpcFileUploadResponse, IpcFileDownloadRequest, IpcFileDownloadResponse,
  IpcFolderCreateRequest, IpcFolderCreateResponse,
  IpcFilesInFolderRequest, IpcFilesInFolderResponse,
  IpcFolderItemCountsRequest, IpcFolderItemCountsResponse,
  IpcFolderPathRequest, IpcFolderPathResponse,
  IpcFileStarRequest, IpcFileStarResponse,
  IpcFilesSearchAllRequest, IpcFilesSearchAllResponse,
  IpcFileRenameRequest, IpcFileRenameResponse,
  IpcSettingsGetResponse, IpcSettingsSetRequest, IpcSettingsSetResponse,
  IpcCredentialsGetResponse, IpcCredentialsSetRequest, IpcCredentialsSetResponse
} from '../../shared/types';
import { uploadFile } from '../vault/upload';
import { downloadFile } from '../vault/download';
import { deleteFileChunks } from '../vault/delete';
import { getThumbnailDataUrl, invalidateThumbnail } from '../vault/thumbnail';

function requireUserId(): number {
  const idStr = getAppState('activeUserId');
  if (!idStr) throw new Error('Not logged in. Please log in first.');
  return parseInt(idStr, 10);
}

export function registerIpcHandlers(mainWindow: BrowserWindow) {
  
  // -- Accounts --
  
  // Aborts a pending login/connect flow (the user cancelled from the waiting modal).
  ipcMain.handle('oauth:cancel', async () => {
    abortActiveOAuthFlow();
    return { success: true };
  });

  ipcMain.handle('account:add', async () => {
    try {
      const userId = requireUserId();
      const account = await initiateOAuthFlow(userId);
      mainWindow.webContents.send('account:added', { account });
      return { account };
    } catch (e: any) {
      // A newer attempt cancelled this one — not an error, just signal it so
      // the renderer doesn't show a stale "cancelled" message.
      if (e instanceof OAuthCancelledError) return { cancelled: true };
      return { error: e.message };
    }
  });

  // Tests an account's refresh token (expired/revoked detection). The result
  // is persisted so the expired state survives restarts — but ONLY definitive
  // auth failures flip the persisted state; transient errors (network, missing
  // credentials) keep the previous health and just surface the error.
  ipcMain.handle('account:test', async (_: any, payload: { accountId: number }): Promise<IpcAccountTestResponse> => {
    try {
      const userId = requireUserId();
      const result = await testAccountToken(userId, payload.accountId);
      if (result.ok) setAccountTokenStatus(payload.accountId, true);
      else if (result.expired) setAccountTokenStatus(payload.accountId, false);
      return result;
    } catch (e: any) {
      return { ok: false, expired: false, error: e.message };
    }
  });

  ipcMain.handle('account:remove', async (_: any, payload: IpcAccountRemoveRequest): Promise<IpcAccountRemoveResponse> => {
    try {
      const userId = requireUserId();
      removeAccount(payload.accountId, userId);
      mainWindow.webContents.send('account:removed', { accountId: payload.accountId });
      return { success: true };
    } catch (e: any) {
      return { error: e.message };
    }
  });

  ipcMain.handle('accounts:list', async () => {
    try {
      const userId = requireUserId();
      return { accounts: getAllAccounts(userId) };
    } catch (e) {
      return { accounts: [] };
    }
  });

  // -- User (login identity, separate from drive accounts) --

  ipcMain.handle('user:login', async () => {
    try {
      const user = await initiateLoginFlow();
      setAppState('activeUserId', user.id.toString());
      mainWindow.webContents.send('user:changed', { user });
      return { user };
    } catch (e: any) {
      if (e instanceof OAuthCancelledError) return { cancelled: true };
      return { error: e.message };
    }
  });

  ipcMain.handle('user:logout', async () => {
    try {
      deleteAppState('activeUserId');
      mainWindow.webContents.send('user:changed', { user: null });
      return { success: true };
    } catch (e: any) {
      return { error: e.message };
    }
  });

  ipcMain.handle('user:current', async () => {
    try {
      const idStr = getAppState('activeUserId');
      if (!idStr) return { user: null };
      const user = getUser(parseInt(idStr, 10));
      return { user: user ?? null };
    } catch (e: any) {
      return { user: null };
    }
  });

  ipcMain.handle('storage:stats', async () => {
    try {
      const userId = requireUserId();
      return { categories: getStorageStats(userId) };
    } catch (e) {
      return { categories: { photo: 0, video: 0, document: 0, other: 0 } };
    }
  });

  // -- Files --
  
  ipcMain.handle('files:list', async () => {
    try {
      const userId = requireUserId();
      return { files: getAllFiles(userId) };
    } catch (e) {
      return { files: [] };
    }
  });

  // Global search — folders + files with parent-folder names for breadcrumbs.
  ipcMain.handle('files:search-all', async (_: any, payload: IpcFilesSearchAllRequest): Promise<IpcFilesSearchAllResponse> => {
    try {
      const userId = requireUserId();
      const query = (payload.query || '').trim();
      if (!query) return { results: [] };
      return { results: searchFilesAndFolders(userId, query) };
    } catch (e) {
      return { results: [] };
    }
  });

  ipcMain.handle('folder:create', async (_: any, payload: IpcFolderCreateRequest): Promise<IpcFolderCreateResponse> => {
    try {
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
    } catch (e: any) {
      return { error: e.message };
    }
  });

  ipcMain.handle('files:in-folder', async (_: any, payload: IpcFilesInFolderRequest): Promise<IpcFilesInFolderResponse> => {
    try {
      const userId = requireUserId();
      return { items: getFilesInFolder(userId, payload.folderId) };
    } catch (e) {
      return { items: [] };
    }
  });

  ipcMain.handle('folders:item-counts', async (_: any, payload: IpcFolderItemCountsRequest): Promise<IpcFolderItemCountsResponse> => {
    try {
      const userId = requireUserId();
      return { counts: getFolderItemCounts(userId, payload.folderIds ?? []) };
    } catch (e) {
      return { counts: {} };
    }
  });

  // Ancestor chain for the breadcrumb (root → current folder).
  ipcMain.handle('folders:path', async (_: any, payload: IpcFolderPathRequest): Promise<IpcFolderPathResponse> => {
    try {
      const userId = requireUserId();
      return { path: getFolderPath(userId, payload.folderId ?? null) };
    } catch (e) {
      return { path: [] };
    }
  });

  ipcMain.handle('files:starred', async () => {
    try {
      const userId = requireUserId();
      return { files: getStarredFiles(userId) };
    } catch (e) {
      return { files: [] };
    }
  });

  ipcMain.handle('file:star', async (_: any, payload: IpcFileStarRequest): Promise<IpcFileStarResponse> => {
    try {
      const userId = requireUserId();
      const file = toggleStarred(payload.fileId, userId, payload.starred);
      if (!file) return { error: 'File not found' };
      mainWindow.webContents.send('file:starred', { file });
      return { file };
    } catch (e: any) {
      return { error: e.message };
    }
  });

  // NOTE: delete confirmation is handled in the renderer (custom in-app
  // ConfirmDialog). These handlers execute the deletion directly.

  ipcMain.handle('file:delete', async (_: any, payload: IpcFileDeleteRequest): Promise<IpcFileDeleteResponse> => {
    try {
      const userId = requireUserId();
      const target = getFile(payload.fileId, userId);
      if (!target) return { error: 'File not found' };

      const deletedIds = await deleteFileChunks(userId, payload.fileId);
      for (const id of deletedIds) invalidateThumbnail(id);
      mainWindow.webContents.send('file:deleted', { fileId: payload.fileId });
      return { success: true };
    } catch (e: any) {
      return { error: e.message };
    }
  });

  // Batch delete — same as single delete, one IPC call for a multi-selection.
  ipcMain.handle('file:delete-many', async (_: any, payload: IpcFilesDeleteManyRequest): Promise<IpcFilesDeleteManyResponse> => {
    try {
      const userId = requireUserId();
      const ids = (payload.fileIds || []).filter((id, idx, arr) => arr.indexOf(id) === idx);
      if (ids.length === 0) return { success: true };

      for (const id of ids) {
        const deletedIds = await deleteFileChunks(userId, id);
        for (const did of deletedIds) invalidateThumbnail(did);
        mainWindow.webContents.send('file:deleted', { fileId: id });
      }
      return { success: true };
    } catch (e: any) {
      return { error: e.message };
    }
  });

  // -- Rename --

  ipcMain.handle('file:rename', async (_: any, payload: IpcFileRenameRequest): Promise<IpcFileRenameResponse> => {
    try {
      const userId = requireUserId();
      const newName = payload.newName.trim();
      if (!newName) return { error: 'Name cannot be empty' };

      const current = getFile(payload.fileId, userId);
      if (!current) return { error: 'File not found' };
      if (newName === current.name) return { file: current }; // no-op

      // Same duplicate policy as upload/folder-create: if a same-kind sibling
      // already has this name, either auto-rename to "name (2)" or flag
      // duplicate so the renderer can show a modal. Files and folders with the
      // same name coexist — only same-type collisions count.
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

      // The extension may have changed (photo.jpg → photo.txt) — the cached
      // thumbnail for this id would be stale.
      invalidateThumbnail(payload.fileId);
      mainWindow.webContents.send('file:renamed', { file });
      return { file };
    } catch (e: any) {
      return { error: e.message };
    }
  });

  // -- Settings --

  ipcMain.handle('settings:get', async (): Promise<IpcSettingsGetResponse> => {
    try {
      return {
        confirmDelete: getAppState('confirmDelete') !== '0',
        autoRenameDuplicates: getAppState('autoRenameDuplicates') !== '0',
        autoRefreshQuota: getAppState('autoRefreshQuota') !== '0'
      };
    } catch (e: any) {
      return { confirmDelete: true, autoRenameDuplicates: true, autoRefreshQuota: true };
    }
  });

  ipcMain.handle('settings:set', async (_: any, payload: IpcSettingsSetRequest): Promise<IpcSettingsSetResponse> => {
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
      return { success: true };
    } catch (e: any) {
      return { error: e.message };
    }
  });

  // -- Google API credentials (configured in Settings, stored in app_state) --

  ipcMain.handle('credentials:get', async (): Promise<IpcCredentialsGetResponse> => {
    return {
      clientId: getAppState('googleClientId') || '',
      clientSecret: getAppState('googleClientSecret') || '',
    };
  });

  ipcMain.handle('credentials:set', async (_: any, payload: IpcCredentialsSetRequest): Promise<IpcCredentialsSetResponse> => {
    try {
      // Storing empty values clears the saved credentials (removes them).
      const clientId = (payload.clientId || '').trim();
      const clientSecret = (payload.clientSecret || '').trim();
      setAppState('googleClientId', clientId);
      setAppState('googleClientSecret', clientSecret);
      return { success: true };
    } catch (e: any) {
      return { error: e.message };
    }
  });

  ipcMain.handle('file:thumbnail', async (_: any, payload: { fileId: number }) => {
    try {
      const userId = requireUserId();
      const dataUrl = await getThumbnailDataUrl(userId, payload.fileId);
      return { dataUrl };
    } catch (e) {
      return { dataUrl: null };
    }
  });

  ipcMain.handle('file:upload', async (_: any, payload: IpcFileUploadRequest): Promise<IpcFileUploadResponse> => {
    try {
      const userId = requireUserId();
      const parentId = payload.parentFolderId ?? null;

      // Duplicate-name policy: auto-rename to "name (2)" by default, or reject
      // with duplicate:true so the renderer can show a modal instead. Only
      // same-kind siblings (files vs folders) collide.
      const autoRename = getAppState('autoRenameDuplicates') !== '0';
      let fileName = payload.fileName;
      if (findDuplicateName(userId, fileName, parentId, false)) {
        if (!autoRename) {
          return { duplicate: true, error: 'A file with this name already exists here.' };
        }
        fileName = getUniqueName(userId, fileName, parentId, false);
      }

      uploadFile(userId, mainWindow, payload.filePath, fileName, parentId).catch(console.error);
      return {};
    } catch (e: any) {
      return { error: e.message };
    }
  });

  ipcMain.handle('file:download', async (_: any, payload: IpcFileDownloadRequest): Promise<IpcFileDownloadResponse> => {
    try {
      const userId = requireUserId();
      downloadFile(userId, mainWindow, payload.fileId, payload.savePath).catch(console.error);
      return { success: true };
    } catch (e: any) {
      return { error: e.message };
    }
  });

  ipcMain.handle('file:pick', async () => {
    const { dialog } = require('electron');
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Select File to Upload',
      properties: ['openFile']
    });
    if (canceled || filePaths.length === 0) {
      return { filePath: null, fileName: null };
    }
    const path = require('path');
    const filePath = filePaths[0];
    const fileName = path.basename(filePath);
    return { filePath, fileName };
  });

  ipcMain.handle('file:pick-download-path', async (_: any, fileName: string) => {
    const { dialog } = require('electron');
    const path = require('path');
    const ext = path.extname(fileName).toLowerCase().replace('.', '');
    const filters = ext ? [{ name: `${ext.toUpperCase()} File`, extensions: [ext] }, { name: 'All Files', extensions: ['*'] }] : [{ name: 'All Files', extensions: ['*'] }];
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Download File',
      defaultPath: fileName,
      filters: filters
    });
    return { filePath };
  });

  ipcMain.on('show-context-menu', (event: any, fileId: any, fileName: string, isStarred: any = 0) => {
    const { Menu, dialog } = require('electron');
    const template = [
      {
        label: 'Download',
        click: async () => {
          try {
            const userId = requireUserId();
            const path = require('path');
            const ext = path.extname(fileName).toLowerCase().replace('.', '');
            const filters = ext ? [{ name: `${ext.toUpperCase()} File`, extensions: [ext] }, { name: 'All Files', extensions: ['*'] }] : [{ name: 'All Files', extensions: ['*'] }];
            const { filePath } = await dialog.showSaveDialog(mainWindow, {
              title: 'Download File',
              defaultPath: fileName,
              filters: filters
            });
            if (filePath) {
              downloadFile(userId, mainWindow, fileId, filePath).catch(console.error);
            }
          } catch (e) {
            console.error(e);
          }
        }
      },
      { type: 'separator' },
      {
        label: isStarred ? 'Unstar' : 'Star',
        click: () => {
          try {
            const userId = requireUserId();
            const file = toggleStarred(Number(fileId), userId, !isStarred);
            if (file) mainWindow.webContents.send('file:starred', { file });
          } catch (e) {
            console.error(e);
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Delete',
        click: async () => {
          try {
            const userId = requireUserId();
            // Confirmation is handled by the renderer's custom dialog.
            await deleteFileChunks(userId, fileId);
            invalidateThumbnail(fileId);
            mainWindow.webContents.send('file:deleted', { fileId });
          } catch (e) {
            console.error(e);
          }
        }
      }
    ];
    const menu = Menu.buildFromTemplate(template as any);
    menu.popup({ window: BrowserWindow.fromWebContents(event.sender)! });
  });
}
