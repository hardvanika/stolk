import type { DB } from '../db.js';
import type { EnvFile } from '../env.js';
import { normEmail, todayIso } from '../util.js';
import { DEFAULT_TZ, minutesBetween, toLocal, toUtc } from '../tz.js';
import { getSettings } from '../routes/settings.js';
import { CalcomClient, BLOCK_SLUG, blockLength } from './calcom.js';
import { GoogleClient, addresses } from './google.js';
import { RemoteError, type Fetch } from './fetch.js';

export interface SyncResult {
  lastSync: string;
  calcom: { ok: boolean; skipped?: string; bookings?: number; blocks?: number; error?: string };
  gcal: { ok: boolean; skipped?: string; events?: number; error?: string };
  gmail: { ok: boolean; skipped?: string; emails?: number; error?: string };
}

const DAY = 86_400_000;
const PAST_DAYS = 90; // how far back the first sync looks
const FUTURE_DAYS = 120;

/**
 * Pulls Cal.com bookings, Google Calendar events and Gmail headers into the local DB,
 * and keeps one Cal.com block per Stölk event. Every network call is read-only except
 * creating or cancelling those blocks.
 */
export class Syncer {
  private running: Promise<SyncResult> | null = null;

  constructor(private db: DB, private env: EnvFile, private f: Fetch = fetch, private now: () => Date = () => new Date()) {}

  private state(name: string, ok: boolean, message: string | null) {
    this.db.prepare(`INSERT INTO sync_state (name, last_sync, ok, message) VALUES (?, ?, ?, ?)
                     ON CONFLICT(name) DO UPDATE SET last_sync = excluded.last_sync, ok = excluded.ok, message = excluded.message`)
      .run(name, this.now().toISOString(), ok ? 1 : 0, message);
  }

  private calcom() {
    const key = this.env.get('CALCOM_API_KEY');
    return key ? new CalcomClient(key, this.f) : null;
  }
  private google() {
    const clientId = this.env.get('GOOGLE_CLIENT_ID');
    const clientSecret = this.env.get('GOOGLE_CLIENT_SECRET');
    const refreshToken = this.env.get('GOOGLE_REFRESH_TOKEN');
    return clientId && clientSecret && refreshToken ? new GoogleClient({ clientId, clientSecret, refreshToken }, this.f) : null;
  }

  /** One sync at a time; a second call while running gets the same result. */
  syncAll(): Promise<SyncResult> {
    if (!this.running) this.running = this.doSync().finally(() => { this.running = null; });
    return this.running;
  }

  private async doSync(): Promise<SyncResult> {
    const out: SyncResult = { lastSync: this.now().toISOString(), calcom: { ok: true }, gcal: { ok: true }, gmail: { ok: true } };
    const g = this.google();

    const cal = this.calcom();
    if (!cal) out.calcom = { ok: true, skipped: 'not connected' };
    else {
      try {
        const bookings = await this.syncCalcomBookings(cal);
        await this.syncCalLinks(cal);
        const blocks = getSettings(this.db).blockEvents ? await this.syncBlocks(cal) : 0;
        out.calcom = { ok: true, bookings, blocks };
        this.state('calcom', true, null);
      } catch (e) {
        out.calcom = { ok: false, error: (e as Error).message };
        this.state('calcom', false, (e as Error).message);
      }
    }

    if (!g) {
      out.gcal = { ok: true, skipped: 'not connected' };
      out.gmail = { ok: true, skipped: 'not connected' };
    } else {
      try {
        out.gcal = { ok: true, events: await this.syncGoogleCalendar(g) };
        this.state('gcal', true, null);
      } catch (e) {
        out.gcal = { ok: false, error: (e as Error).message };
        this.state('gcal', false, (e as Error).message);
      }
      try {
        out.gmail = { ok: true, emails: await this.syncGmail(g) };
        this.state('gmail', true, null);
      } catch (e) {
        out.gmail = { ok: false, error: (e as Error).message };
        this.state('gmail', false, (e as Error).message);
      }
    }
    return out;
  }

  // ---------- Cal.com ----------

  private contactIdByEmail(email: string): number | null {
    const r = this.db.prepare('SELECT id FROM contacts WHERE email_norm = ? ORDER BY id LIMIT 1').get(normEmail(email)) as any;
    return r?.id ?? null;
  }

  /** Keep Ivan's booking links in settings.calLinks so Preguntar can put the right one in a message. */
  async syncCalLinks(cal: CalcomClient): Promise<number> {
    const me = await cal.me();
    const links = await cal.bookingLinks(me.username);
    this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run('calLinks', JSON.stringify(links));
    return links.length;
  }

  async syncCalcomBookings(cal: CalcomClient): Promise<number> {
    const now = this.now().getTime();
    const from = new Date(now - PAST_DAYS * DAY).toISOString();
    const to = new Date(now + FUTURE_DAYS * DAY).toISOString();
    const all = await cal.bookings(from, to);
    const today = todayIso(this.now());
    let n = 0;
    const upsert = this.db.prepare(`
      INSERT INTO bookings (cal_uid, cid, date, start, end, type, attendee_name, attendee_email, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cal_uid) DO UPDATE SET cid = COALESCE(bookings.cid, excluded.cid), date = excluded.date, start = excluded.start,
        end = excluded.end, type = excluded.type, attendee_name = excluded.attendee_name,
        attendee_email = excluded.attendee_email, status = excluded.status`);
    const logged = this.db.prepare(`INSERT INTO interactions (cid, date, ch, text, cal_type, source, external_id)
                                    VALUES (?, ?, 'cal', ?, ?, 'calcom', ?) ON CONFLICT DO NOTHING`);
    for (const b of all) {
      // Our own blocks are not meetings.
      if (b.eventType?.slug === BLOCK_SLUG || b.metadata?.stolkEventId) continue;
      const att = b.attendees?.[0] ?? { name: '', email: '' };
      const cid = att.email ? this.contactIdByEmail(att.email) : null;
      const s = toLocal(b.start), e = toLocal(b.end);
      const type = b.title?.split(/\s+(?:between|entre|con|with)\s+/i)[0] || b.eventType?.slug || 'Reunión';
      upsert.run(b.uid, cid, s.date, s.time, e.time, type, att.name ?? '', att.email ?? '', b.status);
      n++;
      // A past, accepted meeting with a known person goes into their history once.
      if (cid && b.status === 'accepted' && s.date <= today && new Date(b.end).getTime() <= now) {
        logged.run(cid, s.date, `${type} (Cal.com)`, type, b.uid);
      }
    }
    return n;
  }

  private owner: { name: string; email: string; timeZone: string; blockTypeId: number } | null = null;

  private async ownerAndBlockType(cal: CalcomClient) {
    if (!this.owner) {
      const me = await cal.me();
      const blockTypeId = await cal.ensureBlockEventType(me.username);
      this.owner = { name: me.name ?? me.username, email: me.email, timeZone: me.timeZone || DEFAULT_TZ, blockTypeId };
    }
    return this.owner;
  }

  /** Make sure every upcoming, active Stölk event with a time has exactly one up-to-date block. */
  async syncBlocks(cal: CalcomClient): Promise<number> {
    const today = todayIso(this.now());
    const rows = this.db.prepare(`SELECT * FROM events WHERE COALESCE(end_date, date) >= ? AND
      ((status <> 'cancelado' AND start <> '' AND block = 1 AND cal_block_synced = 0)
       OR ((status = 'cancelado' OR block = 0) AND cal_block_uid IS NOT NULL))`).all(today) as any[];
    let n = 0;
    for (const ev of rows) {
      await this.blockEvent(cal, ev);
      n++;
    }
    return n;
  }

  /** Create, move or remove the Cal.com block for one event. Errors are stored on the event, not thrown. */
  async blockEvent(cal: CalcomClient, ev: any) {
    try {
      if (ev.cal_block_uid) {
        await cal.cancel(ev.cal_block_uid);
        this.db.prepare('UPDATE events SET cal_block_uid = NULL WHERE id = ?').run(ev.id);
      }
      if (ev.status !== 'cancelado' && ev.start && ev.block) {
        const o = await this.ownerAndBlockType(cal);
        // A multi-day event blocks from its start to its end on the last day (capped at the longest block length).
        const days = ev.end_date && ev.end_date > ev.date ? Math.round((Date.parse(ev.end_date) - Date.parse(ev.date)) / 86400000) : 0;
        const mins = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
        const span = days ? days * 1440 + (ev.end ? mins(ev.end) - mins(ev.start) : 0) : 0;
        const minutes = blockLength(span > 0 ? span : ev.end ? minutesBetween(ev.start, ev.end) : 60);
        const uid = await cal.createBlock({
          eventTypeId: o.blockTypeId, startUtc: toUtc(ev.date, ev.start), minutes, owner: o, stolkEventId: ev.id, title: ev.title,
        });
        this.db.prepare('UPDATE events SET cal_block_uid = ? WHERE id = ?').run(uid, ev.id);
      }
      this.db.prepare('UPDATE events SET cal_block_synced = 1, cal_block_error = NULL WHERE id = ?').run(ev.id);
    } catch (e) {
      const msg = e instanceof RemoteError ? e.message : 'Cal.com: unexpected error';
      this.db.prepare('UPDATE events SET cal_block_error = ? WHERE id = ?').run(msg, ev.id);
    }
  }

  /** Called by the event routes right after a change; best effort, never fails the request. */
  async onEventChanged(id: number) {
    const cal = this.calcom();
    if (!cal || !getSettings(this.db).blockEvents) return;
    const ev = this.db.prepare('SELECT * FROM events WHERE id = ?').get(id) as any;
    if (ev && !ev.cal_block_synced) await this.blockEvent(cal, ev);
  }

  /** Called before an event row is deleted, with its block uid. */
  async onEventDeleted(blockUid: string | null) {
    const cal = this.calcom();
    if (!cal || !blockUid) return;
    try { await cal.cancel(blockUid, 'Evento de Stölk borrado'); } catch { /* the slot stays blocked; Ivan can cancel it in Cal.com */ }
  }

  // ---------- Google Calendar ----------

  async syncGoogleCalendar(g: GoogleClient): Promise<number> {
    const now = this.now().getTime();
    const from = new Date(now - PAST_DAYS * DAY), to = new Date(now + FUTURE_DAYS * DAY);
    const items = await g.calendarEvents(from.toISOString(), to.toISOString());
    const fromDate = toLocal(from).date, toDate = toLocal(to).date;
    // Cal.com bookings and blocks usually also land in Google: skip what we already show from Cal.com.
    const calSlots = new Set((this.db.prepare('SELECT date, start, end FROM bookings').all() as any[]).map((b) => `${b.date} ${b.start} ${b.end}`));
    const blockSlots = new Set((this.db.prepare("SELECT date, start, end FROM events WHERE cal_block_uid IS NOT NULL").all() as any[]).map((b) => `${b.date} ${b.start} ${b.end}`));
    const stamp = this.now().toISOString();
    const upsert = this.db.prepare(`INSERT INTO gcal (id, date, start, end, title, place, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET date = excluded.date, start = excluded.start, end = excluded.end,
        title = excluded.title, place = excluded.place, updated_at = excluded.updated_at`);
    let n = 0;
    this.db.exec('BEGIN');
    try {
      for (const it of items) {
        if (it.status === 'cancelled') continue;
        let date: string, start = '', end = '';
        if (it.start?.dateTime) {
          const s = toLocal(it.start.dateTime), e = toLocal(it.end?.dateTime ?? it.start.dateTime);
          date = s.date; start = s.time; end = e.time;
        } else if (it.start?.date) {
          date = it.start.date; // all-day
        } else continue;
        const slot = `${date} ${start} ${end}`;
        if (start && (calSlots.has(slot) || blockSlots.has(slot))) continue;
        upsert.run(it.id, date, start, end, it.summary ?? '(sin título)', it.location ?? '', stamp);
        n++;
      }
      // Anything in the window that Google no longer returned was deleted there.
      this.db.prepare('DELETE FROM gcal WHERE date >= ? AND date <= ? AND (updated_at IS NULL OR updated_at <> ?)').run(fromDate, toDate, stamp);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return n;
  }

  // ---------- Gmail ----------

  /** Log each email to or from a known contact as an interaction (headers only, never bodies). */
  async syncGmail(g: GoogleClient): Promise<number> {
    const st = this.db.prepare("SELECT last_sync FROM sync_state WHERE name = 'gmail' AND ok = 1").get() as any;
    const since = st?.last_sync ? Date.parse(st.last_sync) - DAY : this.now().getTime() - PAST_DAYS * DAY;
    const msgs = await g.recentMessageHeaders(since);
    const byEmail = new Map((this.db.prepare("SELECT id, email_norm FROM contacts WHERE email_norm <> ''").all() as any[]).map((c) => [c.email_norm, c.id]));
    const ins = this.db.prepare(`INSERT INTO interactions (cid, date, ch, text, source, external_id)
                                 VALUES (?, ?, 'email', ?, 'gmail', ?) ON CONFLICT DO NOTHING`);
    let n = 0;
    for (const m of msgs) {
      const sent = m.headers.labels.split(',').includes('SENT');
      const people = sent ? [...addresses(m.headers.to), ...addresses(m.headers.cc)] : addresses(m.headers.from);
      const subject = (m.headers.subject ?? '').trim() || '(sin asunto)';
      const date = toLocal(new Date(m.internalDate)).date;
      for (const addr of new Set(people)) {
        const cid = byEmail.get(addr);
        if (!cid) continue;
        const res = ins.run(cid, date, `${sent ? 'Le escribiste' : 'Te escribió'}: ${subject}`, `${m.id}:${cid}`);
        n += Number(res.changes);
      }
    }
    return n;
  }
}
