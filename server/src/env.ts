import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Keys the server knows about. Values live only in ~/.stolk/.env (mode 600) or the process env. */
export const SECRET_KEYS = ['ANTHROPIC_API_KEY', 'CALCOM_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'NOTION_TOKEN'] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

export class EnvFile {
  constructor(private path: string) {}

  private read(): Map<string, string> {
    const out = new Map<string, string>();
    if (!existsSync(this.path)) return out;
    for (const line of readFileSync(this.path, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      out.set(m[1], v);
    }
    return out;
  }

  /** The process environment wins over the file, so a key can be injected without writing it to disk. */
  get(key: SecretKey): string | undefined {
    return process.env[key] || this.read().get(key) || undefined;
  }

  has(key: SecretKey) {
    return !!this.get(key);
  }

  set(values: Partial<Record<SecretKey, string | null>>) {
    const cur = this.read();
    for (const [k, v] of Object.entries(values)) {
      if (v == null || v === '') cur.delete(k);
      else cur.set(k, v);
    }
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const body = [...cur.entries()].map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('\n') + '\n';
    writeFileSync(this.path, body, { mode: 0o600 });
    chmodSync(this.path, 0o600);
  }
}
