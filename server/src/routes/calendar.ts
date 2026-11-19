import type { DB } from '../db.js';
import { Router, bad } from '../http.js';
import { intParam, optDate, todayIso } from '../util.js';

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
    for (const e of db.prepare("SELECT * FROM events WHERE date = ? AND status <> 'cancelado'").all(t) as any[]) {
      items.push({ src: 'event', start: e.start, end: e.end, title: e.title, sub: e.place, id: e.id });
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
    const ev = between('events', from, to);
    const bk = between('bookings', from, to, "status <> 'cancelled'");
    const gc = between('gcal', from, to);
    const follows = db.prepare(`SELECT i.id, i.cid, i.follow AS date, i.text, c.name FROM interactions i JOIN contacts c ON c.id = i.cid
                                WHERE i.follow >= ? AND i.follow <= ? ORDER BY i.follow`).all(from!, to!) as any[];
    return {
      events: (db.prepare(ev.sql).all(...ev.args) as any[]).map((e) => ({
        id: e.id, title: e.title, date: e.date, start: e.start, end: e.end, place: e.place, status: e.status,
      })),
      bookings: (db.prepare(bk.sql).all(...bk.args) as any[]).map(mapBooking),
      gcal: (db.prepare(gc.sql).all(...gc.args) as any[]).map(mapGcal),
      follows: follows.map((f) => ({ interactionId: f.id, cid: f.cid, name: f.name, date: f.date, text: f.text })),
    };
  });
}
