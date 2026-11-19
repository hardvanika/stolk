import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { openDb, type DB } from '../src/db.js';
import { EnvFile } from '../src/env.js';
import { buildRouter } from '../src/app.js';
import { seedDemo } from '../src/seed.js';
import { buildTools, PROMPTS, SERVER_INSTRUCTIONS } from '../src/mcp/tools.js';
import { handleMessage, serveStdio, type McpOptions } from '../src/mcp/protocol.js';
import { ClaudeConnect } from '../src/claude-connect.js';
import { callRoute } from '../src/mcp/tools.js';

let db: DB;
let opts: McpOptions;
let dir: string;
const now = () => new Date(2026, 10, 19, 18, 30);

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'stolk-mcp-'));
  db = openDb(join(dir, 'stolk.db'));
  seedDemo(db);
  const router = buildRouter({ db, env: new EnvFile(join(dir, '.env')), now });
  opts = { name: 'stolk', version: 'test', instructions: SERVER_INSTRUCTIONS, tools: buildTools(router, db, now), prompts: PROMPTS };
});
after(() => db.close());

let nextId = 1;
async function rpc(method: string, params?: unknown) {
  const res: any = await handleMessage(opts, { jsonrpc: '2.0', id: nextId++, method, params });
  return res;
}
async function tool(name: string, args: Record<string, unknown> = {}) {
  const res = await rpc('tools/call', { name, arguments: args });
  assert.ok(res.result, JSON.stringify(res));
  const text = res.result.content[0].text;
  return { isError: !!res.result.isError, text, data: res.result.isError ? undefined : JSON.parse(text) };
}

test('initialize negotiates the protocol version and gives instructions', async () => {
  const r = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  assert.equal(r.result.protocolVersion, '2025-06-18');
  assert.ok(r.result.capabilities.tools);
  assert.match(r.result.instructions, /pásalo a Stölk/);
  const old = await rpc('initialize', { protocolVersion: '1999-01-01' });
  assert.equal(old.result.protocolVersion, '2025-11-25');
  assert.equal(await handleMessage(opts, { jsonrpc: '2.0', method: 'notifications/initialized' }), undefined);
  assert.equal((await rpc('nope')).error.code, -32601);
});

test('tools/list exposes the tools with JSON schemas', async () => {
  const r = await rpc('tools/list');
  const names = r.result.tools.map((t: any) => t.name);
  for (const n of ['search_contacts', 'get_contact', 'add_contact', 'update_contact', 'log_interaction', 'add_task', 'list_tasks', 'complete_task', 'list_projects', 'add_project']) {
    assert.ok(names.includes(n), n);
  }
  for (const t of r.result.tools) assert.equal(t.inputSchema.type, 'object');
  const p = await rpc('prompts/get', { name: 'pasar_a_stolk' });
  assert.match(p.result.messages[0].content.text, /Stölk/);
});

test('add_contact creates, then refuses a duplicate and points to the existing person', async () => {
  const a = await tool('add_contact', { name: 'Lucía Ferrer', company: 'Fjord Labs', email: 'LUCIA@fjord.dev', tags: ['inversora'] });
  assert.equal(a.data.created, true);
  const id = a.data.contact.id;
  const dup = await tool('add_contact', { name: 'Lucia Ferrer', email: 'lucia@fjord.dev' });
  assert.equal(dup.data.created, false);
  assert.equal(dup.data.matches[0].id, id);
  const forced = await tool('add_contact', { name: 'Lucía Ferrer', allowDuplicate: true });
  assert.equal(forced.data.created, true);
  const found = await tool('search_contacts', { query: 'fjord' });
  assert.ok(found.data.contacts.some((c: any) => c.id === id));
});

test('update_contact appends a dated note and merges tags', async () => {
  const { data } = await tool('add_contact', { name: 'Tomás Rey', notes: 'Conocido en el meetup.', tags: ['madrid'] });
  const id = data.contact.id;
  const u = await tool('update_contact', { id, role: 'CTO', addNote: 'Busca socio técnico.', addTags: ['ia', 'madrid'] });
  assert.equal(u.data.contact.role, 'CTO');
  assert.equal(u.data.contact.notes, 'Conocido en el meetup.\n2026-11-19: Busca socio técnico.');
  assert.deepEqual(u.data.contact.tags, ['madrid', 'ia']);
});

test('log_interaction defaults to today and shows up in the contact history', async () => {
  const { data } = await tool('add_contact', { name: 'Marta Gil' });
  const id = data.contact.id;
  const l = await tool('log_interaction', { contactId: id, text: 'Hablamos de la ronda.', followUp: '2026-11-26' });
  assert.equal(l.data.interaction.date, '2026-11-19');
  assert.equal(l.data.interaction.ch, 'reunion');
  assert.equal(l.data.contact, 'Marta Gil');
  const c = await tool('get_contact', { id });
  assert.equal(c.data.interactions[0].text, 'Hablamos de la ronda.');
  assert.equal(c.data.interactions[0].follow, '2026-11-26');
});

test('add_task files into a named project (created on demand) or Pendientes, and links the person', async () => {
  const { data } = await tool('add_contact', { name: 'Iker Sanz' });
  const cid = data.contact.id;
  const t1 = await tool('add_task', { text: 'Enviar el deck', contactId: cid, project: 'Ronda semilla', due: '2026-11-25' });
  assert.equal(t1.data.project.title, 'Ronda semilla');
  assert.equal(t1.data.task.cid, cid);
  const again = await tool('add_task', { text: 'Pedir referencias', project: 'ronda SEMILLA' });
  assert.equal(again.data.project.id, t1.data.project.id);
  const loose = await tool('add_task', { text: 'Llamar al notario' });
  assert.equal(loose.data.project.title, 'Pendientes');
  const projects = await tool('list_projects');
  const ronda = projects.data.find((p: any) => p.title === 'Ronda semilla');
  assert.equal(ronda.openTasks, 2);
  assert.ok(ronda.people.some((p: any) => p.id === cid && p.name === 'Iker Sanz'));
  const done = await tool('complete_task', { id: t1.data.task.id });
  assert.equal(done.data.task.st, 'hecho');
  const pending = await tool('list_tasks', { status: 'pendiente' });
  assert.ok(!pending.data.some((t: any) => t.id === t1.data.task.id));
  assert.ok(pending.data.some((t: any) => t.text === 'Pedir referencias' && t.project === 'Ronda semilla'));
});

test('mistakes come back as tool errors Claude can read, not protocol errors', async () => {
  const r = await tool('get_contact', { id: 999999 });
  assert.equal(r.isError, true);
  assert.match(r.text, /not found/i);
  const bad = await tool('log_interaction', { contactId: 1, text: 'x', channel: 'paloma' });
  assert.equal(bad.isError, true);
  const unknown = await rpc('tools/call', { name: 'delete_everything', arguments: {} });
  assert.equal(unknown.error.code, -32602);
});

test('serveStdio answers newline-delimited JSON-RPC in order', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let out = '';
  output.on('data', (c) => { out += c; });
  const done = serveStdio(opts, input, output);
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }) + '\n');
  input.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n{bad json\n');
  input.end(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'search_contacts', arguments: { query: 'Marta' } } }) + '\n');
  await done;
  const lines = out.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 3);
  assert.equal(lines[0].id, 1);
  assert.equal(lines[1].error.code, -32700);
  assert.equal(lines[2].id, 2);
  assert.match(lines[2].result.content[0].text, /Marta Gil/);
});

test('ClaudeConnect registers Stölk with Claude desktop and Claude Code without touching other settings', async () => {
  const home = mkdtempSync(join(tmpdir(), 'stolk-home-'));
  const src = join(home, 'mcp.js');
  writeFileSync(src, '// bundled server\n');
  mkdirSync(join(home, '.config', 'Claude'), { recursive: true });
  const desktopCfg = join(home, '.config', 'Claude', 'claude_desktop_config.json');
  writeFileSync(desktopCfg, JSON.stringify({ mcpServers: { other: { command: 'x' } }, globalShortcut: 'Alt+Space' }));
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ numStartups: 4, projects: { '/a': {} } }), { mode: 0o600 });
  const cc = new ClaudeConnect({ homeDir: home, mcpSource: src, runtime: '/opt/Stölk/stolk', runCli: null });

  let s = cc.status();
  assert.deepEqual([s.desktop.available, s.desktop.connected, s.code.available, s.code.connected], [true, false, true, false]);

  s = await cc.connect('desktop');
  assert.equal(s.desktop.connected, true);
  const d = JSON.parse(readFileSync(desktopCfg, 'utf8'));
  assert.equal(d.globalShortcut, 'Alt+Space');
  assert.equal(d.mcpServers.other.command, 'x');
  assert.equal(d.mcpServers.stolk.command, cc.launcher);

  s = await cc.connect('code');
  const c = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8'));
  assert.equal(c.numStartups, 4);
  assert.deepEqual(c.mcpServers.stolk, { type: 'stdio', command: cc.launcher, args: [], env: {} });
  assert.equal(statSync(join(home, '.claude.json')).mode & 0o777, 0o600);

  const sh = readFileSync(cc.launcher, 'utf8');
  assert.match(sh, /ELECTRON_RUN_AS_NODE=1 STOLK_HOME='.*\/\.stolk' exec '\/opt\/Stölk\/stolk' '.*stolk-mcp\.js'/);
  assert.equal(statSync(cc.launcher).mode & 0o111, 0o111);
  assert.ok(existsSync(cc.script));

  await cc.disconnect('desktop');
  assert.equal(JSON.parse(readFileSync(desktopCfg, 'utf8')).mcpServers.other.command, 'x');
  assert.equal(cc.status().desktop.connected, false);

  writeFileSync(desktopCfg, '{ broken');
  await assert.rejects(cc.connect('desktop'), /No se puede leer/);
  assert.equal(readFileSync(desktopCfg, 'utf8'), '{ broken');
});

test('/integrations/claude routes go through the app router', async () => {
  const home = mkdtempSync(join(tmpdir(), 'stolk-home-'));
  const src = join(home, 'mcp.js');
  writeFileSync(src, '//\n');
  const claude = new ClaudeConnect({ homeDir: home, mcpSource: src, runtime: 'node', runCli: null });
  const router = buildRouter({ db, env: new EnvFile(join(dir, '.env')), now, claude });
  assert.equal((await callRoute(router, 'GET', '/integrations/claude')).desktop.available, false);
  const s = await callRoute(router, 'POST', '/integrations/claude/desktop');
  assert.equal(s.desktop.connected, true);
  await assert.rejects(callRoute(router, 'POST', '/integrations/claude/chrome'), /desktop o code/);
  await callRoute(router, 'DELETE', '/integrations/claude/desktop');
  assert.equal((await callRoute(router, 'GET', '/integrations/claude')).desktop.connected, false);
});

test('the built launcher runs the real MCP server end to end against a database file', { skip: !existsSync(new URL('../../dist/mcp.js', import.meta.url)) && 'run npm run build first' }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'stolk-e2e-'));
  const cc = new ClaudeConnect({ homeDir: home, mcpSource: new URL('../../dist/mcp.js', import.meta.url).pathname, runtime: process.execPath, runCli: null });
  cc.installLauncher();
  const child = spawn(cc.launcher, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (c) => { out += c; });
  const msgs = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'add_contact', arguments: { name: 'Ana Prueba', company: 'Stölk' } } },
  ];
  child.stdin.end(msgs.map((m) => JSON.stringify(m)).join('\n') + '\n');
  const code = await new Promise((ok) => child.on('exit', ok));
  assert.equal(code, 0);
  const lines = out.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines[0].result.serverInfo.name, 'stolk');
  assert.equal(JSON.parse(lines[1].result.content[0].text).created, true);
  // The app sees it: same file under STOLK_HOME.
  const check = openDb(join(home, '.stolk', 'stolk.db'));
  assert.equal((check.prepare('SELECT name FROM contacts').get() as any).name, 'Ana Prueba');
  check.close();
});
