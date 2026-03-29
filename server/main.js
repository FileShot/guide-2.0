/**
 * guIDE 2.0 — Main Server Entry Point
 *
 * Starts the Node.js backend that powers the AI pipeline.
 * Provides:
 *   1. HTTP server serving the frontend static files
 *   2. WebSocket server for real-time streaming (tokens, events, tool progress)
 *   3. REST API for model management, file operations, settings
 *   4. Wires all pipeline modules together (llmEngine, agenticChat, mcpToolServer, etc.)
 *
 * This server runs in two modes:
 *   - Standalone: accessed via browser at http://localhost:PORT
 *   - Tauri sidecar: launched by the Rust desktop app, communicates over the same WebSocket
 *
 * Usage:
 *   node server/main.js [--port PORT] [--dev]
 */
'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const express = require('express');
const cors = require('cors');

const { IpcMainBridge, MainWindowBridge, createAppBridge } = require('./ipcBridge');
const { Transport } = require('./transport');

// ─── Parse CLI args ──────────────────────────────────────
const args = process.argv.slice(2);
const isDev = args.includes('--dev');
const portArg = args.find((a, i) => args[i - 1] === '--port');
const PORT = parseInt(portArg, 10) || parseInt(process.env.GUIDE_PORT, 10) || 3000;

// ─── Paths ───────────────────────────────────────────────
const ROOT_DIR = path.resolve(__dirname, '..');
const FRONTEND_DIST = path.join(ROOT_DIR, 'frontend', 'dist');
const MODELS_DIR = path.join(ROOT_DIR, 'models');
const USER_DATA = process.env.APPDATA
  ? path.join(process.env.APPDATA, 'guide-ide')
  : path.join(os.homedir(), '.config', 'guide-ide');

// Ensure critical directories exist
for (const dir of [MODELS_DIR, USER_DATA, path.join(USER_DATA, 'sessions'), path.join(USER_DATA, 'logs')]) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
}

// ─── Install Electron shims BEFORE loading pipeline modules ──
// The pipeline code does require('electron') in several places.
// We intercept this with a Module wrapper that returns our bridges.
const ipcMain = new IpcMainBridge();
const mainWindow = new MainWindowBridge();
const appBridge = createAppBridge(USER_DATA);

// Shim the 'electron' module so require('electron') returns our bridges
const Module = require('module');
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === 'electron') {
    // Return a path to our shim module
    return path.join(__dirname, '_electronShim.js');
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

// Create the electron shim module file if it doesn't exist
const shimPath = path.join(__dirname, '_electronShim.js');
if (!fs.existsSync(shimPath)) {
  // This will be created below — we write it synchronously before any pipeline require()
}

// Write the shim — it exports our bridge instances via a global reference
// We store references on global so the shim can access them
global.__guideIpcMain = ipcMain;
global.__guideMainWindow = mainWindow;
global.__guideApp = appBridge;

const shimCode = `
'use strict';
module.exports = {
  ipcMain: global.__guideIpcMain,
  app: global.__guideApp,
  BrowserWindow: {
    getAllWindows: () => [global.__guideMainWindow],
    getFocusedWindow: () => global.__guideMainWindow,
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showSaveDialog: async () => ({ canceled: true, filePath: '' }),
    showMessageBox: async () => ({ response: 0 }),
  },
  shell: {
    openExternal: (url) => { console.log('[Shell] openExternal:', url); },
    openPath: (p) => { console.log('[Shell] openPath:', p); },
  },
  Menu: { buildFromTemplate: () => ({}), setApplicationMenu: () => {} },
  Tray: class { constructor() {} },
  nativeTheme: { shouldUseDarkColors: true, themeSource: 'dark' },
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) },
};
`;
fs.writeFileSync(shimPath, shimCode, 'utf8');

// ─── Now load pipeline modules (they will get our Electron shim) ──
console.log('[Server] Loading pipeline modules...');

const log = require(path.join(ROOT_DIR, 'logger'));
log.installConsoleIntercepts();

const { LLMEngine } = require(path.join(ROOT_DIR, 'llmEngine'));
const { MCPToolServer } = require(path.join(ROOT_DIR, 'mcpToolServer'));
const { ModelManager } = require(path.join(ROOT_DIR, 'modelManager'));
const { MemoryStore } = require(path.join(ROOT_DIR, 'memoryStore'));
const { LongTermMemory } = require(path.join(ROOT_DIR, 'longTermMemory'));
const { SessionStore } = require(path.join(ROOT_DIR, 'sessionStore'));
const { DEFAULT_SYSTEM_PREAMBLE, DEFAULT_COMPACT_PREAMBLE, DEFAULT_CHAT_PREAMBLE } = require(path.join(ROOT_DIR, 'constants'));
const { ConversationSummarizer } = require(path.join(ROOT_DIR, 'pipeline', 'conversationSummarizer'));
const { CloudLLMService } = require(path.join(ROOT_DIR, 'cloudLLMService'));
const { ModelDownloader } = require(path.join(__dirname, 'modelDownloader'));
const liveServer = require(path.join(__dirname, 'liveServer'));
const agenticChat = require(path.join(ROOT_DIR, 'agenticChat'));

// ─── Initialize pipeline components ──────────────────────
console.log('[Server] Initializing pipeline components...');

const llmEngine = new LLMEngine();
const mcpToolServer = new MCPToolServer({ projectPath: null });
const memoryStore = new MemoryStore();
const longTermMemory = new LongTermMemory();
const modelManager = new ModelManager(ROOT_DIR);
const sessionStore = new SessionStore(path.join(USER_DATA, 'sessions'));
const cloudLLM = new CloudLLMService();
const modelDownloader = new ModelDownloader(path.join(ROOT_DIR, 'models'));

// Settings persistence
const SETTINGS_PATH = path.join(USER_DATA, 'settings.json');
function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    }
  } catch (_) {}
  return { userSettings: {} };
}
function saveSettings(settings) {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
  } catch (e) {
    console.error('[Server] Failed to save settings:', e.message);
  }
}

let currentSettings = loadSettings();

// ─── Build context object (same shape agenticChat.register() expects) ──
const ctx = {
  llmEngine,
  mcpToolServer,
  memoryStore,
  longTermMemory,
  modelManager,
  sessionStore,
  ConversationSummarizer,
  DEFAULT_SYSTEM_PREAMBLE,
  DEFAULT_COMPACT_PREAMBLE,
  DEFAULT_CHAT_PREAMBLE,
  userDataPath: USER_DATA,
  currentProjectPath: null,
  agenticCancelled: false,

  getMainWindow: () => mainWindow,

  cloudLLM,

  // Browser stubs — Playwright/browser engine not included in core
  playwrightBrowser: null,
  browserManager: null,

  // RAG stub — supplementary feature
  ragEngine: null,

  // Web search stub — can be connected to DuckDuckGo or similar
  webSearch: null,

  // License stub — local-first, no license required
  licenseManager: {
    isActivated: false,
    getSessionToken: () => null,
  },

  _truncateResult: (result) => {
    if (!result) return result;
    const str = typeof result === 'string' ? result : JSON.stringify(result);
    return str.length > 8000 ? str.substring(0, 8000) + '...[truncated]' : result;
  },

  _readConfig: () => currentSettings,
};

// Wire license manager into cloud service
cloudLLM.setLicenseManager(ctx.licenseManager);

// Register the agentic chat handlers (they call ipcMain.handle internally)
agenticChat.register(ctx);

// ─── Express HTTP Server ─────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ─── Project Templates ───────────────────────────────────
const { register: registerTemplates } = require(path.join(__dirname, 'templateHandlers'));
registerTemplates(app);

// ─── REST API Routes ─────────────────────────────────────

// Model management
app.get('/api/models', async (req, res) => {
  try {
    const models = modelManager.availableModels;
    const status = llmEngine.getStatus();
    res.json({ models, status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/models/load', async (req, res) => {
  const { modelPath } = req.body;
  if (!modelPath) return res.status(400).json({ error: 'modelPath required' });
  try {
    // Send loading status to connected clients
    mainWindow.webContents.send('model-loading', { path: modelPath });
    await llmEngine.initialize(modelPath);
    const info = llmEngine.modelInfo;
    mainWindow.webContents.send('model-loaded', info);
    res.json({ success: true, modelInfo: info });
  } catch (e) {
    mainWindow.webContents.send('model-error', { error: e.message });
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/models/unload', async (req, res) => {
  try {
    await llmEngine.dispose();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/models/status', (req, res) => {
  res.json(llmEngine.getStatus());
});

app.post('/api/models/scan', async (req, res) => {
  try {
    const models = await modelManager.scanModels();
    res.json({ models });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/models/add', async (req, res) => {
  const { filePaths } = req.body;
  if (!filePaths || !Array.isArray(filePaths)) return res.status(400).json({ error: 'filePaths array required' });
  try {
    const added = await modelManager.addModels(filePaths);
    res.json({ added });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GPU info + system resources
app.get('/api/gpu', async (req, res) => {
  try {
    const info = await llmEngine.getGPUInfo();
    // Add CPU/RAM info
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    info.ramTotalGB = (totalMem / (1024 ** 3)).toFixed(1);
    info.ramUsedGB = (usedMem / (1024 ** 3)).toFixed(1);
    // CPU usage: average across cores (idle vs total)
    const cpus = os.cpus();
    let totalIdle = 0, totalTick = 0;
    for (const cpu of cpus) {
      for (const type in cpu.times) totalTick += cpu.times[type];
      totalIdle += cpu.times.idle;
    }
    info.cpuUsage = Math.round(100 - (totalIdle / totalTick * 100));
    res.json(info);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Project management
app.post('/api/project/open', (req, res) => {
  const { projectPath } = req.body;
  if (!projectPath) return res.status(400).json({ error: 'projectPath required' });
  try {
    const resolved = path.resolve(projectPath);
    if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'Directory not found' });
    ctx.currentProjectPath = resolved;
    mcpToolServer.projectPath = resolved;
    memoryStore.initialize(resolved);
    longTermMemory.initialize(resolved);
    mainWindow.webContents.send('project-opened', { path: resolved });
    res.json({ success: true, path: resolved });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/project/current', (req, res) => {
  res.json({ projectPath: ctx.currentProjectPath });
});

// File operations (for the file explorer)
app.get('/api/files/tree', async (req, res) => {
  const dirPath = req.query.path || ctx.currentProjectPath;
  if (!dirPath) return res.json({ items: [] });
  try {
    const items = await _readDirRecursive(dirPath, 0, 3);
    res.json({ items, root: dirPath });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/files/read', async (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'path required' });
  try {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(ctx.currentProjectPath || '', filePath);
    const content = fs.readFileSync(fullPath, 'utf8');
    const ext = path.extname(fullPath).slice(1);
    res.json({ content, path: fullPath, extension: ext, name: path.basename(fullPath) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/files/write', async (req, res) => {
  const { filePath, content } = req.body;
  if (!filePath) return res.status(400).json({ error: 'filePath required' });
  try {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(ctx.currentProjectPath || '', filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content || '', 'utf8');
    res.json({ success: true, path: fullPath });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Settings
app.get('/api/settings', (req, res) => {
  res.json(currentSettings);
});

app.post('/api/settings', (req, res) => {
  currentSettings = { ...currentSettings, ...req.body };
  saveSettings(currentSettings);
  res.json({ success: true });
});

// ─── Cloud LLM API Routes ────────────────────────────────

app.get('/api/cloud/status', (req, res) => {
  res.json(cloudLLM.getStatus());
});

app.get('/api/cloud/providers', (req, res) => {
  res.json({
    configured: cloudLLM.getConfiguredProviders(),
    all: cloudLLM.getAllProviders(),
  });
});

app.get('/api/cloud/models/:provider', async (req, res) => {
  const { provider } = req.params;
  if (provider === 'openrouter') {
    try {
      const models = await cloudLLM.fetchOpenRouterModels();
      res.json({ models });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  } else if (provider === 'ollama') {
    await cloudLLM.detectOllama();
    res.json({ models: cloudLLM.getOllamaModels() });
  } else {
    res.json({ models: cloudLLM._getProviderModels(provider) });
  }
});

app.post('/api/cloud/provider', (req, res) => {
  const { provider, model } = req.body;
  if (!provider) return res.status(400).json({ error: 'provider required' });
  cloudLLM.activeProvider = provider;
  if (model) cloudLLM.activeModel = model;
  res.json({ success: true, activeProvider: cloudLLM.activeProvider, activeModel: cloudLLM.activeModel });
});

app.post('/api/cloud/apikey', (req, res) => {
  const { provider, key } = req.body;
  if (!provider) return res.status(400).json({ error: 'provider required' });
  cloudLLM.setApiKey(provider, key || '');
  res.json({ success: true, hasKey: !!(key && key.trim()) });
});

app.get('/api/cloud/pool/:provider', (req, res) => {
  res.json(cloudLLM.getPoolStatus(req.params.provider));
});

app.get('/api/cloud/test/:provider', async (req, res) => {
  const { provider } = req.params;
  if (!provider) return res.status(400).json({ error: 'provider required' });
  try {
    const key = cloudLLM.apiKeys[provider];
    if (!key) return res.json({ success: false, error: 'No API key set' });
    const models = cloudLLM._getProviderModels(provider);
    const testModel = models[0]?.id;
    if (!testModel) return res.json({ success: false, error: 'No models for provider' });
    // Quick validation: set the provider temporarily and do a minimal generate
    const prevProvider = cloudLLM.activeProvider;
    const prevModel = cloudLLM.activeModel;
    cloudLLM.activeProvider = provider;
    cloudLLM.activeModel = testModel;
    const result = await Promise.race([
      cloudLLM.generate([{ role: 'user', content: 'Say hi' }], { maxTokens: 5, stream: false }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout after 15s')), 15000)),
    ]);
    cloudLLM.activeProvider = prevProvider;
    cloudLLM.activeModel = prevModel;
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/models/recommend', async (req, res) => {
  try {
    const { execSync } = require('child_process');
    let vramMB = 0;
    try {
      const out = execSync('nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits', { timeout: 5000 }).toString().trim();
      vramMB = parseInt(out.split('\n')[0], 10) || 0;
    } catch { /* no GPU or nvidia-smi not available */ }
    const maxModelGB = vramMB > 0 ? Math.floor((vramMB * 0.85) / 1024) : 4;
    // Curated recommended models list
    const recommended = [
      { name: 'Qwen 3 0.6B', file: 'Qwen3-0.6B-Q8_0.gguf', size: 0.8, desc: 'Tiny, ultra-fast', downloadUrl: 'https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q8_0.gguf', tags: ['general'] },
      { name: 'Qwen 3 1.7B', file: 'Qwen3-1.7B-Q8_0.gguf', size: 1.9, desc: 'Small, fast', downloadUrl: 'https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q8_0.gguf', tags: ['general'] },
      { name: 'Qwen 3 4B', file: 'Qwen3-4B-Q8_0.gguf', size: 4.5, desc: 'Great balance', downloadUrl: 'https://huggingface.co/unsloth/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q8_0.gguf', tags: ['coding', 'general'] },
      { name: 'Qwen 3 8B', file: 'Qwen3-8B-Q4_K_M.gguf', size: 5.0, desc: 'Strong all-rounder', downloadUrl: 'https://huggingface.co/unsloth/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf', tags: ['coding', 'reasoning'] },
      { name: 'Qwen 3 14B', file: 'Qwen3-14B-Q4_K_M.gguf', size: 8.7, desc: 'High quality', downloadUrl: 'https://huggingface.co/unsloth/Qwen3-14B-GGUF/resolve/main/Qwen3-14B-Q4_K_M.gguf', tags: ['coding', 'reasoning'] },
      { name: 'Qwen 3 30B-A3B (MoE)', file: 'Qwen3-30B-A3B-Q4_K_M.gguf', size: 18.4, desc: 'MoE, fast for size', downloadUrl: 'https://huggingface.co/unsloth/Qwen3-30B-A3B-GGUF/resolve/main/Qwen3-30B-A3B-Q4_K_M.gguf', tags: ['coding', 'reasoning'] },
      { name: 'Qwen 3 32B', file: 'Qwen3-32B-Q4_K_M.gguf', size: 20.0, desc: 'Flagship quality', downloadUrl: 'https://huggingface.co/unsloth/Qwen3-32B-GGUF/resolve/main/Qwen3-32B-Q4_K_M.gguf', tags: ['coding', 'reasoning', 'general'] },
    ];
    const fits = recommended.filter(m => m.size <= maxModelGB);
    const other = recommended.filter(m => m.size > maxModelGB);
    res.json({ fits, other, maxModelGB, vramMB });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── HuggingFace model download endpoints ─────────────────────────
app.get('/api/models/hf/search', async (req, res) => {
  const q = req.query.q;
  if (!q || !q.trim()) return res.json({ models: [] });
  try {
    const models = await modelDownloader.searchModels(q.trim());
    res.json({ models });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/models/hf/files/:owner/:repo', async (req, res) => {
  const repoId = `${req.params.owner}/${req.params.repo}`;
  try {
    const result = await modelDownloader.getRepoFiles(repoId);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/models/hf/download', async (req, res) => {
  const { url, fileName } = req.body || {};
  if (!url || !fileName) return res.status(400).json({ error: 'url and fileName required' });
  try {
    const result = await modelDownloader.downloadModel(url, fileName);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/models/hf/cancel', (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  const cancelled = modelDownloader.cancelDownload(id);
  res.json({ success: cancelled });
});

app.get('/api/models/hf/downloads', (req, res) => {
  res.json({ downloads: modelDownloader.getActiveDownloads() });
});

// ── License endpoints ────────────────────────────────────────────
app.get('/api/license/status', (req, res) => {
  const lm = ctx.licenseManager;
  res.json({
    isActivated: lm.isActivated || false,
    isAuthenticated: lm.isAuthenticated || false,
    license: lm.licenseData || null,
    machineId: lm.machineId || null,
  });
});

app.post('/api/license/activate', (req, res) => {
  const { method, key, email, password } = req.body || {};
  if (method === 'key') {
    // License key activation — stub for now
    if (!key || !key.trim()) return res.json({ success: false, error: 'License key is required' });
    res.json({ success: false, error: 'License server not yet connected. Use local AI for now.' });
  } else if (method === 'account') {
    // Email/password activation — stub for now
    if (!email || !password) return res.json({ success: false, error: 'Email and password are required' });
    res.json({ success: false, error: 'License server not yet connected. Use local AI for now.' });
  } else {
    res.json({ success: false, error: 'Invalid activation method' });
  }
});

app.post('/api/license/oauth', (req, res) => {
  const { provider } = req.body || {};
  if (!provider || !['google', 'github'].includes(provider)) {
    return res.json({ success: false, error: 'Invalid OAuth provider' });
  }
  // OAuth flow — stub for now
  res.json({ success: false, error: 'OAuth not yet available. Use local AI for now.' });
});

app.post('/api/license/deactivate', (req, res) => {
  // Deactivation — stub: reset in-memory state
  ctx.licenseManager.isActivated = false;
  ctx.licenseManager.isAuthenticated = false;
  ctx.licenseManager.licenseData = null;
  res.json({ success: true });
});

// Session management
app.post('/api/session/clear', async (req, res) => {
  try {
    ctx.agenticCancelled = true;
    try { llmEngine.cancelGeneration(); } catch (_) {}
    await new Promise(r => setTimeout(r, 100));
    await llmEngine.resetSession();
    ctx.agenticCancelled = false;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'running',
    version: '2.0.0',
    modelLoaded: llmEngine.isReady,
    modelInfo: llmEngine.modelInfo,
    projectPath: ctx.currentProjectPath,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});

// File search
app.get('/api/files/search', async (req, res) => {
  const basePath = req.query.path || ctx.currentProjectPath;
  const query = req.query.query;
  if (!basePath || !query) return res.json({ results: [] });
  try {
    const results = [];
    const maxResults = 200;
    const searchDir = (dir, depth = 0) => {
      if (depth > 6 || results.length >= maxResults) return;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
      for (const entry of entries) {
        if (results.length >= maxResults) break;
        if (entry.name.startsWith('.') && entry.name !== '.env') continue;
        if (['node_modules', '__pycache__', '.git', 'dist', 'build', '.next', 'target'].includes(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          searchDir(fullPath, depth + 1);
        } else if (entry.isFile()) {
          try {
            const stat = fs.statSync(fullPath);
            if (stat.size > 1024 * 1024) continue; // skip files > 1MB
            const content = fs.readFileSync(fullPath, 'utf8');
            const lines = content.split('\n');
            const lowerQuery = query.toLowerCase();
            for (let i = 0; i < lines.length && results.length < maxResults; i++) {
              if (lines[i].toLowerCase().includes(lowerQuery)) {
                results.push({ file: fullPath, line: i + 1, text: lines[i].trim().substring(0, 200) });
              }
            }
          } catch (_) {}
        }
      }
    };
    searchDir(basePath);
    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Git status
app.get('/api/git/status', async (req, res) => {
  const basePath = req.query.path || ctx.currentProjectPath;
  if (!basePath) return res.json({ error: 'No project path' });
  try {
    const { execSync } = require('child_process');
    const opts = { cwd: basePath, encoding: 'utf8', timeout: 5000 };
    let branch = '';
    try { branch = execSync('git rev-parse --abbrev-ref HEAD', opts).trim(); } catch (_) {}
    if (!branch) return res.json({ error: 'Not a git repository', branch: '', staged: [], modified: [], untracked: [] });
    let statusOutput = '';
    try { statusOutput = execSync('git status --porcelain', opts); } catch (_) {}
    const staged = [];
    const modified = [];
    const untracked = [];
    for (const line of statusOutput.split('\n')) {
      if (!line.trim()) continue;
      const x = line[0], y = line[1];
      const file = line.substring(3).trim();
      if (x === '?' && y === '?') untracked.push(file);
      else if (x !== ' ' && x !== '?') staged.push(file);
      if (y !== ' ' && y !== '?') modified.push(file);
    }
    res.json({ branch, staged, modified, untracked });
  } catch (e) {
    res.json({ error: e.message, branch: '', staged: [], modified: [], untracked: [] });
  }
});

// Git stage files
app.post('/api/git/stage', async (req, res) => {
  const basePath = req.body.path || ctx.currentProjectPath;
  if (!basePath) return res.status(400).json({ error: 'No project path' });
  try {
    const { execSync } = require('child_process');
    const opts = { cwd: basePath, encoding: 'utf8', timeout: 10000 };
    if (req.body.all) {
      execSync('git add -A', opts);
    } else if (req.body.files && Array.isArray(req.body.files)) {
      for (const f of req.body.files) {
        const safe = f.replace(/"/g, '\\"');
        execSync(`git add "${safe}"`, opts);
      }
    } else {
      return res.status(400).json({ error: 'Provide files array or all:true' });
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Git unstage files
app.post('/api/git/unstage', async (req, res) => {
  const basePath = req.body.path || ctx.currentProjectPath;
  if (!basePath) return res.status(400).json({ error: 'No project path' });
  try {
    const { execSync } = require('child_process');
    const opts = { cwd: basePath, encoding: 'utf8', timeout: 10000 };
    if (req.body.all) {
      execSync('git reset HEAD', opts);
    } else if (req.body.files && Array.isArray(req.body.files)) {
      for (const f of req.body.files) {
        const safe = f.replace(/"/g, '\\"');
        execSync(`git reset HEAD "${safe}"`, opts);
      }
    } else {
      return res.status(400).json({ error: 'Provide files array or all:true' });
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Git commit
app.post('/api/git/commit', async (req, res) => {
  const basePath = req.body.path || ctx.currentProjectPath;
  const message = req.body.message;
  if (!basePath) return res.status(400).json({ error: 'No project path' });
  if (!message || !message.trim()) return res.status(400).json({ error: 'Commit message required' });
  try {
    const { execSync } = require('child_process');
    const opts = { cwd: basePath, encoding: 'utf8', timeout: 15000 };
    const safe = message.trim().replace(/"/g, '\\"');
    const result = execSync(`git commit -m "${safe}"`, opts);
    res.json({ success: true, output: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Git discard changes (checkout file from HEAD)
app.post('/api/git/discard', async (req, res) => {
  const basePath = req.body.path || ctx.currentProjectPath;
  if (!basePath) return res.status(400).json({ error: 'No project path' });
  try {
    const { execSync } = require('child_process');
    const opts = { cwd: basePath, encoding: 'utf8', timeout: 10000 };
    if (req.body.files && Array.isArray(req.body.files)) {
      for (const f of req.body.files) {
        const safe = f.replace(/"/g, '\\"');
        execSync(`git checkout -- "${safe}"`, opts);
      }
    } else {
      return res.status(400).json({ error: 'Provide files array' });
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Git diff
app.get('/api/git/diff', async (req, res) => {
  const basePath = req.query.path || ctx.currentProjectPath;
  if (!basePath) return res.status(400).json({ error: 'No project path' });
  try {
    const { execSync } = require('child_process');
    const opts = { cwd: basePath, encoding: 'utf8', timeout: 10000 };
    let cmd = req.query.staged === 'true' ? 'git diff --cached' : 'git diff';
    if (req.query.file) {
      const safe = req.query.file.replace(/"/g, '\\"');
      cmd += ` -- "${safe}"`;
    }
    const diff = execSync(cmd, opts);
    res.json({ success: true, diff });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Git log
app.get('/api/git/log', async (req, res) => {
  const basePath = req.query.path || ctx.currentProjectPath;
  if (!basePath) return res.status(400).json({ error: 'No project path' });
  try {
    const { execSync } = require('child_process');
    const count = Math.min(100, Math.max(1, parseInt(req.query.count) || 20));
    const opts = { cwd: basePath, encoding: 'utf8', timeout: 10000 };
    const result = execSync(`git log --oneline --format="%h|%s|%an|%ar" -${count}`, opts);
    const entries = result.split('\n').filter(Boolean).map(line => {
      const [hash, message, author, date] = line.split('|');
      return { hash, message, author, date };
    });
    res.json({ success: true, entries });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Git branches
app.get('/api/git/branches', async (req, res) => {
  const basePath = req.query.path || ctx.currentProjectPath;
  if (!basePath) return res.status(400).json({ error: 'No project path' });
  try {
    const { execSync } = require('child_process');
    const opts = { cwd: basePath, encoding: 'utf8', timeout: 5000 };
    const result = execSync('git branch', opts);
    const branches = result.split('\n').filter(Boolean).map(line => ({
      name: line.replace(/^\*?\s*/, '').trim(),
      current: line.startsWith('*'),
    }));
    res.json({ success: true, branches });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Git checkout branch
app.post('/api/git/checkout', async (req, res) => {
  const basePath = req.body.path || ctx.currentProjectPath;
  const branch = req.body.branch;
  if (!basePath) return res.status(400).json({ error: 'No project path' });
  if (!branch) return res.status(400).json({ error: 'Branch name required' });
  try {
    const { execSync } = require('child_process');
    const opts = { cwd: basePath, encoding: 'utf8', timeout: 15000 };
    const safe = branch.replace(/"/g, '\\"');
    const create = req.body.create ? '-b ' : '';
    const result = execSync(`git checkout ${create}"${safe}"`, opts);
    res.json({ success: true, output: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// File create (for SearchPanel/explorer new file)
app.post('/api/files/create', async (req, res) => {
  const { path: filePath, content } = req.body;
  if (!filePath) return res.status(400).json({ error: 'path required' });
  try {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(ctx.currentProjectPath || '', filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    if (fs.existsSync(fullPath)) return res.status(409).json({ error: 'File already exists' });
    fs.writeFileSync(fullPath, content || '', 'utf8');
    res.json({ success: true, path: fullPath });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// File delete
app.post('/api/files/delete', async (req, res) => {
  const { path: filePath } = req.body;
  if (!filePath) return res.status(400).json({ error: 'path required' });
  try {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(ctx.currentProjectPath || '', filePath);
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'Not found' });
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      fs.rmSync(fullPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(fullPath);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// File rename
app.post('/api/files/rename', async (req, res) => {
  const { oldPath, newPath } = req.body;
  if (!oldPath || !newPath) return res.status(400).json({ error: 'oldPath and newPath required' });
  try {
    const fullOld = path.isAbsolute(oldPath) ? oldPath : path.join(ctx.currentProjectPath || '', oldPath);
    const fullNew = path.isAbsolute(newPath) ? newPath : path.join(ctx.currentProjectPath || '', newPath);
    if (!fs.existsSync(fullOld)) return res.status(404).json({ error: 'Source not found' });
    fs.renameSync(fullOld, fullNew);
    res.json({ success: true, path: fullNew });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Terminal execute (legacy — used when PTY is not available)
app.post('/api/terminal/execute', async (req, res) => {
  const { command, cwd } = req.body;
  if (!command) return res.status(400).json({ error: 'command required' });
  try {
    const { execSync } = require('child_process');
    const output = execSync(command, {
      cwd: cwd || ctx.currentProjectPath || process.cwd(),
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
    res.json({ success: true, output });
  } catch (e) {
    res.json({ success: false, output: e.stderr || e.stdout || e.message });
  }
});

// ─── Live Server (Go Live preview) ───────────────────────
app.post('/api/live-server/start', async (req, res) => {
  const rootPath = req.body.path || ctx.currentProjectPath;
  if (!rootPath) return res.status(400).json({ error: 'No project path' });
  const result = await liveServer.start(rootPath);
  if (result.success) {
    res.json(result);
  } else {
    res.status(500).json(result);
  }
});

app.post('/api/live-server/stop', async (req, res) => {
  const result = await liveServer.stop();
  res.json(result);
});

app.get('/api/live-server/status', (req, res) => {
  res.json(liveServer.getStatus());
});

// ─── Serve Frontend ──────────────────────────────────────
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  // SPA fallback — serve index.html for all non-API, non-file routes
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/') && !req.path.startsWith('/ws')) {
      res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
    }
  });
} else if (isDev) {
  // In dev mode, Vite dev server handles the frontend — just serve API + WS
  app.get('/', (req, res) => {
    res.send('<html><body><h1>guIDE Backend Running</h1><p>Frontend dev server: <a href="http://localhost:5173">http://localhost:5173</a></p></body></html>');
  });
} else {
  app.get('/', (req, res) => {
    res.send('<html><body><h1>guIDE Backend Running</h1><p>Frontend not built. Run: npm run frontend:build</p></body></html>');
  });
}

// ─── Start Server ────────────────────────────────────────
const server = http.createServer(app);
const transport = new Transport({ ipcMain, mainWindow, server });
transport.start();

// ─── PTY Terminal WebSocket ──────────────────────────────
const WebSocket = require('ws');
let pty;
try {
  pty = require('node-pty');
  console.log('[Server] node-pty loaded — real terminal support enabled');
} catch (e) {
  console.warn('[Server] node-pty not available — terminal will use exec fallback');
  pty = null;
}

const ptyTerminals = new Map(); // terminalId -> { pty, ws }

const ptyWss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === '/ws/terminal') {
    ptyWss.handleUpgrade(request, socket, head, (ws) => {
      ptyWss.emit('connection', ws, request);
    });
  }
  // /ws is handled by Transport's own WSS instance
});

ptyWss.on('connection', (ws) => {
  let termId = null;
  let ptyProcess = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (_) { return; }

    if (msg.type === 'create') {
      termId = msg.terminalId || `pty-${Date.now()}`;
      if (pty) {
        const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash');
        const cwd = ctx.currentProjectPath || process.cwd();
        ptyProcess = pty.spawn(shell, [], {
          name: 'xterm-256color',
          cols: msg.cols || 80,
          rows: msg.rows || 24,
          cwd,
          env: process.env,
        });

        ptyProcess.onData((data) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'output', data }));
          }
        });

        ptyProcess.onExit(({ exitCode }) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'exit', exitCode }));
          }
          ptyTerminals.delete(termId);
        });

        ptyTerminals.set(termId, { pty: ptyProcess, ws });
        ws.send(JSON.stringify({ type: 'ready', terminalId: termId, shell }));
      } else {
        // No node-pty — send a message saying to use exec fallback
        ws.send(JSON.stringify({ type: 'no-pty' }));
      }
    } else if (msg.type === 'input' && ptyProcess) {
      ptyProcess.write(msg.data);
    } else if (msg.type === 'resize' && ptyProcess) {
      try { ptyProcess.resize(msg.cols || 80, msg.rows || 24); } catch (_) {}
    }
  });

  ws.on('close', () => {
    if (ptyProcess) {
      try { ptyProcess.kill(); } catch (_) {}
      if (termId) ptyTerminals.delete(termId);
    }
  });
});

// Initialize model manager
modelManager.initialize().then((models) => {
  console.log(`[Server] Found ${models.length} model(s)`);

  // Auto-load default model if none is loaded
  if (!llmEngine.isReady && models.length > 0) {
    const defaultModel = modelManager.getDefaultModel();
    if (defaultModel) {
      console.log(`[Server] Auto-loading default model: ${defaultModel.name}`);
      llmEngine.initialize(defaultModel.path).catch(e => {
        console.error(`[Server] Auto-load failed: ${e.message}`);
      });
    }
  }
}).catch(e => {
  console.error(`[Server] Model scan failed: ${e.message}`);
});

// Forward model manager events to clients
modelManager.on('models-updated', (models) => {
  mainWindow.webContents.send('models-updated', models);
});

// Forward model download events to clients
for (const evt of ['download-started', 'download-progress', 'download-complete', 'download-error', 'download-cancelled']) {
  modelDownloader.on(evt, (data) => {
    mainWindow.webContents.send(evt, data);
  });
}
// Auto-rescan models when a download completes
modelDownloader.on('download-complete', () => {
  modelManager.scanModels().catch(() => {});
});

llmEngine.on('status', (status) => {
  mainWindow.webContents.send('llm-status', status);
});

server.listen(PORT, () => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  guIDE 2.0 Server`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  WebSocket: ws://localhost:${PORT}/ws`);
  console.log(`  Mode: ${isDev ? 'development' : 'production'}`);
  console.log(`  Models dir: ${MODELS_DIR}`);
  console.log(`  User data: ${USER_DATA}`);
  console.log(`${'='.repeat(60)}\n`);
});

// ─── Graceful Shutdown ───────────────────────────────────
process.on('SIGINT', async () => {
  console.log('\n[Server] Shutting down...');
  transport.shutdown();
  memoryStore.dispose();
  sessionStore.flush();
  try { await llmEngine.dispose(); } catch (_) {}
  modelManager.dispose();
  log.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000); // Force exit after 5s
});

process.on('SIGTERM', () => process.emit('SIGINT'));

// ─── Helpers ─────────────────────────────────────────────

async function _readDirRecursive(dirPath, depth = 0, maxDepth = 3) {
  const items = [];
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      // Skip hidden files, node_modules, .git, etc.
      if (entry.name.startsWith('.') && entry.name !== '.env') continue;
      if (['node_modules', '__pycache__', '.git', 'dist', 'build', '.next', 'target'].includes(entry.name)) continue;

      const fullPath = path.join(dirPath, entry.name);
      const item = {
        name: entry.name,
        path: fullPath,
        type: entry.isDirectory() ? 'directory' : 'file',
      };

      if (entry.isFile()) {
        try {
          const stats = fs.statSync(fullPath);
          item.size = stats.size;
          item.modified = stats.mtime.toISOString();
        } catch (_) {}
        item.extension = path.extname(entry.name).slice(1);
      }

      if (entry.isDirectory() && depth < maxDepth) {
        item.children = await _readDirRecursive(fullPath, depth + 1, maxDepth);
      }

      items.push(item);
    }

    // Sort: directories first, then files, both alphabetically
    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  } catch (e) {
    // Permission denied or other errors — skip silently
  }
  return items;
}
