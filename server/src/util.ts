import { bad } from './http.js';

/** Lowercase and strip accents, for search and name matching. */
export const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
export const normEmail = (s: string) => s.trim().toLowerCase();
/** Digits only, without a leading 00/+34 style prefix: the last 9 digits identify a Spanish number. */
export const normPhone = (s: string) => {
  const d = s.replace(/\D/g, '');
  return d.length > 9 ? d.slice(-9) : d;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

type Kind = 'string' | 'date' | 'time' | 'int' | 'bool' | 'tags' | { enum: readonly string[] };
export type Spec = Record<string, { kind: Kind; required?: boolean; nullable?: boolean }>;

/**
 * Validate a JSON body against a spec. Unknown keys are rejected so typos don't silently vanish.
 * With partial=true (PATCH), required fields may be absent.
 */
export function validate(body: any, spec: Spec, partial = false): Record<string, any> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw bad('Body must be a JSON object');
  const out: Record<string, any> = {};
  for (const k of Object.keys(body)) if (!(k in spec)) throw bad(`Unknown field: ${k}`);
  for (const [k, f] of Object.entries(spec)) {
    const v = body[k];
    if (v === undefined) {
      if (f.required && !partial) throw bad(`Missing field: ${k}`);
      continue;
    }
    if (v === null) {
      if (!f.nullable) throw bad(`Field ${k} cannot be null`);
      out[k] = null;
      continue;
    }
    const kind = f.kind;
    if (typeof kind === 'object') {
      if (!kind.enum.includes(v)) throw bad(`Field ${k} must be one of: ${kind.enum.join(', ')}`);
    } else if (kind === 'string') {
      if (typeof v !== 'string') throw bad(`Field ${k} must be a string`);
      if (f.required && !v.trim()) throw bad(`Field ${k} cannot be empty`);
    } else if (kind === 'date') {
      if (typeof v !== 'string' || !DATE.test(v)) throw bad(`Field ${k} must be YYYY-MM-DD`);
    } else if (kind === 'time') {
      if (typeof v !== 'string' || (v !== '' && !TIME.test(v))) throw bad(`Field ${k} must be HH:MM`);
    } else if (kind === 'int') {
      if (!Number.isInteger(v)) throw bad(`Field ${k} must be an integer`);
    } else if (kind === 'bool') {
      if (typeof v !== 'boolean') throw bad(`Field ${k} must be true or false`);
    } else if (kind === 'tags') {
      if (!Array.isArray(v) || !v.every((t) => typeof t === 'string')) throw bad(`Field ${k} must be a list of strings`);
      out[k] = [...new Set(v.map((t: string) => t.trim()).filter(Boolean))];
      continue;
    }
    out[k] = v;
  }
  return out;
}

export function intParam(v: string | undefined, name = 'id'): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw bad(`Invalid ${name}`);
  return n;
}

export function optDate(q: URLSearchParams, k: string): string | undefined {
  const v = q.get(k);
  if (v == null || v === '') return undefined;
  if (!DATE.test(v)) throw bad(`Query ${k} must be YYYY-MM-DD`);
  return v;
}

/** Local date in Europe/Madrid (or the machine's zone), as YYYY-MM-DD. */
export function todayIso(now = new Date()): string {
  const y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000);
}

/** Token-overlap similarity between two names/titles, 0..1, accent and case insensitive. */
export function similarity(a: string, b: string): number {
  const ta = new Set(fold(a).split(/[^a-z0-9]+/).filter(Boolean));
  const tb = new Set(fold(b).split(/[^a-z0-9]+/).filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}
