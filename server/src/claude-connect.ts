// Ajustes → Claude: registers Stölk's MCP server with Claude desktop and Claude Code on this computer.
//
// Both apps start the server through one fixed launcher, ~/.stolk/bin/stolk-mcp, which this module rewrites
// every time Stölk starts. An update can move the app (the AppImage name carries the version), but the
// path in Claude's config never changes, so nothing has to be reconnected after an update.
import { execFile } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { HttpError } from './http.js';

export const SERVER_NAME = 'stolk';
export type Target = 'desktop' | 'code';
export const TARGETS: Target[] = ['desktop', 'code'];

export interface ClaudeConnectOptions {
  homeDir?: string;
  /** Where Stölk keeps its files (default ~/.stolk). */
  stolkHome?: string;
  /** The bundled MCP server to copy, normally dist/mcp.js next to the running server. */
  mcpSource?: string;
  /** The program that runs mcp.js: the AppImage or Electron binary (with ELECTRON_RUN_AS_NODE), or node. */
  runtime?: string;
  /** Runs the `claude` CLI; null turns it off (tests), and the config file is edited directly. */
  runCli?: ((args: string[]) => Promise<void>) | null;
}

function defaultCli(home: string) {
  const PATH = [join(home, '.local', 'bin'), join(home, '.claude', 'local'), '/usr/local/bin', '/usr/bin', process.env.PATH ?? ''].join(':');
  return (args: string[]) =>
    new Promise<void>((ok, fail) => {
      execFile('claude', args, { env: { ...process.env, PATH }, timeout: 15_000 }, (e) => (e ? fail(e) : ok()));
    });
}

const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export class ClaudeConnect {
  readonly home: string;
  readonly stolkHome: string;
  readonly launcher: string;
  readonly script: string;
  private runCli: ((args: string[]) => Promise<void>) | null;

  constructor(private o: ClaudeConnectOptions = {}) {
    this.home = o.homeDir ?? homedir();
    this.stolkHome = o.stolkHome ?? join(this.home, '.stolk');
    this.launcher = join(this.stolkHome, 'bin', 'stolk-mcp');
    this.script = join(this.stolkHome, 'mcp', 'stolk-mcp.js');
    this.runCli = o.runCli === undefined ? defaultCli(this.home) : o.runCli;
  }

  configPath(t: Target): string {
    if (t === 'code') return join(this.home, '.claude.json');
    const xdg = process.env.XDG_CONFIG_HOME && !this.o.homeDir ? process.env.XDG_CONFIG_HOME : join(this.home, '.config');
    return join(xdg, 'Claude', 'claude_desktop_config.json');
  }

  /** Is the app on this computer? Claude desktop creates its config folder on first run; Claude Code writes ~/.claude.json. */
  private available(t: Target): boolean {
    return existsSync(t === 'code' ? this.configPath(t) : dirname(this.configPath(t)));
  }

  private readConfig(t: Target): any {
    const p = this.configPath(t);
    if (!existsSync(p)) return {};
    const text = readFileSync(p, 'utf8');
    if (!text.trim()) return {};
    try {
      const v = JSON.parse(text);
      if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    } catch { /* fall through */ }
    // Never overwrite a file we cannot read: Claude's other settings live there too.
    throw new HttpError(409, 'claude_config', `No se puede leer ${p}. Arréglalo o bórralo y vuelve a intentarlo.`);
  }

  private writeConfig(t: Target, cfg: any) {
    const p = this.configPath(t);
    mkdirSync(dirname(p), { recursive: true });
    const mode = existsSync(p) ? statSync(p).mode & 0o777 : 0o600;
    const tmp = `${p}.stolk-${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', { mode });
    renameSync(tmp, p); // atomic: Claude never sees a half-written file
  }

  status() {
    const out: Record<Target, { available: boolean; connected: boolean; config: string }> = {} as any;
    for (const t of TARGETS) {
      let connected = false;
      try { connected = !!this.readConfig(t).mcpServers?.[SERVER_NAME]; } catch { /* unreadable: not connected */ }
      out[t] = { available: this.available(t), connected, config: this.configPath(t) };
    }
    return { ...out, launcher: this.launcher, installed: existsSync(this.launcher) && existsSync(this.script) };
  }

  /** Copies the MCP server to ~/.stolk/mcp and (re)writes the launcher. Cheap; runs at every start. */
  installLauncher(): boolean {
    const src = this.o.mcpSource;
    if (!src || !existsSync(src)) return false;
    mkdirSync(dirname(this.script), { recursive: true, mode: 0o700 });
    mkdirSync(dirname(this.launcher), { recursive: true, mode: 0o700 });
    copyFileSync(src, this.script);
    const runtime = this.o.runtime ?? process.env.APPIMAGE ?? process.execPath;
    const sh = [
      '#!/bin/sh',
      '# Written by Stölk at every start: runs Stölk\'s MCP server for Claude. Do not edit.',
      `ELECTRON_RUN_AS_NODE=1 STOLK_HOME=${shQuote(this.stolkHome)} exec ${shQuote(runtime)} ${shQuote(this.script)} "$@"`,
      '',
    ].join('\n');
    const prev = existsSync(this.launcher) ? readFileSync(this.launcher, 'utf8') : '';
    if (prev !== sh) writeFileSync(this.launcher, sh, { mode: 0o755 });
    chmodSync(this.launcher, 0o755);
    return true;
  }

  async connect(t: Target) {
    if (!this.installLauncher() && !existsSync(this.launcher)) {
      throw new HttpError(409, 'mcp_missing', 'Falta el servidor de Stölk para Claude. Reinstala Stölk.');
    }
    if (t === 'code' && this.runCli) {
      // The official way; it also covers Claude Code installs that keep settings elsewhere.
      try {
        await this.runCli(['mcp', 'remove', '--scope', 'user', SERVER_NAME]).catch(() => {});
        await this.runCli(['mcp', 'add', '--scope', 'user', SERVER_NAME, '--', this.launcher]);
        if (this.status().code.connected) return this.status();
      } catch { /* no CLI on PATH: edit the file below */ }
    }
    const cfg = this.readConfig(t);
    const entry = t === 'code' ? { type: 'stdio', command: this.launcher, args: [], env: {} } : { command: this.launcher, args: [] };
    cfg.mcpServers = { ...(cfg.mcpServers ?? {}), [SERVER_NAME]: entry };
    this.writeConfig(t, cfg);
    return this.status();
  }

  async disconnect(t: Target) {
    if (t === 'code' && this.runCli) await this.runCli(['mcp', 'remove', '--scope', 'user', SERVER_NAME]).catch(() => {});
    const cfg = this.readConfig(t);
    if (cfg.mcpServers?.[SERVER_NAME]) {
      delete cfg.mcpServers[SERVER_NAME];
      this.writeConfig(t, cfg);
    }
    return this.status();
  }
}
