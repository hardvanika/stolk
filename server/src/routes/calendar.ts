import type { DB } from '../db.js';
import { Router, bad, notFound } from '../http.js';
import { intParam, optDate, todayIso, validate, type Spec } from '../util.js';
import { overlapping } from './events.js';

// Colour categories for Stölk events, like Google Calendar's event colours but with a name.
const HEX = /^#[0-9a-fA-F]{6}$/;
const TAG_SPEC: Spec = { name: { kind: 'string', required: true }, color: { kind: 'string', required: true }, pos: { kind: 'int' } };
const mapTag = (t: any) => ({ id: t.id, name: t.name, color: t.color, pos: t.pos });
function checkTag(v: Record<string, any>) {
  if ('name' in v) { v.name = v.name.trim(); if (!v.name) throw bad('Field name cannot be empty'); if (v.name.length > 40) throw bad('Field name is too long'); }
  if ('color' in v) { if (!HEX.test(v.color)) throw bad('Field color must be #RRGGBB'); v.color = v.color.toUpperCase(); }
  return v;
}

export function mapBooking(b: any) {
  return {
    id: b.id, cid: b.cid ?? null, date: b.date, start: b.start, end: b.end, type: b.type,
    attendeeName: b.attendee_name, attendeeEmail: b.attendee_email, status: b.status, calUid: b.cal_uid,
  };
}
const mapGcal = (g: any) => ({ id: g.id, date: g.date, start: g.start, end: g.end, title: g.title, place: g.place });

function range(q: URLSearchParams, required: boolean) {
  const from = optDate(q, 'from'), to = optDate(q, 'to');
  if (required && (!from || !to)) throw bad('Give from and to as YYYY-MM-DD');
  if (from && to && from > to) throw bad('from must be on or before to');
  return { from, to };
}

function between(table: string, from?: string, to?: string, extra = '', extraArgs: any[] = []) {
  const where: string[] = [];
  const args: any[] = [];
  if (from) { where.push('date >= ?'); args.push(from); }
  if (to) { where.push('date <= ?'); args.push(to); }
  if (extra) { where.push(extra); args.push(...extraArgs); }
  return { sql: `SELECT * FROM ${table} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY date, start`, args };
}

export function calendarRoutes(r: Router, db: DB, now: () => Date) {
  r.get('/bookings', ({ query }) => {
    const { from, to } = range(query, false);
    const cid = query.get('cid');
    const q = between('bookings', from, to, cid ? 'cid = ?' : '', cid ? [intParam(cid, 'cid')] : []);
    return (db.prepare(q.sql).all(...q.args) as any[]).map(mapBooking);
  });

  r.get('/gcal', ({ query }) => {
    const { from, to } = range(query, false);
    const q = between('gcal', from, to);
    return (db.prepare(q.sql).all(...q.args) as any[]).map(mapGcal);
  });

  // Same shape as the prototype's todayItems().
  r.get('/today', () => {
    const t = todayIso(now());
    const items: any[] = [];
    for (const e of db.prepare("SELECT * FROM events WHERE date <= ? AND COALESCE(end_date, date) >= ? AND status <> 'cancelado'").all(t, t) as any[]) {
      // A day in the middle of a multi-day event has no start or end of its own.
      const first = e.date === t, last = (e.end_date || e.date) === t;
      items.push({ src: 'event', start: first ? e.start : '', end: last ? e.end : '', title: e.title, sub: e.place, id: e.id });
    }
    for (const b of db.prepare(`SELECT b.*, c.name, c.role, c.company FROM bookings b LEFT JOIN contacts c ON c.id = b.cid
                                WHERE b.date = ? AND b.status <> 'cancelled'`).all(t) as any[]) {
      const who = b.name ?? b.attendee_name;
      items.push({
        src: 'cal', start: b.start, end: b.end, title: `${b.type} con ${who}`,
        sub: b.name ? [b.role, b.company].filter(Boolean).join(' · ') : b.attendee_email, id: b.id, cid: b.cid ?? undefined,
      });
    }
    for (const g of db.prepare('SELECT * FROM gcal WHERE date = ?').all(t) as any[]) {
      items.push({ src: 'gcal', start: g.start, end: g.end, title: g.title, sub: g.place });
    }
    return items.sort((a, b) => a.start.localeCompare(b.start));
  });

  r.get('/calendar', ({ query }) => {
    const { from, to } = range(query, true);
    const ev = overlapping(from, to);
    const bk = between('bookings', from, to, "status <> 'cancelled'");
    const gc = between('gcal', from, to);
    const follows = db.prepare(`SELECT i.id, i.cid, i.follow AS date, i.text, c.name FROM interactions i JOIN contacts c ON c.id = i.cid
                                WHERE i.follow >= ? AND i.follow <= ? ORDER BY i.follow`).all(from!, to!) as any[];
    return {
      events: (db.prepare(`SELECT * FROM events ${ev.where} ORDER BY date, start`).all(...ev.args) as any[]).map((e) => ({
        id: e.id, title: e.title, date: e.date, endDate: e.end_date ?? null, start: e.start, end: e.end, place: e.place, status: e.status, tagId: e.tag_id ?? null,
      })),
      bookings: (db.prepare(bk.sql).all(...bk.args) as any[]).map(mapBooking),
      gcal: (db.prepare(gc.sql).all(...gc.args) as any[]).map(mapGcal),
      follows: follows.map((f) => ({ interactionId: f.id, cid: f.cid, name: f.name, date: f.date, text: f.text })),
    };
  });

  r.get('/cal-tags', () => (db.prepare('SELECT * FROM cal_tags ORDER BY pos, id').all() as any[]).map(mapTag));

  r.post('/cal-tags', ({ body }) => {
    const v = checkTag(validate(body, TAG_SPEC));
    const pos = v.pos ?? ((db.prepare('SELECT COALESCE(MAX(pos), -1) + 1 AS p FROM cal_tags').get() as any).p);
    const res = db.prepare('INSERT INTO cal_tags (name, color, pos) VALUES (?, ?, ?)').run(v.name, v.color, pos);
    return mapTag(db.prepare('SELECT * FROM cal_tags WHERE id = ?').get(Number(res.lastInsertRowid)));
  });

  r.patch('/cal-tags/:id', ({ params, body }) => {
    const id = intParam(params.id);
    if (!db.prepare('SELECT 1 FROM cal_tags WHERE id = ?').get(id)) throw notFound('Calendar tag not found');
    const v = checkTag(validate(body, TAG_SPEC, true));
    const keys = Object.keys(v);
    if (keys.length) db.prepare(`UPDATE cal_tags SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => v[k]), id);
    return mapTag(db.prepare('SELECT * FROM cal_tags WHERE id = ?').get(id));
  });

  // Deleting a category keeps its events; they just lose the colour (ON DELETE SET NULL).
  r.delete('/cal-tags/:id', ({ params }) => {
    const res = db.prepare('DELETE FROM cal_tags WHERE id = ?').run(intParam(params.id));
    if (!res.changes) throw notFound('Calendar tag not found');
  });
}
