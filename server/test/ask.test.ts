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
import { MAX_ANSWER_CHARS, type CreateMessage } from '../src/ask.js';
import { AskLimiter } from '../src/ratelimit.js';

const TOKEN = 't';
let server: Server, base: string, db: DB;
let lastParams: any;
let reply: () => Anthropic.Beta.BetaMessage | Promise<Anthropic.Beta.BetaMessage>;

const message = (text: string, stop: string = 'end_turn') => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: stop,
  content: [{ type: 'text', text }], usage: { input_tokens: 1, output_tokens: 1 },
}) as unknown as Anthropic.Beta.BetaMessage;

const fakeCreate: CreateMessage = async (params) => {
  lastParams = params;
  return reply();
};

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stolk-ask-'));
  db = openDb(join(dir, 'stolk.db'));
  seedDemo(db);
  const env = new EnvFile(join(dir, '.env'));
  server = createApiServer(buildRouter({ db, env, createMessage: fakeCreate, now: () => new Date('2026-11-19T17:30:00Z'), askLimiter: new AskLimiter({ perMinute: 1000, perDay: 1000 }) }), TOKEN);
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
after(() => { server.close(); db.close(); });

async function ask(question: unknown, extra: Record<string, unknown> = {}) {
  const res = await fetch(base + '/ask', {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, ...extra }),
  });
  return { status: res.status, body: await res.json() };
}

test('sends the question with Ivan\'s data, structured output and fallbacks', async () => {
  reply = () => message(JSON.stringify({
    answer: 'En Tech & Tapas #3 conociste a Lucía, Jorge, Tomás y Ana.',
    cites: [{ type: 'event', id: 103 }, { type: 'contact', id: 1 }, { type: 'contact', id: 1 }, { type: 'contact', id: 999 }],
    draft: null,
  }));
  const { status, body } = await ask('¿A quién conocí en Tech & Tapas #3?');
  assert.equal(status, 201);
  assert.match(body.answer, /Tech & Tapas #3/);
  // Duplicates and ids that don't exist are dropped.
  assert.deepEqual(body.cites, [{ type: 'event', id: 103 }, { type: 'contact', id: 1 }]);
  assert.equal(body.draft, null);
  assert.equal(body.used.contacts, 9);

  assert.equal(lastParams.model, 'claude-opus-5-5');
  assert.equal(lastParams.fallbacks, 'default');
  assert.deepEqual(lastParams.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(lastParams.output_config.format.type, 'json_schema');
  assert.equal(lastParams.thinking, undefined);
  const data = lastParams.system[1].text;
  assert.ok(data.includes('Lucía Romero') && data.includes('Tech & Tapas #4'));
  assert.ok(!data.includes('600 112'), 'phone numbers are not sent');
  assert.deepEqual(lastParams.system[1].cache_control, { type: 'ephemeral' });
  assert.equal(lastParams.messages.length, 1);
  assert.match(lastParams.messages[0].content.at(-1).text, /^today: 2026-11-19/);
});

test('returns a draft for "escribe a…" and drops drafts for unknown people', async () => {
  reply = () => message(JSON.stringify({
    answer: 'Te he preparado un mensaje para Jorge.',
    cites: [{ type: 'contact', id: 2 }],
    draft: { cid: 2, text: '  Hola Jorge, te paso el deck actualizado de Voltia.  ' },
  }));
  const ok = await ask('Escribe a Jorge para mandarle el deck');
  assert.deepEqual(ok.body.draft, { cid: 2, text: 'Hola Jorge, te paso el deck actualizado de Voltia.' });

  reply = () => message(JSON.stringify({ answer: 'x', cites: [], draft: { cid: 777, text: 'hola' } }));
  assert.equal((await ask('Escribe a nadie')).body.draft, null);
});

test('refusals, cut-off output and API errors come back as clear messages', async () => {
  reply = () => message('', 'refusal');
  const r = await ask('algo');
  assert.equal(r.status, 201);
  assert.match(r.body.answer, /no ha querido responder/);

  reply = () => message('{"answer": "a medias', 'max_tokens');
  const cut = await ask('algo');
  assert.equal(cut.status, 502);
  assert.match(cut.body.error.message, /se cortó/);

  reply = () => { throw new Anthropic.RateLimitError(429, undefined, 'rate', new Headers()); };
  const rl = await ask('algo');
  assert.equal(rl.status, 429);
});

test('chat: earlier turns go before the question, files go with it', async () => {
  reply = () => message(JSON.stringify({ answer: 'ok', cites: [], draft: null }));
  const png = Buffer.from('fake-png').toString('base64');
  const pdf = Buffer.from('%PDF-1.4 fake').toString('base64');
  const txt = Buffer.from('Agenda: 19:00 apertura').toString('base64');
  const r = await ask('¿Y quién de estos viene?', {
    history: [
      { role: 'assistant', text: 'hola' }, // a leading assistant turn is dropped
      { role: 'user', text: '¿Quién va a Tech & Tapas #4?' },
      { role: 'assistant', text: 'Ana y Pablo confirmados.' },
    ],
    attachments: [
      { name: 'tarjeta.png', mediaType: 'image/png', data: png },
      { name: 'agenda.pdf', mediaType: 'application/pdf', data: pdf },
      { name: 'notas.md', mediaType: 'text/markdown', data: txt },
    ],
  });
  assert.equal(r.status, 201);
  const m = lastParams.messages;
  assert.deepEqual(m.slice(0, 2), [
    { role: 'user', content: '¿Quién va a Tech & Tapas #4?' },
    { role: 'assistant', content: 'Ana y Pablo confirmados.' },
  ]);
  const last = m[2].content;
  assert.equal(last[0].type, 'image');
  assert.equal(last[0].source.media_type, 'image/png');
  assert.equal(last[1].type, 'document');
  assert.equal(last[1].source.media_type, 'application/pdf');
  assert.equal(last[2].source.type, 'text');
  assert.equal(last[2].source.data, 'Agenda: 19:00 apertura');
  assert.match(last[3].text, /¿Y quién de estos viene\?$/);

  // A file with no text still asks something.
  await ask('', { attachments: [{ name: 'a.jpg', mediaType: 'image/jpeg', data: png }] });
  assert.match(lastParams.messages[0].content.at(-1).text, /Qué ves/);
});

test('chat limits answer in Spanish', async () => {
  const f = (n: number, type = 'image/png', size = 10) => Array.from({ length: n }, (_, i) => ({ name: `f${i}`, mediaType: type, data: Buffer.alloc(size).toString('base64') }));
  const tooMany = await ask('x', { attachments: f(6) });
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.body.error.message, /como máximo 5 archivos/);
  const wrong = await ask('x', { attachments: f(1, 'application/zip') });
  assert.match(wrong.body.error.message, /No puedo leer «f0»/);
  const big = await ask('x', { attachments: f(2, 'application/pdf', 6 * 1024 * 1024) });
  assert.equal(big.status, 400);
  assert.match(big.body.error.message, /máximo 10 MB/);
  assert.equal((await ask('x', { history: [{ role: 'bot', text: 'x' }] })).status, 400);
});

test('guardrails: off-topic questions are refused with an angry O and no links or draft', async () => {
  reply = () => message(JSON.stringify({
    answer: 'Eso no es lo mío: yo llevo tus personas y tu agenda. ¿Te digo a quién te toca escribir?',
    offTopic: true,
    cites: [{ type: 'contact', id: 1 }],
    draft: { cid: 2, text: 'print(1+1)' },
  }));
  const r = await ask('Hazme una calculadora en Python');
  assert.equal(r.status, 201);
  assert.equal(r.body.offTopic, true);
  assert.equal(r.body.emotion, 'angry');
  assert.deepEqual(r.body.cites, []);
  assert.equal(r.body.draft, null);
  // The prompt scopes Claude to Stölk and the schema asks for the flag.
  assert.match(lastParams.system[0].text, /fuera de tema/);
  assert.match(lastParams.system[0].text, /código/);
  assert.ok(lastParams.output_config.format.schema.required.includes('offTopic'));
  assert.ok(lastParams.max_tokens <= 8000);

  reply = () => message(JSON.stringify({ answer: 'Hoy ves a Lucía.', offTopic: false, cites: [], draft: null }));
  const ok = await ask('¿A quién veo hoy?');
  assert.equal(ok.body.offTopic, false);
  assert.equal(ok.body.emotion, null);
});

test('guardrails: over-long answers are clipped', async () => {
  reply = () => message(JSON.stringify({ answer: 'Frase larga de prueba. '.repeat(400), offTopic: false, cites: [], draft: null }));
  const r = await ask('Cuéntamelo todo');
  assert.ok(r.body.answer.length <= MAX_ANSWER_CHARS + 2);
  assert.match(r.body.answer, /…$/);
});

test('validation: empty question, Claude switched off, model setting', async () => {
  assert.equal((await ask('  ')).status, 400);
  const patch = (b: unknown) => fetch(base + '/settings', {
    method: 'PATCH', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(b),
  });
  await patch({ claudeModel: 'claude-sonnet-5-5' });
  reply = () => message(JSON.stringify({ answer: 'ok', cites: [], draft: null }));
  await ask('hola');
  assert.equal(lastParams.model, 'claude-sonnet-5-5');
  assert.equal((await patch({ claudeModel: 'gpt-5' })).status, 400);

  await patch({ claudeOn: false });
  const off = await ask('hola');
  assert.equal(off.status, 409);
  assert.equal(off.body.error.code, 'claude_off');
});

test('guardrails: messages per minute and per day are capped', async () => {
  let t = new Date('2026-11-19T17:30:00Z').getTime();
  const now = () => new Date(t);
  const dir = mkdtempSync(join(tmpdir(), 'stolk-limit-'));
  const db2 = openDb(join(dir, 'stolk.db'));
  seedDemo(db2);
  const srv = createApiServer(buildRouter({
    db: db2, env: new EnvFile(join(dir, '.env')), createMessage: fakeCreate, now,
    askLimiter: new AskLimiter({ perMinute: 2, perDay: 3 }, now),
  }), TOKEN);
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${(srv.address() as any).port}/ask`;
  const post = async (question: string) => {
    const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) });
    return { status: res.status, body: await res.json() };
  };
  try {
    reply = () => message(JSON.stringify({ answer: 'ok', offTopic: false, cites: [], draft: null }));
    assert.equal((await post('uno')).status, 201);
    // Invalid requests don't count.
    assert.equal((await post('')).status, 400);
    assert.equal((await post('dos')).status, 201);
    const fast = await post('tres');
    assert.equal(fast.status, 429);
    assert.equal(fast.body.error.code, 'ask_rate_limited');
    assert.equal(fast.body.error.emotion, 'angry');
    assert.match(fast.body.error.message, /2 preguntas por minuto/);

    t += 61_000;
    assert.equal((await post('tres')).status, 201);
    t += 61_000;
    const day = await post('cuatro');
    assert.equal(day.status, 429);
    assert.equal(day.body.error.code, 'ask_daily_limit');

    t += 86_400_000;
    assert.equal((await post('mañana')).status, 201);
  } finally {
    srv.close(); db2.close();
  }
});
