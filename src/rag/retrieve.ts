import type { Coords, Row, Scalar, SqlDb } from '../db/types';
import { boundingBox, distanceM } from '../geo/geo';
import type { QueryPlan } from './plan';

export type Hit = {
  encounter_id: number;
  contact_id: number;
  full_name: string;
  company: string | null;
  role: string | null;
  headline: string | null;
  linkedin_url: string | null;
  met_at: string;
  note: string | null;
  event_name: string | null;
  place_name: string | null;
  lat: number | null;
  lng: number | null;
  score: number;
};

export type RetrieveOptions = {
  here?: Coords | null; // current phone position, for "near me"
  nearRadiusM?: number;
  embedQuery?: (text: string) => Promise<number[]>; // local embedding model, if loaded
  limit?: number;
};

const RRF_K = 60;

/** FTS5 query from free text: quoted tokens OR'd, prefix-matched. */
export function ftsQuery(text: string): string | null {
  const toks = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]{3,}/g);
  if (!toks) return null;
  const stop = new Set(['who', 'the', 'and', 'did', 'met', 'meet', 'that', 'with', 'was', 'were', 'what', 'from', 'about', 'people', 'person', 'someone', 'works', 'working']);
  const kept = [...new Set(toks.filter((t) => !stop.has(t)))];
  return kept.length ? kept.map((t) => `"${t}"*`).join(' OR ') : null;
}

/** Contact ids ranked by topic relevance, fusing keyword and vector search (reciprocal rank fusion). */
async function topicScores(db: SqlDb, topic: string, embedQuery?: RetrieveOptions['embedQuery']): Promise<Map<number, number>> {
  const scores = new Map<number, number>();
  const addRanked = (contactIds: number[]) => {
    const seen = new Set<number>();
    let rank = 0;
    for (const id of contactIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + ++rank));
    }
  };
  const fq = ftsQuery(topic);
  if (fq) {
    const r = await db.execute(
      `SELECT c.contact_id FROM chunks_fts f JOIN chunks c ON c.id = f.rowid
       WHERE chunks_fts MATCH ? ORDER BY bm25(chunks_fts) LIMIT 50`,
      [fq],
    );
    addRanked(r.rows.map((x) => x.contact_id as number));
  }
  if (embedQuery && db.hasVec) {
    const v = await embedQuery(topic);
    const r = await db.execute(
      `SELECT c.contact_id FROM chunk_vec v JOIN chunks c ON c.id = v.rowid
       WHERE v.embedding MATCH ? AND k = 30 ORDER BY v.distance`,
      [JSON.stringify(v)],
    );
    addRanked(r.rows.map((x) => x.contact_id as number));
  }
  return scores;
}

export async function retrieve(db: SqlDb, plan: QueryPlan, opts: RetrieveOptions = {}): Promise<Hit[]> {
  const where: string[] = [];
  const params: Scalar[] = [];
  const circles: { center: Coords; radius: number; placeId?: number }[] = [];

  if (plan.event) {
    where.push('ev.name = ?');
    params.push(plan.event);
  }
  if (plan.place) {
    const p = (await db.execute('SELECT id, lat, lng, radius_m FROM places WHERE name = ?', [plan.place])).rows[0];
    if (!p) return [];
    circles.push({ center: { lat: p.lat as number, lng: p.lng as number }, radius: p.radius_m as number, placeId: p.id as number });
  }
  if (plan.near_me && opts.here) circles.push({ center: opts.here, radius: opts.nearRadiusM ?? 1000 });
  for (const c of circles) {
    const b = boundingBox(c.center, c.radius);
    const inBox = 'e.lat BETWEEN ? AND ? AND e.lng BETWEEN ? AND ?';
    if (c.placeId != null) {
      where.push(`(e.place_id = ? OR (${inBox}))`);
      params.push(c.placeId);
    } else where.push(`(${inBox})`);
    params.push(b.minLat, b.maxLat, b.minLng, b.maxLng);
  }
  if (plan.date_from) {
    where.push('e.met_at >= ?');
    params.push(plan.date_from);
  }
  if (plan.date_to) {
    where.push('e.met_at < date(?, \'+1 day\')');
    params.push(plan.date_to);
  }
  if (plan.person) {
    where.push('c.full_name LIKE ?');
    params.push(`%${plan.person}%`);
  }
  if (plan.company) {
    where.push('c.company LIKE ?');
    params.push(`%${plan.company}%`);
  }

  const sql = `SELECT e.id AS encounter_id, c.id AS contact_id, c.full_name, c.company, c.role, c.headline, c.linkedin_url,
      e.met_at, e.note, e.lat, e.lng, e.place_id, ev.name AS event_name, p.name AS place_name
    FROM encounters e JOIN contacts c ON c.id = e.contact_id
    LEFT JOIN events ev ON ev.id = e.event_id LEFT JOIN places p ON p.id = e.place_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY e.met_at DESC LIMIT 500`;
  let rows: Row[] = (await db.execute(sql, params)).rows;

  // Exact circle test after the bounding-box prefilter.
  rows = rows.filter((r) =>
    circles.every((c) =>
      (c.placeId != null && r.place_id === c.placeId) ||
      (r.lat != null && distanceM(c.center, { lat: r.lat as number, lng: r.lng as number }) <= c.radius),
    ),
  );

  let hits = rows.map((r) => ({ ...(r as unknown as Hit), score: 0 }));
  if (plan.topic) {
    const scores = await topicScores(db, plan.topic, opts.embedQuery);
    hits = hits.filter((h) => scores.has(h.contact_id));
    for (const h of hits) h.score = scores.get(h.contact_id)!;
    hits.sort((a, b) => b.score - a.score || b.met_at.localeCompare(a.met_at));
  }
  return hits.slice(0, opts.limit ?? 20);
}
