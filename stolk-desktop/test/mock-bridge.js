// In-memory stand-in for Electron's window.stolk + the local server, following plan/stolk-api-interface.md.
// Loaded only by the UI test (test/ui.mjs); never shipped.
(() => {
  const S = JSON.parse(JSON.stringify(window.STOLK_SAMPLE));
  S.settings = { blockEvents: true, claudeOn: true, theme: 'claro', calTypes: [], claudeModel: 'claude-opus-5-5', captureShortcut: 'Ctrl+Shift+S' };
  S.connections = { calcom: { connected: true, lastSync: '18:02' }, gcal: { connected: false }, gmail: { connected: false }, claude: { connected: true } };
  S.claudeMcp = { desktop: { available: true, connected: false }, code: { available: true, connected: false } };
  let next = 5000;
  const today = window.STOLK_TODAY || new Date().toISOString().slice(0, 10);
  const name = (cid) => S.contacts.find((c) => c.id === cid)?.name || '';
  window.STOLK_DATA = S;
  const log = (window.STOLK_CALLS = []);
  const ok = (body, status = 200) => ({ status, body });
  const routes = [
    ['GET', /^\/contacts\/match\?(.*)$/, (m) => { const q = new URLSearchParams(m[1]); const n = (q.get('name') || '').toLowerCase(); return ok(S.contacts.filter((c) => c.name.toLowerCase() === n || (q.get('email') && c.email === q.get('email'))).map((c) => ({ contact: c, score: 1, matchedOn: c.email === q.get('email') ? 'email' : 'name' }))); }],
    ['GET', /^\/contacts$/, () => ok(S.contacts)],
    ['POST', /^\/contacts$/, (m, b) => { const c = { id: next++, tags: [], ...b }; S.contacts.push(c); return ok(c, 201); }],
    ['PATCH', /^\/contacts\/(\d+)$/, (m, b) => { const c = S.contacts.find((x) => x.id === +m[1]); Object.assign(c, b); return ok(c); }],
    ['GET', /^\/interactions$/, () => ok(S.interactions)],
    ['POST', /^\/interactions$/, (m, b) => { const i = { id: next++, ...b }; S.interactions.push(i); return ok(i, 201); }],
    ['GET', /^\/relations$/, () => ok(S.relations)],
    ['GET', /^\/events$/, () => ok(S.events)],
    ['POST', /^\/events$/, (m, b) => { const e = { id: next++, ...b }; S.events.push(e); return ok(e, 201); }],
    ['GET', /^\/events\/(\d+)\/likely-guests$/, () => ok([{ cid: 2, score: 2, reasons: ['Fue a Tech & Tapas #3'] }])],
    ['PUT', /^\/events\/(\d+)\/guests\/(\d+)$/, (m, b) => { const e = S.events.find((x) => x.id === +m[1]); const g = e.guests.find((x) => x.cid === +m[2]); if (g) g.st = b.st; else e.guests.push({ cid: +m[2], st: b.st }); return ok(e); }],
    ['GET', /^\/projects$/, () => ok(S.projects)],
    ['POST', /^\/projects$/, (m, b) => { const p = { id: next++, tasks: [], ...b }; S.projects.unshift(p); return ok(p, 201); }],
    ['POST', /^\/projects\/(\d+)\/tasks$/, (m, b) => { const t = { id: next++, ...b }; S.projects.find((p) => p.id === +m[1]).tasks.push(t); return ok(t, 201); }],
    ['PATCH', /^\/tasks\/(\d+)$/, (m, b) => { for (const p of S.projects) { const t = p.tasks.find((x) => x.id === +m[1]); if (t) { Object.assign(t, b); return ok(t); } } return ok({ error: { message: 'no' } }, 404); }],
    ['PUT', /^\/projects\/(\d+)\/people\/(\d+)$/, (m, b) => { const p = S.projects.find((x) => x.id === +m[1]); p.people.push({ cid: +m[2], role: b.role }); return ok(p); }],
    ['GET', /^\/today$/, () => ok([
      ...S.events.filter((e) => e.date === today).map((e) => ({ src: 'event', start: e.start, end: e.end, title: e.title, sub: e.place, id: e.id })),
      ...S.bookings.filter((b) => b.date === today).map((b) => ({ src: 'cal', start: b.start, end: b.end, title: `${b.type} con ${name(b.cid)}`, sub: '', cid: b.cid })),
      ...S.gcal.filter((g) => g.date === today).map((g) => ({ src: 'gcal', start: g.start, end: g.end, title: g.title, sub: g.place })),
    ].sort((a, b) => a.start.localeCompare(b.start)))],
    ['GET', /^\/calendar\?/, () => ok({ events: S.events, bookings: S.bookings, gcal: S.gcal, follows: [] })],
    ['POST', /^\/connections\/gcal\/start$/, () => { setTimeout(() => { S.connections.gcal = { connected: true }; S.connections.gmail = { connected: true }; }, 300); return ok({ authUrl: 'https://auth.example/consent', state: 's' }); }],
    ['POST', /^\/sync$/, () => ok({ lastSync: '2026-11-19T18:30:00', calcom: { ok: true, bookings: 2, blocks: 1 }, gcal: { ok: true, events: 3 }, gmail: { ok: false, skipped: 'not connected' } })],
    ['POST', /^\/contacts\/(\d+)\/opened$/, (m, b) => { const i = { id: next++, cid: +m[1], date: today, ch: 'mensaje', text: { whatsapp: 'Abriste el chat de WhatsApp', telegram: 'Abriste el chat de Telegram', gmail: 'Abriste Gmail para escribirle', linkedin: 'Abriste su perfil de LinkedIn' }[b.channel] }; if (!S.interactions.some((x) => x.cid === i.cid && x.date === i.date && x.text === i.text)) S.interactions.push(i); return ok(i, 201); }],
    ['GET', /^\/settings$/, () => ok(S.settings)],
    ['PATCH', /^\/settings$/, (m, b) => ok(Object.assign(S.settings, b))],
    ['GET', /^\/connections$/, () => ok(S.connections)],
    ['GET', /^\/integrations\/claude$/, () => ok(S.claudeMcp)],
    ['POST', /^\/integrations\/claude\/(desktop|code)$/, (m) => { S.claudeMcp[m[1]].connected = true; return ok(S.claudeMcp); }],
    ['DELETE', /^\/integrations\/claude\/(desktop|code)$/, (m) => { S.claudeMcp[m[1]].connected = false; return ok(undefined); }],
    ['PUT', /^\/connections\/(\w+)$/, (m) => { S.connections[m[1]] = { connected: true }; return ok({ ok: true }); }],
    ['POST', /^\/ask$/, (m, b) => ok(/^Mejora este mensaje para .* \(id (\d+)\)/.test(b.question)
      ? { answer: 'Lo he dejado más natural.', cites: [], draft: { cid: Number(b.question.match(/\(id (\d+)\)/)[1]), text: 'Holi, ¿qué tal? ¿Nos tomamos un café esta semana?' } }
      : /escribe/i.test(b.question)
      ? { answer: 'Te dejo un mensaje para Jorge.', cites: [{ type: 'contact', id: 2 }], draft: { cid: 2, text: 'Hola Jorge, te paso el deck actualizado de Voltia. Un abrazo, Ivan' } }
      : { answer: 'En Tech & Tapas #3 conociste a Lucía Romero y Jorge Sanz.', cites: [{ type: 'contact', id: 1 }, { type: 'contact', id: 2 }], draft: null })],
  ];
  let captureCb = null;
  window.stolk = {
    apiReady: async () => true,
    onApiReady: () => {},
    call: async (method, route, body) => {
      log.push(`${method} ${route}`);
      for (const [m, re, fn] of routes) { const mm = method === m && route.match(re); if (mm) return fn(mm, body); }
      return { status: 404, body: { error: { code: 'not_found', message: `Sin ruta de prueba: ${method} ${route}` } } };
    },
    settings: async () => ({ shortcut: 'Ctrl+Shift+S', panel: false, hasKey: true, googleReady: true, shortcutActive: false, wayland: true }),
    setSettings: async () => ({ ok: true, shortcutActive: false }),
    setPanel: async (on) => on,
    capture: async () => {},
    installGnomeShortcut: async () => ({ binding: '<Control><Shift>s' }),
    openExternal: async (u) => { window.STOLK_CALLS.push('open ' + u); },
    onCapture: (fn) => { captureCb = fn; },
    updateStatus: async () => ({ version: '0.1.1', auto: true, ready: null }),
    installUpdate: async () => { window.STOLK_CALLS.push('update:install'); },
    setBadge: async (n) => { window.STOLK_BADGE = n; return n; },
    onUpdateReady: (fn) => { window.STOLK_FAKE_UPDATE = fn; },
  };
  window.STOLK_FAKE_CAPTURE = (r) => captureCb && captureCb(r);
})();
