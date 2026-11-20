// An AppImage isn't "installed", so GNOME has no .desktop file to match the window to and shows a generic gear in the dock.
// On each start we write ~/.local/share/applications/stolk.desktop and the icon, pointing at the current AppImage path.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const DESKTOP_ID = 'stolk';

const quoteExec = (p) => `"${String(p).replace(/(["`$\\])/g, '\\$1')}"`;

export function desktopEntry(execPath, iconName = DESKTOP_ID) {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Stölk',
    'Comment=Recuerda a todas las personas que conoces',
    `Exec=${quoteExec(execPath)} %U`,
    `Icon=${iconName}`,
    `StartupWMClass=${DESKTOP_ID}`,
    'Terminal=false',
    'Categories=Office;',
    'X-AppImage-Integrate=false',
    '',
  ].join('\n');
}

// Returns true when something was written. The icon's name carries a hash of its content: GNOME Shell keeps
// icons it has loaded by name, so a new name is the only sure way to show a changed icon without a re-login.
export function installDesktopEntry({ execPath, iconPng, dataHome }) {
  const appsDir = path.join(dataHome, 'applications');
  const iconDir = path.join(dataHome, 'icons', 'hicolor', '512x512', 'apps');
  const iconData = fs.readFileSync(iconPng);
  const iconName = `${DESKTOP_ID}-${crypto.createHash('sha1').update(iconData).digest('hex').slice(0, 8)}`;
  const file = path.join(appsDir, `${DESKTOP_ID}.desktop`);
  const icon = path.join(iconDir, `${iconName}.png`);
  const want = desktopEntry(execPath, iconName);
  let changed = false;
  if (!fs.existsSync(icon)) {
    fs.mkdirSync(iconDir, { recursive: true });
    fs.writeFileSync(icon, iconData, { mode: 0o644 });
    for (const f of fs.readdirSync(iconDir)) {
      if (f !== `${iconName}.png` && (f === `${DESKTOP_ID}.png` || /^stolk-[0-9a-f]{8}\.png$/.test(f))) fs.rmSync(path.join(iconDir, f), { force: true });
    }
    try { const now = new Date(); fs.utimesSync(path.join(dataHome, 'icons', 'hicolor'), now, now); } catch {}
    changed = true;
  }
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== want) {
    fs.mkdirSync(appsDir, { recursive: true });
    fs.writeFileSync(file, want, { mode: 0o644 });
    changed = true;
  }
  return changed;
}
