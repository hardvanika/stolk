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

export const VERSION = '0.1.0';

export interface AppDeps {
  db: DB;
  env: EnvFile;
  /** Injectable clock, so tests can pin "today". */
  now?: () => Date;
  /** Injectable fetch for Cal.com and Google, so tests never touch the network. */
  fetch?: Fetch;
}

export function buildRouter({ db, env, now = () => new Date(), fetch: f = fetch }: AppDeps): Router {
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

  // Step 3. The route exists so the desktop can wire it now.
  r.post('/ask', () => { throw new HttpError(501, 'not_implemented', 'Preguntar is not built yet'); });
  return r;
}
