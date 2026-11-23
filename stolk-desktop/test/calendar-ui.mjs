// Calendario interactions in Chromium against test/mock-bridge.js. Run: node test/calendar-ui.mjs [shots-dir]
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
const here = path.dirname(new URL(import.meta.url).pathname);
const out = process.argv[2] || path.join(here, 'shots');
fs.mkdirSync(out, { recursive: true });
const errors = [];
const checks = [];
const check = (cond, msg) => { checks.push(msg); if (!cond) errors.push(`FALLA: ${msg}`); if (process.env.VERBOSE) console.log(cond ? 'ok  ' : 'FALLA', msg); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.addInitScript({ content: 'window.STOLK_TODAY = "2026-11-19"; try { localStorage.clear(); } catch {}' });
await page.addInitScript({ path: path.join(here, 'sample-data.js') });
// A busy Tuesday: more than fits in a month cell, two of them to reorder in the day dialog.
await page.addInitScript({ content: `
  const ev = window.STOLK_SAMPLE.events;
  ev.push({ id: 201, title: 'Café con Ana', date: '2026-11-24', start: '10:00', end: '11:00', place: '', status: 'planeado', guests: [], tagId: 2 });
  ev.push({ id: 202, title: 'Revisión deck', date: '2026-11-24', start: '12:00', end: '13:00', place: '', status: 'planeado', guests: [] });
  for (let i = 0; i < 6; i++) ev.push({ id: 210 + i, title: 'Reunión ' + (i + 1), date: '2026-11-24', start: String(14 + i) + ':00', end: String(14 + i) + ':30', place: '', status: 'planeado', guests: [] });
` });
await page.addInitScript({ path: path.join(here, 'mock-bridge.js') });
await page.clock.setFixedTime(new Date('2026-11-19T18:30:00'));
await page.goto('file://' + path.join(here, '..', 'renderer', 'index.html') + '#calendario');
await page.waitForSelector('.month .wk');

const ev = (id) => page.evaluate((i) => ({ ...window.STOLK_DATA.events.find((e) => e.id === i) }), id);
const center = async (sel) => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, b }; };
async function dragTo(from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 8, from.y + 4, { steps: 2 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}
// The visible part of a day: its column within its week row (a crowded row lays out lanes it doesn't show).
const dayCell = (ds, dy = 0.8) => page.evaluate(([d, f]) => { const c = document.querySelector(`.month .day[data-id="${d}"]`); const b = c.getBoundingClientRect(), w = c.parentElement.getBoundingClientRect(); return { x: b.left + b.width / 2, y: w.top + w.height * f }; }, [ds, dy]);

// Colour category on the bar.
check((await page.getAttribute('.month .item.event[data-ev="102"]', 'style')).includes('--ev:#3B6FD4'), 'el evento con categoría sale con su color');
check(!(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight)), 'el mes no hace scroll de la ventana');

// Busy day: only the first ones show, then "+N más" opens the day.
const more = page.locator('.month .more[data-id="2026-11-24"]');
check((await more.count()) === 1 && /^\+\d+ más$/.test(await more.textContent()), 'un día lleno enseña los primeros y «+N más»');
const overflow = await page.evaluate(() => [...document.querySelectorAll('.month .wk')].some((wk) => [...wk.querySelectorAll('.item:not([hidden])')].some((it) => it.getBoundingClientRect().bottom > wk.getBoundingClientRect().bottom + 1)));
check(!overflow, 'ningún evento visible queda cortado por abajo');
await page.screenshot({ path: `${out}/cal-mes.png` });
await more.click();
await page.waitForSelector('#dayList');
check((await page.locator('#dayList > li').count()) >= 8, '«+N más» abre el día con todo');

// Day dialog: drag the dots of "Revisión deck" above "Café con Ana" -> it takes the slot before it.
await page.screenshot({ path: `${out}/cal-dia-puntitos.png` });
const grip = await center('#dayList [data-grip="202"]');
const first = await center('#dayList li[data-ev="201"]');
await page.mouse.move(grip.x, grip.y);
await page.mouse.down();
await page.mouse.move(grip.x, first.b.y + 4, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(300);
let e202 = await ev(202);
check(e202.start === '09:00' && e202.end === '10:00', `arrastrar los puntitos cambia el orden y la hora (${e202.start}–${e202.end})`);
check((await page.locator('#dayList > li').first().getAttribute('data-ev')) === '202', 'el diálogo se reordena tras moverlo');
// Hours inline: changing the start keeps the length.
await page.fill('#dayList [data-time="201:start"]', '15:15');
await page.dispatchEvent('#dayList [data-time="201:start"]', 'change');
await page.waitForTimeout(300);
const e201 = await ev(201);
check(e201.start === '15:15' && e201.end === '16:15', `cambiar la hora a mano mantiene la duración (${e201.start}–${e201.end})`);
// Keyboard: arrow down on the dots moves it after the next one.
// Editar from the day dialog.
await page.click('#dayList [data-action="edit-event"][data-id="202"]');
await page.waitForSelector('#xTitle');
await page.screenshot({ path: `${out}/cal-editar.png` });
await page.fill('#xTitle', 'Revisión del deck');
await page.fill('#xEndDate', '2026-11-25');
await page.click('.tag-pick label:has-text("Personal")');
await page.click('#modalForm button[type=submit]');
await page.waitForTimeout(300);
e202 = await ev(202);
check(e202.title === 'Revisión del deck' && e202.endDate === '2026-11-25' && e202.tagId === 3, 'Editar guarda nombre, varios días y color');
check(!(await page.locator('#modalForm').count()), 'Guardar cierra el editor');
const bar = await page.locator('.month .item.event[data-ev="202"]').getAttribute('style');
check(/grid-column:2\/4/.test(bar), `un evento de dos días ocupa dos columnas (${bar.match(/grid-column:[^;]+/)})`);

// Month: drag the Demo day (27) to the 28th, then undo.
await dragTo(await center('.month .item.event[data-ev="102"]'), await dayCell('2026-11-28'));
{ const x = await ev(102); check(x.date === '2026-11-28', `arrastrar un evento a otro día lo mueve (${x.date} ${x.endDate})`); }
check((await page.evaluate(() => window.STOLK_CALLS)).includes('PATCH /events/102'), 'mover guarda en el servidor');
check((await page.textContent('#toastRoot')).includes('Deshacer'), 'tras mover se puede deshacer');
await page.click('.undo-btn');
await page.waitForTimeout(300);
check((await ev(102)).date === '2026-11-27', 'Deshacer lo devuelve a su día');

// Month: stretch it to three days from its right edge.
const rz = await page.locator('.month .item.event[data-ev="102"] .rz').boundingBox();
await dragTo({ x: rz.x + rz.width / 2, y: rz.y + rz.height / 2 }, await dayCell('2026-11-29'));
let e102 = await ev(102);
check(e102.date === '2026-11-27' && e102.endDate === '2026-11-29', `estirar el borde lo alarga a varios días (${e102.endDate})`);
// Moving a multi-day event keeps its length.
await dragTo(await center('.month .item.event[data-ev="102"]'), await dayCell('2026-11-29'));
e102 = await ev(102);
check(e102.date === '2026-11-28' && e102.endDate === '2026-11-30', `moverlo mantiene los días que dura (${e102.date} – ${e102.endDate})`);
await page.screenshot({ path: `${out}/cal-mes-varios-dias.png` });

// Drag across empty days creates an event for that range.
await dragTo(await dayCell('2026-11-10'), await dayCell('2026-11-12'));
await page.waitForSelector('#eTitle');
check((await page.inputValue('#eDate')) === '2026-11-10' && (await page.inputValue('#eEndDate')) === '2026-11-12', 'arrastrar por días vacíos crea un evento de esos días');
await page.fill('#eTitle', 'Viaje a Lisboa');
await page.click('.tag-pick label:has-text("Trabajo")');
await page.click('#modalForm button[type=submit]');
await page.waitForTimeout(300);
const made = await page.evaluate(() => window.STOLK_DATA.events.find((e) => e.title === 'Viaje a Lisboa'));
check(made && made.endDate === '2026-11-12' && made.tagId === 1, `el evento nuevo guarda días y color (${JSON.stringify(made)} ${await page.textContent('#toastRoot')})`);
check((await page.evaluate(() => location.hash)) === '#calendario', 'crear desde el calendario no te saca del calendario');

// Right-click: change colour.
await page.click('.month .item.event[data-ev="102"]', { button: 'right' });
await page.waitForSelector('.cal-menu');
await page.screenshot({ path: `${out}/cal-menu-color.png` });
await page.click('.cal-menu [title="Networking"]');
await page.waitForTimeout(300);
check((await ev(102)).tagId === 2, 'clic derecho cambia el color');

// Event detail: "no viene" saves as the server's value; guests can be removed; Editar is there.
await page.click('.month .item.event[data-ev="102"]');
await page.waitForSelector('[data-guest]');
await page.selectOption('[data-guest="9"]', { label: 'no viene' });
await page.waitForTimeout(250);
check((await ev(102)).guests.find((g) => g.cid === 9)?.st === 'no vino', '«no viene» se guarda sin error');
await page.waitForSelector('[data-unguest="2"]');
await page.click('[data-unguest="2"]');
await page.waitForTimeout(300);
check(!(await ev(102)).guests.some((g) => g.cid === 2) && (await page.evaluate(() => window.STOLK_CALLS)).includes('DELETE /events/102/guests/2'), 'se puede quitar un invitado');
check((await page.locator('.modal [data-action="edit-event"]').count()) === 1, 'el evento tiene botón Editar');
await page.screenshot({ path: `${out}/cal-evento.png` });
await page.click('.modal [data-action="close-modal"].btn');

// Colour categories editor.
await page.click('[data-action="cal-tags"]');
await page.waitForSelector('.tag-edit');
await page.fill('#newTag', 'Familia');
await page.click('#addTag');
await page.waitForTimeout(300);
check((await page.evaluate(() => window.STOLK_DATA.calTags.map((t) => t.name))).includes('Familia'), 'se pueden crear colores nuevos');
await page.screenshot({ path: `${out}/cal-colores.png` });
await page.click('.modal [data-action="close-modal"].btn');

// Week view: drag a timed event one hour later, stretch its end, click an empty hour.
await page.click('[data-action="cal-view"][data-id="week"]');
await page.click('[data-action="cal-nav"][data-id="1"]');
await page.waitForSelector('.wk-col[data-col="2026-11-24"] .tev[data-ev="210"]');
check(!(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight)), 'la semana no hace scroll de la ventana');
await page.screenshot({ path: `${out}/cal-semana.png` });
const t210 = await center('.tev[data-ev="210"]');
await dragTo(t210, { x: t210.x, y: t210.y + 44 });
let e210 = await ev(210);
check(e210.start === '15:00' && e210.end === '15:30', `arrastrar en la semana cambia la hora (${e210.start}–${e210.end})`);
const t211 = await center('.tev[data-ev="211"]');
const col24 = await page.locator('.wk-col[data-col="2026-11-24"]').boundingBox();
await dragTo(t211, { x: t211.x + col24.width, y: t211.y });
check((await ev(211)).date === '2026-11-25', 'arrastrar a la columna de al lado cambia el día');
const rzb = await page.locator('.tev[data-ev="212"] .rzb').boundingBox();
const colTop = (await page.locator('.wk-col[data-col="2026-11-24"]').boundingBox()).y;
await dragTo({ x: rzb.x + rzb.width / 2, y: rzb.y + rzb.height / 2 }, { x: rzb.x + rzb.width / 2, y: colTop + 17.5 * 44 });
const e212 = await ev(212);
check(e212.start === '16:00' && e212.end === '17:30', `estirar el borde de abajo alarga la hora de fin (${e212.end})`);
const colB = await page.locator('.wk-col[data-col="2026-11-26"]').boundingBox();
const y9 = colB.y + 9 * 44 + 5;
await page.evaluate(() => { document.querySelector('.wk-scroll').scrollTop = 7 * 44; });
const colB2 = await page.locator('.wk-col[data-col="2026-11-26"]').boundingBox();
await page.mouse.click(colB2.x + 20, colB2.y + 9 * 44 + 5);
await page.waitForSelector('#eTitle');
check((await page.inputValue('#eDate')) === '2026-11-26' && (await page.inputValue('#eStart')) === '09:00' && (await page.inputValue('#eEnd')) === '10:00', 'clic en una hora vacía crea un evento a esa hora');
void y9;
await page.click('.modal [data-action="close-modal"].btn');
await page.screenshot({ path: `${out}/cal-semana-movido.png` });

// Phone width: agenda, no horizontal scroll.
await page.setViewportSize({ width: 440, height: 900 });
await page.waitForTimeout(200);
check(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'en el panel estrecho no hay scroll horizontal');

await browser.close();
console.log(checks.length - errors.filter((e) => e.startsWith('FALLA')).length + '/' + checks.length + ' comprobaciones OK');
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
