import type { DB } from './db.js';
import { Router, HttpError } from './http.js';
import type { EnvFile } from './env.js';
import { contactRoutes } from './routes/contacts.js';
import { interactionRoutes } from './routes/interactions.js';
import { relationRoutes } from './routes/relations.js';
import { eventRoutes } from './routes/events.js';
import { projectRoutes } from './routes/projects.js';
import { calendarRoutes } from './routes/calendar.js';
import { settingsRoutes } from './routes/settings.js';
import { syncRoutes } from './routes/sync.js';
import { Syncer } from './sync/index.js';
import type { Fetch } from './sync/fetch.js';
import { ask, parseAttachments, parseHistory, type CreateMessage } from './ask.js';
import { getSettings } from './routes/settings.js';
import { ClaudeConnect, TARGETS, type Target } from './claude-connect.js';

export const VERSION = '0.1.0';

export interface AppDeps {
  db: DB;
  env: EnvFile;
  /** Injectable clock, so tests can pin "today". */
  now?: () => Date;
  /** Injectable fetch for Cal.com and Google, so tests never touch the network. */
  fetch?: Fetch;
  /** Injectable Claude call for /ask tests. */
  createMessage?: CreateMessage;
  /** Registers Stölk with Claude desktop and Claude Code (Ajustes → Claude). Tests pass one on a temp home. */
  claude?: ClaudeConnect;
}

export function buildRouter({ db, env, now = () => new Date(), fetch: f = fetch, createMessage, claude }: AppDeps): Router {
  const r = new Router();
  const syncer = new Syncer(db, env, f, now);
  r.get('/health', () => ({ ok: true, version: VERSION }), { public: true });
  contactRoutes(r, db, now);
  interactionRoutes(r, db, now);
  relationRoutes(r, db);
  eventRoutes(r, db, syncer);
  projectRoutes(r, db);
  calendarRoutes(r, db, now);
  settingsRoutes(r, db, env);
  syncRoutes(r, db, env, syncer, f, now);

  // Preguntar: one Claude call with Ivan's data. Runs only when he presses Send in the app.
  r.post('/ask', async ({ body }) => {
    const attachments = parseAttachments(body?.attachments);
    const history = parseHistory(body?.history);
    let q = typeof body?.question === 'string' ? body.question.trim() : '';
    if (!q && attachments.length) q = '¿Qué ves en esto y qué tiene que ver con mis datos?';
    if (!q) throw new HttpError(400, 'bad_request', 'Escribe una pregunta');
    if (q.length > 4000) throw new HttpError(400, 'bad_request', 'La pregunta es demasiado larga');
    const s = getSettings(db);
    if (!s.claudeOn) throw new HttpError(409, 'claude_off', 'Claude está desactivado en Ajustes');
    return ask(db, env, q, { now: now(), model: s.claudeModel, create: createMessage, history, attachments });
  });

  // Ajustes → Claude: let Claude desktop and Claude Code save people, notes and tasks here (MCP).
  if (claude) {
    const target = (t: string): Target => {
      if (!TARGETS.includes(t as Target)) throw new HttpError(404, 'not_found', 'Usa desktop o code');
      return t as Target;
    };
    r.get('/integrations/claude', () => claude.status());
    r.post('/integrations/claude/:target', ({ params }) => claude.connect(target(params.target)));
    r.delete('/integrations/claude/:target', async ({ params }) => { await claude.disconnect(target(params.target)); });
  }
  return r;
}
