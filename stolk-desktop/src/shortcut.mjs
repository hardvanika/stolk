// GNOME on Wayland does not deliver app-registered global shortcuts, so Stölk can also install a GNOME custom
// keyboard shortcut that runs "stolk --capture". The running app receives it through its single-instance lock.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const LIST_SCHEMA = 'org.gnome.settings-daemon.plugins.media-keys';
const ITEM_SCHEMA = 'org.gnome.settings-daemon.plugins.media-keys.custom-keybinding';
export const STOLK_PATH = '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/stolk/';

const MODS = { super: '<Super>', meta: '<Super>', ctrl: '<Control>', control: '<Control>', commandorcontrol: '<Control>', cmdorctrl: '<Control>', alt: '<Alt>', shift: '<Shift>' };
export function toGnomeBinding(accel) {
  const parts = accel.split('+').map((p) => p.trim()).filter(Boolean);
  const key = parts.pop();
  const mods = parts.map((p) => MODS[p.toLowerCase()] || '').join('');
  return mods + (key.length === 1 ? key.toLowerCase() : key);
}

export function addToList(current, path) {
  const items = [...current.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  if (!items.includes(path)) items.push(path);
  return `[${items.map((i) => `'${i}'`).join(', ')}]`;
}

// gsettings parses values as GVariant text; a bare value that starts with " or < is not a valid string literal,
// so every string goes in single quotes with \ and ' escaped.
export const gvString = (v) => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

export async function installGnomeShortcut({ accel, command }) {
  const { stdout } = await run('gsettings', ['get', LIST_SCHEMA, 'custom-keybindings']);
  await run('gsettings', ['set', LIST_SCHEMA, 'custom-keybindings', addToList(stdout.trim(), STOLK_PATH)]);
  const item = `${ITEM_SCHEMA}:${STOLK_PATH}`;
  await run('gsettings', ['set', item, 'name', gvString('Stölk: guardar persona')]);
  await run('gsettings', ['set', item, 'command', gvString(command)]);
  await run('gsettings', ['set', item, 'binding', gvString(toGnomeBinding(accel))]);
  return toGnomeBinding(accel);
}
