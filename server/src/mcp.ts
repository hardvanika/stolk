// Stölk for Claude: an MCP server on stdio that Claude desktop or Claude Code starts on demand.
// It opens the same database as the app (~/.stolk/stolk.db), so what Claude saves shows up in Stölk.
// Started through ~/.stolk/bin/stolk-mcp, which Ajustes → Claude writes (see claude-connect.ts).
import { homedir } from 'node:os';
import { join } from 'node:path';
import { openDb } from './db.js';
import { EnvFile } from './env.js';
import { buildRouter, VERSION } from './app.js';
import { buildTools, PROMPTS, SERVER_INSTRUCTIONS } from './mcp/tools.js';
import { serveStdio } from './mcp/protocol.js';

// stdout carries the protocol; anything else printed there would break it.
const log = (m: string) => process.stderr.write(`[stolk-mcp] ${m}\n`);
console.log = (...a: unknown[]) => log(a.map(String).join(' '));
console.info = console.log;

const home = process.env.STOLK_HOME || join(homedir(), '.stolk');
const db = openDb(process.env.STOLK_DB || join(home, 'stolk.db'));
const router = buildRouter({ db, env: new EnvFile(join(home, '.env')) });

await serveStdio(
  { name: 'stolk', version: VERSION, instructions: SERVER_INSTRUCTIONS, tools: buildTools(router, db), prompts: PROMPTS, log },
  process.stdin,
  process.stdout,
);
db.close();
process.exit(0);
