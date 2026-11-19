import { createHash, randomBytes } from 'node:crypto';
import { fetchJson, RemoteError, type Fetch } from './fetch.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CAL = 'https://www.googleapis.com/calendar/v3';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

// Read-only. gmail.metadata gives headers (From, To, Subject, Date) but never message bodies.
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/gmail.metadata',
];

/** Pending OAuth attempts: state → PKCE verifier and redirect URI. Lives only in memory, 10 min. */
const pending = new Map<string, { verifier: string; redirectUri: string; at: number }>();

export function startGoogleAuth(clientId: string, redirectUri: string): { authUrl: string; state: string } {
  for (const [k, v] of pending) if (Date.now() - v.at > 600_000) pending.delete(k);
  const state = randomBytes(16).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  pending.set(state, { verifier, redirectUri, at: Date.now() });
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
  return { authUrl: `${AUTH_URL}?${q}`, state };
}

export async function finishGoogleAuth(
  f: Fetch, args: { clientId: string; clientSecret: string; code: string; state: string },
): Promise<string> {
  const p = pending.get(args.state);
  if (!p) throw new RemoteError('Google', 400, 'unknown or expired sign-in attempt; start again');
  pending.delete(args.state);
  const tok = await fetchJson(f, 'Google', TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: args.clientId, client_secret: args.clientSecret, code: args.code,
      code_verifier: p.verifier, grant_type: 'authorization_code', redirect_uri: p.redirectUri,
    }),
  });
  if (!tok.refresh_token) throw new RemoteError('Google', 400, 'Google did not return a refresh token');
  return tok.refresh_token;
}

export class GoogleClient {
  private token: { value: string; exp: number } | null = null;
  constructor(private creds: { clientId: string; clientSecret: string; refreshToken: string }, private f: Fetch = fetch) {}

  private async accessToken() {
    if (this.token && this.token.exp > Date.now() + 60_000) return this.token.value;
    const t = await fetchJson(this.f, 'Google', TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.creds.clientId, client_secret: this.creds.clientSecret,
        refresh_token: this.creds.refreshToken, grant_type: 'refresh_token',
      }),
    });
    this.token = { value: t.access_token, exp: Date.now() + (t.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  private async get(url: string) {
    return fetchJson(this.f, 'Google', url, { headers: { Authorization: `Bearer ${await this.accessToken()}` } });
  }

  /** Events on the primary calendar between two ISO instants, recurring ones expanded. */
  async calendarEvents(timeMin: string, timeMax: string): Promise<any[]> {
    const out: any[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 20; page++) {
      const q = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
      if (pageToken) q.set('pageToken', pageToken);
      const res = await this.get(`${CAL}/calendars/primary/events?${q}`);
      out.push(...(res.items ?? []));
      pageToken = res.nextPageToken;
      if (!pageToken) break;
    }
    return out;
  }

  /**
   * Message headers, newest first, stopping at messages older than `sinceMs` or after `max`.
   * The metadata scope doesn't allow search queries, so we walk the list and stop by date.
   */
  async recentMessageHeaders(sinceMs: number, max = 500): Promise<{ id: string; internalDate: number; headers: Record<string, string> }[]> {
    const out: { id: string; internalDate: number; headers: Record<string, string> }[] = [];
    let pageToken: string | undefined;
    while (out.length < max) {
      const q = new URLSearchParams({ maxResults: '100' });
      if (pageToken) q.set('pageToken', pageToken);
      const list = await this.get(`${GMAIL}/messages?${q}`);
      const ids: string[] = (list.messages ?? []).map((m: any) => m.id);
      if (!ids.length) break;
      let older = false;
      for (const id of ids) {
        const q2 = new URLSearchParams({ format: 'metadata' });
        for (const h of ['From', 'To', 'Cc', 'Subject']) q2.append('metadataHeaders', h);
        const m = await this.get(`${GMAIL}/messages/${id}?${q2}`);
        const internalDate = Number(m.internalDate);
        if (internalDate < sinceMs) { older = true; break; }
        const headers: Record<string, string> = {};
        for (const h of m.payload?.headers ?? []) headers[h.name.toLowerCase()] = h.value;
        out.push({ id, internalDate, headers: { ...headers, labels: (m.labelIds ?? []).join(',') } });
        if (out.length >= max) break;
      }
      pageToken = list.nextPageToken;
      if (older || !pageToken) break;
    }
    return out;
  }
}

/** Pull bare addresses out of a header like `"Ana" <ana@x.com>, bob@y.com`. */
export function addresses(header: string | undefined): string[] {
  if (!header) return [];
  return [...header.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)].map((m) => m[0].toLowerCase());
}
