/**
 * Turns a natural-language question into structured filters.
 * The small local model fills a JSON schema; `normalizePlan` then snaps its guesses
 * onto events/places that really exist, and `heuristicPlan` works with no model at all.
 */
export type QueryPlan = {
  event: string | null;
  place: string | null;
  near_me: boolean;
  date_from: string | null; // YYYY-MM-DD inclusive
  date_to: string | null; // YYYY-MM-DD inclusive
  person: string | null;
  company: string | null;
  topic: string | null; // free text for semantic search ("solar storage", "investor")
};

export type PlanContext = { today: Date; events: string[]; places: string[] };

export const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    event: { type: ['string', 'null'] },
    place: { type: ['string', 'null'] },
    near_me: { type: 'boolean' },
    date_from: { type: ['string', 'null'] },
    date_to: { type: ['string', 'null'] },
    person: { type: ['string', 'null'] },
    company: { type: ['string', 'null'] },
    topic: { type: ['string', 'null'] },
  },
  required: ['event', 'place', 'near_me', 'date_from', 'date_to', 'person', 'company', 'topic'],
} as const;

export const emptyPlan = (): QueryPlan => ({
  event: null, place: null, near_me: false, date_from: null, date_to: null, person: null, company: null, topic: null,
});

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export function planPrompt(question: string, ctx: PlanContext): string {
  return [
    `Today is ${ymd(ctx.today)}.`,
    `Known events: ${ctx.events.join('; ') || '(none)'}.`,
    `Known places: ${ctx.places.join('; ') || '(none)'}.`,
    'Extract search filters from the question about people the user met.',
    'Use an event or place only if it matches one of the known names. Dates are YYYY-MM-DD.',
    'Set near_me when the question says here, nearby or around me. Put subject matter (industry, skill, interest) in topic.',
    'Leave every other field null.',
    `Question: ${question}`,
  ].join('\n');
}

/** Best known name that the text refers to, tolerant of case, accents and partial names. */
export function snapToKnown(text: string | null | undefined, known: string[]): string | null {
  if (!text) return null;
  const t = fold(text);
  if (!t) return null;
  let best: string | null = null;
  let bestLen = 0;
  for (const k of known) {
    const f = fold(k);
    if (f === t) return k;
    if ((f.includes(t) || t.includes(f)) && f.length > bestLen) {
      best = k;
      bestLen = f.length;
    }
  }
  return best;
}

const isYmd = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const str = (s: unknown) => (typeof s === 'string' && s.trim() ? s.trim() : null);

export function normalizePlan(raw: unknown, ctx: PlanContext): QueryPlan {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const plan: QueryPlan = {
    event: snapToKnown(str(r.event), ctx.events),
    place: snapToKnown(str(r.place), ctx.places),
    near_me: r.near_me === true,
    date_from: isYmd(r.date_from) ? r.date_from : null,
    date_to: isYmd(r.date_to) ? r.date_to : null,
    person: str(r.person),
    company: str(r.company),
    topic: str(r.topic),
  };
  // Small models sometimes put the event name in `place` or vice versa.
  if (!plan.event && str(r.place)) plan.event = snapToKnown(str(r.place), ctx.events);
  if (!plan.place && str(r.event)) plan.place = snapToKnown(str(r.event), ctx.places);
  if (plan.date_from && plan.date_to && plan.date_from > plan.date_to) [plan.date_from, plan.date_to] = [plan.date_to, plan.date_from];
  return plan;
}

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
};

/** Rule-based fallback, also used to double-check the model's plan. */
export function heuristicPlan(question: string, ctx: PlanContext): QueryPlan {
  const q = fold(question);
  const plan = emptyPlan();
  // "South Summit" should find "South Summit 2026", so also try each name without its year.
  const variants = (k: string) => [fold(k), fold(k).replace(/\s*\b(19|20)\d{2}\b/g, '').trim()].filter((v) => v.length >= 3);
  const findIn = (known: string[]) =>
    known.filter((k) => variants(k).some((v) => q.includes(v))).sort((a, b) => b.length - a.length)[0] ?? null;
  plan.event = findIn(ctx.events);
  plan.place = findIn(ctx.places);
  plan.near_me = /\b(near (me|here)|around (me|here)|nearby|here|cerca|aqui)\b/.test(q);

  const today = ctx.today;
  if (/\b(today|hoy)\b/.test(q)) plan.date_from = plan.date_to = ymd(today);
  else if (/\b(yesterday|ayer)\b/.test(q)) plan.date_from = plan.date_to = ymd(addDays(today, -1));
  else if (/\b(last|this|past) week\b|\bsemana pasada\b/.test(q)) {
    plan.date_from = ymd(addDays(today, -7));
    plan.date_to = ymd(today);
  } else if (/\b(last|past) month\b|\bmes pasado\b/.test(q)) {
    plan.date_from = ymd(new Date(today.getFullYear(), today.getMonth() - 1, 1));
    plan.date_to = ymd(new Date(today.getFullYear(), today.getMonth(), 0));
  } else {
    const m = q.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b(?:\s+(?:de\s+)?(\d{4}))?/);
    const y = q.match(/\b(20\d{2})\b/);
    if (m && !(m[1] === 'may' && !m[2] && /\bmay (i|we|you)\b/.test(q))) {
      const month = MONTHS[m[1]];
      // A bare month means its most recent occurrence.
      const year = m[2] ? Number(m[2]) : month > today.getMonth() ? today.getFullYear() - 1 : today.getFullYear();
      plan.date_from = ymd(new Date(year, month, 1));
      plan.date_to = ymd(new Date(year, month + 1, 0));
    } else if (y) {
      plan.date_from = `${y[1]}-01-01`;
      plan.date_to = `${y[1]}-12-31`;
    }
  }
  const structured = plan.event || plan.place || plan.near_me || plan.date_from;
  if (!structured) plan.topic = question.trim();
  return plan;
}

/** Keeps the model's plan but fills in anything the rules found with certainty. */
export function mergePlans(model: QueryPlan, rules: QueryPlan): QueryPlan {
  return {
    ...model,
    event: model.event ?? rules.event,
    place: model.place ?? rules.place,
    near_me: model.near_me || rules.near_me,
    date_from: model.date_from ?? rules.date_from,
    date_to: model.date_to ?? rules.date_to,
  };
}
