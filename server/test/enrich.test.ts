import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import Anthropic from '@anthropic-ai/sdk';
import { openDb, type DB } from '../src/db.js';
import { EnvFile } from '../src/env.js';
import { buildRouter } from '../src/app.js';
import { createApiServer } from '../src/http.js';
import { seedDemo } from '../src/seed.js';
import type { CreateMessage } from '../src/ask.js';
import { personBrief, normLinkedin, enrich, webTools } from '../src/enrich.js';

const TOKEN = 't';
let server: Server, base: string, db: DB;
let calls: any[] = [];
let replies: (() => Anthropic.Beta.BetaMessage)[] = [];

const fakeCreate: CreateMessage = async (params) => {
  calls.push(structuredClone(params));
  const next = replies.shift();
  if (!next) throw new Error('no reply queued');
  return next();
};

const msg = (content: any[], stop = 'tool_use', searches = 2) => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: stop, content,
  usage: { input_tokens: 20_000, output_tokens: 1_000, server_tool_use: { web_search_requests: searches } },
}) as unknown as Anthropic.Beta.BetaMessage;

const searchResult = (...urls: string[]) => ({
  type: 'web_search_tool_result', tool_use_id: 'srv_1',
  content: urls.map((url) => ({ type: 'web_search_result', url, title: url, encrypted_content: 'x', page_age: null })),
});
const save = (input: any) => ({ type: 'tool_use', id: 'tu_1', name: 'guardar_resultado', input });

async function call(method: string, route: string, body?: unknown) {
  const res = await fetch(base + route, {
    method, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

let cid: number;
before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stolk-enrich-'));
  db = openDb(join(dir, 'stolk.db'));
  seedDemo(db);
  const env = new EnvFile(join(dir, '.env'));
  server = createApiServer(buildRouter({ db, env, createMessage: fakeCreate, now: () => new Date('2026-11-20T09:00:00Z') }), TOKEN);
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  const made = await call('POST', '/contacts', { name: 'Marta Ruiz', role: 'PM', company: 'Acme', email: 'marta@acme.io', phone: '+34 600 000 000', notes: 'Le encanta el ciclismo' });
  cid = made.body.id;
});
after(() => { server.close(); db.close(); });

test('is off by default and refuses to search', async () => {
  const s = await call('GET', '/settings');
  assert.equal(s.body.enrichOn, false);
  const r = await call('POST', `/contacts/${cid}/enrich`);
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'enrich_off');
  assert.equal(calls.length, 0);
  assert.equal((await call('GET', `/contacts/${cid}/enrichment`)).body, null);
});

test('searches with web search, keeps only sourced facts and saves them as suggestions', async () => {
  await call('PATCH', '/settings', { enrichOn: true });
  replies.push(() => msg([
    searchResult('https://acme.io/team', 'https://www.linkedin.com/in/martaruiz/', 'https://news.example.com/acme-launch'),
    save({
      confidence: 'alta',
      summary: 'Marta ahora es Head of Product en Acme.',
      suggestions: [
        { field: 'role', value: 'Head of Product', source: 'https://acme.io/team' },
        { field: 'linkedin', value: 'https://www.linkedin.com/in/martaruiz/', source: 'https://www.linkedin.com/in/martaruiz/' },
        { field: 'company', value: 'Acme', source: 'https://acme.io/team' }, // same as now: dropped
        { field: 'web', value: 'https://acme.io', source: 'https://made-up.example.com' }, // source never seen: dropped
      ],
      news: [
        { title: 'Acme lanza su app', url: 'https://news.example.com/acme-launch', date: '2026-10-02', note: 'Lo lideró ella.' },
        { title: 'Inventada', url: 'https://nope.example.com/x', date: '', note: '' },
      ],
      sources: [{ title: 'Equipo de Acme', url: 'https://acme.io/team' }],
    }),
  ]));
  const r = await call('POST', `/contacts/${cid}/enrich`);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(r.body.suggestions.map((s: any) => [s.field, s.value]), [['role', 'Head of Product'], ['linkedin', 'linkedin.com/in/martaruiz']]);
  assert.deepEqual(r.body.news.map((n: any) => n.title), ['Acme lanza su app']);
  assert.equal(r.body.searches, 2);
  assert.ok(r.body.costUsd > 0.1 && r.body.costUsd < 0.2, String(r.body.costUsd));

  // The request: web search capped, our strict tool, fallbacks on, and only professional fields sent.
  const p = calls[0];
  assert.deepEqual(p.tools[0], { type: 'web_search_20260209', name: 'web_search', max_uses: 5 });
  assert.deepEqual(p.tools[1], { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 4 });
  assert.equal(p.tools[2].name, 'guardar_resultado');
  assert.equal(p.tools[2].strict, true);
  assert.equal(p.fallbacks, 'default');
  const sent = JSON.stringify(p.messages);
  assert.match(sent, /Marta Ruiz/);
  assert.match(sent, /acme\.io/);
  assert.doesNotMatch(sent, /600 000|ciclismo|marta@/);

  // Nothing changed on the contact yet.
  const c = await call('GET', `/contacts/${cid}`);
  assert.equal(c.body.role, 'PM');
  assert.equal((await call('GET', `/contacts/${cid}/enrichment`)).body.summary, 'Marta ahora es Head of Product en Acme.');
});

test('accepting a suggestion updates the contact', async () => {
  const r = await call('POST', `/contacts/${cid}/enrichment/apply`, { fields: ['role'] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.contact.role, 'Head of Product');
  assert.equal(r.body.contact.linkedin, '');
  assert.deepEqual(r.body.enrichment.suggestions.map((s: any) => s.applied), [true, false]);
  assert.equal((await call('POST', `/contacts/${cid}/enrichment/apply`, { fields: ['nope'] })).status, 400);
});

test('Preguntar sees the public summary', async () => {
  const { snapshot } = await import('../src/ask.js');
  const c = snapshot(db, new Date('2026-11-20T09:00:00Z')).contacts.find((x: any) => x.id === cid) as any;
  assert.equal(c.public.summary, 'Marta ahora es Head of Product en Acme.');
});

test('low confidence keeps no suggestions, and a pause is resumed', async () => {
  replies.push(() => msg([searchResult('https://a.example.com')], 'pause_turn', 1));
  replies.push(() => msg([save({ confidence: 'baja', summary: 'Hay varias Marta Ruiz.', suggestions: [{ field: 'role', value: 'CEO', source: 'https://a.example.com' }], news: [], sources: [] })], 'tool_use', 1));
  calls = [];
  const r = await call('POST', `/contacts/${cid}/enrich`);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(calls.length, 2);
  assert.equal(calls[1].messages.at(-1).role, 'assistant');
  assert.deepEqual(r.body.suggestions, []);
  assert.equal(r.body.searches, 2);
});

test('deleting the lookup forgets it, and deleting the contact removes it too', async () => {
  assert.equal((await call('DELETE', `/contacts/${cid}/enrichment`)).status, 204);
  assert.equal((await call('GET', `/contacts/${cid}/enrichment`)).body, null);
  db.prepare("INSERT INTO enrichments (cid, created_at) VALUES (?, '2026-11-20')").run(cid);
  await call('DELETE', `/contacts/${cid}`);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM enrichments').get() as any).n, 0);
});

test('person brief leaves out free-mail domains; LinkedIn URLs are normalised', () => {
  assert.deepEqual(personBrief({ name: 'A', email: 'a@gmail.com', phone: '1', notes: 'x' }), { nombre: 'A' });
  assert.equal(normLinkedin('https://es.linkedin.com/in/foo-bar?x=1'), 'linkedin.com/in/foo-bar');
  assert.equal(normLinkedin('https://linkedin.com/company/acme'), null);
});

test('a lookup that takes too long ends with a clear timeout', async () => {
  const contact = { id: 999, name: 'Lento Pérez' };
  const slow: CreateMessage = () => new Promise(() => {});
  await assert.rejects(enrich(db, new EnvFile(join(tmpdir(), 'none.env')), contact, { create: slow, deadlineMs: 30 }),
    (e: any) => e.status === 504 && /tardado demasiado/.test(e.message));
});

test('Haiku gets the basic web tools; failed searches give a clear error', async () => {
  assert.deepEqual(webTools('claude-haiku-5-5').map((t) => t.type), ['web_search_20250305', 'web_fetch_20250910']);
  assert.deepEqual(webTools('claude-sonnet-5-5').map((t) => t.type), ['web_search_20260209', 'web_fetch_20260209']);
  const failing: CreateMessage = async () => msg([
    { type: 'web_search_tool_result', tool_use_id: 's1', content: { type: 'web_search_tool_result_error', error_code: 'invalid_tool_input' } },
    save({ confidence: 'baja', summary: 'Nada', suggestions: [], news: [], sources: [] }),
  ]);
  await assert.rejects(enrich(db, new EnvFile(join(tmpdir(), 'none.env')), { id: 998, name: 'Error Pérez' }, { create: failing, model: 'claude-haiku-5-5' }),
    (e: any) => e.status === 502 && /invalid_tool_input/.test(e.message));
});
