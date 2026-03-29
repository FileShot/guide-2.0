// Quick diagnostic — which module fails to load?
'use strict';
const path = require('path');
const ROOT = __dirname;

// Install electron shim first (same as server/main.js)
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === 'electron') return path.join(__dirname, 'server', '_electronShim.js');
  return origResolve.call(this, request, parent, isMain, options);
};
global.__guideIpcMain = { handle: () => {} };
global.__guideMainWindow = { webContents: { send: () => {} } };
global.__guideApp = { getPath: (k) => k === 'userData' ? path.join(process.env.APPDATA || '', 'guide-ide') : __dirname };

const modules = [
  ['logger', () => require(path.join(ROOT, 'logger'))],
  ['llmEngine', () => require(path.join(ROOT, 'llmEngine'))],
  ['mcpToolServer', () => require(path.join(ROOT, 'mcpToolServer'))],
  ['modelManager', () => require(path.join(ROOT, 'modelManager'))],
  ['memoryStore', () => require(path.join(ROOT, 'memoryStore'))],
  ['longTermMemory', () => require(path.join(ROOT, 'longTermMemory'))],
  ['sessionStore', () => require(path.join(ROOT, 'sessionStore'))],
  ['constants', () => require(path.join(ROOT, 'constants'))],
  ['conversationSummarizer', () => require(path.join(ROOT, 'pipeline', 'conversationSummarizer'))],
  ['cloudLLMService', () => require(path.join(ROOT, 'cloudLLMService'))],
  ['modelDownloader', () => require(path.join(ROOT, 'server', 'modelDownloader'))],
  ['agenticChat', () => require(path.join(ROOT, 'agenticChat'))],
];

for (const [name, loader] of modules) {
  try {
    loader();
    console.log(`OK: ${name}`);
  } catch (e) {
    console.error(`FAIL: ${name} — ${e.message}`);
    console.error(e.stack.split('\n').slice(0, 5).join('\n'));
    break;
  }
}
console.log('DONE');
