// An AppImage isn't "installed", so GNOME has no .desktop file to match the window to and shows a generic gear in the dock.
// On each start we write ~/.local/share/applications/stolk.desktop and the icon, pointing at the current AppImage path.
import fs from 'node:fs';
import path from 'node:path';

export const DESKTOP_ID = 'stolk';

const quoteExec = (p) => `"${String(p).replace(/(["`$\\])/g, '\\$1')}"`;

export function desktopEntry(execPath) {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Stölk',
    'Comment=Recuerda a todas las personas que conoces',
    `Exec=${quoteExec(execPath)} %U`,
    `Icon=${DESKTOP_ID}`,
    `StartupWMClass=${DESKTOP_ID}`,
    'Terminal=false',
    'Categories=Office;',
    'X-AppImage-Integrate=false',
    '',
  ].join('\n');
}

// Returns true when something was written.
export function installDesktopEntry({ execPath, iconPng, dataHome }) {
  const appsDir = path.join(dataHome, 'applications');
  const iconDir = path.join(dataHome, 'icons', 'hicolor', '512x512', 'apps');
  const file = path.join(appsDir, `${DESKTOP_ID}.desktop`);
  const icon = path.join(iconDir, `${DESKTOP_ID}.png`);
  const want = desktopEntry(execPath);
  const iconData = fs.readFileSync(iconPng);
  let changed = false;
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== want) {
    fs.mkdirSync(appsDir, { recursive: true });
    fs.writeFileSync(file, want, { mode: 0o644 });
    changed = true;
  }
  if (!fs.existsSync(icon) || !fs.readFileSync(icon).equals(iconData)) {
    fs.mkdirSync(iconDir, { recursive: true });
    fs.writeFileSync(icon, iconData, { mode: 0o644 });
    // GNOME keeps showing the old icon until the theme folder's mtime changes.
    try { const now = new Date(); fs.utimesSync(path.join(dataHome, 'icons', 'hicolor'), now, now); } catch {}
    changed = true;
  }
  return changed;
}
