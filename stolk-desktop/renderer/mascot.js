/* Stölk mascot: the ö of the logo, alive.
   The ring is the body and the umlaut dots are the eyes; the light glint in each eye is where it looks.
   Usage: const m = StolkMascot.mount(gElement, { drop: 80 });
          m.set('idle' | 'listen' | 'think' | 'sleep');   // a state that lasts until changed
          m.play('hop' | 'jump' | 'happy' | 'thanks' | 'eyeroll' | 'wink' | 'surprised' | 'sad' | 'celebrate' | 'angry' | 'error' | 'blink');
          m.ping();                                      // tiny nod, e.g. on each keystroke while listening
   Colours: ink is currentColor, the glint uses var(--m-bg). Everything runs on the Web Animations API. */
(function (global) {
  const NS = 'http://www.w3.org/2000/svg';
  const EYES = [{ cx: 98, cy: 44 }, { cx: 122, cy: 44 }];
  const REST = { x: 2.5, y: -2.5 }; // the glint sits up-right when the eye looks straight ahead
  const reduced = () => !!global.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let uid = 0;

  const make = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  /** Glint offset from the eye centre (x, y) as a transform relative to its rest spot. */
  const at = (x, y) => `translate(${(x - REST.x).toFixed(2)}px,${(y - REST.y).toFixed(2)}px)`;
  const orbit = (r, n = 16, dir = 1, start = -Math.PI / 2) => Array.from({ length: n + 1 }, (_, i) => {
    const a = start + dir * (i / n) * 2 * Math.PI;
    return { transform: at(r * Math.cos(a), r * Math.sin(a)) };
  });
  const FB = 'transform-box:fill-box;transform-origin:50% 50%';

  /** Animations. Each returns a list of Web Animations; `m` holds the parts. */
  const ONE_SHOTS = {
    blink: (m) => m.eyes.map((e) => e.animate([{ transform: 'scaleY(1)' }, { transform: 'scaleY(.1)', offset: 0.5 }, { transform: 'scaleY(1)' }], { duration: 170, easing: 'ease-in-out' })),

    // Jumps up, falls out of the top bar into the page, bounces and climbs back.
    hop: (m) => {
      const d = m.opts.drop;
      return [
        m.body.animate([
          { transform: 'translate(0,0) scale(1,1)' },
          { transform: 'translate(0,0) scale(1.14,.84)', offset: 0.1, easing: 'cubic-bezier(.2,.8,.3,1)' },
          { transform: 'translate(0,-36px) scale(.9,1.12)', offset: 0.28, easing: 'ease-out' },
          { transform: 'translate(0,-42px) scale(1,1)', offset: 0.36, easing: 'ease-in' },
          { transform: `translate(0,${d}px) scale(.94,1.08)`, offset: 0.58 },
          { transform: `translate(0,${d + 4}px) scale(1.16,.84)`, offset: 0.63, easing: 'ease-out' },
          { transform: `translate(0,${d - 14}px) scale(1,1)`, offset: 0.72, easing: 'ease-in-out' },
          { transform: `translate(0,${d}px) scale(1.04,.96)`, offset: 0.78, easing: 'ease-in' },
          { transform: 'translate(0,-6px) scale(.95,1.06)', offset: 0.92, easing: 'ease-out' },
          { transform: 'translate(0,0) scale(1,1)' },
        ], { duration: 1600 }),
        ...m.glints.map((g) => g.animate([
          { transform: at(REST.x, REST.y) }, { transform: at(0, -3.5), offset: 0.3 },
          { transform: at(0, 4), offset: 0.5 }, { transform: at(0, 4), offset: 0.8 }, { transform: at(REST.x, REST.y) },
        ], { duration: 1600 })),
      ];
    },

    // Small hop in place, for most questions (the big hop out of the bar is only now and then).
    jump: (m) => [
      m.body.animate([
        { transform: 'translate(0,0) scale(1,1)' },
        { transform: 'translate(0,0) scale(1.1,.88)', offset: 0.18, easing: 'ease-out' },
        { transform: 'translate(0,-18px) scale(.95,1.06)', offset: 0.5, easing: 'ease-in' },
        { transform: 'translate(0,0) scale(1.06,.94)', offset: 0.82, easing: 'ease-out' },
        { transform: 'translate(0,0) scale(1,1)' },
      ], { duration: 650 }),
      ...m.glints.map((g) => g.animate([{ transform: at(REST.x, REST.y) }, { transform: at(0, -3.5), offset: 0.45 }, { transform: at(REST.x, REST.y) }], { duration: 650 })),
    ],

    // "¿Cómo voy a saber eso?": looks down, rolls the eyes up and across, lids drop, sighs.
    eyeroll: (m) => [
      ...m.glints.map((g) => g.animate([
        { transform: at(REST.x, REST.y) },
        { transform: at(-3, 3), offset: 0.14 },
        { transform: at(-4.2, 0), offset: 0.24 },
        { transform: at(-3, -3), offset: 0.32 },
        { transform: at(0, -4.3), offset: 0.4 },
        { transform: at(3, -3), offset: 0.48 },
        { transform: at(4, 0.5), offset: 0.58 },
        { transform: at(4, 0.5), offset: 0.86 },
        { transform: at(REST.x, REST.y) },
      ], { duration: 2000, easing: 'ease-in-out' })),
      ...m.lids.map((l) => l.animate([
        { transform: 'translateY(0)' }, { transform: 'translateY(0)', offset: 0.46 },
        { transform: 'translateY(15px)', offset: 0.6 }, { transform: 'translateY(15px)', offset: 0.86 }, { transform: 'translateY(0)' },
      ], { duration: 2000, easing: 'ease-in-out' })),
      m.body.animate([
        { transform: 'scale(1,1) rotate(0)' }, { transform: 'scale(1,1) rotate(0)', offset: 0.6 },
        { transform: 'scale(1.06,.92) rotate(-5deg)', offset: 0.72 }, { transform: 'scale(1.04,.95) rotate(-4deg)', offset: 0.86 },
        { transform: 'scale(1,1) rotate(0)' },
      ], { duration: 2000, easing: 'ease-in-out' }),
    ],

    // Gracias: happy eyes, a smile inside the ring, a little star twinkles at its side.
    thanks: (m) => [
      ...happyEyes(m, 2300),
      m.smile.animate([
        { strokeDashoffset: 1, opacity: 1 }, { strokeDashoffset: 0, opacity: 1, offset: 0.16 },
        { strokeDashoffset: 0, opacity: 1, offset: 0.86 }, { strokeDashoffset: 0, opacity: 0 },
      ], { duration: 2300, easing: 'ease-out' }),
      starPop(m.stars[0], 2300, 0.12),
      m.body.animate([
        { transform: 'rotate(0) translateY(0)' }, { transform: 'rotate(7deg) translateY(-6px)', offset: 0.14, easing: 'ease-out' },
        { transform: 'rotate(5deg) translateY(0)', offset: 0.26 }, { transform: 'rotate(5deg) translateY(0)', offset: 0.84 },
        { transform: 'rotate(0) translateY(0)' },
      ], { duration: 2300 }),
    ],

    // Found it / good news.
    happy: (m) => [
      ...happyEyes(m, 1400),
      m.body.animate(bounces(2, 14), { duration: 1000 }),
    ],

    // A draft is ready for you.
    wink: (m) => [
      m.eyes[1].animate([{ transform: 'scaleY(1)' }, { transform: 'scaleY(.1)', offset: 0.18 }, { transform: 'scaleY(.1)', offset: 0.7 }, { transform: 'scaleY(1)' }], { duration: 1000, easing: 'ease-in-out' }),
      m.arcs[1].animate([{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.68 }, { opacity: 0 }], { duration: 1000 }),
      m.glints[0].animate([{ transform: at(REST.x, REST.y) }, { transform: at(3.5, -1), offset: 0.2 }, { transform: at(3.5, -1), offset: 0.7 }, { transform: at(REST.x, REST.y) }], { duration: 1000 }),
      m.body.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(-6deg)', offset: 0.2 }, { transform: 'rotate(-6deg)', offset: 0.7 }, { transform: 'rotate(0)' }], { duration: 1000, easing: 'ease-in-out' }),
    ],

    // Something unexpected in the data.
    surprised: (m) => [
      m.body.animate([
        { transform: 'translateY(0) scale(1,1)' }, { transform: 'translateY(-12px) scale(.92,1.12)', offset: 0.14, easing: 'ease-out' },
        { transform: 'translateY(0) scale(1.04,.97)', offset: 0.32 }, { transform: 'translateY(0) scale(1,1)' },
      ], { duration: 1300 }),
      ...m.eyes.map((e) => e.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.32)', offset: 0.14 }, { transform: 'scale(1.25)', offset: 0.75 }, { transform: 'scale(1)' }], { duration: 1300, easing: 'ease-out' })),
      ...m.glints.map((g) => g.animate([{ transform: at(REST.x, REST.y) }, { transform: `${at(0, -0.5)} scale(.7)`, offset: 0.14 }, { transform: `${at(0, -0.5)} scale(.7)`, offset: 0.75 }, { transform: at(REST.x, REST.y) }], { duration: 1300 })),
    ],

    // Nothing found, or bad news.
    sad: (m) => [
      m.body.animate([{ transform: 'scale(1,1)' }, { transform: 'scale(1.05,.93)', offset: 0.25 }, { transform: 'scale(1.05,.93)', offset: 0.8 }, { transform: 'scale(1,1)' }], { duration: 2200, easing: 'ease-in-out' }),
      ...m.eyes.map((e, i) => e.animate([{ transform: 'translateY(0) rotate(0)' }, { transform: `translateY(3px) rotate(${i ? 14 : -14}deg)`, offset: 0.25 }, { transform: `translateY(3px) rotate(${i ? 14 : -14}deg)`, offset: 0.8 }, { transform: 'translateY(0) rotate(0)' }], { duration: 2200, easing: 'ease-in-out' })),
      ...m.lids.map((l) => l.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(11px)', offset: 0.25 }, { transform: 'translateY(11px)', offset: 0.8 }, { transform: 'translateY(0)' }], { duration: 2200, easing: 'ease-in-out' })),
      ...m.glints.map((g) => g.animate([{ transform: at(REST.x, REST.y) }, { transform: at(0, 3.6), offset: 0.25 }, { transform: at(0, 3.6), offset: 0.8 }, { transform: at(REST.x, REST.y) }], { duration: 2200, easing: 'ease-in-out' })),
    ],

    // Saved, done, sent.
    celebrate: (m) => [
      ...happyEyes(m, 1800),
      m.body.animate(bounces(2, 26), { duration: 1300 }),
      starPop(m.stars[0], 1800, 0.18),
      starPop(m.stars[1], 1800, 0.34),
    ],

    // Off-topic or too many messages: grumpy slanted lids, puffs up, an anger mark pops. Cartoon cross, never glaring.
    angry: (m) => [
      ...m.lids.map((l, i) => l.animate([
        { transform: 'translateY(0) rotate(0)' }, { transform: `translateY(13px) rotate(${i ? -22 : 22}deg)`, offset: 0.12 },
        { transform: `translateY(13px) rotate(${i ? -22 : 22}deg)`, offset: 0.84 }, { transform: 'translateY(0) rotate(0)' },
      ], { duration: 2000, easing: 'ease-in-out' })),
      ...m.glints.map((g, i) => g.animate([{ transform: at(REST.x, REST.y) }, { transform: at(i ? -2.5 : 2.5, 1.5), offset: 0.12 }, { transform: at(i ? -2.5 : 2.5, 1.5), offset: 0.84 }, { transform: at(REST.x, REST.y) }], { duration: 2000 })),
      m.body.animate([
        { transform: 'scale(1,1) translateX(0)' }, { transform: 'scale(1.1,.9) translateX(0)', offset: 0.1 },
        { transform: 'scale(1.06,1.04) translateX(-2px)', offset: 0.18 }, { transform: 'scale(1.06,1.04) translateX(2px)', offset: 0.22 },
        { transform: 'scale(1.06,1.04) translateX(-2px)', offset: 0.26 }, { transform: 'scale(1.06,1.04) translateX(2px)', offset: 0.3 },
        { transform: 'scale(1.06,1.04) translateX(0)', offset: 0.34 }, { transform: 'scale(1.06,1.04) translateX(0)', offset: 0.84 },
        { transform: 'scale(1,1) translateX(0)' },
      ], { duration: 2000 }),
      m.vein.animate([
        { opacity: 0, transform: 'scale(0)' }, { opacity: 0, transform: 'scale(0)', offset: 0.14 },
        { opacity: 1, transform: 'scale(1.3)', offset: 0.22 }, { opacity: 1, transform: 'scale(.9)', offset: 0.3 },
        { opacity: 1, transform: 'scale(1.1)', offset: 0.4 }, { opacity: 1, transform: 'scale(.95)', offset: 0.5 },
        { opacity: 1, transform: 'scale(1)', offset: 0.8 }, { opacity: 0, transform: 'scale(.6)' },
      ], { duration: 2000, easing: 'ease-out' }),
    ],

    // Something failed: shakes its head with eyes squeezed, then a dizzy glint.
    error: (m) => [
      m.body.animate([
        { transform: 'translateX(0) rotate(0)' }, { transform: 'translateX(-7px) rotate(-6deg)', offset: 0.1 },
        { transform: 'translateX(7px) rotate(6deg)', offset: 0.22 }, { transform: 'translateX(-6px) rotate(-5deg)', offset: 0.34 },
        { transform: 'translateX(5px) rotate(4deg)', offset: 0.46 }, { transform: 'translateX(0) rotate(0)', offset: 0.58 },
        { transform: 'translateX(0) rotate(0)' },
      ], { duration: 1500, easing: 'ease-in-out' }),
      ...m.eyes.map((e) => e.animate([{ transform: 'scaleY(1)' }, { transform: 'scaleY(.22)', offset: 0.08 }, { transform: 'scaleY(.22)', offset: 0.52 }, { transform: 'scaleY(1)', offset: 0.62 }, { transform: 'scaleY(1)' }], { duration: 1500 })),
      ...m.glints.map((g, i) => g.animate([{ transform: at(REST.x, REST.y) }, { transform: at(REST.x, REST.y), offset: 0.6 }, ...orbit(3.6, 8, i ? 1 : -1).map((k, j) => ({ ...k, offset: 0.6 + (j / 8) * 0.36 })), { transform: at(REST.x, REST.y) }], { duration: 1500 })),
    ],
  };

  /** States: loop until another state is set. */
  const STATES = {
    idle: () => [],
    // While you type in Preguntar: looks down at the box, leaning in.
    listen: (m) => [
      ...m.glints.map((g) => g.animate([{ transform: at(-1, 3.8) }, { transform: at(-1, 3.8) }], { duration: 1000, fill: 'forwards' })),
      m.body.animate([{ transform: 'scale(1,1)' }, { transform: 'scale(1.02,.97)' }], { duration: 400, fill: 'forwards', easing: 'ease-out' }),
    ],
    // While Claude works: the glints spin around inside the eyes and the ö bobs.
    think: (m) => [
      ...m.glints.map((g) => g.animate(orbit(3.6, 16, 1), { duration: 1300, iterations: Infinity })),
      m.body.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-5px)' }, { transform: 'translateY(0)' }], { duration: 1800, iterations: Infinity, easing: 'ease-in-out' }),
    ],
    // After a long time without you: eyes shut, slow breathing, a z floats up.
    sleep: (m) => [
      ...m.eyes.map((e) => e.animate([{ transform: 'scaleY(1)' }, { transform: 'scaleY(.12)' }], { duration: 600, fill: 'forwards', easing: 'ease-in' })),
      ...m.glints.map((g) => g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' })),
      m.body.animate([{ transform: 'scale(1,1)' }, { transform: 'scale(1.03,.96)' }, { transform: 'scale(1,1)' }], { duration: 3200, iterations: Infinity, easing: 'ease-in-out' }),
      m.zee.animate([
        { opacity: 0, transform: 'translate(0,0) scale(.6)' }, { opacity: 1, transform: 'translate(4px,-8px) scale(1)', offset: 0.3 },
        { opacity: 0, transform: 'translate(12px,-26px) scale(1.15)' },
      ], { duration: 2600, iterations: Infinity, delay: 400, easing: 'ease-out' }),
    ],
  };

  function happyEyes(m, duration) {
    const kf = (a, b) => [{ opacity: a }, { opacity: b, offset: 0.1 }, { opacity: b, offset: 0.86 }, { opacity: a }];
    return [...m.eyes.map((e) => e.animate(kf(1, 0), { duration })), ...m.arcs.map((a) => a.animate(kf(0, 1), { duration }))];
  }
  function bounces(n, h) {
    const k = [{ transform: 'translateY(0) scale(1,1)' }];
    for (let i = 0; i < n; i++) {
      const o = i / n, s = 1 / n;
      k.push({ transform: 'translateY(0) scale(1.1,.9)', offset: o + s * 0.12 });
      k.push({ transform: `translateY(-${h}px) scale(.95,1.06)`, offset: o + s * 0.5 });
      k.push({ transform: 'translateY(0) scale(1.06,.94)', offset: o + s * 0.88 });
    }
    k.push({ transform: 'translateY(0) scale(1,1)' });
    return k;
  }
  function starPop(star, duration, at0) {
    return star.animate([
      { opacity: 0, transform: 'scale(0) rotate(-90deg)' },
      { opacity: 0, transform: 'scale(0) rotate(-90deg)', offset: at0 },
      { opacity: 1, transform: 'scale(1.25) rotate(0deg)', offset: at0 + 0.1 },
      { opacity: 1, transform: 'scale(.85) rotate(10deg)', offset: at0 + 0.24 },
      { opacity: 1, transform: 'scale(1.1) rotate(0deg)', offset: at0 + 0.38 },
      { opacity: 1, transform: 'scale(1) rotate(0deg)', offset: 0.84 },
      { opacity: 0, transform: 'scale(0) rotate(45deg)' },
    ], { duration, easing: 'ease-out' });
  }

  // Under reduced motion, show only the expression (smile, happy eyes, star) without movement.
  const STILL = { thanks: ['smile', 'arcs', 'star0'], happy: ['arcs'], celebrate: ['arcs', 'star0', 'star1'], wink: ['arc1'] };

  const all = new Set();
  let px = null, py = null, raf = 0;

  function mount(g, opts = {}) {
    const id = `m${++uid}`;
    const m = { opts: { drop: 80, ...opts }, state: 'idle', running: [], loops: [], gen: 0, busy: false };
    g.textContent = '';
    m.root = g;
    const body = m.body = make('g', { class: 'm-body', style: 'transform-box:fill-box;transform-origin:50% 100%' }, g);
    make('circle', { class: 'm-ring', cx: 110, cy: 90, r: 23, fill: 'none', stroke: 'currentColor', 'stroke-width': 14 }, body);
    m.smile = make('path', { class: 'm-smile', d: 'M101.5 91 Q110 100 118.5 91', fill: 'none', stroke: 'currentColor', 'stroke-width': 5, 'stroke-linecap': 'round', pathLength: 1, style: 'stroke-dasharray:1;stroke-dashoffset:1;opacity:0' }, body);
    const defs = make('defs', {}, body);
    m.eyes = []; m.glints = []; m.looks = []; m.lids = []; m.arcs = [];
    EYES.forEach((e, i) => {
      const cp = make('clipPath', { id: `${id}-lid${i}` }, defs);
      m.lids.push(make('rect', { x: e.cx - 18, y: e.cy - 16, width: 36, height: 36, style: FB }, cp));
      const wrap = make('g', { 'clip-path': `url(#${id}-lid${i})` }, body);
      const eye = make('g', { class: 'm-eye', style: FB }, wrap);
      make('circle', { class: 'eye', cx: e.cx, cy: e.cy, r: 9, fill: 'currentColor' }, eye);
      const look = make('g', { class: 'm-look' }, eye);
      m.glints.push(make('circle', { class: 'glint', cx: e.cx + REST.x, cy: e.cy + REST.y, r: 4.4, style: `fill:var(--m-bg,#fff);${FB}` }, look));
      m.eyes.push(eye); m.looks.push(look);
      m.arcs.push(make('path', { class: 'm-arc', d: `M${e.cx - 8} ${e.cy + 3} Q${e.cx} ${e.cy - 9} ${e.cx + 8} ${e.cy + 3}`, fill: 'none', stroke: 'currentColor', 'stroke-width': 5, 'stroke-linecap': 'round', style: 'opacity:0' }, body));
    });
    const star = (x, y, s) => make('path', { class: 'm-star', d: `M${x} ${y - s}Q${x + s * 0.18} ${y - s * 0.18} ${x + s} ${y}Q${x + s * 0.18} ${y + s * 0.18} ${x} ${y + s}Q${x - s * 0.18} ${y + s * 0.18} ${x - s} ${y}Q${x - s * 0.18} ${y - s * 0.18} ${x} ${y - s}Z`, fill: 'currentColor', style: `opacity:0;${FB}` }, body);
    m.stars = [star(146, 62, 9), star(73, 70, 6.5)];
    m.vein = make('path', { class: 'm-vein', d: 'M141 37Q146 38 145 33M151 33Q150 38 155 37M155 45Q150 44 151 49M145 49Q146 44 141 45', fill: 'none', stroke: 'currentColor', 'stroke-width': 3, 'stroke-linecap': 'round', style: `opacity:0;${FB}` }, body);
    m.zee = make('path', { class: 'm-zee', d: 'M138 36h9l-9 10h9', fill: 'none', stroke: 'currentColor', 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', style: `opacity:0;${FB}` }, body);

    const stopLoops = () => { m.loops.forEach((a) => a.cancel()); m.loops = []; };
    const startLoops = () => { stopLoops(); if (!reduced()) m.loops = STATES[m.state](m); else if (m.state === 'sleep') m.loops = STATES.sleep(m).slice(0, 2).map((a) => (a.finish(), a)); };

    m.api = {
      el: g,
      get state() { return m.state; },
      set(state) {
        if (!STATES[state] || state === m.state) return;
        const waking = m.state === 'sleep';
        m.state = state;
        if (!m.busy) startLoops();
        if (state === 'idle') { look(m, true); if (waking) m.api.play('blink'); }
      },
      async play(name) {
        if (!ONE_SHOTS[name]) return;
        const gen = ++m.gen;
        m.running.forEach((a) => a.cancel());
        if (reduced()) {
          const parts = STILL[name];
          if (!parts) return;
          const nodes = parts.map((p) => (p === 'smile' ? m.smile : p === 'arcs' ? m.arcs : p === 'arc1' ? m.arcs[1] : m.stars[+p.slice(4)])).flat();
          m.running = nodes.map((n) => n.animate([{ opacity: 1, strokeDashoffset: 0, transform: 'none' }, { opacity: 1, strokeDashoffset: 0, transform: 'none' }], { duration: 1600 }));
          if (parts.includes('arcs') || parts.includes('arc1')) m.running.push(...(parts.includes('arcs') ? m.eyes : [m.eyes[1]]).map((e) => e.animate([{ opacity: 0 }, { opacity: 0 }], { duration: 1600 })));
          await Promise.all(m.running.map((a) => a.finished)).catch(() => {});
          return;
        }
        m.busy = true;
        stopLoops();
        look(m, false);
        m.running = ONE_SHOTS[name](m);
        await Promise.all(m.running.map((a) => a.finished)).catch(() => {});
        if (gen !== m.gen) return;
        m.running = []; m.busy = false;
        startLoops();
        if (m.state === 'idle') look(m, true);
      },
      ping() {
        if (m.busy || reduced()) return;
        m.eyes.forEach((e) => e.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(2.5px)' }, { transform: 'translateY(0)' }], { duration: 160, composite: 'add' }));
      },
      destroy() { all.delete(m); m.gen++; stopLoops(); m.running.forEach((a) => a.cancel()); clearTimeout(m.blinkT); },
    };

    // Idle life: a blink every few seconds.
    const scheduleBlink = () => {
      m.blinkT = setTimeout(() => {
        if (m.state === 'idle' && !m.busy && !reduced() && document.visibilityState !== 'hidden') m.api.play('blink');
        scheduleBlink();
      }, 2800 + Math.random() * 4200);
    };
    scheduleBlink();
    all.add(m);
    look(m, true);
    return m.api;
  }

  /** Point the glints at the cursor (idle only). */
  function look(m, on) {
    m.looks.forEach((l, i) => {
      if (!on || m.state !== 'idle' || m.busy || px === null || reduced()) { l.style.transform = ''; return; }
      const svg = l.ownerSVGElement, ctm = l.getScreenCTM?.();
      if (!svg || !ctm) return;
      const e = EYES[i];
      const sx = ctm.a * e.cx + ctm.c * e.cy + ctm.e, sy = ctm.b * e.cx + ctm.d * e.cy + ctm.f;
      const dx = px - sx, dy = py - sy, d = Math.hypot(dx, dy) || 1, k = Math.min(4.2, d / 14);
      l.style.transform = at((dx / d) * k, (dy / d) * k);
    });
  }
  if (global.document) {
    document.addEventListener('pointermove', (e) => {
      px = e.clientX; py = e.clientY;
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; all.forEach((m) => look(m, true)); });
    });
    document.documentElement.addEventListener('pointerleave', () => { px = null; all.forEach((m) => look(m, false)); });
  }

  global.StolkMascot = {
    mount,
    // What Claude may pick in Preguntar. "angry" is set by the server (off-topic, too many messages), not by Claude.
    emotions: ['neutral', 'happy', 'thanks', 'eyeroll', 'wink', 'surprised', 'sad', 'celebrate', 'angry'],
    oneShots: Object.keys(ONE_SHOTS),
    states: Object.keys(STATES),
  };
})(typeof window !== 'undefined' ? window : globalThis);
