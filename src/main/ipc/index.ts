import { ipcMain, BrowserWindow } from 'electron';
import { 
  getAllAccounts, removeAccount, 
  getAllFiles, searchFiles, removeFile 
} from '../db/queries';
import { initiateOAuthFlow } from '../google/auth';
import { 
  IpcAccountRemoveRequest, IpcFilesSearchRequest, 
  IpcFileDeleteRequest, IpcAccountRemoveResponse,
  IpcFileDeleteResponse, IpcFileUploadRequest, IpcFileUploadResponse, IpcFileDownloadRequest, IpcFileDownloadResponse
} from '../../shared/types';
import { uploadFile } from '../vault/upload';
import { downloadFile } from '../vault/download';
import { deleteFileChunks } from '../vault/delete';

export function registerIpcHandlers(mainWindow: BrowserWindow) {
  
  // -- Accounts --
  
  ipcMain.handle('account:add', async () => {
    try {
      await initiateOAuthFlow();
      // The actual account data will be sent via 'account:added' event 
      // from the protocol handler in index.ts after successful callback.
      return { success: true };
    } catch (e: any) {
      return { error: e.message };
    }
  });

  ipcMain.handle('account:remove', async (_: any, payload: IpcAccountRemoveRequest): Promise<IpcAccountRemoveResponse> => {
    try {
      // Logic to check for chunks will be added in vault module
      // For MVP, just delete the account directly
      removeAccount(payload.accountId);
      mainWindow.webContents.send('account:removed', { accountId: payload.accountId });
      return { success: true };
    } catch (e: any) {
      return { error: e.message };
    }
  });

  ipcMain.handle('accounts:list', async () => {
    return { accounts: getAllAccounts() };
  });

  // -- Files --
  
  ipcMain.handle('files:list', async () => {
    return { files: getAllFiles() };
  });

  ipcMain.handle('files:search', async (_: any, payload: IpcFilesSearchRequest) => {
    return { files: searchFiles(payload.query) };
  });

  ipcMain.handle('file:delete', async (_: any, payload: IpcFileDeleteRequest): Promise<IpcFileDeleteResponse> => {
    try {
      await deleteFileChunks(payload.fileId);
      mainWindow.webContents.send('file:deleted', { fileId: payload.fileId });
      return { success: true };
    } catch (e: any) {
      return { error: e.message };
    }
  });

  ipcMain.handle('file:upload', async (_: any, payload: IpcFileUploadRequest): Promise<IpcFileUploadResponse> => {
    try {
      // Run async without blocking IPC return so UI stays responsive
      uploadFile(mainWindow, payload.filePath, payload.fileName).catch(console.error);
      return {}; 
    } catch (e: any) {
      return { error: e.message };
    }
  });

  ipcMain.handle('file:download', async (_: any, payload: IpcFileDownloadRequest): Promise<IpcFileDownloadResponse> => {
    try {
      // Run async without blocking IPC return
      downloadFile(mainWindow, payload.fileId, payload.savePath).catch(console.error);
      return { success: true };
    } catch (e: any) {
      return { error: e.message };
    }
  });

  ipcMain.on('show-context-menu', (event: any, fileId: any) => {
    const { Menu, dialog } = require('electron');
    const template = [
      {
        label: 'Download',
        click: async () => {
          const { filePath } = await dialog.showSaveDialog(mainWindow, {
            title: 'Download File',
            defaultPath: 'downloaded_file' // In reality we'd pass the actual filename
          });
          if (filePath) {
            downloadFile(mainWindow, fileId, filePath).catch(console.error);
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Delete',
        click: async () => {
          const { response } = await dialog.showMessageBox(mainWindow, {
            type: 'warning',
            buttons: ['Cancel', 'Delete'],
            defaultId: 0,
            title: 'Confirm Delete',
            message: 'Are you sure you want to delete this file from all connected drives?'
          });
          if (response === 1) {
            await deleteFileChunks(fileId);
            mainWindow.webContents.send('file:deleted', { fileId });
          }
        }
      }
    ];
    const menu = Menu.buildFromTemplate(template as any);
    menu.popup({ window: BrowserWindow.fromWebContents(event.sender)! });
  });
}


