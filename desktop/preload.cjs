// The only bridge between the screens and the main process (see src/desktop/bridge.ts for types).
const { contextBridge, ipcRenderer } = require('electron');

const streams = new Map();
ipcRenderer.on('ai:token', (_e, id, token) => streams.get(id)?.(token));
let nextStream = 0;

contextBridge.exposeInMainWorld('stolk', {
  execute: (sql, params) => ipcRenderer.invoke('db:execute', sql, params),

  modelStat: (file) => ipcRenderer.sendSync('models:stat', file),
  download: (file, url) => ipcRenderer.invoke('models:download', file, url),

  completeJson: (file, prompt, schema) => ipcRenderer.invoke('ai:json', file, prompt, schema),
  completeChat: async (file, messages, onToken) => {
    const id = ++nextStream;
    if (onToken) streams.set(id, onToken);
    try {
      return await ipcRenderer.invoke('ai:chat', file, messages, id);
    } finally {
      streams.delete(id);
    }
  },
  embed: (file, text) => ipcRenderer.invoke('ai:embed', file, text),
});
