// Small JSON file for the shell's own settings (shortcut, side panel). Contacts and the rest live in the server's SQLite.
// Writes go to a temp file first so a crash never leaves half a file.
import fs from 'node:fs';
import path from 'node:path';

export function createStore(dir, name, defaults) {
  const file = path.join(dir, name);
  const read = () => {
    try { return { ...defaults, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; }
    catch (e) { if (e.code !== 'ENOENT') console.error(`No se pudo leer ${file}:`, e.message); return { ...defaults }; }
  };
  const write = (value) => {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  };
  return { file, read, write };
}
