import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { openDb, type DB } from '../src/db.js';
import { EnvFile } from '../src/env.js';
import { buildRouter } from '../src/app.js';
import { createApiServer } from '../src/http.js';
import { seedDemo } from '../src/seed.js';

const TOKEN = 'test-token';
let server: Server;
let base: string;
let db: DB;
let dir: string;

before(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.CALCOM_API_KEY;
  dir = mkdtempSync(join(tmpdir(), 'stolk-'));
  db = openDb(join(dir, 'stolk.db'));
  seedDemo(db);
  const env = new EnvFile(join(dir, '.env'));
  // Pin "today" to the prototype's date.
  server = createApiServer(buildRouter({ db, env, now: () => new Date(2026, 10, 19, 18, 30) }), TOKEN);
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
after(() => { server.close(); db.close(); });

async function api(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined, headers: res.headers };
}

test('health is public, everything else needs the token', async () => {
  assert.equal((await fetch(base + '/health')).status, 200);
  assert.equal((await fetch(base + '/contacts')).status, 401);
  assert.equal((await api('GET', '/contacts', undefined, { Authorization: 'Bearer nope' })).status, 401);
});

test('origin: null is allowed with CORS, other origins are refused', async () => {
  const ok = await api('GET', '/contacts', undefined, { Origin: 'null' });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'null');
  const pre = await fetch(base + '/contacts', { method: 'OPTIONS', headers: { Origin: 'null' } });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-headers') ?? '', /Authorization/);
  assert.equal((await api('GET', '/contacts', undefined, { Origin: 'https://evil.example' })).status, 403);
});

test('contacts: list with lastContact, search folds accents, filters', async () => {
  const all = await api('GET', '/contacts');
  assert.equal(all.body.length, 9);
  assert.equal(all.body[0].name, 'David Lin'); // most recent interaction first (18 nov)
  const lucia = all.body.find((c: any) => c.id === 1);
  assert.equal(lucia.lastContact, '2026-10-21');
  assert.deepEqual(lucia.tags, ['startup', 'energía']);

  assert.deepEqual((await api('GET', '/contacts?q=lucia')).body.map((c: any) => c.id), [1]);
  assert.deepEqual((await api('GET', '/contacts?tag=IA')).body.map((c: any) => c.id).sort(), [3, 6]);
  assert.deepEqual((await api('GET', '/contacts?filter=seguimiento')).body.map((c: any) => c.id).sort(), [1, 4]);
  // Sofía (11 jun) and Elena (30 jul) are 60+ days without contact.
  assert.deepEqual((await api('GET', '/contacts?filter=sin-contacto')).body.map((c: any) => c.id).sort(), [7, 9]);
});

test('contacts: detail bundles history, upcoming bookings, events, projects and relations', async () => {
  const { body } = await api('GET', '/contacts/1');
  assert.equal(body.interactions.length, 2);
  assert.equal(body.interactions[0].date, '2026-10-21');
  assert.equal(body.interactions[0].follow, '2026-11-21');
  assert.deepEqual(body.bookings.map((b: any) => b.date), ['2026-11-24']);
  assert.deepEqual(body.events.map((e: any) => [e.id, e.st]), [[101, 'invitado'], [103, 'asistió']]);
  assert.deepEqual(body.projects.map((p: any) => p.id).sort(), [301, 302]);
  assert.equal(body.relations.length, 1);
});

test('contacts: create, patch, validation and delete', async () => {
  const c = await api('POST', '/contacts', { name: 'Nuevo Contacto', email: ' Nuevo@Example.com ', tags: ['a', 'a', ' b '] });
  assert.equal(c.status, 201);
  assert.deepEqual(c.body.tags, ['a', 'b']);
  assert.equal(c.body.web, '');
  const p = await api('PATCH', `/contacts/${c.body.id}`, { company: 'ACME', web: 'https://acme.example' });
  assert.equal(p.body.web, 'https://acme.example');
  assert.equal(p.body.company, 'ACME');
  assert.equal(p.body.name, 'Nuevo Contacto');
  assert.equal((await api('POST', '/contacts', { email: 'x@y' })).status, 400);
  assert.equal((await api('POST', '/contacts', { name: 'X', nmae: 'typo' })).status, 400);
  assert.equal((await api('DELETE', `/contacts/${c.body.id}`)).status, 204);
  assert.equal((await api('GET', `/contacts/${c.body.id}`)).status, 404);
});

test('contacts/match: dedupe by email, phone and fuzzy name', async () => {
  const byEmail = await api('GET', '/contacts/match?email=JORGE@ribera.example');
  assert.equal(byEmail.body[0].contact.id, 2);
  assert.equal(byEmail.body[0].matchedOn, 'email');
  const byPhone = await api('GET', '/contacts/match?phone=600112203');
  assert.equal(byPhone.body[0].contact.id, 3);
  const byName = await api('GET', '/contacts/match?name=sofia herrera');
  assert.equal(byName.body[0].contact.id, 7);
  assert.equal(byName.body[0].score, 0.9);
  assert.equal((await api('GET', '/contacts/match?name=zzz')).body.length, 0);
  assert.equal((await api('GET', '/contacts/match')).status, 400);
});

test('interactions: create and filter', async () => {
  const i = await api('POST', '/interactions', { cid: 9, date: '2026-11-19', ch: 'llamada', text: 'Seguimiento', follow: '2026-11-30' });
  assert.equal(i.status, 201);
  assert.equal(i.body.follow, '2026-11-30');
  assert.equal((await api('POST', '/interactions', { cid: 9, date: '19/11/2026', ch: 'llamada' })).status, 400);
  assert.equal((await api('POST', '/interactions', { cid: 9, date: '2026-11-19', ch: 'fax' })).status, 400);
  assert.equal((await api('POST', '/interactions', { cid: 999, date: '2026-11-19', ch: 'email' })).status, 409);
  const list = await api('GET', '/interactions?cid=9');
  assert.equal(list.body[0].id, i.body.id);
  assert.equal((await api('DELETE', `/interactions/${i.body.id}`)).status, 204);
});

test('relations: either side, no self-relation', async () => {
  assert.equal((await api('GET', '/relations?cid=2')).body.length, 2);
  assert.equal((await api('POST', '/relations', { a: 3, b: 3, kind: 'x' })).status, 400);
  const r = await api('POST', '/relations', { a: 7, b: 5, kind: 'Se conocen' });
  assert.equal(r.status, 201);
  assert.equal((await api('PATCH', `/relations/${r.body.id}`, { kind: 'Amigas' })).body.kind, 'Amigas');
  assert.equal((await api('DELETE', `/relations/${r.body.id}`)).status, 204);
});

test('events: create with guests and URL, guests upsert, range filter', async () => {
  const e = await api('POST', '/events', {
    title: 'Tech & Tapas #5', date: '2027-01-14', start: '19:00', end: '22:00', place: 'Impact Lab, Madrid',
    url: 'https://lu.ma/tt5', guests: [{ cid: 5, st: 'confirmado' }],
  });
  assert.equal(e.status, 201);
  assert.equal(e.body.url, 'https://lu.ma/tt5');
  assert.deepEqual(e.body.guests, [{ cid: 5, st: 'confirmado' }]);
  assert.equal(e.body.calBlock, null);

  const g = await api('PUT', `/events/${e.body.id}/guests/4`, { st: 'invitado' });
  assert.equal(g.body.guests.length, 2);
  const g2 = await api('PUT', `/events/${e.body.id}/guests/4`, { st: 'confirmado' });
  assert.equal(g2.body.guests.find((x: any) => x.cid === 4).st, 'confirmado');
  assert.equal((await api('PUT', `/events/${e.body.id}/guests/4`, { st: 'quizá' })).status, 400);
  assert.equal((await api('PATCH', `/events/${e.body.id}`, { start: '25:00' })).status, 400);

  const range = await api('GET', '/events?from=2026-11-01&to=2026-12-31');
  assert.deepEqual(range.body.map((x: any) => x.id), [102, 101]);

  assert.equal((await api('DELETE', `/events/${e.body.id}/guests/4`)).status, 204);
  assert.equal((await api('DELETE', `/events/${e.body.id}`)).status, 204);
});

test('events: likely guests come from past editions, the project and relations', async () => {
  const { body } = await api('GET', '/events/101/likely-guests');
  const ids = body.map((x: any) => x.cid);
  // Already invited (5, 4, 6, 1, 7) are never suggested.
  for (const cid of [5, 4, 6, 1, 7]) assert.ok(!ids.includes(cid));
  // Jorge (2) and Tomás (8) went to Tech & Tapas #3.
  assert.ok(ids.includes(2) && ids.includes(8));
  const jorge = body.find((x: any) => x.cid === 2);
  assert.ok(jorge.reasons.some((r: string) => r.includes('Tech & Tapas #3')));
});

test('projects: people and tasks with status', async () => {
  const all = await api('GET', '/projects');
  assert.equal(all.body.length, 3);
  const p = all.body.find((x: any) => x.id === 301);
  assert.equal(p.eventId, 101);
  assert.equal(p.people.length, 4);
  assert.equal(p.tasks.length, 4);

  const created = await api('POST', '/projects', { title: 'Nuevo', people: [{ cid: 2, role: 'Mentor' }] });
  assert.equal(created.status, 201);
  const id = created.body.id;
  assert.equal(created.body.status, 'En marcha');
  await api('PUT', `/projects/${id}/people/3`, { role: 'Asesora' });
  const t = await api('POST', `/projects/${id}/tasks`, { cid: 3, text: 'Revisar plan', due: '2026-11-30' });
  assert.equal(t.body.st, 'pendiente');
  assert.equal((await api('PATCH', `/tasks/${t.body.id}`, { st: 'hecho' })).body.st, 'hecho');
  assert.equal((await api('PATCH', `/tasks/${t.body.id}`, { st: 'listo' })).status, 400);
  const full = await api('GET', `/projects/${id}`);
  assert.equal(full.body.people.length, 2);
  assert.equal(full.body.tasks[0].st, 'hecho');

  const pending = await api('GET', '/tasks?cid=2&st=pendiente');
  assert.deepEqual(pending.body.map((x: any) => x.text), ['Reenviar el deck actualizado de Voltia']);

  assert.equal((await api('DELETE', `/projects/${id}`)).status, 204);
  assert.equal((await api('GET', `/tasks?cid=3&st=hecho`)).body.filter((x: any) => x.projectId === id).length, 0);
});

test('today merges events, Cal.com bookings and Google, sorted by time', async () => {
  const { body } = await api('GET', '/today');
  assert.deepEqual(body.map((x: any) => [x.src, x.start]), [['gcal', '16:00'], ['cal', '18:45'], ['cal', '20:00']]);
  assert.equal(body[1].title, 'Llamada con Elena Prieto');
  assert.equal(body[1].cid, 9);
});

test('calendar returns all sources and follow-ups for a range', async () => {
  const { body } = await api('GET', '/calendar?from=2026-11-01&to=2026-11-30');
  assert.deepEqual(body.events.map((e: any) => e.id), [102]);
  assert.equal(body.bookings.length, 4);
  assert.equal(body.gcal.length, 3);
  assert.deepEqual(body.follows.map((f: any) => [f.cid, f.date]), [[1, '2026-11-21'], [4, '2026-11-24']]);
  assert.equal((await api('GET', '/calendar?from=2026-11-01')).status, 400);
});

test('settings and connections: keys go to .env with mode 600 and are never returned', async () => {
  const s = await api('PATCH', '/settings', { blockEvents: false });
  assert.equal(s.body.blockEvents, false);
  assert.equal(s.body.theme, 'claro');
  assert.equal((await api('PATCH', '/settings', { theme: 'rosa' })).status, 400);
  assert.equal(s.body.captureShortcut, 'Ctrl+Shift+S');
  assert.equal((await api('PATCH', '/settings', { captureShortcut: 'Super+K' })).body.captureShortcut, 'Super+K');
  assert.equal((await api('PATCH', '/settings', { captureShortcut: 'banana' })).status, 400);

  assert.equal((await api('GET', '/connections')).body.claude.connected, false);
  const put = await api('PUT', '/connections/claude', { apiKey: 'sk-test-123' });
  assert.equal(put.status, 200);
  const conns = await api('GET', '/connections');
  assert.equal(conns.body.claude.connected, true);
  assert.ok(!JSON.stringify(conns.body).includes('sk-test-123'));
  const file = join(dir, '.env');
  assert.match(readFileSync(file, 'utf8'), /^ANTHROPIC_API_KEY="sk-test-123"$/m);
  assert.equal(statSync(file).mode & 0o777, 0o600);

  assert.equal((await api('DELETE', '/connections/claude')).status, 204);
  assert.equal((await api('GET', '/connections')).body.claude.connected, false);
  assert.equal((await api('PUT', '/connections/nope', { apiKey: 'x' })).status, 404);
});

test('not-yet-built routes answer 501, unknown routes 404', async () => {
  assert.equal((await api('POST', '/ask', { question: 'hola' })).status, 501);
  assert.equal((await api('GET', '/nope')).status, 404);
  assert.equal((await api('PUT', '/contacts')).status, 405);
});
