// Stölk desktop shell: window and side panel, tray, the capture shortcut, and the local server process.
// Contacts and everything else live in the local server (server/ in this repo); the shell only talks to it.
import { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, desktopCapturer, screen, shell, nativeImage } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { createStore } from './src/store.mjs';
import { makeClient, parseContact } from './src/claude.mjs';
import { installGnomeShortcut } from './src/shortcut.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PANEL_WIDTH = 440;
const wantsCapture = (argv) => argv.includes('--capture');

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let tray = null;
let server = null;
let normalBounds = null;
let capturing = false;
const settingsStore = createStore(app.getPath('userData'), 'settings.json', { shortcut: 'Ctrl+Shift+S', panel: false });
let settings = settingsStore.read();
const saveSettings = (patch) => { settings = { ...settings, ...patch }; settingsStore.write(settings); };
// The Claude key lives only in ~/.stolk/.env, written by the server's /connections route. The shell reads it for captures.
function apiKey() {
  try {
    const env = fs.readFileSync(path.join(os.homedir(), '.stolk', '.env'), 'utf8');
    const m = env.match(/^ANTHROPIC_API_KEY=(.*)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  } catch {}
  return process.env.ANTHROPIC_API_KEY || '';
}

// ---------- Local server ----------
// Started as a child process on 127.0.0.1 with a random port and a per-launch token; the page gets both.
// Contract: /mnt/project-files/plan/stolk-api-interface.md (server prints {"ready":true,"port":N} once listening).
const api = { baseUrl: '', token: crypto.randomBytes(32).toString('hex') };
function startServer() {
  const entry = process.env.STOLK_SERVER || (app.isPackaged ? path.join(process.resourcesPath, 'server', 'main.js') : path.join(here, '..', 'server', 'dist', 'main.js'));
  if (!fs.existsSync(entry)) { console.warn(`Servidor no encontrado en ${entry}; la app arranca sin datos.`); return; }
  server = spawn(process.execPath, [entry], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', STOLK_TOKEN: api.token, STOLK_EXIT_ON_STDIN_CLOSE: '1' },
    stdio: ['pipe', 'pipe', 'inherit'], // the server exits when this process (and so its stdin) goes away
  });
  let out = '';
  server.stdout.on('data', (buf) => {
    out += String(buf);
    for (const line of out.split('\n').slice(0, -1)) {
      try {
        const msg = JSON.parse(line);
        if (msg.ready && !api.baseUrl) { api.baseUrl = `http://127.0.0.1:${msg.port}`; win?.webContents.send('api:ready'); loadServerShortcut(); }
      } catch { /* other server output */ }
    }
    out = out.slice(out.lastIndexOf('\n') + 1);
  });
  server.on('exit', (code) => { if (code) console.error(`El servidor local terminó con código ${code}`); });
}

// ---------- Window and side panel ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 380, minHeight: 520,
    title: 'Stölk', backgroundColor: '#F7F7F7', show: false,
    icon: path.join(here, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(here, 'preload.cjs'), sandbox: true, contextIsolation: true },
  });
  win.loadFile(path.join(here, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (settings.panel) setPanel(true); win.show(); });
  win.webContents.setWindowOpenHandler(({ url }) => { openSafe(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); openSafe(url); } });
  win.on('close', (e) => { if (!app.isQuitting) { e.preventDefault(); win.hide(); } });
}

function setPanel(on) {
  if (on) {
    if (!settings.panel || !normalBounds) normalBounds = win.getBounds();
    const { workArea: wa } = screen.getDisplayMatching(win.getBounds());
    win.setBounds({ x: wa.x + wa.width - PANEL_WIDTH, y: wa.y, width: PANEL_WIDTH, height: wa.height });
    win.setAlwaysOnTop(true, 'floating');
  } else {
    win.setAlwaysOnTop(false);
    if (normalBounds) win.setBounds(normalBounds);
  }
  saveSettings({ panel: on });
  buildTray();
}

function showWindow() { if (!win) return; win.show(); win.focus(); }

function openSafe(url) {
  if (/^(https?:|mailto:)/i.test(url)) shell.openExternal(url);
}

// ---------- Tray ----------
function buildTray() {
  if (!tray) { tray = new Tray(nativeImage.createFromPath(path.join(here, 'build', 'tray.png'))); tray.setToolTip('Stölk'); tray.on('click', showWindow); }
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir Stölk', click: showWindow },
    { label: 'Panel lateral', type: 'checkbox', checked: !!settings.panel, click: (i) => setPanel(i.checked) },
    { label: `Guardar persona desde pantalla (${settings.shortcut})`, click: () => startCapture() },
    { type: 'separator' },
    { label: 'Salir', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
}

// The capture shortcut lives in the server's /settings (captureShortcut); settings.json keeps a copy so the
// shortcut works before the server is up.
async function serverCall(method, route, body) {
  const res = await fetch(api.baseUrl + route, {
    method,
    headers: { Authorization: `Bearer ${api.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
async function applyShortcut(accel) {
  if (accel === settings.shortcut && globalShortcut.isRegistered(accel)) return;
  saveSettings({ shortcut: accel });
  registerShortcut();
  buildTray();
  if (settings.gnome) await installGnomeShortcut({ accel, command: gnomeCommand() }).catch(() => {});
}
async function loadServerShortcut() {
  try {
    const r = await serverCall('GET', '/settings');
    if (r.status === 200 && r.body?.captureShortcut) await applyShortcut(r.body.captureShortcut);
  } catch { /* keep the local copy */ }
}
const gnomeCommand = () => `"${process.env.APPIMAGE || process.execPath}" --capture`;

// ---------- Capture ----------
function registerShortcut() {
  globalShortcut.unregisterAll();
  try { return globalShortcut.register(settings.shortcut, () => startCapture()); }
  catch { return false; }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function startCapture() {
  if (capturing || !win) return;
  capturing = true;
  const wasVisible = win.isVisible();
  try {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    if (wasVisible) { win.hide(); await wait(250); } // keep Stölk itself out of the shot
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) },
    });
    const src = sources.find((s) => s.display_id === String(display.id)) || sources[0];
    if (!src || src.thumbnail.isEmpty()) throw new Error('No se pudo capturar la pantalla. En Wayland, acepta el permiso de captura de GNOME.');
    const rect = await pickArea(display, src.thumbnail);
    showWindow();
    if (!rect) return;
    const size = src.thumbnail.getSize();
    let crop = src.thumbnail.crop({ x: Math.round(rect.x * size.width), y: Math.round(rect.y * size.height), width: Math.max(1, Math.round(rect.w * size.width)), height: Math.max(1, Math.round(rect.h * size.height)) });
    if (crop.getSize().width > 1600) crop = crop.resize({ width: 1600 });
    const image = crop.toDataURL();
    win.webContents.send('capture:result', { status: 'reading', image });
    try {
      const card = await parseContact(makeClient(apiKey()), crop.toPNG().toString('base64'));
      win.webContents.send('capture:result', { status: 'ok', card, image });
    } catch (err) {
      win.webContents.send('capture:result', { status: 'error', message: err.message, image });
    }
  } catch (err) {
    showWindow();
    win.webContents.send('capture:result', { status: 'error', message: err.message });
  } finally {
    capturing = false;
  }
}

// Full-screen overlay showing the frozen screenshot; Ivan drags a box around the person. Resolves to fractions (0..1) or null.
function pickArea(display, image) {
  return new Promise((resolve) => {
    const overlay = new BrowserWindow({
      ...display.bounds, frame: false, fullscreen: true, alwaysOnTop: true, skipTaskbar: true, show: false,
      webPreferences: { preload: path.join(here, 'preload.cjs'), sandbox: true, contextIsolation: true },
    });
    let done = false;
    const finish = (rect) => { if (done) return; done = true; ipcMain.removeListener('capture:crop', onCrop); if (!overlay.isDestroyed()) overlay.close(); resolve(rect); };
    const onCrop = (e, rect) => { if (e.sender === overlay.webContents) finish(rect && rect.w > 0.005 && rect.h > 0.005 ? rect : null); };
    ipcMain.on('capture:crop', onCrop);
    overlay.on('closed', () => finish(null));
    overlay.loadFile(path.join(here, 'renderer', 'capture.html'));
    overlay.webContents.once('did-finish-load', () => { overlay.webContents.send('capture:shot', image.toDataURL()); overlay.show(); overlay.focus(); });
  });
}

// ---------- IPC ----------
// Every API call goes through here, so the token never reaches the page and the server can keep CORS off.
ipcMain.handle('api:ready', () => !!api.baseUrl);
ipcMain.handle('api:call', async (_e, method, route, body) => {
  if (!api.baseUrl) return { status: 503, body: { error: { code: 'not_ready', message: 'El servidor local aún no está listo' } } };
  if (!/^\/[\w\-/?=&%.:,+@]*$/.test(route) || !['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) return { status: 400, body: { error: { code: 'bad_call', message: 'Llamada no válida' } } };
  return serverCall(method, route, body);
});
ipcMain.handle('settings:get', () => ({ shortcut: settings.shortcut, panel: !!settings.panel, hasKey: !!apiKey(), shortcutActive: globalShortcut.isRegistered(settings.shortcut), wayland: process.env.XDG_SESSION_TYPE === 'wayland' }));
ipcMain.handle('settings:set', async (_e, patch) => {
  const accel = typeof patch.shortcut === 'string' ? patch.shortcut.trim() : '';
  if (accel) {
    if (api.baseUrl) {
      const r = await serverCall('PATCH', '/settings', { captureShortcut: accel });
      if (r.status >= 400) return { ok: false, message: r.body?.error?.message || 'Atajo no válido', shortcutActive: globalShortcut.isRegistered(settings.shortcut) };
    }
    await applyShortcut(accel);
  }
  return { ok: true, shortcutActive: globalShortcut.isRegistered(settings.shortcut) };
});
ipcMain.handle('window:panel', (_e, on) => { setPanel(!!on); return !!on; });
ipcMain.handle('capture:start', () => startCapture());
ipcMain.handle('shortcut:gnome', async () => {
  const binding = await installGnomeShortcut({ accel: settings.shortcut, command: gnomeCommand() });
  saveSettings({ gnome: true }); // later shortcut changes update this GNOME binding too
  return { binding };
});
ipcMain.handle('open:external', (_e, url) => openSafe(url));

// ---------- Lifecycle ----------
app.on('second-instance', (_e, argv) => { if (wantsCapture(argv)) startCapture(); else showWindow(); });
app.whenReady().then(() => {
  startServer();
  createWindow();
  buildTray();
  registerShortcut();
  if (wantsCapture(process.argv)) win.once('ready-to-show', () => startCapture());
});
app.on('will-quit', () => { globalShortcut.unregisterAll(); server?.kill(); });
