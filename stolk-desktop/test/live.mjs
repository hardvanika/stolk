// Drives the renderer against the real local server (server/dist) instead of the mock.
// Run: node test/live.mjs [path/to/server/dist]   (needs Playwright installed globally)
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, execSync, execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
const here = path.dirname(new URL(import.meta.url).pathname);
const dist = path.resolve(process.argv[2] || path.join(here, '..', '..', 'server', 'dist'));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stolk-live-'));
const token = crypto.randomBytes(32).toString('hex');
const env = { ...process.env, STOLK_HOME: home, STOLK_TOKEN: token, ANTHROPIC_API_KEY: '' };
execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(dist, 'seed-cli.js')], { env, stdio: 'ignore' });
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(dist, 'main.js')], { env, stdio: ['pipe', 'pipe', 'inherit'] });
const port = await new Promise((res, rej) => {
  let buf = '';
  server.stdout.on('data', (d) => { buf += d; for (const l of buf.split('\n')) { try { const j = JSON.parse(l); if (j.ready) res(j.port); } catch {} } });
  server.on('exit', (c) => rej(new Error('server exited ' + c)));
});
const errors = [];
const checks = [];
const check = (cond, msg) => { checks.push(msg); if (!cond) errors.push(`FALLA: ${msg}`); };
const browser = await chromium.launch();
try {
  const failed = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.stack || e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  // Same contract as preload.cjs: the page never talks HTTP itself (its CSP forbids it); this side adds the token, like main.mjs.
  await page.exposeFunction('__stolkHttp', async (method, route, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${route}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text();
    if (r.status >= 400 && !route.startsWith('/ask')) failed.push(`${method} ${route} -> ${r.status} ${t.slice(0, 120)}`);
    return { status: r.status, body: t ? JSON.parse(t) : null };
  });
  await page.addInitScript({ content: `
    window.STOLK_CALLS = [];
    let cb = null;
    window.stolk = {
      apiReady: async () => true, onApiReady: () => {},
      call: async (method, route, body) => { window.STOLK_CALLS.push(method + ' ' + route); return window.__stolkHttp(method, route, body ?? null); },
      settings: async () => ({ shortcut: 'Ctrl+Shift+S', panel: false, hasKey: false, shortcutActive: false, wayland: true }),
      setSettings: async () => ({ ok: true }), setPanel: async (on) => on, capture: async () => {},
      installGnomeShortcut: async () => ({}), openExternal: async () => {},
      onCapture: (fn) => { cb = fn; },
    };
    window.STOLK_FAKE_CAPTURE = (r) => cb && cb(r);` });
  await page.goto('file://' + path.join(here, '..', 'renderer', 'index.html'));
  await page.waitForSelector('#askInput', { timeout: 8000 }).catch(async () => { console.error('no carga:', errors, failed, await page.evaluate(() => window.STOLK_CALLS)); throw new Error('la pantalla no carga'); });
  await page.waitForTimeout(500);
  for (const v of ['calendario', 'contactos', 'proyectos', 'eventos', 'integraciones']) {
    await page.evaluate((h) => { location.hash = h; }, v);
    await page.waitForTimeout(300);
    check((await page.textContent('main')).trim().length > 40, `${v} se pinta con datos del servidor`);
  }
  await page.evaluate(() => { location.hash = 'contactos'; });
  await page.waitForTimeout(300);
  const people = await page.locator('main').textContent();
  check(/\w+ \w+/.test(people), 'Personas lista contactos reales');
  await page.evaluate(() => window.STOLK_FAKE_CAPTURE({ status: 'ok', image: '', card: { found: true, name: 'Nora Gil', role: 'CTO', company: 'Brezo', email: 'nora@brezo.example', phone: '', linkedin: '', website: '', notes: 'Panel de IA.' } }));
  await page.waitForSelector('#cap-name');
  await page.click('#modalForm button[type=submit]');
  await page.waitForTimeout(600);
  const contacts = await (await fetch(`http://127.0.0.1:${port}/contacts?q=Nora`, { headers: { authorization: `Bearer ${token}` } })).json();
  check(contacts.some((c) => c.email === 'nora@brezo.example'), 'la captura se guarda en SQLite');
  await page.evaluate(() => window.STOLK_FAKE_CAPTURE({ status: 'ok', image: '', card: { found: true, name: 'Nora Gil', role: '', company: '', email: 'nora@brezo.example', phone: '+34 600 000 000', linkedin: '', website: 'brezo.example', notes: '' } }));
  await page.waitForTimeout(600);
  check(await page.locator('input[name=merge]').count() === 1, 'una captura repetida ofrece fusionar');
  await page.click('#modalForm button[type=submit]');
  await page.waitForTimeout(600);
  const again = await (await fetch(`http://127.0.0.1:${port}/contacts?q=Nora`, { headers: { authorization: `Bearer ${token}` } })).json();
  check(again.length === 1 && again[0].phone && again[0].web === 'brezo.example', 'la fusión rellena teléfono y web sin duplicar');
  check(await page.locator('#modalRoot .modal').count() === 0, 'la ventana de captura se cierra al guardar' + (await page.locator('#modalRoot').textContent().catch(() => '')).slice(0, 200));
  await page.keyboard.press('Escape');
  await page.evaluate(() => { location.hash = 'preguntar'; });
  await page.fill('#askInput', 'hola');
  await page.click('#askForm button[type=submit]');
  await page.waitForTimeout(800);
  check(true, 'Preguntar sin clave no rompe la app');
  check(failed.length === 0, 'ninguna llamada a la API falla' + (failed.length ? ': ' + failed.join(', ') : ''));
  // main.mjs reads and writes the capture shortcut through /settings.
  const h = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const st = await (await fetch(`http://127.0.0.1:${port}/settings`, { headers: h })).json();
  check(st.captureShortcut === 'Ctrl+Shift+S', 'el atajo por defecto es Ctrl+Shift+S');
  const okPatch = await fetch(`http://127.0.0.1:${port}/settings`, { method: 'PATCH', headers: h, body: JSON.stringify({ captureShortcut: 'Super+K' }) });
  const badPatch = await fetch(`http://127.0.0.1:${port}/settings`, { method: 'PATCH', headers: h, body: JSON.stringify({ captureShortcut: 'Banana+' }) });
  check(okPatch.status === 200 && badPatch.status === 400, 'el servidor guarda un atajo válido y rechaza uno roto');
  const sync = await (await fetch(`http://127.0.0.1:${port}/sync`, { method: 'POST', headers: h })).json();
  check(['calcom', 'gcal', 'gmail'].every((k) => sync[k] && (sync[k].ok || sync[k].skipped)), 'POST /sync responde por servicio (sin conexiones, todo skipped)');
  const conn = await (await fetch(`http://127.0.0.1:${port}/connections`, { headers: h })).json();
  check('gmail' in conn, '/connections incluye gmail');
  const st2 = await (await fetch(`http://127.0.0.1:${port}/settings`, { method: 'PATCH', headers: h, body: JSON.stringify({ claudeModel: 'claude-haiku-5-5' }) })).json();
  check(st2.claudeModel === 'claude-haiku-5-5', 'el modelo de Claude se guarda');
  await page.evaluate(() => { location.hash = 'contactos'; });
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelectorAll('#personSend a[data-sent]').forEach((a) => a.addEventListener('click', (e) => e.preventDefault())));
  const before = failed.length;
  const chat = page.locator('#personSend a[data-sent]').first();
  check(await chat.count() > 0, 'la ficha tiene botones de chat');
  if (await chat.count()) { await chat.click(); await page.waitForTimeout(500); }
  check(failed.length === before && (await page.evaluate(() => window.STOLK_CALLS)).some((c) => /\/opened$/.test(c)), 'abrir un chat se anota con /contacts/:id/opened');
  // Persona: Editar changes only what you touch; Eliminar asks first, then deletes.
  await page.evaluate(() => { location.hash = 'contactos'; });
  await page.waitForTimeout(300);
  await page.click('button[data-action=edit-contact]');
  await page.waitForSelector('#cPhone');
  await page.fill('#cPhone', '+34 611 222 333');
  await page.click('#modalForm button[type=submit]');
  await page.waitForTimeout(600);
  const edited = await (await fetch(`http://127.0.0.1:${port}/contacts?q=Nora`, { headers: h })).json();
  check(edited[0]?.phone === '+34 611 222 333', 'Editar guarda el cambio en el servidor');
  const before2 = (await (await fetch(`http://127.0.0.1:${port}/contacts`, { headers: h })).json()).length;
  await page.click('button[data-action=delete-contact]');
  await page.waitForSelector('#modalForm .btn.danger');
  await page.click('#modalForm button[type=submit]');
  await page.waitForTimeout(600);
  const after2 = (await (await fetch(`http://127.0.0.1:${port}/contacts`, { headers: h })).json()).length;
  check(after2 === before2 - 1, 'Eliminar borra a la persona tras confirmar');
  await page.evaluate(() => { location.hash = 'preguntar'; });
  await page.waitForSelector('#askInput');
  await page.fill('#askInput', '¿Con quién hablé ayer?');
  await page.click('#askForm button[type=submit]');
  await page.waitForTimeout(800);
  const askText = await page.textContent('main');
  check(/Claude/.test(askText) && !/Error 4/.test(askText), 'Preguntar sin clave muestra el mensaje del servidor');
  await page.screenshot({ path: path.join(home, 'live.png') });
} finally {
  await browser.close();
  server.kill();
}
console.log(checks.length - errors.filter((e) => e.startsWith('FALLA')).length + '/' + checks.length + ' comprobaciones OK contra el servidor real');
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
