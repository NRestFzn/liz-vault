import { app, BrowserWindow, Menu } from 'electron';
import path from 'path';
import { initConfig, initManifest, ensureManifestLoaded, flushNow, getActiveUserId } from './db/queries';
import { registerIpcHandlers } from './ipc';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    // Window/taskbar icon (dev: project root; packaged: inside the app asar).
    icon: path.join(__dirname, '../../assets/icons/LizVault_Logo.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false // For MVP simplicity. In prod, use preload script.
    }
  });

  // One canonical UI entry point: the build copies src/renderer/index.html to
  // dist/renderer/index.html (with ./bundle.js and ./index.css next to it), so
  // the same relative paths work in dev and packaged. No separate src path.
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
  // Initialize storage: local config.json + the Drive-hosted vault manifest.
  initConfig();
  initManifest();

  createWindow();

  // Load the vault manifest from Drive as soon as possible on startup.
  if (getActiveUserId() != null) {
    ensureManifestLoaded().catch(err => console.error('[Startup] Manifest load failed:', err));
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

// Flush any pending manifest save before quitting — cancel the debounce timer
// and wait (bounded) for the upload instead of silently dropping the last change.
let quitting = false;
app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  Promise.race([
    flushNow(),
    new Promise<void>(res => setTimeout(res, 3000)), // never hang the quit
  ]).catch(() => {}).finally(() => app.quit());
});
