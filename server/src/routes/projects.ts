import { tx, type DB } from '../db.js';
import { Router, notFound, bad } from '../http.js';
import { intParam, validate, type Spec } from '../util.js';
import { getContact } from './contacts.js';

const P_SPEC: Spec = {
  title: { kind: 'string', required: true },
  desc: { kind: 'string' },
  status: { kind: { enum: ['En marcha', 'En pausa', 'Hecho'] } },
  eventId: { kind: 'int', nullable: true },
};
const TASK_ST = ['pendiente', 'enviado', 'hecho'] as const;
const T_SPEC: Spec = {
  cid: { kind: 'int', nullable: true },
  text: { kind: 'string', required: true },
  st: { kind: { enum: TASK_ST } },
  due: { kind: 'date', nullable: true },
};

export function mapTask(t: any) {
  const out: any = { id: t.id, projectId: t.project_id, cid: t.cid, text: t.text, st: t.st };
  if (t.due) out.due = t.due;
  return out;
}

export function mapProject(db: DB, p: any) {
  const out: any = {
    id: p.id, title: p.title, desc: p.desc, status: p.status,
    people: (db.prepare('SELECT cid, role FROM project_people WHERE project_id = ? ORDER BY rowid').all(p.id) as any[]).map((x) => ({ cid: x.cid, role: x.role })),
    tasks: (db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY id').all(p.id) as any[]).map(mapTask),
  };
  if (p.event_id) out.eventId = p.event_id;
  return out;
}

function getProject(db: DB, id: number) {
  const r = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!r) throw notFound('Project not found');
  return r as any;
}
function getTask(db: DB, id: number) {
  const r = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!r) throw notFound('Task not found');
  return r as any;
}

export function projectRoutes(r: Router, db: DB) {
  r.get('/projects', () => (db.prepare('SELECT * FROM projects ORDER BY id').all() as any[]).map((p) => mapProject(db, p)));
  r.get('/projects/:id', ({ params }) => mapProject(db, getProject(db, intParam(params.id))));

  r.post('/projects', ({ body }) => {
    const { people, ...rest } = body ?? {};
    const v = validate(rest, P_SPEC);
    if (people !== undefined && !Array.isArray(people)) throw bad('people must be a list of {cid, role}');
    return tx(db, () => {
      const res = db.prepare('INSERT INTO projects (title, desc, status, event_id) VALUES (?, ?, ?, ?)')
        .run(v.title, v.desc ?? '', v.status ?? 'En marcha', v.eventId ?? null);
      const id = Number(res.lastInsertRowid);
      for (const p of people ?? []) {
        if (!Number.isInteger(p?.cid)) throw bad('Each person needs an integer cid');
        db.prepare('INSERT INTO project_people (project_id, cid, role) VALUES (?, ?, ?)').run(id, p.cid, typeof p.role === 'string' ? p.role : '');
      }
      return mapProject(db, getProject(db, id));
    });
  });

  r.patch('/projects/:id', ({ params, body }) => {
    const id = intParam(params.id);
    getProject(db, id);
    if (body && ('people' in body || 'tasks' in body)) throw bad('Change people and tasks through their own endpoints');
    const v = validate(body, P_SPEC, true);
    const col: Record<string, string> = { eventId: 'event_id' };
    const keys = Object.keys(v);
    if (keys.length) db.prepare(`UPDATE projects SET ${keys.map((k) => `${col[k] ?? k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => v[k]), id);
    return mapProject(db, getProject(db, id));
  });

  r.delete('/projects/:id', ({ params }) => {
    const id = intParam(params.id);
    getProject(db, id);
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  });

  r.put('/projects/:id/people/:cid', ({ params, body }) => {
    const id = intParam(params.id);
    const cid = intParam(params.cid, 'cid');
    getProject(db, id);
    getContact(db, cid);
    const role = body?.role ?? '';
    if (typeof role !== 'string') throw bad('role must be a string');
    db.prepare('INSERT INTO project_people (project_id, cid, role) VALUES (?, ?, ?) ON CONFLICT(project_id, cid) DO UPDATE SET role = excluded.role').run(id, cid, role);
    return mapProject(db, getProject(db, id));
  });

  r.delete('/projects/:id/people/:cid', ({ params }) => {
    const id = intParam(params.id);
    const cid = intParam(params.cid, 'cid');
    getProject(db, id);
    const res = db.prepare('DELETE FROM project_people WHERE project_id = ? AND cid = ?').run(id, cid);
    if (!res.changes) throw notFound('Person not in project');
  });

  r.post('/projects/:id/tasks', ({ params, body }) => {
    const id = intParam(params.id);
    getProject(db, id);
    const v = validate(body, T_SPEC);
    const res = db.prepare('INSERT INTO tasks (project_id, cid, text, st, due) VALUES (?, ?, ?, ?, ?)')
      .run(id, v.cid ?? null, v.text, v.st ?? 'pendiente', v.due ?? null);
    return mapTask(getTask(db, Number(res.lastInsertRowid)));
  });

  r.get('/tasks', ({ query }) => {
    const where: string[] = [];
    const args: any[] = [];
    if (query.get('cid')) { where.push('cid = ?'); args.push(intParam(query.get('cid')!, 'cid')); }
    const st = query.get('st');
    if (st) {
      if (!TASK_ST.includes(st as any)) throw bad(`st must be one of: ${TASK_ST.join(', ')}`);
      where.push('st = ?'); args.push(st);
    }
    return (db.prepare(`SELECT * FROM tasks ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY due IS NULL, due, id`).all(...args) as any[]).map(mapTask);
  });

  r.patch('/tasks/:id', ({ params, body }) => {
    const id = intParam(params.id);
    getTask(db, id);
    const v = validate(body, T_SPEC, true);
    const keys = Object.keys(v);
    if (keys.length) db.prepare(`UPDATE tasks SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => v[k]), id);
    return mapTask(getTask(db, id));
  });

  r.delete('/tasks/:id', ({ params }) => {
    const id = intParam(params.id);
    getTask(db, id);
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  });
}
