// Animation der Telegramm-Simulation auf dem gezeichneten SVG.
// Alle Punkte einer Übertragung starten und landen gleichzeitig – auf dem Bus
// liegt ein Telegramm überall zur selben Zeit an.
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

const MEDIUM_COLOR = { TP: COLORS.signal, IP: COLORS.ip, RF: COLORS.rf };

// Anschlusspunkt eines Elements am Bus plus Weg bis an seinen Rand
function endpoint(lay, ref) {
  if (ref.device) {
    const a = lay.attach.get(ref.device);
    return a ? { node: a.node, edge: [...a.stub].reverse() } : null; // Rand → Bus
  }
  const ca = lay.cAttach.get(ref.coupler);
  const box = lay.couplers.find((c) => c.id === ref.coupler);
  if (!ca || !box) return null;
  const node = ca[ref.side].node;
  const [x, y] = parse(node);
  const yy = y < box.y ? box.y : y > box.y + box.h ? box.y + box.h : y;
  return { node, edge: [[x, yy], [x, y]] };
}

function route(lay, busId, from, to) {
  // Funk: direkte Linie durch die Luft
  if (lay.radios.some((r) => r.busId === busId)) {
    const pt = (ref) => (ref.device ? lay.attach.get(ref.device)?.node : lay.cAttach.get(ref.coupler)?.[ref.side]?.node);
    const a = pt(from), b = pt(to);
    return a && b ? [parse(a), parse(b)] : null;
  }
  const a = endpoint(lay, from), b = endpoint(lay, to);
  if (!a || !b) return null;
  const mid = busPath(lay, busId, a.node, b.node);
  if (!mid) return null;
  return [...a.edge, ...mid, ...[...b.edge].reverse()];
}

/**
 * Spielt das Simulationsergebnis ab.
 * @param {number} secs Sekunden pro Telegrammlänge
 */
export function animate(svg, lay, result, { secs = 1.2, onDone } = {}) {
  const layer = svg.querySelector('#sim-layer');
  layer.replaceChildren();
  svg.querySelector('#content').classList.add('dim');
  svg.querySelectorAll('.lit,.rx,.tx').forEach((n) => n.classList.remove('lit', 'rx', 'tx'));

  const tracks = [];
  const pulses = [];
  const events = [];
  const at = (t, fn) => events.push({ t: t * secs, fn });

  for (const ev of result.events) {
    if (ev.kind === 'tx') {
      const color = MEDIUM_COLOR[ev.medium];
      at(ev.t, () => {
        mark(svg, `[data-bus="${ev.busId}"]`, 'lit');
        if (ev.from.device) mark(svg, `[data-id="${ev.from.device}"],[data-dstub="${ev.from.device}"]`, 'lit', 'tx');
        if (ev.attempt) label(layer, lay, ev.from, `Wiederholung ${ev.attempt}`, COLORS.block);
      });
      for (const to of ev.to) {
        const pts = route(lay, ev.busId, ev.from, to);
        if (!pts) continue;
        tracks.push({ pts, t0: ev.t * secs, dur: ev.dur * secs, color, r: to.addressed ? 5 : 3.2, faint: !to.addressed });
        if (to.device) at(ev.t, () => mark(svg, `[data-dstub="${to.device}"]`, 'lit'));
      }
      if (ev.medium === 'RF') {
        const radio = lay.radios.find((r) => r.busId === ev.busId);
        const node = ev.from.device ? lay.attach.get(ev.from.device)?.node : lay.cAttach.get(ev.from.coupler)?.[ev.from.side]?.node;
        if (node) pulses.push({ at: parse(node), t0: ev.t * secs, dur: ev.dur * secs, color: ev.retrans ? COLORS.signal : color, R: radio ? (ev.range || 22) * radio.sc : 150, clip: radio ? `url(#clip-${ev.busId})` : null });
      }
    }
    if (ev.kind === 'ack') {
      for (const from of ev.from) {
        // Funk-Quittung über Repeater: Stück für Stück zurück
        const hops = [from, ...(ev.via || []), ev.to];
        const pts = hops.slice(1).reduce((acc, h, i) => {
          const seg = acc && route(lay, ev.busId, hops[i], h);
          return seg ? [...acc, ...(acc.length ? seg.slice(1) : seg)] : null;
        }, []);
        if (pts) tracks.push({ pts, t0: ev.t * secs, dur: ev.dur * secs, color: COLORS.pass, r: 3.6, ack: true });
      }
    }
    if (ev.kind === 'rx') {
      at(ev.t, () => {
        if (ev.ref.device) { mark(svg, `[data-id="${ev.ref.device}"]`, 'lit', 'rx'); }
        else mark(svg, `[data-id="${ev.ref.coupler}"]`, 'lit');
      });
    }
    if (ev.kind === 'off') at(ev.t, () => label(layer, lay, ev.ref, 'aus – keine Antwort', COLORS.ink2));
    if (ev.kind === 'coupler') {
      const box = lay.couplers.find((x) => x.id === ev.couplerId);
      at(ev.t, () => {
        mark(svg, `[data-id="${ev.couplerId}"]`, 'lit');
        badge(layer, box, ev.pass);
      });
    }
    if (ev.kind === 'through') {
      const ca = lay.cAttach.get(ev.couplerId);
      if (ca) {
        const pts = [parse(ca.up.node), ...(ca.mid ? [ca.mid] : []), parse(ca.down.node)];
        if (ev.dir === 'up') pts.reverse();
        tracks.push({ pts, t0: ev.t * secs, dur: ev.dur * secs, color: COLORS.signal, r: 4 });
        at(ev.t, () => mark(svg, `[data-cstub="${ev.couplerId}"]`, 'lit'));
      }
    }
    if (ev.kind === 'giveup') at(ev.t, () => label(layer, lay, ev.ref, 'keine Quittung – aufgegeben', COLORS.block));
  }

  const total = Math.max(0, ...tracks.map((t) => t.t0 + t.dur), ...events.map((e) => e.t)) + 0.3;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    events.forEach((e) => e.fn());
    onDone?.();
    return () => {};
  }

  const dots = tracks.map((t) => {
    const g = el('g', { 'pointer-events': 'none' });
    if (!t.faint) g.append(el('circle', { r: t.r * 2, fill: t.color, opacity: 0.22 }));
    g.append(el('circle', { r: t.r, fill: t.color, stroke: '#fff', 'stroke-width': t.ack ? 1 : 1.5, opacity: t.faint ? 0.75 : 1 }));
    g.style.display = 'none';
    layer.append(g);
    return { ...t, g, L: len(t.pts) };
  });
  const rings = pulses.map((p) => {
    const c = el('circle', { cx: p.at[0], cy: p.at[1], r: 0, fill: p.color, 'fill-opacity': 0.06, stroke: p.color, 'stroke-width': 2, 'pointer-events': 'none' });
    if (p.clip) c.setAttribute('clip-path', p.clip);
    c.style.display = 'none';
    layer.append(c);
    return { ...p, c };
  });
  events.sort((a, b) => a.t - b.t);
  let ei = 0;
  let raf = 0;
  const start = performance.now();
  const frame = (now) => {
    const t = (now - start) / 1000;
    while (ei < events.length && events[ei].t <= t) events[ei++].fn();
    for (const d of dots) {
      if (t < d.t0 || t > d.t0 + d.dur) { d.g.style.display = 'none'; continue; }
      const k = d.dur ? (t - d.t0) / d.dur : 1;
      const [x, y] = pointAt(d.pts, k * d.L);
      d.g.style.display = '';
      d.g.setAttribute('transform', `translate(${x} ${y})`);
    }
    for (const r of rings) {
      const k = (t - r.t0) / r.dur;
      if (k < 0 || k > 1) { r.c.style.display = 'none'; continue; }
      r.c.style.display = '';
      r.c.setAttribute('r', String(k * r.R));
      r.c.setAttribute('opacity', String(0.8 * (1 - k)));
    }
    if (t < total) raf = requestAnimationFrame(frame);
    else { dots.forEach((d) => d.g.remove()); rings.forEach((r) => r.c.remove()); while (ei < events.length) events[ei++].fn(); onDone?.(); }
  };
  raf = requestAnimationFrame(frame);
  return () => { cancelAnimationFrame(raf); };
}

function mark(svg, sel, ...cls) {
  svg.querySelectorAll(sel).forEach((n) => n.classList.add(...cls));
}

function badge(layer, box, pass) {
  if (!box) return;
  layer.querySelector(`[data-badge="${box.id}"]`)?.remove();
  const g = el('g', { class: 'badge', 'data-badge': box.id, transform: `translate(${box.x + box.w - 4} ${box.y + 4})` });
  g.append(el('circle', { r: 12, fill: pass ? COLORS.pass : COLORS.block, stroke: '#fff', 'stroke-width': 2 }));
  const t = el('text', { 'text-anchor': 'middle', y: 4.5 });
  t.textContent = pass ? '✓' : '✕';
  g.append(t);
  layer.append(g);
}

// Kleines Schild an einem Gerät oder Koppler (Wiederholung, aufgegeben, aus)
function label(layer, lay, ref, text, color) {
  const id = ref.device || ref.coupler;
  const card = ref.device ? lay.cards.find((c) => c.id === id) : lay.couplers.find((c) => c.id === id);
  if (!card) return;
  layer.querySelector(`[data-label="${id}"]`)?.remove();
  const w = text.length * 6.4 + 16;
  const g = el('g', { class: 'badge', 'data-label': id, transform: `translate(${card.x + card.w - w - 20} ${card.y - 11})` });
  g.append(el('rect', { width: w, height: 18, rx: 9, fill: color, stroke: '#fff', 'stroke-width': 1.5 }));
  const t = el('text', { x: w / 2, y: 13, 'text-anchor': 'middle', style: 'font-size:11px' });
  t.textContent = text;
  g.append(t);
  layer.append(g);
}

export function clearSim(svg) {
  if (!svg) return;
  svg.querySelector('#sim-layer')?.replaceChildren();
  svg.querySelector('#content')?.classList.remove('dim');
  svg.querySelectorAll('.lit,.rx,.tx').forEach((n) => n.classList.remove('lit', 'rx', 'tx'));
}
