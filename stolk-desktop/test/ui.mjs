// Drives the renderer in Chromium against test/mock-bridge.js. Run: node test/ui.mjs (needs Playwright installed globally).
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
const here = path.dirname(new URL(import.meta.url).pathname);
const out = process.argv[2] || path.join(here, 'shots');
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const errors = [];
const checks = [];
const check = (cond, msg) => { checks.push(msg); if (!cond) errors.push(`FALLA: ${msg}`); };
for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['panel', { width: 440, height: 900 }]]) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label}: ${m.text()}`); });
  await page.addInitScript({ content: 'window.STOLK_TODAY = "2026-11-19";' });
  await page.addInitScript({ path: path.join(here, 'sample-data.js') });
  await page.addInitScript({ path: path.join(here, 'mock-bridge.js') });
  await page.clock.setFixedTime(new Date('2026-11-19T18:30:00'));
  await page.goto('file://' + path.join(here, '..', 'renderer', 'index.html'));
  await page.waitForSelector('#askInput');
  await page.fill('#askInput', '¿A quién conocí en Tech & Tapas #3?');
  await page.click('#askForm button[type=submit]');
  await page.waitForSelector('.answer');
  check((await page.textContent('.answer')).includes('Lucía'), `${label}: Preguntar muestra la respuesta del servidor`);
  await page.fill('#askInput', 'escribe a Jorge para el deck');
  await page.click('#askForm button[type=submit]');
  await page.waitForSelector('#askDraftText');
  check((await page.inputValue('#askDraftText')).includes('deck'), `${label}: Preguntar deja el borrador editable`);
  await page.screenshot({ path: `${out}/${label}-preguntar.png` });
  for (const v of ['hoy', 'calendario', 'contactos', 'proyectos', 'eventos', 'integraciones']) {
    await page.evaluate((h) => { location.hash = h; }, v);
    await page.waitForTimeout(200);
    check(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), `${label}: ${v} sin scroll horizontal`);
    await page.screenshot({ path: `${out}/${label}-${v}.png` });
  }
  await page.evaluate(() => { location.hash = 'hoy'; });
  await page.waitForTimeout(150);
  check((await page.locator('.today-row').count()) === 3, `${label}: Hoy enseña las 3 reuniones de hoy`);
  // Capture flow: reading -> card -> save as new contact.
  await page.evaluate(() => window.STOLK_FAKE_CAPTURE({ status: 'reading', image: '' }));
  await page.waitForSelector('text=Leyendo tu captura');
  await page.evaluate(() => window.STOLK_FAKE_CAPTURE({ status: 'ok', image: '', card: { found: true, name: 'Nora Gil', role: 'CTO', company: 'Brezo', email: 'nora@brezo.example', phone: '', linkedin: 'linkedin.com/in/noragil', website: '', notes: 'Habló en el panel de IA.' } }));
  await page.waitForSelector('#cap-name');
  await page.screenshot({ path: `${out}/${label}-captura.png` });
  await page.click('#modalForm button[type=submit]');
  await page.waitForTimeout(250);
  const calls = await page.evaluate(() => window.STOLK_CALLS);
  check(calls.includes('POST /contacts') && calls.includes('POST /interactions'), `${label}: Guardar captura crea la persona y su historial`);
  check((await page.textContent('main')).includes('Nora Gil'), `${label}: la persona capturada aparece en Personas`);
  // Capture of someone already saved -> merge (PATCH).
  await page.evaluate(() => window.STOLK_FAKE_CAPTURE({ status: 'ok', image: '', card: { found: true, name: 'Jorge Sanz', role: '', company: '', email: '', phone: '', linkedin: '', website: 'ribera.example', notes: '' } }));
  await page.waitForSelector('input[name=merge]');
  await page.click('#modalForm button[type=submit]');
  await page.waitForTimeout(250);
  check((await page.evaluate(() => window.STOLK_CALLS)).some((c) => c.startsWith('PATCH /contacts/2')), `${label}: una captura repetida se fusiona con la ficha existente`);
  // Sync at startup, chat buttons log through /contacts/:id/opened, model picker in Ajustes.
  const all = await page.evaluate(() => window.STOLK_CALLS);
  check(all.includes('POST /sync'), `${label}: sincroniza al arrancar`);
  await page.evaluate(() => { location.hash = 'integraciones'; });
  await page.waitForSelector('#claudeModel');
  await page.selectOption('#claudeModel', 'claude-haiku-5-5');
  await page.waitForTimeout(200);
  check((await page.evaluate(() => window.STOLK_CALLS)).includes('PATCH /settings'), `${label}: el modelo de Claude se cambia en Ajustes`);
  await page.click('button[data-action=sync]');
  await page.waitForTimeout(250);
  check((await page.evaluate(() => window.STOLK_CALLS)).filter((c) => c === 'POST /sync').length >= 2, `${label}: el botón Sincronizar llama al servidor`);
  await page.evaluate(() => { location.hash = 'contactos'; });
  await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector('#personSend a[data-sent]')?.addEventListener('click', (e) => e.preventDefault(), { once: true }));
  const chat = page.locator('#personSend a[data-sent]').first();
  if (await chat.count()) {
    await chat.click();
    await page.waitForTimeout(250);
    check((await page.evaluate(() => window.STOLK_CALLS)).some((c) => /^POST \/contacts\/\d+\/opened$/.test(c)), `${label}: abrir un chat queda en el historial`);
  } else check(false, `${label}: hay botones de chat en la ficha`);
  await page.evaluate(() => window.STOLK_FAKE_UPDATE('0.1.2'));
  await page.waitForSelector('#updateBar');
  check((await page.textContent('#updateBar')).includes('Nueva versión disponible'), `${label}: avisa de una versión nueva`);
  await page.click('#updateBar .btn.primary');
  check((await page.evaluate(() => window.STOLK_CALLS)).includes('update:install'), `${label}: Reiniciar instala la actualización`);
  await page.close();
}
await browser.close();
console.log(checks.length - errors.filter((e) => e.startsWith('FALLA')).length + '/' + checks.length + ' comprobaciones OK');
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
