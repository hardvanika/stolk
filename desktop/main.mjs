// Electron main process: owns the SQLite file and the local models, and serves the
// web build of the same expo-router screens the phone uses.
import { app, BrowserWindow, ipcMain, net, protocol, shell } from 'electron';
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, isAbsolute } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openSqlite } from './sqlite.mjs';
import { completeChat, completeJson, embedText } from './llm.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(here, '..', 'dist'); // output of `expo export -p web`
const DEV_URL = process.env.STOLK_DEV_URL; // e.g. http://localhost:8081 while `expo start --web` runs

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

// ---- data -----------------------------------------------------------------------------

let db = null;
const getDb = () => (db ??= openSqlite(join(app.getPath('userData'), 'stolk.db')));

const modelDir = () => join(app.getPath('userData'), 'models');

/** Only bare .gguf file names from src/ai/catalog.ts are accepted. */
function modelPath(file) {
  if (typeof file !== 'string' || !/^[\w.-]+\.gguf$/.test(file)) throw new Error(`Bad model file: ${file}`);
  return join(modelDir(), file);
}

async function download(file, url) {
  const target = modelPath(file);
  if (existsSync(target)) return;
  if (!/^https:\/\//.test(url)) throw new Error('Models are only downloaded over https');
  mkdirSync(modelDir(), { recursive: true });
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const part = target + '.part';
  try {
    await pipeline(Readable.fromWeb(res.body), createWriteStream(part));
    if (total && statSync(part).size !== total) throw new Error('Download incomplete');
    renameSync(part, target);
  } catch (e) {
    rmSync(part, { force: true });
    throw e;
  }
}

function registerIpc() {
  ipcMain.handle('db:execute', (_e, sql, params) => getDb().execute(sql, params));

  // Synchronous on purpose: the screens call isDownloaded()/chatReady() during render.
  ipcMain.on('models:stat', (e, file) => {
    const path = modelPath(file);
    e.returnValue = { path, exists: existsSync(path) };
  });
  ipcMain.handle('models:download', (_e, file, url) => download(file, url));

  ipcMain.handle('ai:json', (_e, file, prompt, schema) => completeJson(modelPath(file), prompt, schema));
  ipcMain.handle('ai:chat', (e, file, messages, streamId) =>
    completeChat(modelPath(file), messages, (t) => !e.sender.isDestroyed() && e.sender.send('ai:token', streamId, t)),
  );
  ipcMain.handle('ai:embed', (_e, file, text) => embedText(modelPath(file), text));
}

// ---- window ---------------------------------------------------------------------------

function serveWebBuild() {
  protocol.handle('app', (req) => {
    const rel = normalize(decodeURIComponent(new URL(req.url).pathname)).replace(/^[/\\]+/, '');
    let file = join(WEB_ROOT, rel);
    const outside = relative(WEB_ROOT, file).startsWith('..') || isAbsolute(relative(WEB_ROOT, file));
    // Client-side routes (/ask, /capture, …) all load the single-page index.html.
    if (outside || !existsSync(file) || statSync(file).isDirectory()) file = join(WEB_ROOT, 'index.html');
    return net.fetch(pathToFileURL(file).toString());
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 560,
    height: 900,
    minWidth: 380,
    minHeight: 560,
    title: 'Stölk',
    backgroundColor: '#EEF2F6', // mist
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  const origin = DEV_URL ?? 'app://stolk';
  // LinkedIn links open in the real browser; the app itself never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(origin)) {
      e.preventDefault();
      if (/^https:\/\//.test(url)) shell.openExternal(url);
    }
  });
  win.loadURL(DEV_URL ?? 'app://stolk/');
}

app.whenReady().then(() => {
  registerIpc();
  if (!DEV_URL) {
    if (!existsSync(join(WEB_ROOT, 'index.html'))) {
      console.error('No web build found. Run `npm run desktop` (or `npx expo export -p web`) first.');
      app.exit(1);
      return;
    }
    serveWebBuild();
  }
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => {
  db?.close();
  if (process.platform !== 'darwin') app.quit();
});
