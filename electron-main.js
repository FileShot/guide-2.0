/**
 * guIDE 2.0 — Electron Main Process
 *
 * Responsibilities:
 *  1. Start the Node.js backend (server/main.js) as a child process
 *  2. Wait for the backend HTTP server to be ready
 *  3. Open the main BrowserWindow pointed at http://localhost:PORT
 *  4. Enforce single instance
 *  5. Kill backend on exit
 */
'use strict';

const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const http = require('http');
const net = require('net');

// ─── GPU / V8 flags (match old IDE) ─────────────────────────────────
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');

// ─── Single instance lock ────────────────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let mainWindow = null;
let serverProcess = null;
let serverPort = null;

// ─── Helpers ─────────────────────────────────────────────────────────

function findFreePort(start) {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', () => findFreePort(start + 1).then(resolve).catch(reject));
    srv.listen(start, '127.0.0.1', () => srv.close(() => resolve(start)));
  });
}

function waitForBackend(port, maxAttempts) {
  if (maxAttempts === undefined) maxAttempts = 60;
  return new Promise((resolve, reject) => {
    let n = 0;
    const check = () => {
      if (n >= maxAttempts) { reject(new Error('Backend health timeout')); return; }
      n++;
      const req = http.get(`http://localhost:${port}/api/health`, (res) => {
        res.resume();
        res.statusCode === 200 ? resolve() : setTimeout(check, 250);
      });
      req.setTimeout(500, () => { req.destroy(); setTimeout(check, 250); });
      req.on('error', () => setTimeout(check, 250));
    };
    check();
  });
}

// ─── Start backend ───────────────────────────────────────────────────

function startBackend(port) {
  const appPath = app.getAppPath();

  // When packaged, server files are in app.asar.unpacked (not inside the asar)
  // because child_process.fork() cannot execute scripts inside asar archives.
  const serverBase = app.isPackaged
    ? appPath.replace('app.asar', 'app.asar.unpacked')
    : appPath;

  const serverScript = path.join(serverBase, 'server', 'main.js');

  console.log('[Electron] Starting backend:', serverScript, 'on port', port);

  serverProcess = fork(serverScript, [], {
    env: { ...process.env, GUIDE_PORT: String(port), PORT: String(port) },
    cwd: serverBase,
    silent: false,
  });

  serverProcess.on('exit', (code, signal) => {
    console.log('[Electron] Backend exited:', code, signal);
    serverProcess = null;
  });

  serverProcess.on('error', (err) => {
    console.error('[Electron] Backend error:', err.message);
  });
}

// ─── Create window ───────────────────────────────────────────────────

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'guIDE',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    backgroundColor: '#0d0d0d',
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(app.getAppPath(), 'preload.js'),
    },
  });

  mainWindow.loadURL(`http://localhost:${port}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open external links in default browser, not in-app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://localhost')) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ─── Window control IPC ─────────────────────────────────────────────

ipcMain.handle('win-minimize', () => { mainWindow?.minimize(); });
ipcMain.handle('win-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.handle('win-close', () => { mainWindow?.close(); });
ipcMain.handle('win-is-maximized', () => mainWindow?.isMaximized() ?? false);

// ─── Folder picker IPC ──────────────────────────────────────────────

ipcMain.handle('dialog-open-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Open Folder',
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// ─── Reveal in file explorer IPC ────────────────────────────────────

ipcMain.handle('shell-show-item', (_event, fullPath) => {
  if (typeof fullPath === 'string' && fullPath.length > 0) {
    shell.showItemInFolder(fullPath);
  }
});

// ─── App lifecycle ───────────────────────────────────────────────────

app.whenReady().then(async () => {
  serverPort = await findFreePort(3000);

  startBackend(serverPort);

  try {
    await waitForBackend(serverPort);
    console.log('[Electron] Backend ready on port', serverPort);
  } catch (e) {
    console.error('[Electron] Backend did not respond:', e.message);
    // Still create window — server may have started even if health check timed out
  }

  createWindow(serverPort);
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  killBackend();
  app.quit();
});

app.on('before-quit', () => {
  killBackend();
});

function killBackend() {
  if (serverProcess) {
    try { serverProcess.kill('SIGTERM'); } catch (_) {}
    serverProcess = null;
  }
}
