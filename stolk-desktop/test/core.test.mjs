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
