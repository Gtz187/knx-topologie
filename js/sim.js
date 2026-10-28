// Animation der Telegramm-Simulation auf dem gezeichneten SVG.
import { busPath } from './layout.js';
import { COLORS } from './render.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}) => {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

const parse = (k) => k.split(',').map(Number);
const len = (pts) => pts.reduce((n, p, i) => (i ? n + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

function pointAt(pts, d) {
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
    const l = Math.hypot(x2 - x1, y2 - y1);
    if (d <= l) return [x1 + ((x2 - x1) * d) / (l || 1), y1 + ((y2 - y1) * d) / (l || 1)];
    d -= l;
  }
  return pts[pts.length - 1];
}

/**
 * Baut aus dem Simulationsergebnis einen Ablaufplan aus Bewegungen (tracks)
 * und Ereignissen (events) und spielt ihn auf dem SVG ab.
 */
export function animate(svg, lay, result, { speed = 1, onDone } = {}) {
  const layer = svg.querySelector('#sim-layer');
  layer.replaceChildren();
  const content = svg.querySelector('#content');
  content.classList.add('dim');
  svg.querySelectorAll('.lit,.rx,.tx').forEach((n) => n.classList.remove('lit', 'rx', 'tx'));

  const v = 380 * speed;          // Pixel pro Sekunde
  const transit = 0.35 / speed;    // Zeit im Koppler
  const tracks = [];
  const events = [];
  const lit = (sel) => events.push(sel);

  const send = result.steps.find((s) => s.kind === 'send');
  const senderAttach = lay.attach.get(send.deviceId);
  const entry = new Map([[send.busId, { node: senderAttach.node, t: len(senderAttach.stub) / v }]]);
  tracks.push({ pts: [...senderAttach.stub].reverse(), t0: 0, dur: len(senderAttach.stub) / v });
  lit({ t: 0, fn: () => { mark(svg, `[data-id="${send.deviceId}"],[data-dstub="${send.deviceId}"]`, 'lit'); mark(svg, `[data-id="${send.deviceId}"]`, 'tx'); } });

  // Busse in Reihenfolge der Simulation abarbeiten
  const order = result.steps.filter((s) => s.kind === 'bus');
  for (const b of order) {
    const en = entry.get(b.busId);
    if (!en) continue;
    lit({ t: en.t, fn: () => mark(svg, `[data-bus="${b.busId}"]`, 'lit') });

    // Empfänger auf diesem Bus
    for (const r of result.steps.filter((s) => s.kind === 'receive' && s.busId === b.busId && s.deviceId)) {
      const a = lay.attach.get(r.deviceId);
      const path = busPath(lay, b.busId, en.node, a.node);
      if (!path) continue;
      const pts = [...path, ...a.stub.slice(1)];
      const dur = len(pts) / v;
      tracks.push({ pts, t0: en.t, dur });
      lit({ t: en.t + dur, fn: () => { mark(svg, `[data-id="${r.deviceId}"],[data-dstub="${r.deviceId}"]`, 'lit'); mark(svg, `[data-id="${r.deviceId}"]`, 'rx'); } });
    }

    // Koppler an diesem Bus
    for (const c of result.steps.filter((s) => s.kind === 'coupler' && s.fromBus === b.busId)) {
      const ca = lay.cAttach.get(c.couplerId);
      if (!ca) continue;
      const near = c.dir === 'down' ? ca.up : ca.down;
      const far = c.dir === 'down' ? ca.down : ca.up;
      const path = busPath(lay, b.busId, en.node, near.node);
      if (!path) continue;
      const dur = len(path) / v;
      const tArr = en.t + dur;
      tracks.push({ pts: path, t0: en.t, dur });
      const box = lay.couplers.find((x) => x.id === c.couplerId);
      lit({ t: tArr, fn: () => { mark(svg, `[data-id="${c.couplerId}"]`, 'lit'); if (c.pass) mark(svg, `[data-cstub="${c.couplerId}"]`, 'lit'); badge(layer, box, c.pass); } });
      if (c.pass) {
        const through = [parse(near.node), parse(far.node)];
        tracks.push({ pts: through, t0: tArr, dur: transit });
        entry.set(c.toBus, { node: far.node, t: tArr + transit });
      } else {
        tracks.push({ pts: [parse(near.node), parse(near.node)], t0: tArr, dur: 0.25, fade: true, color: COLORS.block });
      }
    }
  }
  // Koppler als Empfänger
  for (const r of result.steps.filter((s) => s.kind === 'receive' && s.couplerId)) {
    const en = entry.get(r.busId);
    lit({ t: (en ? en.t : 0) + 0.3, fn: () => mark(svg, `[data-id="${r.couplerId}"]`, 'lit') });
  }

  const total = Math.max(0, ...tracks.map((t) => t.t0 + t.dur), ...events.map((e) => e.t)) + 0.2;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) {
    events.forEach((e) => e.fn());
    onDone?.();
    return () => {};
  }

  const dots = tracks.map((t) => {
    const g = el('g');
    g.append(el('circle', { r: 9, fill: t.color || COLORS.signal, opacity: 0.25 }), el('circle', { r: 4.5, fill: t.color || COLORS.signal, stroke: '#fff', 'stroke-width': 1.5 }));
    g.style.display = 'none';
    layer.append(g);
    return { ...t, g };
  });
  events.sort((a, b) => a.t - b.t);
  let ei = 0;
  let raf = 0;
  const start = performance.now();
  const frame = (now) => {
    const t = (now - start) / 1000;
    while (ei < events.length && events[ei].t <= t) events[ei++].fn();
    for (const d of dots) {
      if (t < d.t0 || t > d.t0 + d.dur + (d.fade ? 0.4 : 0.05)) { d.g.style.display = 'none'; continue; }
      const k = d.dur ? Math.min(1, (t - d.t0) / d.dur) : 1;
      const [x, y] = pointAt(d.pts, k * len(d.pts));
      d.g.style.display = '';
      d.g.setAttribute('transform', `translate(${x} ${y})`);
      if (d.fade) d.g.setAttribute('opacity', String(Math.max(0, 1 - (t - d.t0) / 0.6)));
    }
    if (t < total) raf = requestAnimationFrame(frame);
    else { dots.forEach((d) => d.g.remove()); while (ei < events.length) events[ei++].fn(); onDone?.(); }
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

function mark(svg, sel, ...cls) {
  svg.querySelectorAll(sel).forEach((n) => n.classList.add(...cls));
}

function badge(layer, box, pass) {
  if (!box) return;
  const cx = box.x + box.w - 4, cy = box.y + 4;
  const g = el('g', { class: 'badge', transform: `translate(${cx} ${cy})` });
  g.append(el('circle', { r: 12, fill: pass ? COLORS.pass : COLORS.block, stroke: '#fff', 'stroke-width': 2 }));
  const t = el('text', { 'text-anchor': 'middle', y: 4.5 });
  t.textContent = pass ? '✓' : '✕';
  g.append(t);
  layer.append(g);
}

export function clearSim(svg) {
  if (!svg) return;
  svg.querySelector('#sim-layer')?.replaceChildren();
  svg.querySelector('#content')?.classList.remove('dim');
  svg.querySelectorAll('.lit,.rx,.tx').forEach((n) => n.classList.remove('lit', 'rx', 'tx'));
}
