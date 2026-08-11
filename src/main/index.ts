import { app, BrowserWindow, Menu } from 'electron';
import path from 'path';
import { initDb } from './db/schema';
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
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false // For MVP simplicity. In prod, use preload script.
    }
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));
  } else {
    // Esbuild will bundle to dist/renderer/bundle.js, but we serve index.html directly from src
    // Or we can just load the file directly if we copy it, but easiest is to load from src
    mainWindow.loadFile(path.join(__dirname, '../../../src/renderer/index.html'));
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  registerIpcHandlers(mainWindow);
}

app.whenReady().then(() => {
  // Initialize Database
  initDb();

  createWindow();

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
