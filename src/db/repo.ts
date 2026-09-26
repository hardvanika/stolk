import type { Coords, SqlDb } from './types';
import { matchPlace, type Place } from '../geo/geo';

export type CaptureInput = {
  fullName: string;
  linkedinUrl?: string;
  company?: string;
  role?: string;
  headline?: string;
  note?: string;
  eventName?: string;
  placeName?: string; // names the current spot as a place if no saved place matches
  coords?: Coords | null;
  metAt?: Date;
};

const clean = (s?: string | null) => (s && s.trim() ? s.trim() : null);

export function normalizeLinkedin(url?: string | null): string | null {
  const u = clean(url);
  if (!u) return null;
  const m = u.match(/linkedin\.com\/in\/([^/?#\s]+)/i);
  return m ? `https://www.linkedin.com/in/${m[1].toLowerCase()}` : u;
}

/** Local ISO timestamp without timezone suffix, so "March" means March where you were. */
export function localIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function upsertContact(db: SqlDb, i: CaptureInput): Promise<number> {
  const li = normalizeLinkedin(i.linkedinUrl);
  const existing = li
    ? await db.execute('SELECT id FROM contacts WHERE lower(linkedin_url) = lower(?)', [li])
    : await db.execute('SELECT id FROM contacts WHERE lower(full_name) = lower(?) AND linkedin_url IS NULL', [i.fullName.trim()]);
  const id = existing.rows[0]?.id as number | undefined;
  if (id) {
    await db.execute(
      `UPDATE contacts SET company = coalesce(?, company), role = coalesce(?, role),
         headline = coalesce(?, headline), updated_at = datetime('now') WHERE id = ?`,
      [clean(i.company), clean(i.role), clean(i.headline), id],
    );
    return id;
  }
  const r = await db.execute(
    'INSERT INTO contacts (full_name, linkedin_url, company, role, headline) VALUES (?, ?, ?, ?, ?)',
    [i.fullName.trim(), li, clean(i.company), clean(i.role), clean(i.headline)],
  );
  return Number(r.insertId);
}

async function upsertEvent(db: SqlDb, name: string | null, day: string): Promise<number | null> {
  if (!name) return null;
  await db.execute('INSERT OR IGNORE INTO events (name, starts_on, ends_on) VALUES (?, ?, ?)', [name, day, day]);
  await db.execute(
    `UPDATE events SET starts_on = min(ifnull(starts_on, ?), ?), ends_on = max(ifnull(ends_on, ?), ?) WHERE name = ?`,
    [day, day, day, day, name],
  );
  const r = await db.execute('SELECT id FROM events WHERE name = ?', [name]);
  return r.rows[0].id as number;
}

export async function listPlaces(db: SqlDb): Promise<Place[]> {
  return (await db.execute('SELECT id, name, lat, lng, radius_m FROM places')).rows as Place[];
}

async function resolvePlace(db: SqlDb, coords: Coords | null | undefined, name: string | null): Promise<number | null> {
  if (!coords) return null;
  const hit = matchPlace(await listPlaces(db), coords);
  if (hit) return hit.id;
  if (!name) return null;
  const r = await db.execute('INSERT INTO places (name, lat, lng) VALUES (?, ?, ?)', [name, coords.lat, coords.lng]);
  return Number(r.insertId);
}

/** Text that represents a contact for search; kept deliberately to professional fields. */
export function profileText(c: { full_name: unknown; headline?: unknown; role?: unknown; company?: unknown; notes?: unknown }) {
  return [c.full_name, c.headline, [c.role, c.company].filter(Boolean).join(' at '), c.notes]
    .filter((x) => typeof x === 'string' && x.trim())
    .join('. ');
}

async function upsertChunk(db: SqlDb, contactId: number, kind: 'profile' | 'encounter', encounterId: number | null, text: string) {
  const found = await db.execute(
    'SELECT id, text FROM chunks WHERE contact_id = ? AND kind = ? AND ifnull(encounter_id, 0) = ?',
    [contactId, kind, encounterId ?? 0],
  );
  const row = found.rows[0];
  if (!row) {
    await db.execute('INSERT INTO chunks (contact_id, encounter_id, kind, text) VALUES (?, ?, ?, ?)', [contactId, encounterId, kind, text]);
  } else if (row.text !== text) {
    await db.execute('UPDATE chunks SET text = ?, embedded = 0 WHERE id = ?', [text, row.id as number]);
  }
}

/** One tap at an event: contact + where/when + note. Returns the encounter id. */
export async function saveCapture(db: SqlDb, i: CaptureInput): Promise<number> {
  const metAt = localIso(i.metAt ?? new Date());
  await db.execute('BEGIN');
  try {
    const contactId = await upsertContact(db, i);
    const eventId = await upsertEvent(db, clean(i.eventName), metAt.slice(0, 10));
    const placeId = await resolvePlace(db, i.coords, clean(i.placeName));
    const enc = await db.execute(
      `INSERT INTO encounters (contact_id, event_id, place_id, met_at, lat, lng, accuracy_m, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [contactId, eventId, placeId, metAt, i.coords?.lat ?? null, i.coords?.lng ?? null, i.coords?.accuracy ?? null, clean(i.note)],
    );
    const encounterId = Number(enc.insertId);
    const c = (await db.execute('SELECT * FROM contacts WHERE id = ?', [contactId])).rows[0];
    await upsertChunk(db, contactId, 'profile', null, profileText(c as any));
    const note = clean(i.note);
    if (note) await upsertChunk(db, contactId, 'encounter', encounterId, note);
    await db.execute('COMMIT');
    return encounterId;
  } catch (e) {
    await db.execute('ROLLBACK');
    throw e;
  }
}

/** Embeds any chunk not yet in the vector index. Safe to call repeatedly (e.g. after the model downloads). */
export async function embedPending(db: SqlDb, embed: (text: string) => Promise<number[]>): Promise<number> {
  if (!db.hasVec) return 0;
  const { rows } = await db.execute('SELECT id, text FROM chunks WHERE embedded = 0 LIMIT 500');
  for (const r of rows) {
    const v = await embed(r.text as string);
    await db.execute('DELETE FROM chunk_vec WHERE rowid = ?', [r.id as number]);
    await db.execute('INSERT INTO chunk_vec (rowid, embedding) VALUES (?, ?)', [r.id as number, JSON.stringify(v)]);
    await db.execute('UPDATE chunks SET embedded = 1 WHERE id = ?', [r.id as number]);
  }
  return rows.length;
}

export async function recentEncounters(db: SqlDb, limit = 50) {
  return (
    await db.execute(
      `SELECT e.id, e.met_at, e.note, c.id AS contact_id, c.full_name, c.company, c.role, c.linkedin_url,
              ev.name AS event_name, p.name AS place_name
       FROM encounters e JOIN contacts c ON c.id = e.contact_id
       LEFT JOIN events ev ON ev.id = e.event_id LEFT JOIN places p ON p.id = e.place_id
       ORDER BY e.met_at DESC LIMIT ?`,
      [limit],
    )
  ).rows;
}
