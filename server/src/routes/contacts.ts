import type { DB } from '../db.js';
import { Router, notFound, bad } from '../http.js';
import { daysBetween, fold, intParam, normEmail, normPhone, similarity, todayIso, validate, type Spec } from '../util.js';
import { mapInteraction } from './interactions.js';
import { relationsFor } from './relations.js';
import { mapBooking } from './calendar.js';

const SPEC: Spec = {
  name: { kind: 'string', required: true },
  role: { kind: 'string' },
  company: { kind: 'string' },
  email: { kind: 'string' },
  phone: { kind: 'string' },
  telegram: { kind: 'string' },
  linkedin: { kind: 'string' },
  web: { kind: 'string' },
  notes: { kind: 'string' },
  tags: { kind: 'tags' },
};
const FIELDS = Object.keys(SPEC);
export const STALE_DAYS = 60;

export function mapContact(r: any, lastContact: string | null = null) {
  return {
    id: r.id, name: r.name, role: r.role, company: r.company, email: r.email, phone: r.phone,
    telegram: r.telegram, linkedin: r.linkedin, web: r.web, tags: JSON.parse(r.tags), notes: r.notes,
    lastContact, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function lastContacts(db: DB, today: string): Map<number, string> {
  const rows = db.prepare('SELECT cid, MAX(date) AS d FROM interactions WHERE date <= ? GROUP BY cid').all(today) as any[];
  return new Map(rows.map((r) => [r.cid, r.d]));
}

export function getContact(db: DB, id: number) {
  const r = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
  if (!r) throw notFound('Contact not found');
  return r as any;
}

function columns(v: Record<string, any>) {
  const cols: Record<string, any> = {};
  for (const k of FIELDS) if (k in v) cols[k] = k === 'tags' ? JSON.stringify(v[k]) : v[k];
  if ('email' in v) cols.email_norm = normEmail(v.email);
  if ('phone' in v) cols.phone_norm = normPhone(v.phone);
  return cols;
}

export function contactRoutes(r: Router, db: DB, now: () => Date) {
  r.get('/contacts', ({ query }) => {
    const today = todayIso(now());
    const last = lastContacts(db, today);
    const q = fold(query.get('q') ?? '');
    const tag = query.get('tag');
    const filter = query.get('filter');
    const withFollow = filter === 'seguimiento'
      ? new Set((db.prepare('SELECT DISTINCT cid FROM interactions WHERE follow IS NOT NULL').all() as any[]).map((x) => x.cid))
      : null;
    const rows = db.prepare('SELECT * FROM contacts').all() as any[];
    return rows
      .map((row) => mapContact(row, last.get(row.id) ?? null))
      .filter((c) => {
        if (tag && !c.tags.includes(tag)) return false;
        if (withFollow && !withFollow.has(c.id)) return false;
        if (filter === 'sin-contacto' && !(c.lastContact && daysBetween(c.lastContact, today) >= STALE_DAYS)) return false;
        if (q && !fold([c.name, c.company, c.role, c.tags.join(' '), c.notes, c.email, c.web].join(' ')).includes(q)) return false;
        return true;
      })
      .sort((a, b) => (b.lastContact ?? '').localeCompare(a.lastContact ?? '') || a.name.localeCompare(b.name));
  });

  // Dedupe lookup for captures. Registered before /contacts/:id so "match" is not read as an id.
  r.get('/contacts/match', ({ query }) => {
    const email = normEmail(query.get('email') ?? '');
    const phone = normPhone(query.get('phone') ?? '');
    const name = query.get('name') ?? '';
    if (!email && !phone && !name.trim()) throw bad('Give at least one of email, phone or name');
    const out = new Map<number, { contact: any; score: number; matchedOn: string }>();
    const put = (row: any, score: number, on: string) => {
      const prev = out.get(row.id);
      if (!prev || prev.score < score) out.set(row.id, { contact: mapContact(row), score, matchedOn: on });
    };
    if (email) for (const row of db.prepare('SELECT * FROM contacts WHERE email_norm = ?').all(email)) put(row, 1, 'email');
    if (phone.length >= 6) for (const row of db.prepare('SELECT * FROM contacts WHERE phone_norm = ?').all(phone)) put(row, 0.95, 'phone');
    if (name.trim()) {
      for (const row of db.prepare('SELECT * FROM contacts').all() as any[]) {
        const s = fold(row.name) === fold(name) ? 0.9 : similarity(row.name, name) * 0.8;
        if (s >= 0.4) put(row, Math.round(s * 100) / 100, 'name');
      }
    }
    return [...out.values()].sort((a, b) => b.score - a.score).slice(0, 10);
  });

  r.get('/contacts/:id', ({ params }) => {
    const id = intParam(params.id);
    const today = todayIso(now());
    const row = getContact(db, id);
    const last = (db.prepare('SELECT MAX(date) AS d FROM interactions WHERE cid = ? AND date <= ?').get(id, today) as any).d ?? null;
    return {
      ...mapContact(row, last),
      interactions: (db.prepare('SELECT * FROM interactions WHERE cid = ? ORDER BY date DESC, id DESC').all(id) as any[]).map(mapInteraction),
      bookings: (db.prepare('SELECT * FROM bookings WHERE cid = ? AND date >= ? ORDER BY date, start').all(id, today) as any[]).map(mapBooking),
      events: (db.prepare(`SELECT e.id, e.title, e.date, e.start, g.st FROM event_guests g JOIN events e ON e.id = g.event_id
                           WHERE g.cid = ? ORDER BY e.date DESC`).all(id) as any[]).map((e) => ({ ...e })),
      projects: (db.prepare(`SELECT p.id, p.title, p.status, pp.role FROM project_people pp JOIN projects p ON p.id = pp.project_id
                             WHERE pp.cid = ? ORDER BY p.id DESC`).all(id) as any[]).map((p) => ({ ...p })),
      relations: relationsFor(db, id),
    };
  });

  r.post('/contacts', ({ body }) => {
    const v = validate(body, SPEC);
    const cols = columns({ role: '', company: '', email: '', phone: '', telegram: '', linkedin: '', web: '', notes: '', tags: [], ...v });
    const keys = Object.keys(cols);
    const res = db.prepare(`INSERT INTO contacts (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => cols[k]));
    return mapContact(getContact(db, Number(res.lastInsertRowid)));
  });

  r.patch('/contacts/:id', ({ params, body }) => {
    const id = intParam(params.id);
    getContact(db, id);
    const cols = columns(validate(body, SPEC, true));
    const keys = Object.keys(cols);
    if (keys.length) {
      db.prepare(`UPDATE contacts SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
        .run(...keys.map((k) => cols[k]), id);
    }
    return mapContact(getContact(db, id));
  });

  r.delete('/contacts/:id', ({ params }) => {
    const id = intParam(params.id);
    getContact(db, id);
    db.prepare('DELETE FROM contacts WHERE id = ?').run(id);
  });
}
