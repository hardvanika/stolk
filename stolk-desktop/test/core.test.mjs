import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/store.mjs';
import { parseContact, MODEL } from '../src/claude.mjs';
import { toGnomeBinding, addToList } from '../src/shortcut.mjs';

test('store writes atomically and falls back to defaults', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stolk-'));
  const s = createStore(dir, 'data.json', { contacts: [] });
  assert.deepEqual(s.read(), { contacts: [] });
  s.write({ contacts: [{ id: 1, name: 'Ana' }] });
  assert.equal(s.read().contacts[0].name, 'Ana');
  assert.equal(fs.existsSync(`${s.file}.tmp`), false);
  assert.equal(fs.statSync(s.file).mode & 0o777, 0o600);
});

const fakeClient = (out, seen) => ({ messages: { parse: async (req) => { seen.push(req); return { parsed_output: out }; } } });

test('parseContact sends the image and asks for the card schema', async () => {
  const seen = [];
  const card = { found: true, name: 'Ana', role: '', company: '', email: '', phone: '', linkedin: '', website: '', notes: '' };
  assert.deepEqual(await parseContact(fakeClient(card, seen), 'AAAA'), card);
  const req = seen[0];
  assert.equal(req.model, MODEL);
  assert.equal(req.messages[0].content[0].source.data, 'AAAA');
  assert.equal(req.output_config.format.type, 'json_schema');
});

test('accelerators convert to GNOME bindings', () => {
  assert.equal(toGnomeBinding('Super+K'), '<Super>k');
  assert.equal(toGnomeBinding('Ctrl+Shift+S'), '<Control><Shift>s');
  assert.equal(toGnomeBinding('Ctrl+Alt+S'), '<Control><Alt>s');
  assert.equal(toGnomeBinding('CommandOrControl+Shift+F2'), '<Control><Shift>F2');
});

test('custom keybinding list keeps existing entries and adds ours once', () => {
  const p = '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/stolk/';
  assert.equal(addToList('@as []', p), `['${p}']`);
  assert.equal(addToList("['/a/']", p), `['/a/', '${p}']`);
  assert.equal(addToList(`['/a/', '${p}']`, p), `['/a/', '${p}']`);
});

test('parseContact throws when the model returns nothing parseable', async () => {
  await assert.rejects(parseContact(fakeClient(null, []), 'AAAA'), /ficha/);
});

test('gsettings values are quoted GVariant strings', async () => {
  const { gvString } = await import('../src/shortcut.mjs');
  assert.equal(gvString('"/opt/Stölk/stolk" --capture'), `'"/opt/Stölk/stolk" --capture'`);
  assert.equal(gvString('<Control><Shift>s'), `'<Control><Shift>s'`);
  assert.equal(gvString("it's"), `'it\\'s'`);
  assert.equal(gvString('a\\b'), `'a\\\\b'`);
});

test('AppImage desktop entry points at the AppImage and matches the window class', async () => {
  const { desktopEntry, installDesktopEntry } = await import('../src/desktop-entry.mjs');
  const e = desktopEntry('/home/ivan/Aplicaciones/Stölk "nuevo".AppImage');
  assert.match(e, /^Exec="\/home\/ivan\/Aplicaciones\/Stölk \\"nuevo\\"\.AppImage" %U$/m);
  assert.match(e, /^StartupWMClass=stolk$/m);
  assert.match(e, /^Icon=stolk$/m);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stolk-xdg-'));
  const png = path.join(home, 'i.png'); fs.writeFileSync(png, Buffer.from([1, 2, 3]));
  assert.equal(installDesktopEntry({ execPath: '/a.AppImage', iconPng: png, dataHome: home }), true);
  assert.equal(installDesktopEntry({ execPath: '/a.AppImage', iconPng: png, dataHome: home }), false);
  assert.ok(fs.existsSync(path.join(home, 'icons/hicolor/512x512/apps/stolk.png')));
});

test('portal screenshot reads the returned file, deletes it, and maps displays', async () => {
  const { portalScreenshot, displayRegion } = await import('../src/portal-screenshot.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stolk-shot-'));
  const f = path.join(dir, 'Captura de pantalla.png'); fs.writeFileSync(f, Buffer.from([9, 9]));
  const png = await portalScreenshot({ run: (cmd, args, o, cb) => cb(null, `file://${encodeURI(f)}\n`, '') });
  assert.deepEqual([...png], [9, 9]);
  assert.equal(fs.existsSync(f), false);
  await assert.rejects(portalScreenshot({ run: (c, a, o, cb) => cb(new Error('x'), '', 'portal response 2') }), /portal response 2/);
  let args;
  assert.equal(await portalScreenshot({ interactive: true, run: (c, a, o, cb) => { args = a; cb(new Error('x'), '', 'portal response 1\n'); } }), null);
  assert.equal(args.at(-1), 'interactive');
  const ds = [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }, { bounds: { x: 1920, y: 0, width: 1280, height: 1024 } }];
  assert.deepEqual(displayRegion(ds, ds[1], 6400, 2160), { x: 3840, y: 0, width: 2560, height: 2048 });
});

test('dock badge sends counts to the helper, skipping repeats', async () => {
  const { createLauncherBadge } = await import('../src/launcher-badge.mjs');
  const writes = []; let args;
  const fake = (cmd, a) => { args = a; return { on() {}, stdin: { on() {}, write: (s) => writes.push(s), end() {} } }; };
  const b = createLauncherBadge({ run: fake });
  b.set(3); b.set(3); b.set(0); b.set(-2);
  assert.deepEqual(writes, ['3\n', '0\n']);
  assert.equal(args.at(-1), 'application://stolk.desktop');
});

test('systemPython prefers Ubuntu python over a conda/pyenv one in PATH', async () => {
  const { systemPython } = await import('../src/portal-screenshot.mjs');
  assert.equal(systemPython(() => true), '/usr/bin/python3');
  assert.equal(systemPython(() => false), 'python3');
});
