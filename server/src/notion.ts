import { randomUUID } from 'node:crypto';
import type { DB } from './db.js';
import { tx } from './db.js';
import { Router, HttpError, bad } from './http.js';
import { fold, intParam, normEmail, validate } from './util.js';
import { NotionClient, describePage, plain, type NotionPage } from './sync/notion.js';

/** How much of Notion Stölk keeps. A personal workspace fits well under this. */
export const NOTION_LIMITS = { pages: 400, databases: 100, pageChars: 6000, askChars: 40_000, askPageChars: 3000 };

export type LinkType = 'contact' | 'project';
const LINK_TYPES: LinkType[] = ['contact', 'project'];

/**
 * Pull every page shared with the integration into notion_pages. A page's body is read again only
 * when Notion says it changed. Pages no longer shared (or archived) are dropped from the cache.
 * Returns how many pages are kept.
 */
export async function syncNotion(db: DB, client: NotionClient, now: string): Promise<number> {
  // Unique per run, so pages that weren't returned this time can be told apart even within the same second.
  const stamp = `${now} ${randomUUID()}`;
  const dbs = await client.search('database', NOTION_LIMITS.databases);
  const dbTitles = new Map(dbs.map((d) => [String(d.id).replace(/-/g, ''), plain(d.title).trim()]));
  const raw = (await client.search('page', NOTION_LIMITS.pages)).filter((p) => p?.object === 'page' && !p.archived && !p.in_trash);
  const known = new Map((db.prepare('SELECT id, edited FROM notion_pages').all() as any[]).map((r) => [r.id, r.edited]));

  // Network first, then one short write.
  const rows: (NotionPage & { text: string | null })[] = [];
  for (const p of raw) {
    const page = describePage(p, dbTitles);
    const same = known.get(page.id) === page.edited;
    rows.push({ ...page, text: same ? null : await client.pageText(page.id, NOTION_LIMITS.pageChars) });
  }

  tx(db, () => {
    const up = db.prepare(`INSERT INTO notion_pages (id, title, url, edited, db, props, text, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, url = excluded.url, edited = excluded.edited, db = excluded.db,
        props = excluded.props, text = COALESCE(?, notion_pages.text), synced_at = excluded.synced_at`);
    for (const r of rows) up.run(r.id, r.title, r.url, r.edited, r.db, JSON.stringify(r.props), r.text ?? '', stamp, r.text);
    db.prepare('DELETE FROM notion_pages WHERE synced_at <> ?').run(stamp);
    autoLink(db);
  });
  return rows.length;
}

/**
 * Link a page to a person when its title is exactly their name or one of its properties is their email,
 * and to a project when its title is the project's title. Only unambiguous matches; a link Ivan removed stays removed.
 */
export function autoLink(db: DB) {
  const byName = new Map<string, number[]>();
  const byEmail = new Map<string, number>();
  for (const c of db.prepare('SELECT id, name, email_norm FROM contacts').all() as any[]) {
    const k = fold(c.name);
    if (k.length >= 3) byName.set(k, [...(byName.get(k) ?? []), c.id]);
    if (c.email_norm) byEmail.set(c.email_norm, c.id);
  }
  const projects = new Map<string, number[]>();
  for (const p of db.prepare('SELECT id, title FROM projects').all() as any[]) {
    const k = fold(p.title);
    if (k.length >= 3) projects.set(k, [...(projects.get(k) ?? []), p.id]);
  }
  const ins = db.prepare(`INSERT INTO notion_links (page_id, kind, ref, auto) VALUES (?, ?, ?, 1) ON CONFLICT DO NOTHING`);
  for (const p of db.prepare('SELECT id, title, props FROM notion_pages').all() as any[]) {
    const t = fold(p.title);
    const people = new Set<number>();
    if (byName.get(t)?.length === 1) people.add(byName.get(t)![0]);
    for (const v of Object.values<string>(JSON.parse(p.props))) {
      const cid = byEmail.get(normEmail(v));
      if (cid) people.add(cid);
    }
    for (const cid of people) ins.run(p.id, 'contact', cid);
    if (projects.get(t)?.length === 1) ins.run(p.id, 'project', projects.get(t)![0]);
  }
}

function linksOf(db: DB, pageId: string) {
  const rows = db.prepare('SELECT kind, ref, auto FROM notion_links WHERE page_id = ? AND removed = 0 ORDER BY kind, ref').all(pageId) as any[];
  return rows.map((r) => ({ type: r.kind as LinkType, id: r.ref as number, auto: !!r.auto }));
}

function mapPage(db: DB, r: any, withText = false) {
  const text = String(r.text ?? '');
  return {
    id: r.id, title: r.title, url: r.url, edited: r.edited, db: r.db || null, props: JSON.parse(r.props),
    ...(withText ? { text } : { snippet: text.replace(/\s+/g, ' ').slice(0, 160) }),
    links: linksOf(db, r.id),
  };
}

function getPage(db: DB, id: string) {
  const r = db.prepare('SELECT * FROM notion_pages WHERE id = ?').get(id.replace(/-/g, '')) as any;
  if (!r) throw new HttpError(404, 'not_found', 'Esa página de Notion no está en Stölk. Compártela con la integración y sincroniza.');
  return r;
}

/** Notion for Preguntar: linked pages first, then the most recently edited, within a fixed size. */
export function notionContext(db: DB) {
  const rows = db.prepare(`SELECT p.*, EXISTS (SELECT 1 FROM notion_links l WHERE l.page_id = p.id AND l.removed = 0) AS linked
                           FROM notion_pages p ORDER BY linked DESC, p.edited DESC`).all() as any[];
  const out: any[] = [];
  let size = 0;
  for (const r of rows) {
    const links = linksOf(db, r.id);
    const text = String(r.text ?? '');
    const props = JSON.parse(r.props);
    const item = {
      title: r.title, db: r.db || undefined, edited: String(r.edited).slice(0, 10),
      contacts: links.filter((l) => l.type === 'contact').map((l) => l.id),
      projects: links.filter((l) => l.type === 'project').map((l) => l.id),
      props: Object.keys(props).length ? props : undefined,
      text: text ? (text.length > NOTION_LIMITS.askPageChars ? text.slice(0, NOTION_LIMITS.askPageChars) + ' …' : text) : undefined,
    };
    if (!item.contacts.length) delete (item as any).contacts;
    if (!item.projects.length) delete (item as any).projects;
    const n = JSON.stringify(item).length;
    if (size + n > NOTION_LIMITS.askChars) break;
    size += n;
    out.push(item);
  }
  return out;
}

/** Forget everything read from Notion (on disconnect). */
export function clearNotion(db: DB) {
  db.exec('DELETE FROM notion_links; DELETE FROM notion_pages;');
}

export function notionRoutes(r: Router, db: DB) {
  // Pages Stölk has read from Notion. ?q= searches titles; ?contact= / ?project= lists what's linked.
  r.get('/notion/pages', ({ query }) => {
    const q = fold(query.get('q') ?? '');
    const contact = query.get('contact'), project = query.get('project');
    let rows: any[];
    if (contact || project) {
      const [kind, ref] = contact ? ['contact', intParam(contact, 'contact')] : ['project', intParam(project!, 'project')];
      rows = db.prepare(`SELECT p.* FROM notion_pages p JOIN notion_links l ON l.page_id = p.id
                         WHERE l.kind = ? AND l.ref = ? AND l.removed = 0 ORDER BY p.edited DESC`).all(kind, ref) as any[];
    } else {
      rows = db.prepare('SELECT * FROM notion_pages ORDER BY edited DESC').all() as any[];
      if (q) rows = rows.filter((p) => fold(p.title).includes(q) || fold(p.db).includes(q));
    }
    return rows.slice(0, 200).map((p) => mapPage(db, p));
  });

  r.get('/notion/pages/:id', ({ params }) => mapPage(db, getPage(db, params.id), true));

  // Link a page to a person or a project by hand.
  r.put('/notion/pages/:id/links', ({ params, body }) => {
    const page = getPage(db, params.id);
    const v = validate(body, { type: { kind: { enum: LINK_TYPES }, required: true }, id: { kind: 'int', required: true } });
    const table = v.type === 'contact' ? 'contacts' : 'projects';
    if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(v.id)) throw new HttpError(404, 'not_found', v.type === 'contact' ? 'Esa persona no existe' : 'Ese proyecto no existe');
    db.prepare(`INSERT INTO notion_links (page_id, kind, ref, auto, removed) VALUES (?, ?, ?, 0, 0)
                ON CONFLICT(page_id, kind, ref) DO UPDATE SET removed = 0`).run(page.id, v.type, v.id);
    return mapPage(db, page);
  });

  // Unlink. Kept as "removed" so the automatic name match doesn't bring it back on the next sync.
  r.delete('/notion/pages/:id/links/:type/:ref', ({ params }) => {
    const page = getPage(db, params.id);
    if (!LINK_TYPES.includes(params.type as LinkType)) throw bad('type must be contact or project');
    const ref = intParam(params.ref, 'ref');
    db.prepare(`INSERT INTO notion_links (page_id, kind, ref, auto, removed) VALUES (?, ?, ?, 0, 1)
                ON CONFLICT(page_id, kind, ref) DO UPDATE SET removed = 1`).run(page.id, params.type, ref);
  });
}
