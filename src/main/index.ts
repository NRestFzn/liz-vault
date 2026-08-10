import { app, BrowserWindow, protocol, Menu } from 'electron';
import path from 'path';
import { initDb } from './db/schema';
import { registerIpcHandlers } from './ipc';
import { handleOAuthCallback } from './google/auth';

let mainWindow: BrowserWindow | null = null;

// Register the lizvault custom protocol for OAuth before app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'lizvault', privileges: { secure: true, standard: true, bypassCSP: true } }
]);

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

  // Register custom protocol handler for OAuth
  protocol.handle('lizvault', async (req: any) => {
    try {
      const account = await handleOAuthCallback(req.url);
      if (mainWindow) {
        mainWindow.webContents.send('account:added', { account });
      }
    } catch (e) {
      console.error("OAuth callback failed:", e);
      if (mainWindow) {
        mainWindow.webContents.send('account:error', { error: String(e) });
      }
    }
    // Return a dummy response so the protocol handler doesn't crash
    return new Response('<html><body><h1>Authentication complete! You can close this window.</h1><script>window.close()</script></body></html>', {
      headers: { 'content-type': 'text/html' }
    });
  });

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
