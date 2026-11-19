import { fetchJson, type Fetch } from './fetch.js';

// Cal.com API v2. Each endpoint family pins its own version header; a wrong value silently
// falls back to an older behaviour, so they are kept here in one place.
const BASE = process.env.CALCOM_API_URL || 'https://api.cal.com/v2';
export const CAL_VERSIONS = {
  bookings: '2026-05-01',
  createBooking: '2026-02-25',
  cancelBooking: '2026-02-25',
  eventTypes: '2026-06-12',
} as const;

export const BLOCK_SLUG = 'bloqueado-stolk';
export const BLOCK_TITLE = 'Bloqueado (Stölk)';
// One hidden event type covers any event length, in 15-minute steps up to 12 h.
export const BLOCK_LENGTHS = Array.from({ length: 48 }, (_, i) => (i + 1) * 15);

export interface CalBooking {
  uid: string;
  title: string;
  status: string;
  start: string; // ISO UTC
  end: string;
  eventType?: { id: number; slug: string };
  attendees: { name: string; email: string }[];
  metadata?: Record<string, string>;
}

export class CalcomClient {
  constructor(private apiKey: string, private f: Fetch = fetch) {}

  private req(path: string, version: string | null, init: RequestInit = {}) {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' };
    if (version) headers['cal-api-version'] = version;
    return fetchJson(this.f, 'Cal.com', BASE + path, { ...init, headers });
  }

  async me(): Promise<{ id: number; username: string; email: string; name?: string; timeZone: string }> {
    return (await this.req('/me', null)).data;
  }

  /** All bookings that end after `from` and start before `to` (ISO UTC), all statuses, following cursors. */
  async bookings(from: string, to: string): Promise<CalBooking[]> {
    const out: CalBooking[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 50; page++) {
      const q = new URLSearchParams({ afterStart: from, beforeEnd: to, limit: '100', sortStart: 'asc' });
      if (cursor) q.set('cursor', cursor);
      const res = await this.req(`/bookings?${q}`, CAL_VERSIONS.bookings);
      out.push(...(res.data ?? []));
      cursor = res.pagination?.nextCursor ?? null;
      if (!cursor || !res.pagination?.hasMore) break;
    }
    return out;
  }

  /** Find or create the hidden event type used to block slots. Returns its id. */
  async ensureBlockEventType(username: string): Promise<number> {
    const list = await this.req(`/event-types?${new URLSearchParams({ username })}`, CAL_VERSIONS.eventTypes);
    const found = (list.data ?? []).find((e: any) => e.slug === BLOCK_SLUG);
    if (found) return found.id;
    const res = await this.req('/event-types', CAL_VERSIONS.eventTypes, {
      method: 'POST',
      body: JSON.stringify({
        title: BLOCK_TITLE,
        slug: BLOCK_SLUG,
        lengthInMinutes: 60,
        lengthInMinutesOptions: BLOCK_LENGTHS,
        hidden: true,
        minimumBookingNotice: 0,
      }),
    });
    return res.data.id;
  }

  /** Book the slot on the hidden event type, as the owner, so Cal.com stops offering it. */
  async createBlock(args: { eventTypeId: number; startUtc: Date; minutes: number; owner: { name: string; email: string; timeZone: string }; stolkEventId: number; title: string }) {
    const res = await this.req('/bookings', CAL_VERSIONS.createBooking, {
      method: 'POST',
      body: JSON.stringify({
        start: args.startUtc.toISOString().replace(/\.\d{3}Z$/, 'Z'),
        eventTypeId: args.eventTypeId,
        lengthInMinutes: args.minutes,
        attendee: { name: args.owner.name || 'Stölk', email: args.owner.email, timeZone: args.owner.timeZone, language: 'es' },
        metadata: { stolkEventId: String(args.stolkEventId), stolkTitle: args.title.slice(0, 400) },
      }),
    });
    return res.data.uid as string;
  }

  async cancel(uid: string, reason = 'Evento de Stölk cambiado o borrado') {
    await this.req(`/bookings/${encodeURIComponent(uid)}/cancel`, CAL_VERSIONS.cancelBooking, {
      method: 'POST',
      body: JSON.stringify({ cancellationReason: reason }),
    });
  }
}

/** Round up to the next allowed block length. */
export function blockLength(minutes: number): number {
  return BLOCK_LENGTHS.find((l) => l >= minutes) ?? BLOCK_LENGTHS[BLOCK_LENGTHS.length - 1];
}
