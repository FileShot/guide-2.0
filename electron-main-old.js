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
const { buildAppMenu } = require('./appMenu');
const { AutoUpdater } = require('./autoUpdater');

// ─── Loading screen ──────────────────────────────────────────────────
// Shown immediately while the backend subprocess starts up.
// Replaced with the real app URL as soon as /api/health responds.
const LOADING_HTML = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Audiowide&display=swap" rel="stylesheet">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body {
  height: 100%; background: #0d0d0d; color: #e5e7eb;
  font-family: 'Audiowide', 'Courier New', monospace;
  display: flex; align-items: center; justify-content: center;
  flex-direction: column; gap: 20px;
  -webkit-app-region: drag; user-select: none;
}
.logo { font-size: 26px; font-weight: 400; letter-spacing: 2px; color: #fff; }
.logo span { color: #4f9cf9; }
.spinner {
  width: 28px; height: 28px;
  border: 3px solid #2a2a2a; border-top-color: #4f9cf9;
  border-radius: 50%; animation: spin 0.75s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.sub { font-size: 12px; color: #4b5563; font-family: -apple-system, sans-serif; }
.err {
  font-size: 11px; color: #f87171; max-width: 460px; padding: 10px 14px;
  background: #1c0a0a; border: 1px solid #7f1d1d; border-radius: 6px;
  font-family: monospace; white-space: pre-wrap; word-break: break-all;
  display: none; -webkit-app-region: no-drag;
}
</style></head><body>
  <div class="logo">gu<span>IDE</span></div>
  <div class="spinner" id="sp"></div>
  <div class="sub" id="st">Starting…</div>
  <div class="err" id="er"></div>
</body></html>`;

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
    silent: true, // capture stdout/stderr so we can show crash messages
  });

  // Pipe backend stdout to Electron's stdout (visible in dev)
  serverProcess.stdout.on('data', (d) => process.stdout.write(d));

  // Capture backend stderr — show crash details in the loading screen
  serverProcess.stderr.on('data', (data) => {
    const msg = data.toString();
    process.stderr.write(msg);
    _showBackendError(msg);
  });

  serverProcess.on('exit', (code, signal) => {
    console.log('[Electron] Backend exited:', code, signal);
    serverProcess = null;
    if (code !== 0) _showBackendError(`Backend exited with code ${code} (${signal || 'no signal'})`);
  });

  serverProcess.on('error', (err) => {
    console.error('[Electron] Backend error:', err.message);
    _showBackendError(err.message);
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

  // Show loading screen immediately — backend may not be ready yet
  mainWindow.loadURL('data:text/html,' + encodeURIComponent(LOADING_HTML));

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

// ─── Backend error UI ──────────────────────────────────────────────────
// Shows crash details in the loading screen so users aren't left with silence.
function _showBackendError(msg) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // Only inject if the loading screen is still shown (not yet navigated away)
  mainWindow.webContents.executeJavaScript(`
    var er = document.getElementById('er');
    var sp = document.getElementById('sp');
    var st = document.getElementById('st');
    if (er) {
      er.textContent = ${JSON.stringify(String(msg).substring(0, 800))};
      er.style.display = 'block';
    }
    if (sp) sp.style.display = 'none';
    if (st) st.textContent = 'Backend failed to start';
  `).catch(() => {});
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

// ─── Model file picker IPC ──────────────────────────────────────────

ipcMain.handle('dialog-models-add', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    title: 'Select Model Files',
    filters: [
      { name: 'GGUF Models', extensions: ['gguf'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths.length) return { success: false };

  // Send selected paths to the backend to register them
  try {
    const http = require('http');
    const body = JSON.stringify({ filePaths: result.filePaths });
    await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1', port: serverPort,
        path: '/api/models/add', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve(JSON.parse(data)));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    return { success: true, filePaths: result.filePaths };
  } catch (e) {
    return { success: false, error: e.message };
  }
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

  // Show window IMMEDIATELY with loading screen — do not wait for backend.
  // Waiting for the backend before creating the window caused a multi-minute black
  // screen on first install because AV scans every file in app.asar.unpacked.
  createWindow(serverPort);
  buildAppMenu(mainWindow);

  // Poll backend async (up to 2 min for AV-scanned first runs).
  // When ready, navigate to the real app URL.
  waitForBackend(serverPort, 480).then(() => {
    console.log('[Electron] Backend ready on port', serverPort);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(`http://localhost:${serverPort}`);
    }
  }).catch((e) => {
    console.error('[Electron] Backend startup timeout:', e.message);
    // Try loading anyway — server may have started even if health check timed out
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(`http://localhost:${serverPort}`);
    }
  });

  // Auto-updater — check for updates after launch
  const updater = new AutoUpdater(mainWindow, { autoDownload: false });
  updater.registerIPC(ipcMain);
  // Check for updates 5 seconds after startup (don't block launch)
  setTimeout(() => updater.checkForUpdates(), 5000);
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
