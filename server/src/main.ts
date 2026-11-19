import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { EnvFile } from './env.js';
import { buildRouter } from './app.js';
import { createApiServer } from './http.js';
import { ClaudeConnect } from './claude-connect.js';

const home = process.env.STOLK_HOME || join(homedir(), '.stolk');
const dbPath = process.env.STOLK_DB || join(home, 'stolk.db');
const port = Number(process.env.STOLK_PORT || 0);
const given = process.env.STOLK_TOKEN;
const token = given || randomBytes(32).toString('base64url');

const db = openDb(dbPath);
const env = new EnvFile(join(home, '.env'));
// dist/mcp.js sits next to this file in the bundle. Refresh the copy Claude runs, so it follows app updates.
const claude = new ClaudeConnect({ stolkHome: home, mcpSource: join(dirname(fileURLToPath(import.meta.url)), 'mcp.js') });
try { claude.installLauncher(); } catch (e) { console.error('No se pudo preparar el servidor para Claude:', e); }
const server = createApiServer(buildRouter({ db, env, claude }), token);

server.listen(port, '127.0.0.1', () => {
  const { port: actual } = server.address() as { port: number };
  // One JSON line on stdout: Electron main reads it to learn the port.
  const ready: Record<string, unknown> = { ready: true, port: actual };
  if (!given) ready.token = token; // dev only: no token was passed in
  process.stdout.write(JSON.stringify(ready) + '\n');
});

const stop = () => server.close(() => { db.close(); process.exit(0); });
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
// If Electron main dies, our stdin closes: exit instead of lingering.
if (process.env.STOLK_EXIT_ON_STDIN_CLOSE === '1') process.stdin.on('end', stop).resume();
