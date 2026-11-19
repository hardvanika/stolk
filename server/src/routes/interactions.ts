import type { DB } from '../db.js';
import { Router, notFound } from '../http.js';
import { intParam, optDate, todayIso, validate, type Spec } from '../util.js';

const CH = ['reunion', 'llamada', 'email', 'mensaje', 'evento', 'cal'] as const;
const SPEC: Spec = {
  cid: { kind: 'int', required: true },
  date: { kind: 'date', required: true },
  ch: { kind: { enum: CH }, required: true },
  text: { kind: 'string' },
  follow: { kind: 'date', nullable: true },
  eventId: { kind: 'int', nullable: true },
  calType: { kind: 'string', nullable: true },
};
const COL: Record<string, string> = { eventId: 'event_id', calType: 'cal_type' };

export function mapInteraction(r: any) {
  const out: any = { id: r.id, cid: r.cid, date: r.date, ch: r.ch, text: r.text };
  if (r.follow) out.follow = r.follow;
  if (r.event_id) out.eventId = r.event_id;
  if (r.cal_type) out.calType = r.cal_type;
  return out;
}

function get(db: DB, id: number) {
  const r = db.prepare('SELECT * FROM interactions WHERE id = ?').get(id);
  if (!r) throw notFound('Interaction not found');
  return r;
}

export function interactionRoutes(r: Router, db: DB, now: () => Date) {
  r.get('/interactions', ({ query }) => {
    const where: string[] = [];
    const args: any[] = [];
    if (query.get('cid')) { where.push('cid = ?'); args.push(intParam(query.get('cid')!, 'cid')); }
    const from = optDate(query, 'from'), to = optDate(query, 'to');
    if (from) { where.push('date >= ?'); args.push(from); }
    if (to) { where.push('date <= ?'); args.push(to); }
    // "open" follow-ups: set, and today or later (an overdue one is still open until edited away).
    if (query.get('follow') === 'open') where.push('follow IS NOT NULL');
    if (query.get('follow') === 'due') { where.push('follow IS NOT NULL AND follow <= ?'); args.push(todayIso(now())); }
    const sql = `SELECT * FROM interactions ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY date DESC, id DESC`;
    return (db.prepare(sql).all(...args) as any[]).map(mapInteraction);
  });

  r.post('/interactions', ({ body }) => {
    const v = validate(body, SPEC);
    const keys = Object.keys(v);
    const res = db.prepare(`INSERT INTO interactions (${keys.map((k) => COL[k] ?? k).join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
      .run(...keys.map((k) => v[k]));
    return mapInteraction(get(db, Number(res.lastInsertRowid)));
  });

  r.patch('/interactions/:id', ({ params, body }) => {
    const id = intParam(params.id);
    get(db, id);
    const v = validate(body, SPEC, true);
    const keys = Object.keys(v);
    if (keys.length) db.prepare(`UPDATE interactions SET ${keys.map((k) => `${COL[k] ?? k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => v[k]), id);
    return mapInteraction(get(db, id));
  });

  r.delete('/interactions/:id', ({ params }) => {
    const id = intParam(params.id);
    get(db, id);
    db.prepare('DELETE FROM interactions WHERE id = ?').run(id);
  });
}
