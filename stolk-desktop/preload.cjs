// The only bridge between the page and the system. The page never sees the API key.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('stolk', {
  apiReady: () => ipcRenderer.invoke('api:ready'),
  onApiReady: (fn) => ipcRenderer.on('api:ready', () => fn()),
  call: (method, route, body) => ipcRenderer.invoke('api:call', method, route, body),
  settings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  capture: () => ipcRenderer.invoke('capture:start'),
  setPanel: (on) => ipcRenderer.invoke('window:panel', on),
  installGnomeShortcut: () => ipcRenderer.invoke('shortcut:gnome'),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  updateStatus: () => ipcRenderer.invoke('update:status'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateReady: (fn) => ipcRenderer.on('update:ready', (_e, v) => fn(v)),
  onCapture: (fn) => ipcRenderer.on('capture:result', (_e, r) => fn(r)),
  // Capture overlay only.
  cropDone: (rect) => ipcRenderer.send('capture:crop', rect),
  onShot: (fn) => ipcRenderer.on('capture:shot', (_e, url) => fn(url)),
});
