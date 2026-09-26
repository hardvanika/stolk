import type { SqlDb } from './types';

export const EMBED_DIM = 768; // nomic-embed-text-v1.5

// Each entry is one migration; PRAGMA user_version tracks how many have run.
const MIGRATIONS: string[][] = [
  [
    `CREATE TABLE contacts (
      id INTEGER PRIMARY KEY,
      full_name TEXT NOT NULL,
      headline TEXT, company TEXT, role TEXT,
      linkedin_url TEXT, email TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE UNIQUE INDEX contacts_linkedin ON contacts(lower(linkedin_url)) WHERE linkedin_url IS NOT NULL`,
    `CREATE TABLE events (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      starts_on TEXT, ends_on TEXT
    )`,
    `CREATE TABLE places (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE,
      lat REAL NOT NULL, lng REAL NOT NULL,
      radius_m REAL NOT NULL DEFAULT 250
    )`,
    `CREATE TABLE encounters (
      id INTEGER PRIMARY KEY,
      contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
      place_id INTEGER REFERENCES places(id) ON DELETE SET NULL,
      met_at TEXT NOT NULL,            -- ISO 8601, local time of the phone
      lat REAL, lng REAL, accuracy_m REAL,
      note TEXT,
      follow_up_on TEXT
    )`,
    `CREATE INDEX encounters_met_at ON encounters(met_at)`,
    `CREATE INDEX encounters_contact ON encounters(contact_id)`,
    // Text units for retrieval: one per contact profile and one per encounter note.
    `CREATE TABLE chunks (
      id INTEGER PRIMARY KEY,
      contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      encounter_id INTEGER REFERENCES encounters(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('profile','encounter')),
      text TEXT NOT NULL,
      embedded INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE UNIQUE INDEX chunks_owner ON chunks(contact_id, kind, ifnull(encounter_id, 0))`,
    `CREATE VIRTUAL TABLE chunks_fts USING fts5(text, content='chunks', content_rowid='id', tokenize='porter unicode61 remove_diacritics 2')`,
    `CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
       INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text); END`,
    `CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
       INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.id, old.text); END`,
    `CREATE TRIGGER chunks_au AFTER UPDATE OF text ON chunks BEGIN
       INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
       INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text); END`,
  ],
];

// Created separately so tests can run without the sqlite-vec extension.
const VEC_TABLE = `CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vec USING vec0(embedding float[${EMBED_DIM}])`;

export async function migrate(db: SqlDb): Promise<void> {
  await db.execute('PRAGMA foreign_keys = ON');
  const { rows } = await db.execute('PRAGMA user_version');
  const current = Number(rows[0]?.user_version ?? 0);
  for (let v = current; v < MIGRATIONS.length; v++) {
    await db.execute('BEGIN');
    try {
      for (const stmt of MIGRATIONS[v]) await db.execute(stmt);
      await db.execute(`PRAGMA user_version = ${v + 1}`);
      await db.execute('COMMIT');
    } catch (e) {
      await db.execute('ROLLBACK');
      throw e;
    }
  }
  if (db.hasVec) await db.execute(VEC_TABLE);
}
