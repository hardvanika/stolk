import type { DB } from '../db.js';
import type { EnvFile } from '../env.js';
import { Router, Html, bad } from '../http.js';
import { intParam, todayIso, validate } from '../util.js';
import { getContact } from './contacts.js';
import { mapInteraction } from './interactions.js';
import type { Syncer } from '../sync/index.js';
import { startGoogleAuth, finishGoogleAuth } from '../sync/google.js';
import type { Fetch } from '../sync/fetch.js';

const page = (title: string, text: string) => new Html(`<!doctype html><meta charset="utf-8"><title>Stölk</title>
<body style="font:16px system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px;color:#111">
<h1 style="font-size:22px">${title}</h1><p>${text}</p></body>`);

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

// What clicking a chat button in a person's card logs in their history.
const OPENED: Record<string, { ch: string; text: string }> = {
  whatsapp: { ch: 'mensaje', text: 'Abriste el chat de WhatsApp' },
  telegram: { ch: 'mensaje', text: 'Abriste el chat de Telegram' },
  gmail: { ch: 'email', text: 'Abriste Gmail para escribirle' },
  linkedin: { ch: 'mensaje', text: 'Abriste su perfil de LinkedIn' },
};

export function syncRoutes(r: Router, db: DB, env: EnvFile, syncer: Syncer, f: Fetch, now: () => Date) {
  r.post('/sync', async () => syncer.syncAll());

  // Google sign-in: the desktop opens authUrl in the browser; Google redirects back to us.
  r.post('/connections/gcal/start', ({ body, host }) => {
    const v = validate(body ?? {}, { clientId: { kind: 'string' }, clientSecret: { kind: 'string' } });
    if (v.clientId || v.clientSecret) {
      if (!v.clientId?.trim() || !v.clientSecret?.trim()) throw bad('Give both clientId and clientSecret');
      env.set({ GOOGLE_CLIENT_ID: v.clientId.trim(), GOOGLE_CLIENT_SECRET: v.clientSecret.trim() });
    }
    const clientId = env.get('GOOGLE_CLIENT_ID');
    if (!clientId || !env.get('GOOGLE_CLIENT_SECRET')) throw bad('First save your Google OAuth client (clientId and clientSecret)');
    return startGoogleAuth(clientId, `http://${host}/oauth/gcal/callback`);
  });

  // Public: the browser lands here without our token. The one-time state ties it to a start call.
  r.get('/oauth/gcal/callback', async ({ query }) => {
    const err = query.get('error');
    if (err) return page('No se conectó Google', `Google respondió: ${esc(err)}. Puedes cerrar esta pestaña y volver a intentarlo desde Stölk.`);
    const code = query.get('code'), state = query.get('state');
    if (!code || !state) return page('Falta información', 'Vuelve a Stölk y pulsa otra vez «Conectar Google».');
    try {
      const refresh = await finishGoogleAuth(f, {
        clientId: env.get('GOOGLE_CLIENT_ID')!, clientSecret: env.get('GOOGLE_CLIENT_SECRET')!, code, state,
      });
      env.set({ GOOGLE_REFRESH_TOKEN: refresh });
      void syncer.syncAll().catch(() => {});
      return page('Google conectado', 'Stölk ya puede leer tu Google Calendar y las cabeceras de Gmail. Puedes cerrar esta pestaña.');
    } catch (e) {
      return page('No se conectó Google', esc((e as Error).message));
    }
  }, { public: true });

  // A chat button was clicked in a person's card: note it in their history once per channel per day.
  r.post('/contacts/:id/opened', ({ params, body }) => {
    const cid = intParam(params.id);
    getContact(db, cid);
    const v = validate(body, { channel: { kind: { enum: Object.keys(OPENED) }, required: true } });
    const o = OPENED[v.channel];
    const date = todayIso(now());
    const ext = `${cid}:${v.channel}:${date}`;
    db.prepare(`INSERT INTO interactions (cid, date, ch, text, source, external_id) VALUES (?, ?, ?, ?, 'opened', ?)
                ON CONFLICT DO NOTHING`).run(cid, date, o.ch, o.text, ext);
    return mapInteraction(db.prepare("SELECT * FROM interactions WHERE source = 'opened' AND external_id = ?").get(ext));
  });
}
