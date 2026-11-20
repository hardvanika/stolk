import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openSqlite } from '../desktop/sqlite.mjs';
import type { SqlDb } from '../src/db/types';
import { migrate, EMBED_DIM } from '../src/db/schema';
import { embedPending, saveCapture } from '../src/db/repo';
import { emptyPlan } from '../src/rag/plan';
import { retrieve } from '../src/rag/retrieve';

// Deterministic stand-in for nomic-embed: one axis per keyword.
const AXES = ['battery', 'investor', 'research'];
const fakeEmbed = async (text: string) => {
  const v = new Array(EMBED_DIM).fill(0.001);
  AXES.forEach((w, i) => text.toLowerCase().includes(w) && (v[i] = 1));
  return v;
};

async function desktopDb(): Promise<SqlDb> {
  const raw = openSqlite(':memory:');
  const db: SqlDb = { hasVec: true, execute: async (sql, params) => raw.execute(sql, params) };
  await migrate(db);
  return db;
}

test('desktop SQLite: same schema with sqlite-vec, vector leg of hybrid search', async () => {
  const db = await desktopDb();
  await saveCapture(db, { fullName: 'Ana García', company: 'Voltia', note: 'home battery storage', metAt: new Date(2026, 5, 4) });
  await saveCapture(db, { fullName: 'Luis Pérez', company: 'Kfund', note: 'seed investor', metAt: new Date(2026, 5, 5) });
  assert.equal(await embedPending(db, fakeEmbed), 4); // 2 profiles + 2 notes
  assert.equal(await embedPending(db, fakeEmbed), 0);

  // "capital" has no keyword match, so only the vector search can find the investor.
  const hits = await retrieve(db, { ...emptyPlan(), topic: 'capital' }, { embedQuery: async () => fakeEmbed('investor') });
  assert.equal(hits[0].full_name, 'Luis Pérez');
});
