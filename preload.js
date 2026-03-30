'use strict';

/**
 * guIDE 2.0 — Electron Preload Script
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  },
  windowControls: {
    minimize:    () => ipcRenderer.invoke('win-minimize'),
    maximize:    () => ipcRenderer.invoke('win-maximize'),
    close:       () => ipcRenderer.invoke('win-close'),
    isMaximized: () => ipcRenderer.invoke('win-is-maximized'),
  },
  openFolderDialog: () => ipcRenderer.invoke('dialog-open-folder'),
  showItemInFolder: (fullPath) => ipcRenderer.invoke('shell-show-item', fullPath),
  onMenuAction: (callback) => {
    ipcRenderer.on('menu-action', (_event, action) => callback(action));
  },
  updater: {
    check:     () => ipcRenderer.invoke('updater-check'),
    download:  () => ipcRenderer.invoke('updater-download'),
    install:   () => ipcRenderer.invoke('updater-install'),
    getStatus: () => ipcRenderer.invoke('updater-status'),
    onStatus:  (callback) => {
      ipcRenderer.on('update-status', (_event, data) => callback(data));
    },
  },
});
