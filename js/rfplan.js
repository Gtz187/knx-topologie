// Funkplan einer RF-Linie: Grundriss in Metern mit Geräten, Medienkoppler und
// Hindernissen. Zeigt die kreisförmige Ausbreitung eines Funktelegramms.
import { findById, fmtPA, CATEGORIES, DEVICE_TYPES } from './model.js';
import { ensureRF, propagate, OBSTACLES, rangeOf, canReceive, newObstacle, key } from './rf.js';
import { ICONS, iconFor, COLORS } from './render.js';

const NS = 'http://www.w3.org/2000/svg';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = (s, r = document) => r.querySelector(s);

let api = null;      // { project, commit, toast, secs }
let lineId = null;
let mode = 'move';
let sel = null;      // { kind: 'device'|'obstacle'|'mk', id }
let stopAnim = null;
let lastLog = [];

export function openRFPlan(id, a) {
  api = a;
  lineId = id;
  sel = null;
  lastLog = [];
  const dlg = $('#dlgRF');
  draw();
  if (!dlg.open) dlg.showModal();
}

function ctx() {
  const f = findById(api.project(), lineId);
  if (!f) return null;
  const line = f.el;
  ensureRF(line);
  return { line, area: f.area, rf: line.rf, devs: line.segments.flatMap((s) => s.devices) };
}

function draw() {
  const c = ctx();
  if (!c) { $('#dlgRF').close(); return; }
  const { line, area, rf, devs } = c;
  const dlg = $('#dlgRF');
  dlg.innerHTML = `
    <div class="rf-head">
      <h2>Funkplan Linie ${area.area}.${line.line}${line.name ? ' ' + esc(line.name) : ''}</h2>
      <div class="seg-mode rf-modes" role="radiogroup" aria-label="Werkzeug">
        ${[['move', 'Verschieben'], ['wall', 'Wand zeichnen'], ['concrete', 'Beton zeichnen'], ['send', 'Senden']].map(([k, v]) => `<label><input type="radio" name="rfmode" value="${k}"${k === mode ? ' checked' : ''}>${v}</label>`).join('')}
      </div>
      <button class="btn" data-rf="close">Schließen</button>
    </div>
    <div class="rf-body">
      <div class="rf-stage" id="rfStage">${svg(c)}</div>
      <aside class="rf-side">${side(c)}</aside>
    </div>`;
  bindDialog(c);
}

function svg({ line, area, rf, devs }) {
  const W = rf.w, H = rf.h;
  const parts = [];
  parts.push(`<defs><pattern id="rfg" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0H0V1" fill="none" stroke="#DDE4DF" stroke-width=".03"/></pattern>
    <pattern id="rfg5" width="5" height="5" patternUnits="userSpaceOnUse"><rect width="5" height="5" fill="url(#rfg)"/><path d="M5 0H0V5" fill="none" stroke="#C6D0C9" stroke-width=".05"/></pattern></defs>`);
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${COLORS.paper}"/><rect x="0" y="0" width="${W}" height="${H}" fill="url(#rfg5)"/>`);
  for (let x = 5; x < W; x += 5) parts.push(`<text x="${x}" y="${H - 0.3}" class="rf-scale" text-anchor="middle">${x} m</text>`);

  // Reichweite des ausgewählten Geräts
  const s = selected({ devs, rf });
  if (s && s.pos) parts.push(`<circle cx="${s.pos.x}" cy="${s.pos.y}" r="${s.range}" class="rf-range"/>`);

  for (const o of rf.obstacles) {
    const cls = `rf-obs ${o.kind}${sel?.kind === 'obstacle' && sel.id === o.id ? ' sel' : ''}`;
    parts.push(`<g class="${cls}" data-obs="${o.id}"><line x1="${o.x1}" y1="${o.y1}" x2="${o.x2}" y2="${o.y2}" class="hit"/><line x1="${o.x1}" y1="${o.y1}" x2="${o.x2}" y2="${o.y2}" class="vis"/></g>`);
  }
  parts.push('<g id="rfFx"></g>');

  if (!line.noCoupler) {
    const m = rf.mk;
    const isSel = sel?.kind === 'mk';
    parts.push(`<g class="rf-mk${isSel ? ' sel' : ''}${line.coupler.off ? ' off' : ''}" data-mk="1" transform="translate(${m.x} ${m.y})">
      <rect x="-1.1" y="-0.7" width="2.2" height="1.4" rx=".2"/><text y=".22" text-anchor="middle" class="rf-mk-t">MK</text>
      <text y="1.45" text-anchor="middle" class="rf-name">${fmtPA(area.area, line.line, 0)}</text></g>`);
  }
  for (const d of devs) {
    if (!d.pos) continue;
    const isSel = sel?.kind === 'device' && sel.id === d.id;
    const pa = DEVICE_TYPES[d.type].addr && d.dev !== null ? fmtPA(area.area, line.line, d.dev) : '';
    const cls = ['rf-dev', d.power === 'battery' ? 'battery' : 'mains', d.repeat ? 'repeat' : '', d.off ? 'off' : '', isSel ? 'sel' : ''].join(' ');
    parts.push(`<g class="${cls}" data-dev="${d.id}" transform="translate(${d.pos.x} ${d.pos.y})">
      ${d.repeat ? '<circle r="0.95" class="rf-rep"/>' : ''}
      <circle r="0.7" class="rf-body"/>
      <g class="rf-ico" transform="translate(-.5 -.5) scale(.05)">${iconFor(d)}</g>
      <text y="1.45" text-anchor="middle" class="rf-name">${esc(trunc(d.name || CATEGORIES[d.cat] || DEVICE_TYPES[d.type].label, 22))}</text>
      <text y="2.15" text-anchor="middle" class="rf-pa">${pa}${d.power === 'battery' ? ' · Batterie' : d.repeat ? ' · Repeater' : ''}</text>
      <title>${esc(d.name)} ${pa}</title></g>`);
  }
  return `<svg id="rfSvg" viewBox="-1 -1 ${W + 2} ${H + 2}" preserveAspectRatio="xMidYMid meet">${parts.join('')}</svg>`;
}

const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function selected({ devs, rf }) {
  if (sel?.kind === 'device') {
    const d = devs.find((x) => x.id === sel.id);
    return d ? { pos: d.pos, range: rangeOf(d), d } : null;
  }
  if (sel?.kind === 'mk') return { pos: rf.mk, range: 22 };
  return null;
}

function side(c) {
  const { rf, devs, line } = c;
  const hint = {
    move: 'Geräte und Medienkoppler mit der Maus verschieben. Klick auf ein Gerät oder eine Wand zeigt die Eigenschaften.',
    wall: 'Ziehe eine Linie, um eine Wand einzuzeichnen. Eine Wand halbiert die Reichweite dahinter.',
    concrete: 'Ziehe eine Linie für Beton oder Metall. Dort kommt kein Funk durch.',
    send: 'Klicke auf ein Gerät oder den Medienkoppler – das Telegramm breitet sich kreisförmig aus.',
  }[mode];
  let props = '';
  if (sel?.kind === 'device') {
    const d = devs.find((x) => x.id === sel.id);
    if (d) {
      props = `<h3>${esc(d.name || DEVICE_TYPES[d.type].label)}</h3>
        <label class="field"><span>Versorgung</span><select name="power"${d.type === 'RFR' ? ' disabled' : ''}><option value="battery"${d.power === 'battery' ? ' selected' : ''}>Batterie – sendet nur</option><option value="mains"${d.power !== 'battery' ? ' selected' : ''}>Netz – empfängt</option></select></label>
        <label class="check"><input type="checkbox" name="repeat" ${d.repeat ? 'checked' : ''} ${d.power === 'battery' || d.type === 'RFR' ? 'disabled' : ''}> Repeater: empfangene Telegramme weitersenden</label>
        <label class="field"><span>Reichweite</span><span class="speed"><input type="range" name="range" min="5" max="60" step="1" value="${rangeOf(d)}"><output>${rangeOf(d)} m</output></span></label>
        <p class="hint">Freifeld-Reichweite. In Gebäuden sind 20–30 m üblich.</p>`;
    }
  } else if (sel?.kind === 'obstacle') {
    const o = rf.obstacles.find((x) => x.id === sel.id);
    if (o) {
      props = `<h3>Hindernis</h3>
        <label class="field"><span>Art</span><select name="okind">${Object.entries(OBSTACLES).map(([k, v]) => `<option value="${k}"${k === o.kind ? ' selected' : ''}>${v.label}</option>`).join('')}</select></label>
        <div class="btnrow"><button class="btn danger" data-rf="delobs">Hindernis löschen</button></div>`;
    }
  } else if (sel?.kind === 'mk') {
    props = `<h3>Medienkoppler</h3><p class="hint">Verbindet die Funklinie mit dem Bus. Er ist netzversorgt und empfängt alles in seiner Reichweite.</p>`;
  }
  const log = lastLog.length ? `<h3>Letzte Aussendung</h3><ul class="issues log">${lastLog.map((l) => `<li><span class="mark ${l.level}"></span><span>${esc(l.text)}</span></li>`).join('')}</ul>` : '';
  return `<p class="hint">${hint}</p>
    <div class="rf-size"><label class="field"><span>Breite</span><span class="unit"><input type="number" name="w" min="10" max="200" value="${rf.w}"> m</span></label>
    <label class="field"><span>Tiefe</span><span class="unit"><input type="number" name="h" min="6" max="200" value="${rf.h}"> m</span></label></div>
    ${props}
    ${log}
    <h3>Legende</h3>
    <ul class="legend-list">
      <li><span class="dot" style="background:#fff;box-shadow:0 0 0 2px ${COLORS.rf}"></span>Netzgerät – empfängt</li>
      <li><span class="dot small" style="background:#E7DDF4;box-shadow:0 0 0 2px ${COLORS.ink3}"></span>Batteriegerät – sendet nur</li>
      <li><span class="dot" style="background:#fff;box-shadow:0 0 0 2px ${COLORS.rf},0 0 0 4px #fff,0 0 0 5px ${COLORS.signal}"></span>Repeater – sendet weiter</li>
      <li><span class="line wall"></span>Wand – halbiert die Reichweite</li>
      <li><span class="line concrete"></span>Beton/Metall – blockt</li>
    </ul>
    ${line.rfAck ? '<p class="hint">KNX RF Multi: Empfänger quittieren per Fast-Ack.</p>' : '<p class="hint">KNX RF Ready: keine Quittung.</p>'}`;
}

// Bildschirm → Meter
function toM(svgEl, e) {
  const pt = svgEl.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  const p = pt.matrixTransform(svgEl.getScreenCTM().inverse());
  return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
}

function bindDialog(c) {
  const dlg = $('#dlgRF');
  const svgEl = $('#rfSvg');
  dlg.onclick = (e) => {
    const b = e.target.closest('[data-rf]');
    if (!b) return;
    if (b.dataset.rf === 'close') close();
    if (b.dataset.rf === 'delobs') removeObstacle();
  };
  dlg.onchange = (e) => {
    const n = e.target.name;
    if (n === 'rfmode') { mode = e.target.value; stopAnim?.(); draw(); return; }
    if (n === 'w' || n === 'h') {
      const v = Math.max(n === 'w' ? 10 : 6, Math.min(200, Number(e.target.value) || 0));
      return change((cc) => { cc.rf[n] = v; });
    }
    if (n === 'power') return change((cc) => { const d = dev(cc); d.power = e.target.value; if (d.power === 'battery') delete d.repeat; });
    if (n === 'repeat') return change((cc) => { const d = dev(cc); if (e.target.checked) d.repeat = true; else delete d.repeat; });
    if (n === 'range') return change((cc) => { dev(cc).range = Number(e.target.value); });
    if (n === 'okind') return change((cc) => { cc.rf.obstacles.find((o) => o.id === sel.id).kind = e.target.value; });
  };
  dlg.oninput = (e) => { if (e.target.name === 'range') e.target.nextElementSibling.textContent = `${e.target.value} m`; };
  dlg.onkeydown = (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel?.kind === 'obstacle' && !/INPUT|SELECT/.test(e.target.tagName)) { e.preventDefault(); removeObstacle(); }
  };
  dlg.onclose = () => { stopAnim?.(); api.closed?.(); };

  let drag = null;
  svgEl.addEventListener('pointerdown', (e) => {
    const m = toM(svgEl, e);
    const devEl = e.target.closest('[data-dev]');
    const mkEl = e.target.closest('[data-mk]');
    const obsEl = e.target.closest('[data-obs]');
    if (mode === 'send') {
      if (devEl) send({ device: devEl.dataset.dev });
      else if (mkEl) send({ coupler: true });
      return;
    }
    if (mode === 'move') {
      if (devEl || mkEl) {
        sel = devEl ? { kind: 'device', id: devEl.dataset.dev } : { kind: 'mk' };
        drag = { kind: 'move', el: devEl || mkEl, start: m, moved: false };
        svgEl.setPointerCapture(e.pointerId);
        refreshSide(c);
        highlight();
        return;
      }
      if (obsEl) { sel = { kind: 'obstacle', id: obsEl.dataset.obs }; draw(); return; }
      if (sel) { sel = null; draw(); }
      return;
    }
    // Hindernis zeichnen
    drag = { kind: 'draw', start: m, line: document.createElementNS(NS, 'line') };
    drag.line.setAttribute('class', `rf-draft ${mode}`);
    for (const [k, v] of Object.entries({ x1: m.x, y1: m.y, x2: m.x, y2: m.y })) drag.line.setAttribute(k, v);
    svgEl.append(drag.line);
    svgEl.setPointerCapture(e.pointerId);
  });
  svgEl.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const m = toM(svgEl, e);
    if (drag.kind === 'move') {
      drag.moved = true;
      const x = clamp(m.x, 0, c.rf.w), y = clamp(m.y, 0, c.rf.h);
      drag.el.setAttribute('transform', `translate(${x} ${y})`);
      drag.pos = { x, y };
      const rr = svgEl.querySelector('.rf-range');
      if (rr) { rr.setAttribute('cx', x); rr.setAttribute('cy', y); }
    } else {
      const s = snap(drag.start, m, e.shiftKey);
      drag.line.setAttribute('x2', s.x); drag.line.setAttribute('y2', s.y);
      drag.end = s;
    }
  });
  const up = () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.kind === 'move' && d.moved && d.pos) {
      change((cc) => { if (sel?.kind === 'mk') cc.rf.mk = d.pos; else dev(cc).pos = d.pos; });
    } else if (d.kind === 'move') {
      draw();
    } else if (d.kind === 'draw') {
      d.line.remove();
      const end = d.end || d.start;
      if (Math.hypot(end.x - d.start.x, end.y - d.start.y) < 0.5) return;
      const o = newObstacle(mode, d.start.x, d.start.y, end.x, end.y);
      change((cc) => { cc.rf.obstacles.push(o); });
    }
  };
  svgEl.addEventListener('pointerup', up);
  svgEl.addEventListener('pointercancel', up);
}

// Gerade Wände: mit Umschalt auf 0/45/90 Grad einrasten
function snap(a, b, force) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const ang = Math.atan2(dy, dx);
  const step = Math.PI / 4;
  const r = Math.round(ang / step) * step;
  if (!force && Math.abs(ang - r) > 0.12) return b;
  const len = Math.hypot(dx, dy);
  return { x: Math.round((a.x + Math.cos(r) * len) * 10) / 10, y: Math.round((a.y + Math.sin(r) * len) * 10) / 10 };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function dev(cc) { return cc.devs.find((x) => x.id === sel.id); }

function change(fn) {
  api.commit((p) => {
    const f = findById(p, lineId);
    ensureRF(f.el);
    fn({ line: f.el, rf: f.el.rf, devs: f.el.segments.flatMap((s) => s.devices) });
  });
  draw();
}

function removeObstacle() {
  const id = sel.id;
  sel = null;
  change((cc) => { cc.rf.obstacles = cc.rf.obstacles.filter((o) => o.id !== id); });
}

function refreshSide(c) {
  $('.rf-side').innerHTML = side(ctx() || c);
}
function highlight() {
  document.querySelectorAll('#rfSvg .sel').forEach((n) => n.classList.remove('sel'));
  const c = ctx();
  const s = selected(c);
  const svgEl = $('#rfSvg');
  svgEl.querySelector('.rf-range')?.remove();
  if (sel?.kind === 'device') svgEl.querySelector(`[data-dev="${sel.id}"]`)?.classList.add('sel');
  if (sel?.kind === 'mk') svgEl.querySelector('[data-mk]')?.classList.add('sel');
  if (s?.pos) {
    const r = document.createElementNS(NS, 'circle');
    r.setAttribute('class', 'rf-range');
    r.setAttribute('cx', s.pos.x); r.setAttribute('cy', s.pos.y); r.setAttribute('r', s.range);
    svgEl.querySelector('#rfFx').before(r);
  }
}

function close() {
  stopAnim?.();
  $('#dlgRF').close();
}

// ---------- Ausbreitung zeigen ----------

function send(from) {
  const c = ctx();
  stopAnim?.();
  const name = (r) => (r.coupler ? 'Medienkoppler' : c.devs.find((d) => d.id === r.device)?.name || 'Gerät');
  const start = from.coupler ? null : c.devs.find((d) => d.id === from.device);
  if (start?.off) return api.toast(`${start.name || 'Das Gerät'} ist ausgeschaltet.`);
  const res = propagate(c.line, from, !c.line.coupler?.off);
  const fx = $('#rfFx');
  fx.replaceChildren();
  document.querySelectorAll('#rfSvg .rx,#rfSvg .tx').forEach((n) => n.classList.remove('rx', 'tx'));
  const secs = api.secs();
  const steps = [];
  lastLog = [{ level: 'info', text: `${name(from)} sendet.` }];
  for (const w of res.waves) {
    const t0 = w.level * secs * 1.3;
    steps.push({ t: t0, dur: secs, w });
    if (w.level > 0) lastLog.push({ level: 'pass', text: `${name(w.from)} frischt das Telegramm auf und sendet es weiter.` });
  }
  const got = [...res.reached].filter((k) => k !== key(from));
  const missed = c.devs.filter((d) => d.id !== from.device && canReceive(d) && !d.off && !res.reached.has(d.id));
  lastLog.push({ level: got.length ? 'ok' : 'warn', text: got.length ? `Erreicht: ${got.map((k) => (k === 'mk' ? 'Medienkoppler' : name({ device: k }))).join(', ')}.` : 'Niemand hat das Telegramm empfangen.' });
  if (missed.length) lastLog.push({ level: 'warn', text: `Nicht erreicht: ${missed.map((d) => d.name || 'Gerät').join(', ')}.` });
  if (!c.line.noCoupler && !from.coupler && !res.coupler) lastLog.push({ level: 'block', text: 'Der Medienkoppler hört das Telegramm nicht – es kommt nicht auf den Bus.' });
  refreshSide(c);

  const nodes = new Map();
  const startKey = key(from);
  const el = (n, a) => { const e = document.createElementNS(NS, n); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); return e; };
  for (const s of steps) {
    s.ring = el('circle', { cx: s.w.pos.x, cy: s.w.pos.y, r: 0, class: `rf-wave${s.w.level ? ' re' : ''}` });
    s.ring.style.display = 'none';
    fx.append(s.ring);
    s.rays = s.w.links.map((l) => {
      const blocked = l.hits.find((h) => OBSTACLES[h.kind].factor === Infinity);
      const endP = blocked && !l.ok ? blocked.at : l.pos;
      const cls = l.ok ? 'ok' : blocked ? 'blocked' : l.deaf && l.inRange ? 'deaf' : 'far';
      const ln = el('line', { x1: s.w.pos.x, y1: s.w.pos.y, x2: s.w.pos.x, y2: s.w.pos.y, class: `rf-ray ${cls}` });
      ln.style.display = 'none';
      fx.append(ln);
      let mark = null;
      if (cls === 'blocked') { mark = el('text', { x: endP.x, y: endP.y + 0.35, class: 'rf-x', 'text-anchor': 'middle' }); mark.textContent = '✕'; mark.style.display = 'none'; fx.append(mark); }
      return { l, ln, endP, mark, cls };
    });
  }
  const svgEl = $('#rfSvg');
  const startEl = from.coupler ? svgEl.querySelector('[data-mk]') : svgEl.querySelector(`[data-dev="${from.device}"]`);
  startEl?.classList.add('tx');
  const total = Math.max(...steps.map((s) => s.t + s.dur), 0) + 0.2;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const t0 = performance.now();
  let raf = 0;
  const frame = (now) => {
    const t = reduce ? total : (now - t0) / 1000;
    for (const s of steps) {
      const k = Math.max(0, Math.min(1, (t - s.t) / s.dur));
      if (t < s.t) continue;
      s.ring.style.display = '';
      s.ring.setAttribute('r', String(k * s.w.range));
      s.ring.setAttribute('opacity', String(0.9 - 0.6 * k));
      for (const r of s.rays) {
        const L = Math.hypot(r.endP.x - s.w.pos.x, r.endP.y - s.w.pos.y);
        const reach = Math.min(L, k * s.w.range);
        if (r.cls === 'far' && k < 1) { r.ln.style.display = 'none'; continue; }
        r.ln.style.display = '';
        const f = L ? reach / L : 1;
        r.ln.setAttribute('x2', s.w.pos.x + (r.endP.x - s.w.pos.x) * (r.cls === 'far' ? 1 : f));
        r.ln.setAttribute('y2', s.w.pos.y + (r.endP.y - s.w.pos.y) * (r.cls === 'far' ? 1 : f));
        if (reach >= L && r.l.ok) {
          const kk = key(r.l.to);
          if (!nodes.has(kk)) {
            nodes.set(kk, true);
            const n = r.l.to.coupler ? svgEl.querySelector('[data-mk]') : svgEl.querySelector(`[data-dev="${r.l.to.device}"]`);
            n?.classList.add('rx');
          }
        }
        if (r.mark && reach >= L) r.mark.style.display = '';
      }
    }
    if (t < total) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  stopAnim = () => cancelAnimationFrame(raf);
  void startKey;
}

export { ICONS };
