import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDb } from './helpers';
import { saveCapture, normalizeLinkedin } from '../src/db/repo';
import { heuristicPlan, normalizePlan, emptyPlan, ftsQueryCheck } from './shim';
import { retrieve } from '../src/rag/retrieve';
import { ask } from '../src/rag/ask';
import { distanceM } from '../src/geo/geo';

const IFEMA = { lat: 40.4636, lng: -3.6167 };
const UC3M = { lat: 40.3325, lng: -3.7652 };

async function seeded() {
  const db = await testDb();
  await saveCapture(db, { fullName: 'Ana García', company: 'Voltia', role: 'CEO', note: 'Building solar battery storage for homes', eventName: 'South Summit 2026', placeName: 'IFEMA', coords: IFEMA, metAt: new Date(2026, 5, 4, 11) });
  await saveCapture(db, { fullName: 'Luis Pérez', company: 'Kfund', role: 'Investor', note: 'Seed investor, fintech focus', eventName: 'South Summit 2026', coords: { lat: IFEMA.lat + 0.0005, lng: IFEMA.lng }, metAt: new Date(2026, 5, 5, 16) });
  await saveCapture(db, { fullName: 'Marta Ruiz', linkedinUrl: 'https://es.linkedin.com/in/MartaRuiz/?trk=x', company: 'UC3M', role: 'Researcher', note: 'NLP research, knowledge graphs', placeName: 'UC3M Leganés', coords: UC3M, metAt: new Date(2026, 8, 20, 10) });
  return db;
}
const ctxOf = async (db: Awaited<ReturnType<typeof testDb>>) => ({
  today: new Date(2026, 8, 26),
  events: (await db.execute('SELECT name FROM events')).rows.map((r) => r.name as string),
  places: (await db.execute('SELECT name FROM places')).rows.map((r) => r.name as string),
});

test('linkedin urls are normalised and dedupe contacts', async () => {
  assert.equal(normalizeLinkedin('es.linkedin.com/in/MartaRuiz/?trk=x'), 'https://www.linkedin.com/in/martaruiz');
  const db = await seeded();
  await saveCapture(db, { fullName: 'Marta R.', linkedinUrl: 'linkedin.com/in/martaruiz', note: 'second chat', metAt: new Date(2026, 8, 21) });
  const n = (await db.execute('SELECT count(*) AS n FROM contacts')).rows[0].n;
  assert.equal(n, 3);
  const enc = (await db.execute('SELECT count(*) AS n FROM encounters')).rows[0].n;
  assert.equal(enc, 4);
});

test('a second capture near a saved place reuses it', async () => {
  const db = await seeded();
  const places = (await db.execute('SELECT name FROM places')).rows.map((r) => r.name);
  assert.deepEqual(places.sort(), ['IFEMA', 'UC3M Leganés']);
  const luis = (await db.execute("SELECT p.name FROM encounters e JOIN contacts c ON c.id=e.contact_id JOIN places p ON p.id=e.place_id WHERE c.full_name='Luis Pérez'")).rows[0];
  assert.equal(luis.name, 'IFEMA');
  assert.ok(distanceM(IFEMA, UC3M) > 10_000);
});

test('who did I meet at <event>', async () => {
  const db = await seeded();
  const plan = heuristicPlan('Who did I meet at south summit 2026?', await ctxOf(db));
  assert.equal(plan.event, 'South Summit 2026');
  const hits = await retrieve(db, plan);
  assert.deepEqual(hits.map((h) => h.full_name).sort(), ['Ana García', 'Luis Pérez']);
});

test('place, accents and month filters', async () => {
  const db = await seeded();
  const ctx = await ctxOf(db);
  const p1 = heuristicPlan('quién conocí en uc3m leganes?', ctx);
  assert.equal(p1.place, 'UC3M Leganés');
  assert.deepEqual((await retrieve(db, p1)).map((h) => h.full_name), ['Marta Ruiz']);
  const p2 = heuristicPlan('who did I meet in June?', ctx);
  assert.equal(p2.date_from, '2026-06-01');
  assert.equal(p2.date_to, '2026-06-30');
  assert.equal((await retrieve(db, p2)).length, 2);
});

test('near me uses GPS radius', async () => {
  const db = await seeded();
  const plan = heuristicPlan('who did I meet near here', await ctxOf(db));
  assert.ok(plan.near_me);
  const hits = await retrieve(db, plan, { here: { lat: UC3M.lat + 0.001, lng: UC3M.lng } });
  assert.deepEqual(hits.map((h) => h.full_name), ['Marta Ruiz']);
});

test('topic search ranks by notes (keyword leg of hybrid search)', async () => {
  const db = await seeded();
  const hits = await retrieve(db, { ...emptyPlan(), topic: 'battery startups' });
  assert.equal(hits[0].full_name, 'Ana García');
  const inv = await retrieve(db, { ...emptyPlan(), event: 'South Summit 2026', topic: 'investors' });
  assert.deepEqual(inv.map((h) => h.full_name), ['Luis Pérez']);
  assert.ok(ftsQueryCheck('who works on batteries?')?.includes('"batteries"*'));
});

test('model output is snapped to known names and validated', async () => {
  const db = await seeded();
  const plan = normalizePlan({ event: null, place: 'south summit', near_me: false, date_from: 'June', date_to: null, person: '', company: null, topic: null }, await ctxOf(db));
  assert.equal(plan.event, 'South Summit 2026');
  assert.equal(plan.date_from, null);
  assert.equal(plan.person, null);
});

test('ask() works end to end with a fake local model, and without one', async () => {
  const db = await seeded();
  const noModel = await ask(db, 'Who did I meet at South Summit?', {});
  assert.equal(noModel.hits.length, 2);
  assert.match(noModel.answer, /2 people at South Summit 2026/);

  const fake = await ask(db, 'the researcher from UC3M', {
    completeJson: async () => ({ event: null, place: null, near_me: false, date_from: null, date_to: null, person: null, company: 'UC3M', topic: null }),
    completeChat: async (m) => `answer from ${m[1].content.split('\n')[1].slice(0, 14)}`,
  });
  assert.deepEqual(fake.hits.map((h) => h.full_name), ['Marta Ruiz']);
  assert.equal(fake.answer, 'answer from [1] Marta Ruiz');

  // A plan that over-constrains falls back to the rules.
  const bad = await ask(db, 'Who did I meet at South Summit?', {
    completeJson: async () => ({ event: null, place: null, near_me: false, date_from: '2020-01-01', date_to: '2020-01-02', person: null, company: null, topic: null }),
  });
  assert.equal(bad.hits.length, 2);
});
