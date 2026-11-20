// Stölk desktop shell: window and side panel, tray, the capture shortcut, and the local server process.
// Contacts and everything else live in the local server (server/ in this repo); the shell only talks to it.
import { app, dialog, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, desktopCapturer, screen, shell, nativeImage } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { createStore } from './src/store.mjs';
import { makeClient, parseContact } from './src/claude.mjs';
import { installGnomeShortcut, toGnomeBinding } from './src/shortcut.mjs';
import { installPanelExtension } from './src/gnome-panel.mjs';
import { installDesktopEntry } from './src/desktop-entry.mjs';
import { portalScreenshot } from './src/portal-screenshot.mjs';
import { createLauncherBadge } from './src/launcher-badge.mjs';
import updaterPkg from 'electron-updater';
const { autoUpdater } = updaterPkg;

const here = path.dirname(fileURLToPath(import.meta.url));
const PANEL_WIDTH = 440;
const wantsCapture = (argv) => argv.includes('--capture');

// A second launch hands over to the running Stölk and leaves at once, before anything else starts
// (with app.quit() the rest of startup still ran, so it printed "Checking for update" and vanished).
const isFirstInstance = app.requestSingleInstanceLock();
if (!isFirstInstance) {
  console.log('Stölk ya está abierto: te muestro esa ventana. Para cerrarlo del todo usa «Salir» en el icono de la barra o: pkill -x stolk');
  app.exit(0);
}
// Spanish UI locale, so date pickers read dd/mm/aaaa whatever the system language is.
app.commandLine.appendSwitch('lang', 'es-ES');

// Give the AppImage a .desktop file + icon so GNOME's dock shows the Stölk icon instead of a gear.
function integrateAppImage() {
  if (process.platform !== 'linux' || !process.env.APPIMAGE) return;
  try {
    const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
    if (installDesktopEntry({ execPath: process.env.APPIMAGE, iconPng: path.join(here, 'build', 'icon.png'), dataHome })) {
      spawn('update-desktop-database', [path.join(dataHome, 'applications')], { stdio: 'ignore' }).on('error', () => {});
    }
  } catch (err) { console.error('No se pudo integrar la AppImage:', err.message); }
}

let win = null;
let tray = null;
let server = null;
let normalBounds = null;
let capturing = false;
const settingsStore = createStore(app.getPath('userData'), 'settings.json', { shortcut: 'Ctrl+Shift+S', panel: false });
let settings = settingsStore.read();
const saveSettings = (patch) => { settings = { ...settings, ...patch }; settingsStore.write(settings); };
// Wayland doesn't let apps place their own window or keep it on top. Running under XWayland for that left the
// window unpainted with software rendering (x11_software_bitmap_presenter), so on Wayland the panel is just a narrow window.
const onWaylandSession = process.platform === 'linux' && (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY);
// Logging must never crash Stölk: once the terminal that started it closes, writes to stdout/stderr fail with EIO.
for (const stream of [process.stdout, process.stderr]) stream?.on?.('error', () => {});
process.on('uncaughtException', (err) => {
  if (['EIO', 'EPIPE'].includes(err?.code)) return;
  try { dialog.showErrorBox('Stölk ha tenido un error', String(err?.stack || err)); } catch {}
});
// On Linux the GPU process crashed on start (Wayland + Vulkan, exit 139), which left an instance with no window
// holding the single-instance lock. Stölk draws plain UI, so software rendering is enough; settings.gpu: true opts back in.
if (process.platform === 'linux' && settings.gpu !== true) app.disableHardwareAcceleration();
// The Claude key lives only in ~/.stolk/.env, written by the server's /connections route. The shell reads it for captures.
function envFileValue(name) {
  try {
    const env = fs.readFileSync(path.join(process.env.STOLK_HOME || path.join(os.homedir(), '.stolk'), '.env'), 'utf8');
    const m = env.match(new RegExp(`^${name}=(.*)$`, 'm'));
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  } catch {}
  return '';
}
function apiKey() { return envFileValue('ANTHROPIC_API_KEY') || process.env.ANTHROPIC_API_KEY || ''; }

// Stölk's own Google OAuth client ("Desktop app" type), written into build/google-client.json by the release
// workflow from repository secrets. Google treats a desktop client's secret as public; it only identifies the app,
// and the user still signs in and consents in their browser. A client the user saved in ~/.stolk/.env wins.
function bundledGoogleClient() {
  if (envFileValue('GOOGLE_CLIENT_ID') || process.env.GOOGLE_CLIENT_ID) return null;
  try {
    const c = JSON.parse(fs.readFileSync(path.join(here, 'build', 'google-client.json'), 'utf8'));
    return c.clientId && c.clientSecret ? c : null;
  } catch { return null; }
}

// ---------- Local server ----------
// Started as a child process on 127.0.0.1 with a random port and a per-launch token; the page gets both.
// Contract: /mnt/project-files/plan/stolk-api-interface.md (server prints {"ready":true,"port":N} once listening).
const api = { baseUrl: '', token: crypto.randomBytes(32).toString('hex') };
function startServer() {
  const entry = process.env.STOLK_SERVER || (app.isPackaged ? path.join(process.resourcesPath, 'server', 'main.js') : path.join(here, '..', 'server', 'dist', 'main.js'));
  if (!fs.existsSync(entry)) { console.warn(`Servidor no encontrado en ${entry}; la app arranca sin datos.`); return; }
  const google = bundledGoogleClient();
  server = spawn(process.execPath, [entry], {
    env: {
      ...process.env, ELECTRON_RUN_AS_NODE: '1', STOLK_TOKEN: api.token, STOLK_EXIT_ON_STDIN_CLOSE: '1',
      ...(google ? { GOOGLE_CLIENT_ID: google.clientId, GOOGLE_CLIENT_SECRET: google.clientSecret } : {}),
    },
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
  server.on('exit', (code) => {
    if (code) console.error(`El servidor local terminó con código ${code}`);
    // If it died before it was ready, try again a couple of times instead of leaving the window on "Arrancando…".
    if (!api.baseUrl && !app.isQuitting && (startServer.retries = (startServer.retries || 0) + 1) <= 2) setTimeout(startServer, 1000);
  });
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
  let shown = false;
  const firstShow = () => { if (shown || win.isDestroyed()) return; shown = true; if (settings.panel) setPanel(true); win.show(); };
  win.once('ready-to-show', firstShow);
  // Never stay invisible: if the page never reports ready, show the window anyway.
  setTimeout(firstShow, 4000);
  // A crashed page reloads instead of leaving a blank window.
  win.webContents.on('render-process-gone', (_e, d) => { console.error('La ventana se cerró:', d.reason); if (!win.isDestroyed()) win.webContents.reload(); });
  win.webContents.setWindowOpenHandler(({ url }) => { openSafe(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); openSafe(url); } });
  win.on('close', (e) => { if (!app.isQuitting) { e.preventDefault(); win.hide(); } });
}

function setPanel(on) {
  if (on) {
    if (win.isMaximized()) win.unmaximize();
    if (win.isFullScreen()) win.setFullScreen(false);
    if (!settings.panel || !normalBounds) normalBounds = win.getBounds();
    const { workArea: wa } = screen.getDisplayMatching(win.getBounds());
    // On Wayland the compositor ignores the position and keep-on-top; the window still gets narrow and tall.
    win.setBounds({ x: wa.x + wa.width - PANEL_WIDTH, y: wa.y, width: PANEL_WIDTH, height: wa.height });
    if (!onWaylandSession) win.setAlwaysOnTop(true, 'floating');
  } else {
    win.setAlwaysOnTop(false);
    if (normalBounds) win.setBounds(normalBounds);
  }
  saveSettings({ panel: on });
  buildTray();
  // GNOME: the Stölk panel extension reads settings.json, reserves the strip on the right and places Stölk there.
  panelSync = on && process.platform === 'linux' ? syncPanelExtension() : Promise.resolve(null);
}
let panelExtension = null; // 'active' | 'relogin' | 'unavailable'
let panelSync = Promise.resolve(null);
async function syncPanelExtension() {
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  try { panelExtension = await installPanelExtension({ from: path.join(here, 'gnome-extension'), dataHome }); }
  catch (err) { console.error('Extensión del panel:', err.message); panelExtension = 'unavailable'; }
  win?.webContents.send('panel:extension', panelExtension);
  return panelExtension;
}

function showWindow() {
  if (!win || win.isDestroyed()) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}

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
// On Wayland, GNOME never hands global shortcuts to apps (Electron may report the shortcut as registered,
// but it only fires while Stölk has focus). There the shortcut lives in GNOME's own keyboard settings.
const isWayland = () => process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY;
const shortcutWorks = () => (isWayland() ? !!settings.gnome : globalShortcut.isRegistered(settings.shortcut));
async function syncGnome(accel) {
  try { await installGnomeShortcut({ accel, command: gnomeCommand() }); saveSettings({ gnome: true }); return null; }
  catch (err) { return `No se pudo crear el atajo en GNOME: ${String(err.stderr || err.message || err).trim().split('\n')[0]}`; }
}
async function applyShortcut(accel, { force = false } = {}) {
  if (!force && accel === settings.shortcut && shortcutWorks()) return null;
  saveSettings({ shortcut: accel });
  registerShortcut();
  buildTray();
  return isWayland() || settings.gnome ? syncGnome(accel) : null;
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
// X11 (or a desktop without the screenshot portal): grab the screen, then Stölk's own overlay picks the area.
async function grabScreen(display) {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) },
  });
  const src = sources.find((s) => s.display_id === String(display.id)) || sources[0];
  if (!src || src.thumbnail.isEmpty()) throw new Error('No se pudo capturar la pantalla.');
  return src.thumbnail;
}
async function pickWithOverlay() {
  const wasVisible = win.isVisible();
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  if (wasVisible) { win.hide(); await wait(250); } // keep Stölk itself out of the shot
  const shot = await grabScreen(display);
  const rect = await pickArea(display, shot);
  if (!rect) return null;
  const size = shot.getSize();
  return shot.crop({ x: Math.round(rect.x * size.width), y: Math.round(rect.y * size.height), width: Math.max(1, Math.round(rect.w * size.width)), height: Math.max(1, Math.round(rect.h * size.height)) });
}
// Wayland: GNOME's own screenshot UI picks the area in one step and hands back only that part.
async function pickWithPortal() {
  const png = await portalScreenshot({ interactive: true });
  return png ? nativeImage.createFromBuffer(png) : null;
}
function logError(err) {
  console.error(err.message);
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'stolk.log'), `${new Date().toISOString()} ${err.message}\n`); } catch {}
}

async function startCapture() {
  if (capturing || !win) return;
  capturing = true;
  try {
    let crop;
    if (isWayland()) {
      try { crop = await pickWithPortal(); if (!crop) return; } // null: Ivan pressed Esc
      catch (err) { logError(err); crop = await pickWithOverlay(); }
    } else crop = await pickWithOverlay();
    showWindow();
    if (!crop || crop.isEmpty()) return;
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
ipcMain.handle('settings:get', () => ({ shortcut: settings.shortcut, panel: !!settings.panel, hasKey: !!apiKey(), googleReady: !!(bundledGoogleClient() || envFileValue('GOOGLE_CLIENT_ID') || process.env.GOOGLE_CLIENT_ID), shortcutActive: shortcutWorks(), gnome: !!settings.gnome, wayland: isWayland(), panelExtension }));
ipcMain.handle('settings:set', async (_e, patch) => {
  const accel = typeof patch.shortcut === 'string' ? patch.shortcut.trim() : '';
  if (accel) {
    if (api.baseUrl) {
      const r = await serverCall('PATCH', '/settings', { captureShortcut: accel });
      if (r.status >= 400) return { ok: false, message: r.body?.error?.message || 'Atajo no válido', shortcutActive: shortcutWorks() };
    }
    const error = await applyShortcut(accel, { force: true });
    if (error) return { ok: false, message: error, shortcutActive: shortcutWorks() };
  }
  return { ok: true, shortcutActive: shortcutWorks() };
});
const dockBadge = process.platform === 'linux' ? createLauncherBadge() : null;
ipcMain.handle('badge:set', (_e, n) => { n = Math.max(0, Math.floor(Number(n) || 0)); if (dockBadge) dockBadge.set(n); else app.setBadgeCount(n); return n; });
app.on('will-quit', () => dockBadge?.stop());
ipcMain.handle('window:panel', (_e, on) => { setPanel(!!on); return panelSync; });
ipcMain.handle('capture:start', () => startCapture());
ipcMain.handle('shortcut:gnome', async () => {
  const error = await syncGnome(settings.shortcut); // later shortcut changes update this GNOME binding too
  if (error) throw new Error(error);
  return { binding: toGnomeBinding(settings.shortcut) };
});
ipcMain.handle('open:external', (_e, url) => openSafe(url));

// ---------- Updates ----------
// Only the AppImage can replace itself. The .deb shows nothing here; it updates by installing the new .deb.
const canAutoUpdate = () => app.isPackaged && !!process.env.APPIMAGE;
let updateReady = null;
function startUpdates() {
  if (!canAutoUpdate()) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // if Ivan never presses Reiniciar, it installs on the next quit
  autoUpdater.on('update-downloaded', (info) => { updateReady = info.version; win?.webContents.send('update:ready', info.version); });
  autoUpdater.on('error', (err) => console.warn('Actualización:', err?.message || err));
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 4 * 60 * 60 * 1000);
}
ipcMain.handle('update:status', () => ({ version: app.getVersion(), auto: canAutoUpdate(), ready: updateReady }));
ipcMain.handle('update:install', () => { if (updateReady) { app.isQuitting = true; autoUpdater.quitAndInstall(); } });

// ---------- Lifecycle ----------
app.on('second-instance', (_e, argv) => { if (wantsCapture(argv)) startCapture(); else showWindow(); });
app.on('child-process-gone', (_e, d) => { if (d.type === 'GPU') console.error('Proceso GPU caído:', d.reason, d.exitCode); });
if (isFirstInstance) app.whenReady().then(() => {
  integrateAppImage();
  startServer();
  createWindow();
  buildTray();
  registerShortcut();
  startUpdates();
  if (wantsCapture(process.argv)) win.once('ready-to-show', () => startCapture());
});
app.on('will-quit', () => { globalShortcut.unregisterAll(); server?.kill(); });
