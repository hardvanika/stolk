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

export const VERSION = '0.1.0';

export interface AppDeps {
  db: DB;
  env: EnvFile;
  /** Injectable clock, so tests can pin "today". */
  now?: () => Date;
}

export function buildRouter({ db, env, now = () => new Date() }: AppDeps): Router {
  const r = new Router();
  r.get('/health', () => ({ ok: true, version: VERSION }), { public: true });
  contactRoutes(r, db, now);
  interactionRoutes(r, db, now);
  relationRoutes(r, db);
  eventRoutes(r, db);
  projectRoutes(r, db);
  calendarRoutes(r, db, now);
  settingsRoutes(r, db, env);

  // Step 2 and 3. The routes exist so the desktop can wire them now.
  const later = (what: string) => () => { throw new HttpError(501, 'not_implemented', `${what} is not built yet`); };
  r.post('/sync', later('Cal.com and Google sync'));
  r.post('/connections/gcal/start', later('Google Calendar connection'));
  r.post('/ask', later('Preguntar'));
  return r;
}
