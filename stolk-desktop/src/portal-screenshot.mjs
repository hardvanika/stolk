// Wayland: take a screenshot through xdg-desktop-portal. Interactive opens GNOME's own screenshot UI, where
// Ivan drags the area and presses Enter, in one step and with no "Share screen" dialog or one-time grant
// (non-interactive needs a grant GNOME only asks for while Stölk is focused). Uses python3-gi, shipped with Ubuntu.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PORTAL_SCRIPT = String.raw`
import sys, random
interactive = sys.argv[-1] == 'interactive'
from gi.repository import Gio, GLib
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
token = 'stolk%d' % random.randint(0, 1 << 30)
sender = bus.get_unique_name()[1:].replace('.', '_')
path = '/org/freedesktop/portal/desktop/request/%s/%s' % (sender, token)
loop = GLib.MainLoop()
out = {}
def on_response(conn, snd, obj, iface, sig, params):
    code, results = params.unpack()
    out['code'] = code
    out['uri'] = results.get('uri', '')
    loop.quit()
bus.signal_subscribe('org.freedesktop.portal.Desktop', 'org.freedesktop.portal.Request', 'Response', path, None, Gio.DBusSignalFlags.NO_MATCH_RULE, on_response)
opts = {'handle_token': GLib.Variant('s', token), 'interactive': GLib.Variant('b', interactive)}
bus.call_sync('org.freedesktop.portal.Desktop', '/org/freedesktop/portal/desktop', 'org.freedesktop.portal.Screenshot', 'Screenshot',
              GLib.Variant('(sa{sv})', ('', opts)), None, Gio.DBusCallFlags.NONE, -1, None)
GLib.timeout_add_seconds(170 if interactive else 20, loop.quit)
loop.run()
if out.get('code') != 0 or not out.get('uri'):
    sys.stderr.write('portal response %s\n' % out.get('code')); sys.exit(2)
print(out['uri'])
`;

// Resolves to PNG bytes, or null when Ivan cancels (portal response 1); the portal's file (usually in
// ~/Pictures/Screenshots) is removed afterwards.
// Ubuntu's own python3 has python3-gi; a conda/pyenv python3 earlier in PATH usually doesn't.
export function systemPython(exists = fs.existsSync) {
  return exists('/usr/bin/python3') ? '/usr/bin/python3' : 'python3';
}

export function portalScreenshot({ run = execFile, python = systemPython(), interactive = false } = {}) {
  return new Promise((resolve, reject) => {
    run(python, ['-c', PORTAL_SCRIPT, interactive ? 'interactive' : 'quiet'], { timeout: interactive ? 180000 : 25000 }, (err, stdout, stderr) => {
      if (err && /portal response 1\b/.test(String(stderr))) return resolve(null);
      if (err) return reject(new Error(`Portal de capturas: ${String(stderr || err.message).trim()}`));
      const uri = String(stdout).trim().split('\n').pop();
      if (!uri.startsWith('file://')) return reject(new Error('Portal de capturas: respuesta inesperada'));
      const file = fileURLToPath(uri);
      try { const png = fs.readFileSync(file); try { fs.unlinkSync(file); } catch {} resolve(png); }
      catch (e) { reject(e); }
    });
  });
}

// Portal shots cover every monitor; map one display (logical px) onto the image.
export function displayRegion(displays, display, imgW, imgH) {
  const minX = Math.min(...displays.map((d) => d.bounds.x)), minY = Math.min(...displays.map((d) => d.bounds.y));
  const maxX = Math.max(...displays.map((d) => d.bounds.x + d.bounds.width)), maxY = Math.max(...displays.map((d) => d.bounds.y + d.bounds.height));
  const sx = imgW / (maxX - minX), sy = imgH / (maxY - minY);
  return { x: Math.round((display.bounds.x - minX) * sx), y: Math.round((display.bounds.y - minY) * sy), width: Math.round(display.bounds.width * sx), height: Math.round(display.bounds.height * sy) };
}
