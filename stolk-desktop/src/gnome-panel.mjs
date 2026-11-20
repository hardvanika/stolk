// Side panel on GNOME: an app can't reserve part of the screen there, so Stölk ships a small GNOME Shell
// extension (gnome-extension/) that does. Copying it into ~/.local/share/gnome-shell/extensions and enabling it
// is enough on X11; on Wayland GNOME only picks up a new extension at the next login.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

export const EXTENSION_UUID = 'stolk-panel@hardvanika.github.io';
const FILES = ['metadata.json', 'extension.js'];
const run = promisify(execFile);

// Returns true when the files on disk changed (a new or updated extension).
export function copyExtension({ from, dataHome }) {
  const dir = path.join(dataHome, 'gnome-shell', 'extensions', EXTENSION_UUID);
  let changed = false;
  for (const f of FILES) {
    const want = fs.readFileSync(path.join(from, f));
    const dest = path.join(dir, f);
    if (fs.existsSync(dest) && fs.readFileSync(dest).equals(want)) continue;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(dest, want, { mode: 0o644 });
    changed = true;
  }
  return changed;
}

// 'active' when GNOME is running it now, 'relogin' when it waits for the next login, 'unavailable' off GNOME.
export async function installPanelExtension({ from, dataHome, exec = run }) {
  try { await exec('gnome-extensions', ['version']); } catch { return 'unavailable'; }
  copyExtension({ from, dataHome });
  try { await exec('gnome-extensions', ['enable', EXTENSION_UUID]); } catch { /* not loaded yet: enabled below */ }
  try {
    const { stdout } = await exec('gsettings', ['get', 'org.gnome.shell', 'enabled-extensions']);
    if (!stdout.includes(EXTENSION_UUID)) {
      const items = [...stdout.matchAll(/'([^']+)'/g)].map((m) => m[1]).concat(EXTENSION_UUID);
      await exec('gsettings', ['set', 'org.gnome.shell', 'enabled-extensions', `[${items.map((i) => `'${i}'`).join(', ')}]`]);
    }
  } catch { /* gsettings missing: nothing else to try */ }
  try {
    const { stdout } = await exec('gnome-extensions', ['info', EXTENSION_UUID]);
    return /State:\s*(ACTIVE|ENABLED)/i.test(stdout) ? 'active' : 'relogin';
  } catch { return 'relogin'; }
}
