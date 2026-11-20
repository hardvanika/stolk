// Number badge on the dock icon (Ubuntu Dock / Dash to Dock read the Unity LauncherEntry D-Bus signal).
// Electron's app.setBadgeCount only does this under Unity, so a small python3-gi helper (shipped with Ubuntu)
// stays alive and emits the signal. The dock drops the badge when the helper's bus name goes away.
import { spawn } from 'node:child_process';
import { systemPython } from './portal-screenshot.mjs';

export const BADGE_SCRIPT = String.raw`
import sys
from gi.repository import Gio, GLib
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
app_uri = sys.argv[1]
for line in sys.stdin:
    try: n = max(0, int(line.strip()))
    except ValueError: continue
    props = {'count': GLib.Variant('x', n), 'count-visible': GLib.Variant('b', n > 0)}
    bus.emit_signal(None, '/com/canonical/unity/launcherentry/stolk', 'com.canonical.Unity.LauncherEntry', 'Update', GLib.Variant('(sa{sv})', (app_uri, props)))
    bus.flush_sync(None)
`;

export function createLauncherBadge({ desktopId = 'stolk.desktop', run = spawn } = {}) {
  let child = null, last = null, broken = false;
  const start = () => {
    if (child || broken) return child;
    child = run(systemPython(), ['-c', BADGE_SCRIPT, `application://${desktopId}`], { stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', () => { broken = true; child = null; });
    child.on('exit', () => { child = null; });
    child.stdin.on('error', () => {});
    return child;
  };
  return {
    set(n) {
      n = Math.max(0, Math.floor(Number(n) || 0));
      if (n === last) return;
      last = n;
      const c = start();
      if (c) c.stdin.write(`${n}\n`);
    },
    stop() { if (child) { child.stdin.end(); child = null; } },
  };
}
