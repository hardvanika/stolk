import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { openDb, type DB } from '../src/db.js';
import { EnvFile } from '../src/env.js';
import { buildRouter } from '../src/app.js';
import { createApiServer } from '../src/http.js';
import { seedDemo } from '../src/seed.js';
import { toUtc, toLocal } from '../src/tz.js';

const TOKEN = 't';
let server: Server, base: string, db: DB, dir: string, env: EnvFile;
const calls: { method: string; url: string; body?: any; headers: Record<string, string> }[] = [];
let blockSeq = 0;
const cancelled: string[] = [];

// A fake Cal.com + Google, recording every call.
const fakeFetch = (async (input: any, init: any = {}) => {
  const url = String(input);
  const method = init.method ?? 'GET';
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : undefined;
  calls.push({ method, url, body, headers: init.headers ?? {} });
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
  const u = new URL(url);

  if (u.host === 'api.cal.com') {
    if (u.pathname === '/v2/me') return json({ status: 'success', data: { id: 1, username: 'ivan', email: 'ivan@me.example', name: 'Ivan', timeZone: 'Europe/Madrid' } });
    if (u.pathname === '/v2/event-types' && method === 'GET') return json({ status: 'success', data: [{ id: 7, slug: 'cafe-30' }] });
    if (u.pathname === '/v2/event-types' && method === 'POST') return json({ status: 'success', data: { id: 99 } }, 201);
    if (u.pathname === '/v2/bookings' && method === 'GET') {
      return json({
        status: 'success',
        pagination: { nextCursor: null, hasMore: false },
        data: [
          // Past café with Jorge (known by email) → booking + history entry.
          { uid: 'bk-1', title: 'Café entre Ivan y Jorge', status: 'accepted', start: '2026-11-17T09:00:00Z', end: '2026-11-17T09:30:00Z',
            eventType: { id: 7, slug: 'cafe-30' }, attendees: [{ name: 'Jorge Sanz', email: 'JORGE@ribera.example' }] },
          // Future call with a stranger → booking only.
          { uid: 'bk-2', title: 'Llamada', status: 'accepted', start: '2026-11-26T15:00:00Z', end: '2026-11-26T15:15:00Z',
            eventType: { id: 8, slug: 'llamada-15' }, attendees: [{ name: 'Nadie', email: 'nadie@x.example' }] },
          // Our own block → ignored.
          { uid: 'blk-old', title: 'Bloqueado', status: 'accepted', start: '2026-12-03T18:00:00Z', end: '2026-12-03T21:00:00Z',
            eventType: { id: 99, slug: 'bloqueado-stolk' }, attendees: [{ name: 'Ivan', email: 'ivan@me.example' }] },
        ],
      });
    }
    if (u.pathname === '/v2/bookings' && method === 'POST') return json({ status: 'success', data: { uid: `blk-${++blockSeq}` } }, 201);
    const m = /^\/v2\/bookings\/([^/]+)\/cancel$/.exec(u.pathname);
    if (m) { cancelled.push(decodeURIComponent(m[1])); return json({ status: 'success' }); }
  }
  if (u.host === 'oauth2.googleapis.com') {
    if (body.grant_type === 'authorization_code') return json({ access_token: 'a', refresh_token: 'refresh-123', expires_in: 3600 });
    return json({ access_token: 'a', expires_in: 3600 });
  }
  if (u.host === 'www.googleapis.com') {
    return json({ items: [
      { id: 'ge1', status: 'confirmed', summary: 'Tutoría', location: 'UC3M', start: { dateTime: '2026-11-20T15:00:00Z' }, end: { dateTime: '2026-11-20T16:00:00Z' } },
      { id: 'ge2', status: 'confirmed', summary: 'Puente', start: { date: '2026-12-08' }, end: { date: '2026-12-09' } },
      // Same slot as Cal.com booking bk-2 → skipped as a duplicate.
      { id: 'ge3', status: 'confirmed', summary: 'Llamada (Cal.com)', start: { dateTime: '2026-11-26T15:00:00Z' }, end: { dateTime: '2026-11-26T15:15:00Z' } },
      { id: 'ge4', status: 'cancelled', summary: 'Borrado' },
    ] });
  }
  if (u.host === 'gmail.googleapis.com') {
    if (u.pathname.endsWith('/messages')) return json({ messages: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }, { id: 'm-old' }] });
    const id = u.pathname.split('/').pop();
    const msgs: Record<string, any> = {
      m1: { internalDate: String(Date.UTC(2026, 10, 19, 10)), labelIds: ['INBOX'], payload: { headers: [{ name: 'From', value: 'Lucía <lucia@voltia.example>' }, { name: 'Subject', value: 'Deck v3' }] } },
      m2: { internalDate: String(Date.UTC(2026, 10, 18, 10)), labelIds: ['SENT'], payload: { headers: [{ name: 'To', value: 'jorge@ribera.example, desconocido@x.example' }, { name: 'Cc', value: 'Ana <ana@impactlab.example>' }, { name: 'Subject', value: 'Intro' }] } },
      m3: { internalDate: String(Date.UTC(2026, 10, 18, 9)), labelIds: ['INBOX'], payload: { headers: [{ name: 'From', value: 'news@spam.example' }, { name: 'Subject', value: 'Oferta' }] } },
      'm-old': { internalDate: String(Date.UTC(2025, 0, 1)), labelIds: ['INBOX'], payload: { headers: [{ name: 'From', value: 'lucia@voltia.example' }, { name: 'Subject', value: 'Antiguo' }] } },
    };
    return json(msgs[id!]);
  }
  return json({ message: `unexpected ${method} ${url}` }, 500);
}) as typeof fetch;

before(async () => {
  delete process.env.CALCOM_API_KEY;
  delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET; delete process.env.GOOGLE_REFRESH_TOKEN;
  dir = mkdtempSync(join(tmpdir(), 'stolk-sync-'));
  db = openDb(join(dir, 'stolk.db'));
  seedDemo(db);
  env = new EnvFile(join(dir, '.env'));
  server = createApiServer(buildRouter({ db, env, fetch: fakeFetch, now: () => new Date('2026-11-19T17:30:00Z') }), TOKEN);
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
after(() => { server.close(); db.close(); });

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method, headers: { Authorization: `Bearer ${TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: any = text;
  try { parsed = text ? JSON.parse(text) : undefined; } catch { /* html */ }
  return { status: res.status, body: parsed };
}

test('time zone helpers round-trip Madrid wall time, including DST', () => {
  assert.equal(toUtc('2026-12-03', '19:00').toISOString(), '2026-12-03T18:00:00.000Z'); // CET +1
  assert.equal(toUtc('2026-07-01', '19:00').toISOString(), '2026-07-01T17:00:00.000Z'); // CEST +2
  assert.deepEqual(toLocal('2026-11-17T09:00:00Z'), { date: '2026-11-17', time: '10:00' });
});

test('sync without connections skips everything and touches no network', async () => {
  const { body } = await api('POST', '/sync');
  assert.equal(body.calcom.skipped, 'not connected');
  assert.equal(body.gcal.skipped, 'not connected');
  assert.equal(calls.length, 0);
});

test('Cal.com: bookings are imported, past ones go to history, and events get blocks', async () => {
  await api('PUT', '/connections/calcom', { apiKey: 'cal_test' });
  const { body } = await api('POST', '/sync');
  assert.equal(body.calcom.ok, true, body.calcom.error);
  assert.equal(body.calcom.bookings, 2);

  const bk = (await api('GET', '/bookings?from=2026-11-17&to=2026-11-30')).body.filter((b: any) => b.calUid.startsWith('bk-'));
  assert.deepEqual(bk.map((b: any) => [b.calUid, b.date, b.start, b.cid]), [['bk-1', '2026-11-17', '10:00', 2], ['bk-2', '2026-11-26', '16:00', null]]);
  const jorge = (await api('GET', '/contacts/2')).body;
  assert.ok(jorge.interactions.some((i: any) => i.ch === 'cal' && i.date === '2026-11-17'));

  // Upcoming events 101 (3 dic 19–22) and 102 (27 nov 17–20) are blocked; the hidden type was created once.
  assert.equal(body.calcom.blocks, 2);
  const created = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/v2/event-types'));
  assert.equal(created.length, 1);
  assert.equal(created[0].body.slug, 'bloqueado-stolk');
  assert.equal(created[0].body.hidden, true);
  const blocks = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/v2/bookings'));
  const b101 = blocks.find((c) => c.body.metadata.stolkEventId === '101')!;
  assert.equal(b101.body.start, '2026-12-03T18:00:00Z');
  assert.equal(b101.body.lengthInMinutes, 180);
  assert.equal(b101.body.eventTypeId, 99);
  assert.equal(b101.headers['cal-api-version'], '2026-02-25');
  const ev = (await api('GET', '/events/101')).body;
  assert.equal(ev.calBlock.synced, true);
  assert.ok(ev.calBlock.uid.startsWith('blk-'));

  // A second sync doesn't duplicate anything.
  const again = await api('POST', '/sync');
  assert.equal(again.body.calcom.blocks, 0);
  assert.equal((await api('GET', '/contacts/2')).body.interactions.filter((i: any) => i.ch === 'cal' && i.date === '2026-11-17').length, 1);
});

test('Cal.com: moving an event moves its block, a text edit does not, deleting cancels it', async () => {
  const before = (await api('GET', '/events/102')).body.calBlock.uid;
  await api('PATCH', '/events/102', { desc: 'Solo texto' });
  assert.equal((await api('GET', '/events/102')).body.calBlock.uid, before);

  const moved = await api('PATCH', '/events/102', { start: '18:00' });
  assert.ok(cancelled.includes(before));
  assert.notEqual(moved.body.calBlock.uid, before);
  assert.equal(moved.body.calBlock.synced, true);

  const created = await api('POST', '/events', { title: 'Nuevo', date: '2026-12-10', start: '10:00', end: '10:20' });
  assert.ok(created.body.calBlock.uid);
  const lastBlock = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/v2/bookings')).pop()!;
  assert.equal(lastBlock.body.lengthInMinutes, 30); // 20 min rounds up to 30

  assert.equal((await api('DELETE', `/events/${created.body.id}`)).status, 204);
  assert.ok(cancelled.includes(created.body.calBlock.uid));
});

test('Google: sign-in stores a refresh token; calendar and Gmail headers sync', async () => {
  const start = await api('POST', '/connections/gcal/start', { clientId: 'cid.apps.googleusercontent.com', clientSecret: 'sec' });
  assert.equal(start.status, 201);
  const auth = new URL(start.body.authUrl);
  assert.equal(auth.host, 'accounts.google.com');
  assert.match(auth.searchParams.get('redirect_uri')!, /^http:\/\/127\.0\.0\.1:\d+\/oauth\/gcal\/callback$/);
  assert.match(auth.searchParams.get('scope')!, /calendar\.readonly/);
  assert.match(auth.searchParams.get('scope')!, /gmail\.metadata/);
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');

  // Wrong state is refused; the browser callback needs no token.
  const bad = await fetch(`${base}/oauth/gcal/callback?code=x&state=nope`);
  assert.match(await bad.text(), /No se conectó/);
  const ok = await fetch(`${base}/oauth/gcal/callback?code=abc&state=${start.body.state}`);
  assert.match(await ok.text(), /Google conectado/);
  assert.match(readFileSync(join(dir, '.env'), 'utf8'), /GOOGLE_REFRESH_TOKEN="refresh-123"/);

  const { body } = await api('POST', '/sync');
  assert.equal(body.gcal.ok, true, body.gcal.error);
  assert.equal(body.gcal.events, 2); // ge3 duplicates a Cal.com booking, ge4 is cancelled
  const g = (await api('GET', '/gcal?from=2026-11-20&to=2026-12-31')).body;
  assert.deepEqual(g.map((x: any) => [x.id, x.date, x.start]), [['ge1', '2026-11-20', '16:00'], ['ge2', '2026-12-08', '']]);

  assert.equal(body.gmail.ok, true, body.gmail.error);
  // The sign-in already kicked off a background sync, so count rows rather than this call's result.
  // Lucía (in), Jorge + Ana (sent); spam and old mail ignored.
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM interactions WHERE source = 'gmail'").get() as any).n, 3);
  const lucia = (await api('GET', '/contacts/1')).body.interactions[0];
  assert.deepEqual([lucia.date, lucia.ch, lucia.text], ['2026-11-19', 'email', 'Te escribió: Deck v3']);
  const ana = (await api('GET', '/contacts/5')).body.interactions[0];
  assert.equal(ana.text, 'Le escribiste: Intro');

  const again = await api('POST', '/sync');
  assert.equal(again.body.gmail.emails, 0);

  const conns = (await api('GET', '/connections')).body;
  assert.equal(conns.gcal.connected, true);
  assert.ok(conns.gmail.lastSync);
  assert.ok(!JSON.stringify(conns).includes('refresh-123'));
});

test('clicking a chat button logs it once per channel per day', async () => {
  const a = await api('POST', '/contacts/3/opened', { channel: 'whatsapp' });
  assert.equal(a.status, 201);
  assert.equal(a.body.text, 'Abriste el chat de WhatsApp');
  await api('POST', '/contacts/3/opened', { channel: 'whatsapp' });
  await api('POST', '/contacts/3/opened', { channel: 'telegram' });
  const today = (await api('GET', '/interactions?cid=3&from=2026-11-19&to=2026-11-19')).body;
  assert.equal(today.length, 2);
  assert.equal((await api('POST', '/contacts/3/opened', { channel: 'fax' })).status, 400);
});
