import { tx, type DB } from '../db.js';
import { Router, notFound, bad } from '../http.js';
import { intParam, optDate, similarity, validate, type Spec } from '../util.js';
import { getContact } from './contacts.js';

const GUEST_ST = ['invitado', 'confirmado', 'asistió', 'no vino'] as const;
const SPEC: Spec = {
  title: { kind: 'string', required: true },
  date: { kind: 'date', required: true },
  start: { kind: 'time' },
  end: { kind: 'time' },
  place: { kind: 'string' },
  url: { kind: 'string' },
  status: { kind: { enum: ['planeado', 'hecho', 'cancelado'] } },
  desc: { kind: 'string' },
};
const FIELDS = ['title', 'date', 'start', 'end', 'place', 'url', 'status', 'desc'];

export function mapEvent(db: DB, r: any) {
  const guests = (db.prepare('SELECT cid, st FROM event_guests WHERE event_id = ? ORDER BY rowid').all(r.id) as any[]).map((g) => ({ cid: g.cid, st: g.st }));
  return {
    id: r.id, title: r.title, date: r.date, start: r.start, end: r.end, place: r.place,
    url: r.url || undefined, status: r.status, desc: r.desc, guests,
    calBlock: r.cal_block_uid ? { uid: r.cal_block_uid, synced: !!r.cal_block_synced } : null,
  };
}

export function getEvent(db: DB, id: number) {
  const r = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  if (!r) throw notFound('Event not found');
  return r as any;
}

function parseGuests(v: unknown): { cid: number; st: string }[] {
  if (!Array.isArray(v)) throw bad('guests must be a list of {cid, st}');
  return v.map((g) => {
    if (!g || !Number.isInteger(g.cid)) throw bad('Each guest needs an integer cid');
    const st = g.st ?? 'invitado';
    if (!GUEST_ST.includes(st)) throw bad(`Guest st must be one of: ${GUEST_ST.join(', ')}`);
    return { cid: g.cid, st };
  });
}

/**
 * People likely to come to an event, from Ivan's own data only:
 * past attendance at similar events (title or place), membership in the event's project,
 * relations with people already confirmed, and tags shared with the guest list.
 */
export function likelyGuests(db: DB, eventId: number) {
  const ev = getEvent(db, eventId);
  const already = new Set((db.prepare('SELECT cid FROM event_guests WHERE event_id = ?').all(eventId) as any[]).map((g) => g.cid));
  const scores = new Map<number, { score: number; reasons: string[] }>();
  const add = (cid: number, s: number, why: string) => {
    if (already.has(cid)) return;
    const cur = scores.get(cid) ?? { score: 0, reasons: [] };
    cur.score += s;
    if (!cur.reasons.includes(why)) cur.reasons.push(why);
    scores.set(cid, cur);
  };

  const others = db.prepare('SELECT * FROM events WHERE id <> ?').all(eventId) as any[];
  for (const o of others) {
    const sameTitle = similarity(o.title, ev.title) >= 0.5;
    const samePlace = !!ev.place && !!o.place && similarity(o.place, ev.place) >= 0.5;
    if (!sameTitle && !samePlace) continue;
    const went = db.prepare("SELECT cid, st FROM event_guests WHERE event_id = ? AND st IN ('asistió','confirmado')").all(o.id) as any[];
    for (const g of went) add(g.cid, g.st === 'asistió' ? 2 : 1, sameTitle ? `Fue a ${o.title}` : `Estuvo en ${o.place}`);
  }

  const proj = db.prepare(`SELECT pp.cid, pp.role, p.title FROM projects p JOIN project_people pp ON pp.project_id = p.id
                           WHERE p.event_id = ?`).all(eventId) as any[];
  for (const p of proj) add(p.cid, 3, `En el proyecto ${p.title}${p.role ? ` (${p.role})` : ''}`);

  const confirmed = (db.prepare("SELECT cid FROM event_guests WHERE event_id = ? AND st IN ('confirmado','asistió')").all(eventId) as any[]).map((g) => g.cid);
  for (const cid of confirmed) {
    const name = (db.prepare('SELECT name FROM contacts WHERE id = ?').get(cid) as any)?.name;
    for (const rel of db.prepare('SELECT a, b FROM relations WHERE a = ? OR b = ?').all(cid, cid) as any[]) {
      add(rel.a === cid ? rel.b : rel.a, 1, `Relación con ${name}, que viene`);
    }
  }

  const guestTags = new Map<string, number>();
  for (const cid of already) {
    for (const t of JSON.parse((db.prepare('SELECT tags FROM contacts WHERE id = ?').get(cid) as any)?.tags ?? '[]')) {
      guestTags.set(t, (guestTags.get(t) ?? 0) + 1);
    }
  }
  if (guestTags.size) {
    for (const c of db.prepare('SELECT id, tags FROM contacts').all() as any[]) {
      const shared = (JSON.parse(c.tags) as string[]).filter((t) => (guestTags.get(t) ?? 0) >= 2);
      if (shared.length && scores.has(c.id)) add(c.id, 0.5 * shared.length, `Etiqueta común: ${shared.join(', ')}`);
    }
  }

  return [...scores.entries()]
    .map(([cid, s]) => ({ cid, score: Math.round(s.score * 10) / 10, reasons: s.reasons }))
    .sort((a, b) => b.score - a.score || a.cid - b.cid)
    .slice(0, 20);
}

export function eventRoutes(r: Router, db: DB) {
  r.get('/events', ({ query }) => {
    const from = optDate(query, 'from'), to = optDate(query, 'to');
    const where: string[] = [];
    const args: string[] = [];
    if (from) { where.push('date >= ?'); args.push(from); }
    if (to) { where.push('date <= ?'); args.push(to); }
    const rows = db.prepare(`SELECT * FROM events ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY date, start`).all(...args);
    return rows.map((e) => mapEvent(db, e));
  });

  r.get('/events/:id', ({ params }) => mapEvent(db, getEvent(db, intParam(params.id))));

  r.get('/events/:id/likely-guests', ({ params }) => likelyGuests(db, intParam(params.id)));

  r.post('/events', ({ body }) => {
    const { guests: rawGuests, ...rest } = body ?? {};
    const guests = rawGuests !== undefined ? parseGuests(rawGuests) : [];
    const v = validate(rest, SPEC);
    return tx(db, () => {
      const keys = FIELDS.filter((k) => k in v);
      const res = db.prepare(`INSERT INTO events (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => v[k]));
      const id = Number(res.lastInsertRowid);
      const ins = db.prepare('INSERT INTO event_guests (event_id, cid, st) VALUES (?, ?, ?)');
      for (const g of guests) ins.run(id, g.cid, g.st);
      return mapEvent(db, getEvent(db, id));
    });
  });

  r.patch('/events/:id', ({ params, body }) => {
    const id = intParam(params.id);
    getEvent(db, id);
    if (body && 'guests' in body) throw bad('Change guests with PUT/DELETE /events/:id/guests/:cid');
    const v = validate(body, SPEC, true);
    const keys = FIELDS.filter((k) => k in v);
    if (keys.length) db.prepare(`UPDATE events SET ${keys.map((k) => `${k} = ?`).join(', ')}, cal_block_synced = 0 WHERE id = ?`).run(...keys.map((k) => v[k]), id);
    return mapEvent(db, getEvent(db, id));
  });

  r.delete('/events/:id', ({ params }) => {
    const id = intParam(params.id);
    getEvent(db, id);
    db.prepare('DELETE FROM events WHERE id = ?').run(id);
  });

  r.put('/events/:id/guests/:cid', ({ params, body }) => {
    const id = intParam(params.id);
    const cid = intParam(params.cid, 'cid');
    getEvent(db, id);
    getContact(db, cid);
    const [g] = parseGuests([{ cid, st: body?.st }]);
    db.prepare('INSERT INTO event_guests (event_id, cid, st) VALUES (?, ?, ?) ON CONFLICT(event_id, cid) DO UPDATE SET st = excluded.st').run(id, cid, g.st);
    return mapEvent(db, getEvent(db, id));
  });

  r.delete('/events/:id/guests/:cid', ({ params }) => {
    const id = intParam(params.id);
    const cid = intParam(params.cid, 'cid');
    getEvent(db, id);
    const res = db.prepare('DELETE FROM event_guests WHERE event_id = ? AND cid = ?').run(id, cid);
    if (!res.changes) throw notFound('Guest not found');
  });
}
