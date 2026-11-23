// Calendario: month and week views with the interactions people expect from a desktop calendar.
// - Colour categories (/cal-tags) on Stölk events; right-click an event to recolour it.
// - Drag an event to another day (month, week all-day row) or another time (week grid).
// - Drag the right edge of a bar to make it span more days; drag the bottom edge of a timed event to change when it ends.
// - Drag across empty days or hours to create an event for that range.
// - In the day dialog, drag the dots (⋮⋮) to reorder and retime, edit the hours inline, or press Editar.
// Only Stölk's own events move. Cal.com bookings and Google Calendar stay read-only here.
// Every move saves through PATCH /events/:id and offers Deshacer.
window.StolkCalendar = function StolkCalendar(ctx) {
  const {
    state, Api, act, render, toast, openModal, closeModal, modalRoot,
    iso, parse, addDays, daysBetween, esc, fmt, fmtLong, DOW, MONTHS, byId, bookingName, peoplePicker, wirePicker, TODAY,
  } = ctx;

  // Our own palette (not another product's). Text colour is picked per swatch for contrast.
  const PALETTE = [
    ['#D64541', 'Rojo'], ['#E0703A', 'Naranja'], ['#D4A11E', 'Amarillo'], ['#3E9B5C', 'Verde'], ['#1F9E8F', 'Turquesa'],
    ['#3B6FD4', 'Azul'], ['#7A56C2', 'Morado'], ['#C94F8A', 'Rosa'], ['#8B5E3C', 'Marrón'], ['#6B6B6B', 'Gris'],
  ];
  const PX = 44; // pixels per hour in the week grid
  const SNAP = 15; // minutes
  const RELOAD = ['events', 'today', 'calendar'];

  if (!state.calView) state.calView = 'month';
  if (!state.calWeek) state.calWeek = mondayOf(TODAY);
  if (!state.tags) state.tags = [];

  function mondayOf(d) { return addDays(d, -((d.getDay() + 6) % 7)); }
  const lastDay = (e) => e.endDate || e.date;
  const mins = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const snap = (m) => Math.round(m / SNAP) * SNAP;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const shift = (ds, n) => iso(addDays(parse(ds), n));
  const dur = (e) => { const s = mins(e.start), en = mins(e.end); return s != null && en != null && en > s ? en - s : 60; };
  const tagOf = (e) => (e.tagId != null ? state.tags.find((t) => t.id === e.tagId) : null) || null;
  const inkOn = (hex) => { const n = parseInt(hex.slice(1), 16); const l = (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255; return l > 0.62 ? '#111111' : '#FFFFFF'; };
  const evStyle = (e) => { const t = tagOf(e); return t ? `--ev:${t.color};--ev-ink:${inkOn(t.color)};` : ''; };
  const covers = (e, ds) => e.date <= ds && lastDay(e) >= ds;
  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  const swatch = (color, label) => `<i class="sw" style="background:${color}" aria-hidden="true"></i>${label ? esc(label) : ''}`;

  // ---------- Data range ----------
  function range() {
    if (state.calView === 'week') return { from: iso(addDays(state.calWeek, -1)), to: iso(addDays(state.calWeek, 8)) };
    const m = state.calMonth;
    return { from: iso(addDays(new Date(m.getFullYear(), m.getMonth(), 1), -7)), to: iso(addDays(new Date(m.getFullYear(), m.getMonth() + 1, 0), 14)) };
  }

  // ---------- What's on a day (agenda, day dialog) ----------
  function itemsOn(ds) {
    const out = [];
    for (const e of state.events) if (covers(e, ds)) out.push({ cls: 'event', style: evStyle(e), label: `${e.date === ds && e.start ? e.start + ' ' : ''}${e.title}`, action: 'open-event', id: e.id, t: e.date === ds ? e.start : '' });
    for (const e of state.events) if (e.date === ds && e.status === 'planeado' && state.calConnected && state.blockEvents) out.push({ cls: 'block', label: 'Bloqueado en Cal.com', action: 'open-event', id: e.id, t: e.start });
    for (const b of state.bookings) if (b.date === ds) out.push({ cls: 'cal', label: `${b.start} ${b.type} · ${bookingName(b).split(' ')[0]}`, action: byId(b.cid) ? 'open-contact' : 'open-day', id: byId(b.cid) ? b.cid : ds, t: b.start });
    if (state.gcalConnected) for (const g of state.gcal) if (g.date === ds) out.push({ cls: 'gcal', label: `${g.start ? g.start + ' ' : ''}${g.title}`, action: 'gcal', id: g.id, t: g.start });
    for (const i of state.interactions) if (i.follow === ds) out.push({ cls: 'follow', label: `Seguir: ${(byId(i.cid)?.name || 'contacto').split(' ')[0]}`, action: 'open-contact', id: i.cid, t: '' });
    return out.sort((a, b) => (a.t || '').localeCompare(b.t || ''));
  }

  function dayEntries(ds) {
    const out = [];
    for (const e of state.events) if (covers(e, ds)) {
      const first = e.date === ds, last = lastDay(e) === ds;
      const span = e.endDate ? `Del ${fmt(e.date)} al ${fmt(e.endDate)}` : '';
      const t = tagOf(e);
      out.push({
        ev: e, movable: first && !!e.start, start: first ? e.start : '', end: last ? e.end : '', title: e.title,
        meta: [span, e.place, first && e.status === 'planeado' && state.calConnected && state.blockEvents ? 'Bloqueado en Cal.com' : ''].filter(Boolean).join(' · '),
        tag: `<span class="tag event" style="${evStyle(e)}">${t ? esc(t.name) : 'Mi evento'}</span>`,
        btn: `<button type="button" class="btn small" data-action="edit-event" data-id="${e.id}">Editar</button><button type="button" class="btn small" data-action="open-event" data-id="${e.id}">Ver</button>`,
      });
    }
    for (const b of state.bookings) if (b.date === ds) {
      const c = byId(b.cid);
      out.push({ start: b.start, end: b.end, title: c ? `${b.type} con ${c.name}` : b.type, meta: c ? [c.role, c.company].filter(Boolean).join(' · ') : [b.attendeeName, b.attendeeEmail].filter(Boolean).join(' · '), tag: '<span class="tag cal">Cal.com</span>',
        btn: c ? `<button type="button" class="btn small" data-action="open-contact" data-id="${c.id}">Ver persona</button>` : (b.attendeeName || b.attendeeEmail) ? `<button type="button" class="btn small" data-action="save-attendee" data-id="${b.id}">Guardar persona</button>` : '' });
    }
    if (state.gcalConnected) for (const g of state.gcal) if (g.date === ds) out.push({ start: g.start, end: g.end, title: g.title, meta: g.place || '', tag: '<span class="tag plain">Google</span>', btn: '' });
    for (const i of state.interactions) if (i.follow === ds) { const c = byId(i.cid); out.push({ start: '', end: '', title: `Seguir con ${c?.name || 'contacto'}`, meta: i.text || '', tag: '<span class="tag plain">Seguimiento</span>', btn: c ? `<button type="button" class="btn small" data-action="open-contact" data-id="${c.id}">Ver persona</button>` : '' }); }
    return out.sort((a, b) => (a.start || '99').localeCompare(b.start || '99'));
  }

  // ---------- Lanes: stack bars and chips in a week row without overlap ----------
  function placeLanes(items) {
    const lanes = [];
    for (const it of items) {
      let l = 0;
      while (lanes[l] && lanes[l].some(([a, b]) => it.c0 <= b && it.c1 >= a)) l++;
      (lanes[l] ||= []).push([it.c0, it.c1]);
      it.lane = l;
    }
    return lanes.length;
  }

  // Bars for Stölk events in the days [ws, ws+6], plus one-day chips from the other sources.
  function weekItems(ws, { timedToo = true, others = true } = {}) {
    const we = shift(ws, 6), items = [];
    for (const e of state.events) {
      if (e.date > we || lastDay(e) < ws) continue;
      const multi = !!e.endDate;
      if (!timedToo && !multi && e.start) continue;
      const a = e.date < ws ? ws : e.date, b = lastDay(e) > we ? we : lastDay(e);
      items.push({
        c0: daysBetween(parse(ws), parse(a)), c1: daysBetween(parse(ws), parse(b)), ev: e, multi, cls: `event${e.status === 'cancelado' ? ' cancelled' : ''}${e.date < ws ? ' cont-l' : ''}${lastDay(e) > we ? ' cont-r' : ''}`,
        label: `${e.date >= ws && e.start ? e.start + ' ' : ''}${e.title}`, action: 'open-event', id: e.id, style: evStyle(e), rz: lastDay(e) <= we, t: e.date >= ws ? e.start || '' : '',
      });
    }
    if (others) {
      for (let c = 0; c < 7; c++) {
        const ds = shift(ws, c);
        // "Bloqueado en Cal.com" is said in the day dialog; as a chip it only doubled every event.
        for (const it of itemsOn(ds)) if (it.cls !== 'event' && it.cls !== 'block') items.push({ ...it, c0: c, c1: c });
      }
    }
    items.sort((x, y) => (y.c1 - y.c0) - (x.c1 - x.c0) || x.c0 - y.c0 || (x.multi === y.multi ? 0 : x.multi ? -1 : 1) || (x.t || '99').localeCompare(y.t || '99'));
    return items;
  }

  const barHtml = (it, row) => it.ev
    ? `<button type="button" class="item ${it.cls}" data-action="open-event" data-id="${it.id}" data-ev="${it.id}" data-lane="${it.lane}" data-c0="${it.c0}" data-c1="${it.c1}" style="grid-column:${it.c0 + 1}/${it.c1 + 2};grid-row:${it.lane + row};${it.style}" title="${esc(it.label)}${it.ev.place ? ' · ' + esc(it.ev.place) : ''}" aria-label="${esc(it.label)}. Arrastra para moverlo; clic derecho para cambiar el color.">${esc(it.label)}${it.rz ? '<span class="rz" aria-hidden="true" title="Arrastra para alargarlo a más días"></span>' : ''}</button>`
    : `<button type="button" class="item ${it.cls}" data-action="${it.action}" data-id="${esc(it.id)}" data-lane="${it.lane}" data-c0="${it.c0}" data-c1="${it.c1}" style="grid-column:${it.c0 + 1}/${it.c1 + 2};grid-row:${it.lane + row};${it.style || ''}" title="${esc(it.label)}">${esc(it.label)}</button>`;

  // ---------- Month ----------
  function monthView() {
    const m = state.calMonth;
    const first = new Date(m.getFullYear(), m.getMonth(), 1);
    let ws = mondayOf(first);
    const weeks = [];
    for (let w = 0; w < 6; w++) {
      if (w >= 4 && ws.getMonth() !== m.getMonth()) break;
      const wsI = iso(ws);
      const items = weekItems(wsI);
      const lanes = placeLanes(items);
      const cells = [];
      for (let c = 0; c < 7; c++) {
        const d = addDays(ws, c), ds = iso(d);
        cells.push(`<div class="day ${d.getMonth() !== m.getMonth() ? 'out' : ''} ${ds === iso(TODAY) ? 'today' : ''}" style="grid-column:${c + 1}" data-action="open-day" data-id="${ds}" data-day="${ds}" role="button" tabindex="0" aria-label="Ver el ${esc(fmtLong(ds))}"><span class="num">${d.getDate()}</span></div>`);
      }
      weeks.push(`<div class="wk" style="--lanes:${lanes};grid-template-rows:26px ${'22px '.repeat(lanes)}minmax(0,1fr)">${cells.join('')}${items.map((it) => barHtml(it, 2)).join('')}</div>`);
      ws = addDays(ws, 7);
    }
    return `<div class="month" role="grid"><div class="dow-row">${DOW.map((d) => `<div class="dow">${d}</div>`).join('')}</div>${weeks.join('')}</div>`;
  }

  // Hide lanes that don't fit a week row and say "+N más" per day, so nothing is cut in half.
  function fitMonth() {
    for (const wk of document.querySelectorAll('.month .wk')) {
      wk.querySelectorAll('.more').forEach((x) => x.remove());
      const items = [...wk.querySelectorAll('.item')];
      items.forEach((x) => { x.hidden = false; });
      const lanes = Number(wk.style.getPropertyValue('--lanes')) || 0;
      const fit = Math.floor((wk.clientHeight - 26) / 24);
      if (lanes <= fit) continue;
      const keep = Math.max(fit - 1, 0);
      const hiddenPer = Array(7).fill(0);
      for (const it of items) {
        if (Number(it.dataset.lane) < keep) continue;
        it.hidden = true;
        for (let c = Number(it.dataset.c0); c <= Number(it.dataset.c1); c++) hiddenPer[c]++;
      }
      hiddenPer.forEach((n, c) => {
        if (!n) return;
        const ds = wk.children[c].dataset.id;
        wk.insertAdjacentHTML('beforeend', `<button type="button" class="more" data-action="open-day" data-id="${ds}" style="grid-column:${c + 1};grid-row:${keep + 2}">+${n} más</button>`);
      });
    }
  }

  // ---------- Week ----------
  function timedLayout(items) {
    items.sort((a, b) => a.s - b.s || b.e - a.e);
    let cluster = [], cols = [], end = -1;
    const flush = () => { for (const it of cluster) it.n = cols.length; cluster = []; cols = []; };
    for (const it of items) {
      if (it.s >= end) { flush(); end = -1; }
      let c = cols.findIndex((x) => x <= it.s);
      if (c < 0) { c = cols.length; cols.push(it.e); } else cols[c] = it.e;
      it.c = c; cluster.push(it); end = Math.max(end, it.e);
    }
    flush();
    return items;
  }

  function weekView() {
    const ws = state.calWeek, wsI = iso(ws), today = iso(TODAY);
    const head = [], cols = [];
    for (let c = 0; c < 7; c++) {
      const d = addDays(ws, c), ds = iso(d);
      head.push(`<button type="button" class="wk-dayhead ${ds === today ? 'today' : ''}" data-action="open-day" data-id="${ds}"><span class="dow">${DOW[c]}</span><span class="num">${d.getDate()}</span></button>`);
      const timed = [];
      for (const e of state.events) if (e.date === ds && !e.endDate && e.start) {
        const s = mins(e.start); timed.push({ s, e: Math.max(s + dur(e), s + 20), ev: e, label: e.title, sub: `${e.start}${e.end ? '–' + e.end : ''}${e.place ? ' · ' + e.place : ''}` });
      }
      for (const b of state.bookings) if (b.date === ds && b.start) {
        const s = mins(b.start), en = mins(b.end);
        timed.push({ s, e: Math.max(en > s ? en : s + 30, s + 20), cls: 'cal', action: byId(b.cid) ? 'open-contact' : 'open-day', id: byId(b.cid) ? b.cid : ds, label: `${b.type} · ${bookingName(b).split(' ')[0]}`, sub: `${b.start}–${b.end}` });
      }
      if (state.gcalConnected) for (const g of state.gcal) if (g.date === ds && g.start) {
        const s = mins(g.start), en = mins(g.end);
        timed.push({ s, e: Math.max(en > s ? en : s + 30, s + 20), cls: 'gcal', action: 'gcal', id: g.id, label: g.title, sub: `${g.start}–${g.end}` });
      }
      const blocks = timedLayout(timed).map((it) => {
        const pos = `top:${it.s / 60 * PX}px;height:${(it.e - it.s) / 60 * PX - 2}px;left:calc(${it.c / it.n * 100}% + 2px);width:calc(${100 / it.n}% - 4px)`;
        const short = it.e - it.s < 45 ? ' short' : '';
        if (it.ev) {
          return `<button type="button" class="tev${short} event${it.ev.status === 'cancelado' ? ' cancelled' : ''}" data-action="open-event" data-id="${it.ev.id}" data-ev="${it.ev.id}" style="${pos};${evStyle(it.ev)}" title="${esc(it.label)} · ${esc(it.sub)}" aria-label="${esc(it.label)}, ${esc(it.sub)}. Arrastra para moverlo."><b>${esc(it.label)}</b><span>${esc(it.sub)}</span><span class="rzb" aria-hidden="true" title="Arrastra para cambiar la hora de fin"></span></button>`;
        }
        return `<button type="button" class="tev${short} ro ${it.cls}" data-action="${it.action}" data-id="${esc(it.id)}" style="${pos}" title="${esc(it.label)} · ${esc(it.sub)}"><b>${esc(it.label)}</b><span>${esc(it.sub)}</span></button>`;
      }).join('');
      const now = ds === today ? `<div class="now" style="top:${(TODAY.getHours() * 60 + TODAY.getMinutes()) / 60 * PX}px"></div>` : '';
      cols.push(`<div class="wk-col ${ds === today ? 'today' : ''}" data-day="${ds}" data-col="${ds}">${blocks}${now}</div>`);
    }
    const all = weekItems(wsI, { timedToo: false });
    // Timed bookings and Google events already sit in the grid.
    const allDay = all.filter((it) => it.ev || it.cls === 'follow' || (it.cls === 'gcal' && !/^\d\d:\d\d /.test(it.label)));
    const lanes = placeLanes(allDay);
    const hours = Array.from({ length: 24 }, (_, h) => `<div class="hr" style="top:${h * PX}px">${h ? hm(h * 60) : ''}</div>`).join('');
    return `<div class="week" style="--px:${PX}px">
      <div class="wk-head"><div class="gutter"></div>${head.join('')}</div>
      <div class="wk-allday"><div class="gutter">Todo el día</div><div class="wk-adgrid" style="grid-template-rows:${'22px '.repeat(Math.max(lanes, 1))}">${Array.from({ length: 7 }, (_, c) => `<div class="adcell" data-day="${shift(wsI, c)}" style="grid-column:${c + 1}"></div>`).join('')}${allDay.map((it) => barHtml(it, 1)).join('')}</div></div>
      <div class="wk-scroll"><div class="wk-grid" style="height:${24 * PX}px"><div class="gutter">${hours}</div>${cols.join('')}</div></div>
    </div>`;
  }

  // ---------- The view ----------
  function view() {
    const week = state.calView === 'week';
    const m = state.calMonth, ws = state.calWeek, we = addDays(ws, 6);
    const title = week
      ? (ws.getMonth() === we.getMonth() ? `${ws.getDate()} – ${we.getDate()} ${MONTHS[we.getMonth()]} ${we.getFullYear()}` : `${ws.getDate()} ${MONTHS[ws.getMonth()].slice(0, 3)} – ${we.getDate()} ${MONTHS[we.getMonth()].slice(0, 3)} ${we.getFullYear()}`)
      : `${cap(MONTHS[m.getMonth()])} ${m.getFullYear()}`;
    // Agenda list for phones and the side panel.
    const days = [];
    const first = new Date(m.getFullYear(), m.getMonth(), 1);
    for (let d = new Date(first); d.getMonth() === m.getMonth(); d = addDays(d, 1)) {
      const its = itemsOn(iso(d));
      if (its.length) days.push(`<li class="row" style="align-items:start"><div class="datebox"><div class="d">${d.getDate()}</div><div class="m">${DOW[(d.getDay() + 6) % 7]}</div></div>
        <div style="display:flex;flex-direction:column;gap:4px;min-width:0">${its.map((it) => `<button type="button" class="item ${it.cls}" style="${it.style || ''}" data-action="${it.action}" data-id="${esc(it.id)}">${esc(it.label)}</button>`).join('')}</div><span></span></li>`);
    }
    return `
      <div class="view-head">
        <div><h1>${esc(cap(title))}</h1></div>
        <div class="cal-toolbar">
          <div class="seg cal-seg" role="group" aria-label="Vista"><button type="button" data-action="cal-view" data-id="month" aria-pressed="${!week}">Mes</button><button type="button" data-action="cal-view" data-id="week" aria-pressed="${week}">Semana</button></div>
          <button type="button" class="btn small" data-action="cal-nav" data-id="-1" aria-label="${week ? 'Semana anterior' : 'Mes anterior'}">←</button>
          <button type="button" class="btn small" data-action="cal-nav" data-id="0">Hoy</button>
          <button type="button" class="btn small" data-action="cal-nav" data-id="1" aria-label="${week ? 'Semana siguiente' : 'Mes siguiente'}">→</button>
          <button type="button" class="btn primary small" data-action="new-event">Nuevo evento</button>
        </div>
      </div>
      <div class="cal-legend" style="margin-bottom:12px">
        ${state.tags.map((t) => `<span>${swatch(t.color, t.name)}</span>`).join('')}
        <span><i class="sw ev"></i>Sin color</span>
        <span><i class="sw bk"></i>Cal.com</span>
        <span><i class="sw gc"></i>Google</span>
        <span><i class="sw fu"></i>Seguimientos</span>
        <button type="button" class="linkish" data-action="cal-tags">Colores</button>
      </div>
      ${week ? weekView() : monthView()}
      <ul class="list panel agenda">${days.join('') || '<li class="empty">Nada este mes.</li>'}</ul>`;
  }

  let ro = null;
  function afterRender() {
    if (!document.querySelector('.cal-legend')) { ro?.disconnect(); ro = null; return; }
    if (state.calView === 'month') {
      fitMonth();
      const mo = document.querySelector('.month');
      if (mo && !ro) { ro = new ResizeObserver(() => fitMonth()); }
      if (mo) { ro.disconnect(); ro.observe(mo); }
    } else {
      ro?.disconnect();
      const sc = document.querySelector('.wk-scroll');
      if (sc) sc.scrollTop = state.weekScroll ?? 7.5 * PX;
      sc?.addEventListener('scroll', () => { state.weekScroll = sc.scrollTop; }, { passive: true });
    }
  }

  // ---------- Saving moves, with undo ----------
  function toastUndo(msg, undo) {
    const root = document.getElementById('toastRoot');
    root.innerHTML = `<div class="toast toast-undo" role="status"><span>${esc(msg)}</span><button type="button" class="undo-btn">Deshacer</button></div>`;
    root.querySelector('.undo-btn').addEventListener('click', () => { root.innerHTML = ''; undo(); });
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { root.innerHTML = ''; }, 6000);
  }
  const PATCH_KEYS = ['date', 'endDate', 'start', 'end', 'tagId'];
  async function saveEvent(id, patch, msg, undoable = true) {
    const e = state.events.find((x) => x.id === id);
    if (!e) return false;
    if ('endDate' in patch && patch.endDate && patch.endDate <= (patch.date ?? e.date)) patch.endDate = null;
    const changed = Object.keys(patch).filter((k) => (patch[k] ?? null) !== (e[k] ?? null));
    if (!changed.length) return true;
    const send = Object.fromEntries(changed.map((k) => [k, patch[k]]));
    // The server shifts endDate when only date changes; send both so the result is explicit.
    if ('date' in send && !('endDate' in send)) send.endDate = e.endDate ?? null;
    const before = Object.fromEntries(Object.keys(send).filter((k) => PATCH_KEYS.includes(k)).map((k) => [k, e[k] ?? null]));
    Object.assign(e, send);
    render();
    const ok = await act(() => Api.patch(`/events/${id}`, send), RELOAD);
    if (!ok) { Object.assign(e, before); render(); return false; }
    if (undoable && msg) toastUndo(msg, () => saveEvent(id, before, 'Deshecho', false).then((o) => o && toast('Deshecho')));
    return true;
  }
  const whenText = (e) => `${fmt(e.date)}${e.endDate ? ' – ' + fmt(e.endDate) : ''}${e.start ? ' ' + e.start : ''}${e.end ? '–' + e.end : ''}`;

  // ---------- Pointer drags (month, week all-day row, week grid) ----------
  let drag = null;
  let suppressClick = false; // the click that ends a drag must not also open the event
  // By geometry rather than hit-testing: a crowded week row lays out more lanes than it shows.
  const inside = (r, x, y) => x >= r.left && x < r.right && y >= r.top && y < r.bottom;
  function colAt(x, y) {
    const sc = document.querySelector('.wk-scroll');
    if (!sc || !inside(sc.getBoundingClientRect(), x, y)) return null;
    return [...document.querySelectorAll('.wk-col')].find((c) => { const r = c.getBoundingClientRect(); return x >= r.left && x < r.right; }) || null;
  }
  function dayAt(x, y) {
    for (const row of document.querySelectorAll('.month .wk, .wk-adgrid')) {
      if (!inside(row.getBoundingClientRect(), x, y)) continue;
      const cell = [...row.querySelectorAll(':scope > [data-day]')].find((c) => { const r = c.getBoundingClientRect(); return x >= r.left && x < r.right; });
      return cell?.dataset.day || null;
    }
    return colAt(x, y)?.dataset.day || null;
  }
  const minuteIn = (col, y) => (y - col.getBoundingClientRect().top) / PX * 60;
  function highlight(a, b) {
    document.querySelectorAll('[data-day].drop').forEach((el) => el.classList.remove('drop'));
    if (!a) return;
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    document.querySelectorAll('.month [data-day], .wk-adgrid [data-day]').forEach((el) => { if (el.dataset.day >= lo && el.dataset.day <= hi) el.classList.add('drop'); });
  }
  function ghostIn(col, s, e, label) {
    document.querySelectorAll('.tev.ghost').forEach((g) => g.remove());
    if (!col) return;
    col.insertAdjacentHTML('beforeend', `<div class="tev ghost" style="top:${s / 60 * PX}px;height:${Math.max(e - s, 15) / 60 * PX - 2}px;left:2px;width:calc(100% - 4px)"><b>${esc(label)}</b><span>${hm(s)}–${hm(Math.min(e, 1439))}</span></div>`);
  }
  function endDrag() {
    if (!drag) return;
    document.body.classList.remove('cal-dragging');
    document.querySelectorAll('.dragging').forEach((el) => el.classList.remove('dragging'));
    document.querySelectorAll('.tev.ghost').forEach((g) => g.remove());
    highlight(null);
    const pending = drag.pendingRender;
    drag = null;
    if (pending) render();
  }

  document.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || !document.querySelector('.cal-legend')) return;
    const t = ev.target;
    const bar = t.closest('.item.event[data-ev]');
    const tev = t.closest('.tev.event[data-ev]');
    let mode = null, id = null;
    if (bar) { id = Number(bar.dataset.ev); mode = t.closest('.rz') ? 'resize' : 'move'; }
    else if (tev) { id = Number(tev.dataset.ev); mode = t.closest('.rzb') ? 'tresize' : 'tmove'; }
    else if (t.closest('.item, .tev, .more, button')) return;
    else if (t.closest('.wk-col')) mode = 'tcreate';
    else if (t.closest('.month .day, .wk-adgrid .adcell')) mode = 'select';
    if (!mode) return;
    const e = id ? state.events.find((x) => x.id === id) : null;
    const col = colAt(ev.clientX, ev.clientY);
    drag = {
      mode, e, x: ev.clientX, y: ev.clientY, active: false, el: bar || tev,
      day0: dayAt(ev.clientX, ev.clientY), col0: col, min0: col ? minuteIn(col, ev.clientY) : 0,
    };
    if (mode === 'tmove' || mode === 'tresize' || mode === 'tcreate') ev.preventDefault();
  });

  window.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    if (!drag.active) {
      if (Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) < 5) return;
      drag.active = true;
      document.body.classList.add('cal-dragging');
      drag.el?.classList.add('dragging');
    }
    const d = drag, e = d.e;
    if (d.mode === 'move' || d.mode === 'resize' || d.mode === 'select') {
      const day = dayAt(ev.clientX, ev.clientY) || d.cur;
      if (!day || !d.day0) return;
      d.cur = day;
      if (d.mode === 'move') { const n = daysBetween(parse(d.day0), parse(day)); highlight(shift(e.date, n), shift(lastDay(e), n)); }
      else if (d.mode === 'resize') highlight(e.date, day < e.date ? e.date : day);
      else highlight(d.day0, day);
    } else {
      const col = colAt(ev.clientX, ev.clientY) || d.colCur;
      if (!col) return;
      d.colCur = col;
      const m = minuteIn(col, ev.clientY);
      if (d.mode === 'tmove') {
        const len = dur(e);
        d.s = clamp(snap(mins(e.start) + (m - d.min0)), 0, 1440 - len); d.en = d.s + len; d.day = col.dataset.col;
        ghostIn(col, d.s, d.en, e.title);
      } else if (d.mode === 'tresize') {
        const s = mins(e.start);
        d.en = clamp(snap(m), s + SNAP, 1439); d.day = e.date;
        ghostIn(document.querySelector(`[data-col="${e.date}"]`), s, d.en, e.title);
      } else {
        const a = clamp(Math.floor(d.min0 / SNAP) * SNAP, 0, 1425), b = clamp(snap(m), 0, 1439);
        d.s = Math.min(a, b); d.en = Math.max(a, b, d.s + SNAP); d.day = d.col0.dataset.col;
        ghostIn(d.col0, d.s, d.en, 'Nuevo evento');
      }
    }
  });

  window.addEventListener('pointerup', (ev) => {
    if (!drag) return;
    const d = drag, e = d.e;
    if (!d.active) {
      // A plain click on an empty hour creates a one-hour event there.
      if (d.mode === 'tcreate' && d.col0) {
        const s = clamp(Math.floor(d.min0 / 30) * 30, 0, 1380);
        endDrag();
        modalEvent(d.col0.dataset.col, { start: hm(s), end: hm(s + 60) });
        return;
      }
      endDrag();
      return;
    }
    suppressClick = true;
    setTimeout(() => { suppressClick = false; });
    const day = d.cur;
    endDrag();
    if (d.mode === 'move' && day && d.day0) {
      const n = daysBetween(parse(d.day0), parse(day));
      if (n) saveEvent(e.id, { date: shift(e.date, n), endDate: e.endDate ? shift(e.endDate, n) : null }, `${e.title}: ${fmt(shift(e.date, n))}${e.endDate ? ' – ' + fmt(shift(e.endDate, n)) : ''}`);
    } else if (d.mode === 'resize' && day) {
      const end = day < e.date ? e.date : day;
      saveEvent(e.id, { endDate: end === e.date ? null : end }, end === e.date ? `${e.title}: un solo día` : `${e.title}: hasta el ${fmt(end)}`);
    } else if (d.mode === 'select' && day && d.day0) {
      const [a, b] = d.day0 <= day ? [d.day0, day] : [day, d.day0];
      modalEvent(a, { endDate: b !== a ? b : '' });
    } else if (d.mode === 'tmove' && d.day != null && d.s != null) {
      saveEvent(e.id, { date: d.day, start: hm(d.s), end: hm(Math.min(d.en, 1439)) }, `${e.title}: ${fmt(d.day)} ${hm(d.s)}–${hm(Math.min(d.en, 1439))}`);
    } else if (d.mode === 'tresize' && d.en != null) {
      saveEvent(e.id, { end: hm(d.en) }, `${e.title}: acaba a las ${hm(d.en)}`);
    } else if (d.mode === 'tcreate' && d.s != null) {
      modalEvent(d.day, { start: hm(d.s), end: hm(Math.min(d.en, 1439)) });
    }
  });
  window.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && drag) { drag.active = false; endDrag(); } }, true);
  window.addEventListener('click', (ev) => { if (suppressClick) { suppressClick = false; ev.stopPropagation(); ev.preventDefault(); } }, true);
  const deferRender = () => { if (drag?.active) { drag.pendingRender = true; return true; } return false; };

  // ---------- Right-click menu: colour, edit ----------
  function closeMenu() { document.querySelector('.cal-menu')?.remove(); }
  document.addEventListener('contextmenu', (ev) => {
    const el = ev.target.closest('[data-ev]');
    if (!el || !document.querySelector('.cal-legend')) return;
    ev.preventDefault();
    const e = state.events.find((x) => x.id === Number(el.dataset.ev));
    if (!e) return;
    closeMenu();
    const menu = document.createElement('div');
    menu.className = 'cal-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = `<div class="cal-menu-title">${esc(e.title)}</div>
      <div class="cal-menu-colors">${[{ id: '', name: 'Sin color', color: '' }, ...state.tags].map((t) => `<button type="button" role="menuitemradio" aria-checked="${String((e.tagId ?? '') === (t.id === '' ? '' : t.id))}" class="cm-sw ${t.color ? '' : 'none'}" style="${t.color ? `background:${t.color}` : ''}" data-settag="${e.id}:${t.id}" title="${esc(t.name)}" aria-label="${esc(t.name)}"></button>`).join('')}</div>
      <button type="button" role="menuitem" data-action="edit-event" data-id="${e.id}">Editar</button>
      <button type="button" role="menuitem" data-action="open-event" data-id="${e.id}">Invitados</button>
      <button type="button" role="menuitem" data-action="cal-tags">Gestionar colores</button>`;
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(ev.clientX, innerWidth - r.width - 8)}px`;
    menu.style.top = `${Math.min(ev.clientY, innerHeight - r.height - 8)}px`;
    menu.querySelector('button')?.focus();
  });
  document.addEventListener('click', (ev) => {
    const sw = ev.target.closest('[data-settag]');
    if (sw) {
      const [id, tag] = sw.dataset.settag.split(':');
      const t = state.tags.find((x) => x.id === Number(tag));
      closeMenu();
      saveEvent(Number(id), { tagId: tag ? Number(tag) : null }, t ? `Color: ${t.name}` : 'Sin color');
      return;
    }
    if (!ev.target.closest('.cal-menu')) closeMenu();
    else if (ev.target.closest('[data-action]')) setTimeout(closeMenu);
  });
  window.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeMenu(); });
  window.addEventListener('blur', closeMenu);

  // ---------- Day dialog: dots to reorder and retime, hours inline, Editar ----------
  const GRIP = '<svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true"><circle cx="2.5" cy="3" r="1.4"/><circle cx="7.5" cy="3" r="1.4"/><circle cx="2.5" cy="8" r="1.4"/><circle cx="7.5" cy="8" r="1.4"/><circle cx="2.5" cy="13" r="1.4"/><circle cx="7.5" cy="13" r="1.4"/></svg>';
  function modalDay(ds) {
    const items = dayEntries(ds);
    const title = fmtLong(ds);
    openModal(`
      <h2>${esc(cap(title))}</h2>
      ${items.length ? `<ul class="day-list dnd" id="dayList">${items.map((x, i) => `<li data-i="${i}"${x.movable ? ` data-ev="${x.ev.id}"` : ''}>
          ${x.movable ? `<span class="grip" role="button" tabindex="0" data-grip="${x.ev.id}" title="Arrastra para cambiar el orden y la hora" aria-label="Mover ${esc(x.title)}. Usa las flechas arriba y abajo.">${GRIP}</span>` : '<span></span>'}
          <div class="t">${x.ev && x.movable
            ? `<input type="time" class="t-in" data-time="${x.ev.id}:start" value="${esc(x.start)}" aria-label="Empieza"><input type="time" class="t-in end" data-time="${x.ev.id}:end" value="${esc(x.ev.end || '')}" aria-label="Acaba">`
            : `${esc(x.start || 'Todo el día')}${x.end ? `<span>${esc(x.end)}</span>` : ''}`}</div>
          <div class="what"><div class="title">${esc(x.title)}</div>${x.meta ? `<div class="meta">${esc(x.meta)}</div>` : ''}<div class="tags" style="margin-top:6px">${x.tag}</div></div>
          <div class="day-btns">${x.btn}</div></li>`).join('')}</ul>` : '<p class="muted" style="margin:0">Nada este día.</p>'}
      ${items.some((x) => x.movable) ? '<p class="note" style="margin:0">Arrastra los puntitos para cambiar el orden: el evento toma la hora de su nuevo sitio. También puedes cambiar las horas a mano.</p>' : ''}
      <div class="modal-foot"><button type="button" class="btn ghost" data-action="close-modal">Cerrar</button><button type="button" class="btn primary" data-action="new-event" data-id="${ds}">Nuevo evento este día</button></div>`, () => {});
    const list = document.getElementById('dayList');
    if (!list) return;
    list.querySelectorAll('.t-in').forEach((inp) => inp.addEventListener('change', async () => {
      const [id, which] = inp.dataset.time.split(':');
      const e = state.events.find((x) => x.id === Number(id));
      if (!e || !inp.value) return;
      let patch;
      if (which === 'start') { const len = dur(e); const s = mins(inp.value); patch = { start: inp.value, end: hm(Math.min(s + len, 1439)) }; }
      else patch = { end: inp.value };
      if (await saveEvent(e.id, patch, `${e.title}: ${patch.start || e.start}–${patch.end}`)) modalDay(ds);
    }));
    wireReorder(list, ds, items);
  }

  // New start for an event dropped at index `at` among the other rows (in their shown order).
  function slotFor(e, others, at) {
    const len = dur(e);
    for (let i = at - 1; i >= 0; i--) { const o = others[i]; if (o.start) { const s = mins(o.end || o.start) ?? mins(o.start); return clamp(s, 0, 1440 - len); } }
    for (let i = at; i < others.length; i++) { const o = others[i]; if (o.start) return clamp(mins(o.start) - len, 0, 1440 - len); }
    return null;
  }
  async function moveInDay(ds, items, from, to) {
    const x = items[from];
    const others = items.filter((_, i) => i !== from);
    const s = slotFor(x.ev, others, to);
    if (s == null) { toast('Pon la hora a mano en los campos de hora'); return; }
    const len = dur(x.ev);
    if (await saveEvent(x.ev.id, { start: hm(s), end: hm(Math.min(s + len, 1439)) }, `${x.ev.title}: ${hm(s)}–${hm(Math.min(s + len, 1439))}`)) modalDay(ds);
  }
  function wireReorder(list, ds, items) {
    const rows = () => [...list.children];
    list.querySelectorAll('.grip').forEach((grip) => {
      const li = grip.closest('li');
      const from = Number(li.dataset.i);
      grip.addEventListener('keydown', (ev) => {
        if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
        ev.preventDefault();
        const to = ev.key === 'ArrowUp' ? from - 1 : from + 1;
        if (to < 0 || to > items.length - 1) return;
        moveInDay(ds, items, from, to);
      });
      grip.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        grip.setPointerCapture(ev.pointerId);
        const y0 = ev.clientY;
        let to = from;
        li.classList.add('lifted');
        const marker = document.createElement('li');
        marker.className = 'drop-line';
        const move = (e2) => {
          li.style.transform = `translateY(${e2.clientY - y0}px)`;
          const others = rows().filter((r) => r !== li && r !== marker);
          to = others.findIndex((r) => { const b = r.getBoundingClientRect(); return e2.clientY < b.top + b.height / 2; });
          if (to < 0) to = others.length;
          if (to < others.length) list.insertBefore(marker, others[to]); else list.appendChild(marker);
        };
        const up = () => {
          grip.removeEventListener('pointermove', move);
          grip.removeEventListener('pointerup', up);
          grip.removeEventListener('pointercancel', up);
          li.classList.remove('lifted'); li.style.transform = ''; marker.remove();
          if (to !== from) moveInDay(ds, items, from, to);
        };
        grip.addEventListener('pointermove', move);
        grip.addEventListener('pointerup', up);
        grip.addEventListener('pointercancel', up);
      });
    });
  }

  // ---------- New and edit forms ----------
  const tagPicker = (sel) => `<fieldset class="tag-pick"><legend>Color</legend>
    <label class="tp none"><input type="radio" name="tagId" value="" ${sel == null ? 'checked' : ''}><i class="sw ev"></i><span>Sin color</span></label>
    ${state.tags.map((t) => `<label class="tp"><input type="radio" name="tagId" value="${t.id}" ${sel === t.id ? 'checked' : ''}>${swatch(t.color)}<span>${esc(t.name)}</span></label>`).join('')}
    <button type="button" class="linkish" data-action="cal-tags">Gestionar colores</button></fieldset>`;

  function modalEvent(date, pre = {}) {
    openModal(`
      <h2>Nuevo evento</h2>
      <div class="form">
        <div class="field"><label for="eTitle">Nombre</label><input id="eTitle" name="title" required placeholder="Tech & Tapas #5"></div>
        <div class="form-row">
          <div class="field"><label for="eDate">Día</label><input id="eDate" type="date" name="date" value="${date || iso(addDays(TODAY, 14))}" required></div>
          <div class="field"><label for="eEndDate">Hasta el día <span class="muted">(si dura varios)</span></label><input id="eEndDate" type="date" name="endDate" value="${esc(pre.endDate || '')}"></div>
        </div>
        <div class="form-row">
          <div class="field"><label for="eStart">Empieza</label><input id="eStart" type="time" name="start" value="${esc(pre.start ?? '19:00')}"></div>
          <div class="field"><label for="eEnd">Acaba</label><input id="eEnd" type="time" name="end" value="${esc(pre.end ?? '21:00')}"></div>
        </div>
        <div class="field"><label for="ePlace">Lugar</label><input id="ePlace" name="place" placeholder="Impact Lab, Madrid" list="places"><datalist id="places">${[...new Set(state.events.map((e) => e.place).filter(Boolean))].map((p) => `<option value="${esc(p)}">`).join('')}</datalist></div>
        ${tagPicker(null)}
        <div class="field"><label for="eUrl">Enlace del evento</label><input id="eUrl" name="url" type="url" placeholder="https://lu.ma/… o https://meetup.com/…"></div>
        <div class="field"><label for="eGuests">Invitados</label>${peoplePicker('eGuests', 'guests', 'Busca por nombre o empresa')}</div>
        <label class="toggle"><input type="checkbox" name="block" ${state.calConnected && state.blockEvents ? 'checked' : ''} ${state.calConnected ? '' : 'disabled'}><span>Bloquear esta franja en Cal.com</span></label>
      </div>
      <div class="modal-foot"><button type="button" class="btn ghost" data-action="close-modal">Cancelar</button><button class="btn primary" type="submit">Crear evento</button></div>`,
    (fd) => {
      const endDate = String(fd.get('endDate') || '');
      const date = String(fd.get('date'));
      if (endDate && endDate < date) { toast('«Hasta el día» no puede ser antes del primer día'); return; }
      const tag = String(fd.get('tagId') || '');
      const ev = { title: fd.get('title'), date, start: fd.get('start'), end: fd.get('end'), place: fd.get('place') || '', url: fd.get('url') || undefined, status: 'planeado', desc: '', guests: fd.getAll('guests').map((g) => ({ cid: Number(g), st: 'invitado' })), block: !!fd.get('block') };
      if (endDate && endDate !== date) ev.endDate = endDate;
      if (tag) ev.tagId = Number(tag);
      const where = location.hash === '#calendario' ? null : '#eventos';
      act(async () => { await Api.post('/events', ev); closeModal(); if (where) location.hash = where; }, RELOAD,
        ev.block ? `Creado y bloqueado en Cal.com: ${fmt(ev.date)} ${ev.start}–${ev.end}` : 'Evento creado');
    });
    wirePicker('eGuests');
  }

  function modalEditEvent(id) {
    const e = state.events.find((x) => x.id === id);
    if (!e) return;
    openModal(`
      <h2>Editar evento</h2>
      <div class="form">
        <div class="field"><label for="xTitle">Nombre</label><input id="xTitle" name="title" required value="${esc(e.title)}"></div>
        <div class="form-row">
          <div class="field"><label for="xDate">Día</label><input id="xDate" type="date" name="date" value="${e.date}" required></div>
          <div class="field"><label for="xEndDate">Hasta el día <span class="muted">(si dura varios)</span></label><input id="xEndDate" type="date" name="endDate" value="${e.endDate || ''}"></div>
        </div>
        <div class="form-row">
          <div class="field"><label for="xStart">Empieza</label><input id="xStart" type="time" name="start" value="${esc(e.start || '')}"></div>
          <div class="field"><label for="xEnd">Acaba</label><input id="xEnd" type="time" name="end" value="${esc(e.end || '')}"></div>
        </div>
        <div class="field"><label for="xPlace">Lugar</label><input id="xPlace" name="place" value="${esc(e.place || '')}"></div>
        ${tagPicker(e.tagId ?? null)}
        <div class="field"><label for="xUrl">Enlace del evento</label><input id="xUrl" name="url" type="url" value="${esc(e.url || '')}"></div>
        <div class="field"><label for="xDesc">Notas</label><textarea id="xDesc" name="desc">${esc(e.desc || '')}</textarea></div>
        <div class="field"><label for="xStatus">Estado</label><select id="xStatus" name="status">${['planeado', 'hecho', 'cancelado'].map((s) => `<option ${s === e.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <label class="toggle"><input type="checkbox" name="block" ${e.block !== false ? 'checked' : ''} ${state.calConnected ? '' : 'disabled'}><span>Bloquear esta franja en Cal.com</span></label>
      </div>
      <div class="modal-foot"><button type="button" class="btn danger" id="xDelete" style="margin-right:auto">Borrar evento</button><button type="button" class="btn ghost" data-action="close-modal">Cancelar</button><button class="btn primary" type="submit">Guardar</button></div>`,
    (fd) => {
      const date = String(fd.get('date'));
      let endDate = String(fd.get('endDate') || '') || null;
      if (endDate && endDate < date) { toast('«Hasta el día» no puede ser antes del primer día'); return; }
      if (endDate === date) endDate = null;
      const tag = String(fd.get('tagId') || '');
      const next = {
        title: String(fd.get('title')).trim(), date, endDate, start: String(fd.get('start') || ''), end: String(fd.get('end') || ''),
        place: String(fd.get('place') || ''), url: String(fd.get('url') || ''), desc: String(fd.get('desc') || ''), status: String(fd.get('status')), tagId: tag ? Number(tag) : null,
      };
      if (state.calConnected) next.block = !!fd.get('block');
      const patch = Object.fromEntries(Object.entries(next).filter(([k, v]) => (v ?? null) !== (e[k] ?? (k === 'url' ? '' : null)) && !(k === 'block' && v === (e.block !== false))));
      if (!Object.keys(patch).length) { closeModal(); return; }
      if ('date' in patch && !('endDate' in patch)) patch.endDate = endDate;
      act(async () => { await Api.patch(`/events/${id}`, patch); closeModal(); }, RELOAD, 'Evento guardado');
    });
    const del = document.getElementById('xDelete');
    del.addEventListener('click', () => {
      if (!del.dataset.sure) { del.dataset.sure = '1'; del.textContent = 'Pulsa otra vez para borrarlo'; return; }
      act(async () => { await Api.del(`/events/${id}`); closeModal(); }, RELOAD, `Borrado: ${e.title}`);
    });
  }

  // ---------- Manage colour categories ----------
  function modalTags() {
    const used = new Set(state.tags.map((t) => t.color));
    const nextColor = (PALETTE.find(([c]) => !used.has(c)) || PALETTE[0])[0];
    openModal(`
      <h2>Colores del calendario</h2>
      <p class="note" style="margin:0">Cada color es una categoría para tus eventos. Si borras una, sus eventos se quedan, sin color.</p>
      <ul class="tag-edit">${state.tags.map((t) => `<li>
        <input class="tag-name" data-tagname="${t.id}" value="${esc(t.name)}" aria-label="Nombre del color" maxlength="40">
        <div class="pal" role="radiogroup" aria-label="Color de ${esc(t.name)}">${PALETTE.map(([c, n]) => `<button type="button" role="radio" aria-checked="${c === t.color}" class="cm-sw" style="background:${c}" data-tagcolor="${t.id}:${c}" title="${n}" aria-label="${n}"></button>`).join('')}</div>
        <button type="button" class="btn small ghost" data-tagdel="${t.id}" aria-label="Borrar ${esc(t.name)}">Borrar</button></li>`).join('')}</ul>
      <div class="form-row" style="align-items:end"><div class="field"><label for="newTag">Nuevo color</label><input id="newTag" placeholder="Familia, Clientes, Deporte…" maxlength="40"></div><button type="button" class="btn" id="addTag">${swatch(nextColor)}Añadir</button></div>
      <div class="modal-foot"><button type="button" class="btn primary" data-action="close-modal">Hecho</button></div>`, () => {});
    const root = modalRoot;
    root.querySelectorAll('[data-tagname]').forEach((inp) => inp.addEventListener('change', () => {
      const name = inp.value.trim(); if (!name) return;
      act(() => Api.patch(`/cal-tags/${inp.dataset.tagname}`, { name }), ['tags'], 'Nombre guardado');
    }));
    root.querySelectorAll('[data-tagcolor]').forEach((b) => b.addEventListener('click', () => {
      const [id, color] = b.dataset.tagcolor.split(':');
      act(() => Api.patch(`/cal-tags/${id}`, { color }), ['tags']).then(modalTags);
    }));
    root.querySelectorAll('[data-tagdel]').forEach((b) => b.addEventListener('click', () => {
      if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = '¿Seguro?'; return; }
      act(async () => { await Api.del(`/cal-tags/${b.dataset.tagdel}`); }, ['tags', 'events']).then(modalTags);
    }));
    const add = () => {
      const name = document.getElementById('newTag').value.trim();
      if (!name) { document.getElementById('newTag').focus(); return; }
      act(() => Api.post('/cal-tags', { name, color: nextColor }), ['tags'], `Añadido: ${name}`).then(modalTags);
    };
    document.getElementById('addTag').addEventListener('click', add);
    document.getElementById('newTag').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); add(); } });
  }

  // ---------- Actions from the shared click handler ----------
  function nav(n) {
    if (state.calView === 'week') state.calWeek = n === 0 ? mondayOf(TODAY) : addDays(state.calWeek, 7 * n);
    else state.calMonth = n === 0 ? new Date(TODAY.getFullYear(), TODAY.getMonth(), 1) : new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() + n, 1);
    act(() => {}, ['calendar']);
  }
  function setView(v) {
    if (v === state.calView) return;
    if (v === 'week') {
      const m = state.calMonth;
      state.calWeek = TODAY.getMonth() === m.getMonth() && TODAY.getFullYear() === m.getFullYear() ? mondayOf(TODAY) : mondayOf(m);
    } else {
      const mid = addDays(state.calWeek, 3);
      state.calMonth = new Date(mid.getFullYear(), mid.getMonth(), 1);
    }
    state.calView = v;
    try { localStorage.setItem('stolk.calView', v); } catch {}
    act(() => {}, ['calendar']);
  }
  try { const v = localStorage.getItem('stolk.calView'); if (v === 'week' || v === 'month') state.calView = v; } catch {}

  function handle(a, id) {
    if (a === 'cal-nav') nav(Number(id));
    else if (a === 'cal-view') setView(id);
    else if (a === 'cal-tags') { closeMenu(); modalTags(); }
    else if (a === 'edit-event') { closeMenu(); modalEditEvent(Number(id)); }
    else if (a === 'new-event') modalEvent(/^\d{4}-\d\d-\d\d$/.test(id || '') ? id : undefined);
    else if (a === 'open-day') modalDay(id);
    else return false;
    return true;
  }

  return { view, afterRender, range, handle, modalDay, modalEvent, modalEditEvent, deferRender, tagOf, evStyle, PALETTE };
};
