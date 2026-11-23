import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DB = DatabaseSync;

// Each entry runs once, in order; PRAGMA user_version records how many have run.
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE contacts (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT '',
    company    TEXT NOT NULL DEFAULT '',
    email      TEXT NOT NULL DEFAULT '',
    email_norm TEXT NOT NULL DEFAULT '',
    phone      TEXT NOT NULL DEFAULT '',
    phone_norm TEXT NOT NULL DEFAULT '',
    telegram   TEXT NOT NULL DEFAULT '',
    linkedin   TEXT NOT NULL DEFAULT '',
    notes      TEXT NOT NULL DEFAULT '',
    tags       TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX contacts_email ON contacts(email_norm);
  CREATE INDEX contacts_phone ON contacts(phone_norm);

  CREATE TABLE events (
    id               INTEGER PRIMARY KEY,
    title            TEXT NOT NULL,
    date             TEXT NOT NULL,
    start            TEXT NOT NULL DEFAULT '',
    end              TEXT NOT NULL DEFAULT '',
    place            TEXT NOT NULL DEFAULT '',
    url              TEXT NOT NULL DEFAULT '',
    status           TEXT NOT NULL DEFAULT 'planeado' CHECK (status IN ('planeado','hecho','cancelado')),
    desc             TEXT NOT NULL DEFAULT '',
    cal_block_uid    TEXT,
    cal_block_synced INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX events_date ON events(date);

  CREATE TABLE event_guests (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    cid      INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    st       TEXT NOT NULL DEFAULT 'invitado' CHECK (st IN ('invitado','confirmado','asistió','no vino')),
    PRIMARY KEY (event_id, cid)
  );
  CREATE INDEX event_guests_cid ON event_guests(cid);

  CREATE TABLE interactions (
    id       INTEGER PRIMARY KEY,
    cid      INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    date     TEXT NOT NULL,
    ch       TEXT NOT NULL CHECK (ch IN ('reunion','llamada','email','mensaje','evento','cal')),
    text     TEXT NOT NULL DEFAULT '',
    follow   TEXT,
    event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
    cal_type TEXT
  );
  CREATE INDEX interactions_cid ON interactions(cid, date);

  CREATE TABLE relations (
    id   INTEGER PRIMARY KEY,
    a    INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    b    INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT '',
    date TEXT,
    CHECK (a <> b)
  );
  CREATE INDEX relations_a ON relations(a);
  CREATE INDEX relations_b ON relations(b);

  CREATE TABLE projects (
    id       INTEGER PRIMARY KEY,
    title    TEXT NOT NULL,
    desc     TEXT NOT NULL DEFAULT '',
    status   TEXT NOT NULL DEFAULT 'En marcha' CHECK (status IN ('En marcha','En pausa','Hecho')),
    event_id INTEGER REFERENCES events(id) ON DELETE SET NULL
  );

  CREATE TABLE project_people (
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    cid        INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    role       TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (project_id, cid)
  );

  CREATE TABLE tasks (
    id         INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    cid        INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    text       TEXT NOT NULL,
    st         TEXT NOT NULL DEFAULT 'pendiente' CHECK (st IN ('pendiente','enviado','hecho')),
    due        TEXT
  );
  CREATE INDEX tasks_project ON tasks(project_id);
  CREATE INDEX tasks_cid ON tasks(cid);

  -- Filled by Cal.com sync (step 2).
  CREATE TABLE bookings (
    id             INTEGER PRIMARY KEY,
    cal_uid        TEXT UNIQUE,
    cid            INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    date           TEXT NOT NULL,
    start          TEXT NOT NULL,
    end            TEXT NOT NULL,
    type           TEXT NOT NULL DEFAULT '',
    attendee_name  TEXT NOT NULL DEFAULT '',
    attendee_email TEXT NOT NULL DEFAULT '',
    status         TEXT NOT NULL DEFAULT 'accepted'
  );
  CREATE INDEX bookings_date ON bookings(date);

  -- Filled by Google Calendar sync (step 2). Read-only cache.
  CREATE TABLE gcal (
    id    TEXT PRIMARY KEY,
    date  TEXT NOT NULL,
    start TEXT NOT NULL DEFAULT '',
    end   TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    place TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX gcal_date ON gcal(date);

  -- Non-secret preferences only. Keys live in ~/.stolk/.env.
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE sync_state (name TEXT PRIMARY KEY, last_sync TEXT, ok INTEGER, message TEXT);
  `,
  `
  ALTER TABLE contacts ADD COLUMN web TEXT NOT NULL DEFAULT '';
  `,
  `
  -- Interactions created by a sync remember where they came from, so a re-sync never duplicates them.
  ALTER TABLE interactions ADD COLUMN source TEXT;
  ALTER TABLE interactions ADD COLUMN external_id TEXT;
  CREATE UNIQUE INDEX interactions_external ON interactions(source, external_id) WHERE external_id IS NOT NULL;
  ALTER TABLE events ADD COLUMN cal_block_error TEXT;
  ALTER TABLE gcal ADD COLUMN updated_at TEXT;
  `,
  `
  -- Per-event choice to block the slot in Cal.com ("Bloquear esta franja en Cal.com").
  ALTER TABLE events ADD COLUMN block INTEGER NOT NULL DEFAULT 1;
  `,
  `
  -- "Buscar info pública": the last web lookup per person, as suggestions with sources (see enrich.ts).
  CREATE TABLE enrichments (
    cid         INTEGER PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL,
    model       TEXT NOT NULL DEFAULT '',
    confidence  TEXT NOT NULL DEFAULT 'baja',
    summary     TEXT NOT NULL DEFAULT '',
    suggestions TEXT NOT NULL DEFAULT '[]',
    news        TEXT NOT NULL DEFAULT '[]',
    sources     TEXT NOT NULL DEFAULT '[]',
    searches    INTEGER NOT NULL DEFAULT 0,
    cost_usd    REAL NOT NULL DEFAULT 0
  );
  `,
  `
  -- Calendar like Google Calendar: colour categories, and events that span several days.
  -- end_date NULL means the event ends the same day it starts, so every existing event stays as it was.
  CREATE TABLE cal_tags (
    id    INTEGER PRIMARY KEY,
    name  TEXT NOT NULL,
    color TEXT NOT NULL,
    pos   INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO cal_tags (name, color, pos) VALUES ('Trabajo', '#3B6FD4', 0), ('Networking', '#E0703A', 1), ('Personal', '#3E9B5C', 2);
  ALTER TABLE events ADD COLUMN end_date TEXT;
  ALTER TABLE events ADD COLUMN tag_id INTEGER REFERENCES cal_tags(id) ON DELETE SET NULL;
  `,
];

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  // The app and Claude's MCP server can both have the file open; wait for a lock instead of failing.
  db.exec('PRAGMA busy_timeout = 5000;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  migrate(db);
  return db;
}

function migrate(db: DB) {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    tx(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
