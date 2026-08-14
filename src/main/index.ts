import { app, BrowserWindow, Menu } from 'electron';
import path from 'node:path';
import { initConfig, initManifest, ensureManifestLoaded, flushNow, getActiveUserId } from './db/queries';
import { registerIpcHandlers } from './ipc';
import { initE2ELog, logE2E, logE2EError } from './e2eLog';
import { sweepExpiredTrash } from './vault/delete';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    icon: path.join(__dirname, '../../assets/icons/LizVault_Logo.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  registerIpcHandlers(mainWindow);
}

app.whenReady().then(() => {
  initE2ELog();
  initConfig();
  initManifest();

  createWindow();

  if (getActiveUserId() != null) {
    const userId = getActiveUserId();
    ensureManifestLoaded().catch(err => {
      console.error('[Startup] Manifest load failed:', err);
      logE2EError('manifest.load.error', err);
    }).then(() => {
      if (userId != null) sweepExpiredTrash(userId).catch(() => {});
    });
  } else {
    logE2E('manifest.skip', { reason: 'no active user' });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

let quitting = false;
app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  Promise.race([
    flushNow(),
    new Promise<void>(res => setTimeout(res, 3000)),
  ]).catch(() => {}).finally(() => app.quit());
});
