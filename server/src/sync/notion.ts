import { fetchJson, type Fetch } from './fetch.js';

const API = 'https://api.notion.com/v1';
// Stable API version with plain database ids; pages in databases come back from /search as pages.
export const NOTION_VERSION = '2022-06-28';

/** One Notion page as Stölk keeps it: title, where it lives, its properties as text, and its body as plain text. */
export interface NotionPage {
  id: string;
  title: string;
  url: string;
  edited: string;
  /** Title of the database the page is a row of, or '' for a normal page. */
  db: string;
  /** Property name → value as text (title left out). Empty values are dropped. */
  props: Record<string, string>;
}

/** Lines of text from a rich_text array. */
export const plain = (rt: any): string => (Array.isArray(rt) ? rt.map((t) => t?.plain_text ?? '').join('') : '');

/** A database row's property, as short text. Unknown or empty kinds give ''. */
export function propText(p: any): string {
  if (!p || typeof p !== 'object') return '';
  switch (p.type) {
    case 'title': return plain(p.title);
    case 'rich_text': return plain(p.rich_text);
    case 'select': return p.select?.name ?? '';
    case 'status': return p.status?.name ?? '';
    case 'multi_select': return (p.multi_select ?? []).map((s: any) => s?.name).filter(Boolean).join(', ');
    case 'date': return p.date?.start ? (p.date.end ? `${p.date.start} → ${p.date.end}` : p.date.start) : '';
    case 'email': return p.email ?? '';
    case 'url': return p.url ?? '';
    case 'phone_number': return p.phone_number ?? '';
    case 'number': return p.number == null ? '' : String(p.number);
    case 'checkbox': return p.checkbox ? 'sí' : '';
    case 'people': return (p.people ?? []).map((u: any) => u?.name).filter(Boolean).join(', ');
    case 'formula': return p.formula ? String(p.formula[p.formula.type] ?? '') : '';
    default: return '';
  }
}

/** One block as a line of text, with a light Markdown hint (heading, bullet, to-do). */
export function blockText(b: any): string {
  const t = b?.type;
  const v = t ? b[t] : null;
  if (!v) return '';
  if (t === 'child_page') return `▸ ${v.title ?? ''}`;
  if (t === 'child_database') return `▸ ${v.title ?? ''}`;
  if (t === 'bookmark' || t === 'embed' || t === 'link_preview') return v.url ?? '';
  if (t === 'table_row') return (v.cells ?? []).map(plain).join(' | ');
  const text = plain(v.rich_text);
  if (!text) return '';
  if (t === 'heading_1') return `# ${text}`;
  if (t === 'heading_2') return `## ${text}`;
  if (t === 'heading_3') return `### ${text}`;
  if (t === 'bulleted_list_item' || t === 'numbered_list_item' || t === 'toggle') return `- ${text}`;
  if (t === 'to_do') return `- [${v.checked ? 'x' : ' '}] ${text}`;
  if (t === 'quote' || t === 'callout') return `> ${text}`;
  return text;
}

/** Read-only Notion client for an internal integration token. It sees only the pages Ivan shared with it. */
export class NotionClient {
  constructor(private token: string, private f: Fetch = fetch, private pauseMs = 340) {}

  private last = 0;
  /** Notion allows about 3 requests a second per integration. */
  private async req(path: string, init: RequestInit = {}) {
    const wait = this.last + this.pauseMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.last = Date.now();
    return fetchJson(this.f, 'Notion', `${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
  }

  /** Every page or database shared with the integration, newest edit first. */
  async search(kind: 'page' | 'database', max: number): Promise<any[]> {
    const out: any[] = [];
    let cursor: string | undefined;
    do {
      const body: any = { page_size: 100, filter: { property: 'object', value: kind }, sort: { direction: 'descending', timestamp: 'last_edited_time' } };
      if (cursor) body.start_cursor = cursor;
      const res = await this.req('/search', { method: 'POST', body: JSON.stringify(body) });
      out.push(...(res?.results ?? []));
      cursor = res?.has_more ? res.next_cursor : undefined;
    } while (cursor && out.length < max);
    return out.slice(0, max);
  }

  /** A page's body as plain text, up to maxChars. Nested blocks are read one level deep. */
  async pageText(id: string, maxChars: number, maxRequests = 6): Promise<string> {
    const lines: string[] = [];
    let used = 0, size = 0;
    const walk = async (blockId: string, depth: number) => {
      let cursor: string | undefined;
      do {
        if (used >= maxRequests || size >= maxChars) return;
        used++;
        const q = new URLSearchParams({ page_size: '100' });
        if (cursor) q.set('start_cursor', cursor);
        const res = await this.req(`/blocks/${encodeURIComponent(blockId)}/children?${q}`);
        for (const b of res?.results ?? []) {
          const line = blockText(b);
          if (line) { lines.push('  '.repeat(depth) + line); size += line.length + 1; }
          if (size >= maxChars) return;
          // Child pages are their own entries; don't read them twice.
          if (b.has_children && depth < 1 && b.type !== 'child_page' && b.type !== 'child_database') await walk(b.id, depth + 1);
        }
        cursor = res?.has_more ? res.next_cursor : undefined;
      } while (cursor);
    };
    await walk(id, 0);
    const text = lines.join('\n');
    return text.length > maxChars ? text.slice(0, maxChars) + ' …' : text;
  }
}

/** Title and properties of a page object from /search. */
export function describePage(p: any, dbTitles: Map<string, string>): NotionPage {
  let title = '';
  const props: Record<string, string> = {};
  for (const [name, v] of Object.entries<any>(p?.properties ?? {})) {
    if (v?.type === 'title') { title = plain(v.title); continue; }
    const t = propText(v).trim();
    if (t) props[name] = t.length > 300 ? t.slice(0, 300) + '…' : t;
  }
  const dbId = p?.parent?.type === 'database_id' ? String(p.parent.database_id).replace(/-/g, '') : '';
  return {
    id: String(p.id).replace(/-/g, ''),
    title: title.trim() || '(sin título)',
    url: typeof p.url === 'string' ? p.url : '',
    edited: String(p.last_edited_time ?? ''),
    db: dbId ? dbTitles.get(dbId) ?? '' : '',
    props,
  };
}
