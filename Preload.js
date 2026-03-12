/**
 * preload.js — Electron context bridge
 *
 * Exposes only the minimal IPC surface the renderer needs.
 * nodeIntegration is OFF and contextIsolation is ON in both windows,
 * so renderer.js and Setup.html cannot access Node.js APIs directly.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveConfig:   (config) => ipcRenderer.send('save-config', config),
  onConfigSaved:(cb)     => ipcRenderer.on('config-saved', (_event, success) => cb(success)),
  cancelSetup:  ()       => ipcRenderer.send('cancel-setup'),
  restartApp:   ()       => ipcRenderer.send('restart-app'),
  resetConfig:  ()       => ipcRenderer.send('reset-config'),
});