import type { DB } from '../db.js';
import { Router, notFound, bad } from '../http.js';
import { intParam, validate, type Spec } from '../util.js';

const SPEC: Spec = {
  a: { kind: 'int', required: true },
  b: { kind: 'int', required: true },
  kind: { kind: 'string' },
  date: { kind: 'date', nullable: true },
};

export function mapRelation(r: any) {
  const out: any = { id: r.id, a: r.a, b: r.b, kind: r.kind };
  if (r.date) out.date = r.date;
  return out;
}

export function relationsFor(db: DB, cid: number) {
  return (db.prepare('SELECT * FROM relations WHERE a = ? OR b = ? ORDER BY id').all(cid, cid) as any[]).map(mapRelation);
}

function get(db: DB, id: number) {
  const r = db.prepare('SELECT * FROM relations WHERE id = ?').get(id);
  if (!r) throw notFound('Relation not found');
  return r;
}

export function relationRoutes(r: Router, db: DB) {
  r.get('/relations', ({ query }) => {
    const cid = query.get('cid');
    if (cid) return relationsFor(db, intParam(cid, 'cid'));
    return (db.prepare('SELECT * FROM relations ORDER BY id').all() as any[]).map(mapRelation);
  });

  r.post('/relations', ({ body }) => {
    const v = validate(body, SPEC);
    if (v.a === v.b) throw bad('A relation needs two different people');
    const res = db.prepare('INSERT INTO relations (a, b, kind, date) VALUES (?, ?, ?, ?)').run(v.a, v.b, v.kind ?? '', v.date ?? null);
    return mapRelation(get(db, Number(res.lastInsertRowid)));
  });

  r.patch('/relations/:id', ({ params, body }) => {
    const id = intParam(params.id);
    const cur: any = get(db, id);
    const v = { ...cur, ...validate(body, SPEC, true) };
    if (v.a === v.b) throw bad('A relation needs two different people');
    db.prepare('UPDATE relations SET a = ?, b = ?, kind = ?, date = ? WHERE id = ?').run(v.a, v.b, v.kind, v.date ?? null, id);
    return mapRelation(get(db, id));
  });

  r.delete('/relations/:id', ({ params }) => {
    const id = intParam(params.id);
    get(db, id);
    db.prepare('DELETE FROM relations WHERE id = ?').run(id);
  });
}
