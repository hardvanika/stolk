import type { DB } from '../db.js';
import { Router, HttpError, bad } from '../http.js';
import type { EnvFile, SecretKey } from '../env.js';
import { validate, type Spec } from '../util.js';

const DEFAULTS = {
  blockEvents: true,
  claudeOn: true,
  // "Buscar info pública" on a person's card. Off until Ivan turns it on in Ajustes.
  enrichOn: false,
  theme: 'claro',
  captureShortcut: 'Ctrl+Shift+S',
  claudeModel: 'claude-opus-5-5',
  // Ivan's Cal.com booking pages, refreshed by each sync; read-only here.
  calLinks: [] as { title: string; minutes: number; url: string }[],
  calTypes: [
    { id: 'cafe', name: 'Café', min: 30, slug: 'cafe-30' },
    { id: 'llamada', name: 'Llamada', min: 15, slug: 'llamada-15' },
    { id: 'reunion', name: 'Reunión', min: 45, slug: 'reunion-45' },
  ],
};
const SPEC: Spec = {
  blockEvents: { kind: 'bool' },
  claudeOn: { kind: 'bool' },
  enrichOn: { kind: 'bool' },
  theme: { kind: { enum: ['claro', 'oscuro', 'sistema'] } },
  // Electron accelerator syntax, e.g. "Ctrl+Shift+S". The desktop registers it.
  captureShortcut: { kind: 'string' },
  claudeModel: { kind: { enum: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] } },
  calTypes: { kind: 'string' }, // validated by hand below
};

export function getSettings(db: DB): typeof DEFAULTS {
  const rows = db.prepare('SELECT key, value FROM settings').all() as any[];
  const out: any = structuredClone(DEFAULTS);
  for (const r of rows) out[r.key] = JSON.parse(r.value);
  return out;
}

// Which env keys each connection needs to count as connected, and which `PUT` writes.
const CONNECTIONS: Record<string, { keys: SecretKey[]; put?: SecretKey }> = {
  claude: { keys: ['ANTHROPIC_API_KEY'], put: 'ANTHROPIC_API_KEY' },
  calcom: { keys: ['CALCOM_API_KEY'], put: 'CALCOM_API_KEY' },
  gcal: { keys: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'] },
  // Same Google sign-in as gcal; shown separately so its own sync state is visible.
  gmail: { keys: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'] },
};

export function settingsRoutes(r: Router, db: DB, env: EnvFile) {
  r.get('/settings', () => getSettings(db));

  r.patch('/settings', ({ body }) => {
    const { calTypes, ...rest } = body ?? {};
    const v = validate(rest, SPEC, true);
    if (v.captureShortcut !== undefined && !/^((Ctrl|Control|Shift|Alt|Super|Meta|CmdOrCtrl|CommandOrControl)\+)+[A-Za-z0-9]$|^((Ctrl|Control|Shift|Alt|Super|Meta|CmdOrCtrl|CommandOrControl)\+)+F([1-9]|1[0-9]|2[0-4])$/.test(v.captureShortcut)) {
      throw bad('captureShortcut must look like Ctrl+Shift+S');
    }
    if (calTypes !== undefined) {
      const ok = Array.isArray(calTypes) && calTypes.every((t: any) =>
        t && typeof t.id === 'string' && typeof t.name === 'string' && Number.isInteger(t.min) && typeof t.slug === 'string');
      if (!ok) throw bad('calTypes must be a list of {id, name, min, slug}');
      v.calTypes = calTypes.map((t: any) => ({ id: t.id, name: t.name, min: t.min, slug: t.slug }));
    }
    const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const [k, val] of Object.entries(v)) up.run(k, JSON.stringify(val));
    return getSettings(db);
  });

  r.get('/connections', () => {
    const out: Record<string, any> = {};
    for (const [name, c] of Object.entries(CONNECTIONS)) {
      const s = db.prepare('SELECT last_sync, ok, message FROM sync_state WHERE name = ?').get(name) as any;
      out[name] = { connected: c.keys.every((k) => env.has(k)) };
      if (name !== 'claude') {
        out[name].lastSync = s?.last_sync ?? null;
        if (s && !s.ok) out[name].error = s.message;
      }
    }
    return out;
  });

  r.put('/connections/:name', ({ params, body }) => {
    const c = CONNECTIONS[params.name];
    if (!c) throw new HttpError(404, 'not_found', 'Unknown connection');
    if (!c.put) throw bad('Connect Google with POST /connections/gcal/start');
    const v = validate(body, { apiKey: { kind: 'string', required: true } });
    env.set({ [c.put]: v.apiKey.trim() });
    return { connected: true };
  });

  r.delete('/connections/:name', ({ params }) => {
    const c = CONNECTIONS[params.name];
    if (!c) throw new HttpError(404, 'not_found', 'Unknown connection');
    // Keep the Google OAuth client so reconnecting only needs a new consent.
    const google = params.name === 'gcal' || params.name === 'gmail';
    const drop = google ? (['GOOGLE_REFRESH_TOKEN'] as SecretKey[]) : c.keys;
    env.set(Object.fromEntries(drop.map((k) => [k, null])));
    db.prepare('DELETE FROM sync_state WHERE name IN (?, ?)').run(google ? 'gcal' : params.name, google ? 'gmail' : params.name);
  });
}
