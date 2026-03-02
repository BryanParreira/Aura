const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  captureScreen: () => ipcRenderer.invoke('get-screen-capture'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  setIgnoreMouse: (ignore) => ipcRenderer.invoke('set-ignore-mouse', ignore),
  setUndetectable: (state) => ipcRenderer.invoke('set-undetectable', state),
  
  toggleAlwaysOnTop: (flag) => ipcRenderer.invoke('toggle-always-on-top', flag),
  runCommand: (cmd) => ipcRenderer.invoke('run-command', cmd), // NEW: Execute command

  proxyRequest: (options) => ipcRenderer.invoke('proxy-request', options),
  streamRequest: (options) => ipcRenderer.send('stream-request', options),
  onStreamResponse: (callback) => ipcRenderer.on('stream-response', (_event, value) => callback(value)),
  removeStreamListener: () => ipcRenderer.removeAllListeners('stream-response'),

  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),
  onAppWokeUp: (callback) => ipcRenderer.on('app-woke-up', () => callback()),
  onUpdateMsg: (callback) => ipcRenderer.on('update-msg', (_event, value) => callback(value))
});