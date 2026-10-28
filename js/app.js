// Bedienoberfläche: Zustand, Zeichnen, Eigenschaften, Simulation, Speichern.
import {
  DEVICE_TYPES, CATEGORIES, FILTER_MODES, SEG_KINDS, MEDIA,
  newArea, newLine, newSegment, newProject, addDevice, buses, busById, findById,
  nextAreaNumber, nextLineNumber, nextFreeNumber, nextTunnelNumbers, usedNumbers,
  allowedTypes, parseGAList, allGAs, couplerKind, fmtPA, clone, sanitize, addressables,
} from './model.js';
import { TEMPLATES } from './templates.js';
import { layout } from './layout.js';
import { renderSVG, iconFor, ICONS } from './render.js';
import { validate } from './validate.js';
import { simulate, couplerGraph, filterTable } from './routing.js';
import { animate, clearSim } from './sim.js';

const STORE = 'knx-topologie.projekt';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  p: null,
  sel: null,
  tab: 'props',
  undo: [],
  redo: [],
  view: { x: 40, y: 30, s: 1 },
  lay: null,
  issues: [],
  sim: { senderId: null, type: 'group', ga: '', dest: '', rc: 6, speed: 1, result: null },
  stopAnim: null,
};

// ---------- Laden und Speichern ----------

function load() {
  const fromHash = location.hash.startsWith('#p=') ? location.hash.slice(3) : null;
  if (fromHash) {
    decodeProject(fromHash).then((p) => {
      setProject(p, false);
      history.replaceState(null, '', location.pathname);
      toast('Projekt aus dem Link geladen.');
    }).catch(() => toast('Der Link enthält kein gültiges Projekt.'));
  }
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) return sanitize(JSON.parse(raw));
  } catch { /* leerer oder gesperrter Speicher */ }
  return TEMPLATES.demo.build();
}

let saveTimer = 0;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE, JSON.stringify(state.p)); } catch { /* Speicher voll oder gesperrt */ }
  }, 250);
}

function setProject(p, keepUndo = true) {
  if (keepUndo && state.p) pushUndo();
  state.p = p;
  state.sel = null;
  state.sim.result = null;
  state.sim.senderId = null;
  render();
  fit();
  persist();
}

function pushUndo() {
  state.undo.push(JSON.stringify(state.p));
  if (state.undo.length > 120) state.undo.shift();
  state.redo = [];
}

// Jede Änderung läuft hierüber: Schnappschuss, ändern, speichern, neu zeichnen.
function commit(fn, { keepSim = false } = {}) {
  pushUndo();
  fn(state.p);
  if (!keepSim) state.sim.result = null;
  persist();
  render();
}

function undo() {
  if (!state.undo.length) return;
  state.redo.push(JSON.stringify(state.p));
  state.p = sanitize(JSON.parse(state.undo.pop()));
  afterHistory();
}
function redo() {
  if (!state.redo.length) return;
  state.undo.push(JSON.stringify(state.p));
  state.p = sanitize(JSON.parse(state.redo.pop()));
  afterHistory();
}
function afterHistory() {
  if (state.sel && !findById(state.p, state.sel)) state.sel = null;
  state.sim.result = null;
  persist();
  render();
}

// ---------- Zeichnen ----------

function stats(p) {
  let devices = 0, lines = 0;
  for (const b of buses(p)) devices += b.devices.length;
  for (const a of p.areas) lines += a.lines.length;
  return { devices, lines, areas: p.areas.length };
}

function render() {
  const p = state.p;
  $('#projectName').value = p.name;
  document.title = `${p.name} – KNX Topologie`;
  state.issues = validate(p);
  const errorIds = new Set(state.issues.filter((i) => i.level === 'error').map((i) => i.ref));
  const edit = state.tab !== 'sim';
  state.lay = layout(p, { edit });
  const selId = selectionDrawId();
  $('#sheet').innerHTML = renderSVG(p, state.lay, { selected: selId, errorIds, stats: stats(p) });
  applyView();
  renderCheckCount();
  renderPanel();
  $('#btnUndo').disabled = !state.undo.length;
  $('#btnRedo').disabled = !state.redo.length;
}

function selectionDrawId() {
  const f = findById(state.p, state.sel);
  if (!f) return null;
  if (f.kind === 'area') return f.el.coupler.id;
  if (f.kind === 'line') return f.el.noCoupler ? f.el.id : f.el.coupler.id;
  if (f.kind === 'segment') return f.el.coupler?.id;
  return state.sel;
}

function renderPanel() {
  if (state.tab === 'props') renderProps();
  if (state.tab === 'sim') renderSimPanel();
  if (state.tab === 'check') renderCheck();
}

function renderCheckCount() {
  const e = state.issues.filter((i) => i.level === 'error').length;
  const w = state.issues.filter((i) => i.level === 'warn').length;
  const c = $('#checkCount');
  c.textContent = e || w || '';
  c.className = 'count' + (e ? '' : w ? ' warn' : '');
}

// ---------- Ansicht: Verschieben und Zoomen ----------

function applyView() {
  const { x, y, s } = state.view;
  $('#sheet').style.transform = `translate(${x}px, ${y}px) scale(${s})`;
}

function fit() {
  const stage = $('#stage');
  const lay = state.lay;
  if (!lay) return;
  const sw = stage.clientWidth, sh = stage.clientHeight;
  const s = Math.min(1.25, Math.max(0.2, Math.min((sw - 40) / lay.width, (sh - 40) / lay.height)));
  state.view = { s, x: Math.max(20, (sw - lay.width * s) / 2), y: Math.max(20, (sh - lay.height * s) / 2) };
  applyView();
}

function zoomAt(factor, cx, cy) {
  const v = state.view;
  const s = Math.min(3, Math.max(0.15, v.s * factor));
  const k = s / v.s;
  state.view = { s, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
  applyView();
}

function initStage() {
  const stage = $('#stage');
  let drag = null;
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > Math.abs(e.deltaX) * 1.5 && !e.shiftKey) {
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    } else {
      state.view.x -= e.deltaX; state.view.y -= e.deltaY; applyView();
    }
  }, { passive: false });

  const pointers = new Map();
  stage.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) { drag = { pinch: dist(pointers), s: state.view.s }; return; }
    if (e.target.closest('[data-id],.ghost') || e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, vx: state.view.x, vy: state.view.y, moved: false };
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('panning');
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (drag.pinch && pointers.size === 2) {
      const r = stage.getBoundingClientRect();
      const pts = [...pointers.values()];
      const cx = (pts[0].x + pts[1].x) / 2 - r.left, cy = (pts[0].y + pts[1].y) / 2 - r.top;
      zoomAt((drag.s * dist(pointers) / drag.pinch) / state.view.s, cx, cy);
      return;
    }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    state.view.x = drag.vx + dx; state.view.y = drag.vy + dy; applyView();
  });
  const end = (e) => {
    pointers.delete(e.pointerId);
    if (drag && !drag.moved && !drag.pinch && !e.target.closest('[data-id],.ghost')) select(null);
    drag = null;
    stage.classList.remove('panning');
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);

  stage.addEventListener('click', (e) => {
    const ghost = e.target.closest('.ghost');
    if (ghost) return ghostAction(ghost, e);
    const hit = e.target.closest('[data-id]');
    if (!hit) return;
    const id = hit.dataset.sel || hit.dataset.id;
    if (state.tab === 'sim') {
      const f = findById(state.p, hit.dataset.id);
      if (f?.kind === 'device') { state.sim.senderId = f.el.id; renderSimPanel(); render(); }
      return;
    }
    select(id);
  });
  stage.addEventListener('keydown', (e) => {
    const ghost = e.target.closest?.('.ghost');
    if (ghost && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); ghostAction(ghost, e); }
  });

  $('#zoomIn').onclick = () => zoomAt(1.2, stage.clientWidth / 2, stage.clientHeight / 2);
  $('#zoomOut').onclick = () => zoomAt(1 / 1.2, stage.clientWidth / 2, stage.clientHeight / 2);
  $('#zoomFit').onclick = fit;
}
const dist = (m) => { const [a, b] = [...m.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };

function select(id) {
  state.sel = id;
  if (state.tab !== 'props') setTab('props');
  else render();
}

// ---------- Hinzufügen über die Platzhalter ----------

function ghostAction(g, e) {
  const ctx = JSON.parse(g.dataset.ctx || '{}');
  const action = g.dataset.action;
  if (action === 'add-area') return addArea();
  if (action === 'add-line') return addLine(ctx.areaId);
  if (action === 'add-segment') return addSegment(ctx.lineId);
  if (action === 'add-device') {
    const r = g.getBoundingClientRect();
    openAddMenu(ctx.busId, e.clientX ? { x: e.clientX, y: r.bottom } : { x: r.left, y: r.bottom });
  }
}

function addArea() {
  const n = nextAreaNumber(state.p);
  if (!n) return toast('Es gibt bereits 15 Bereiche – mehr sind in KNX nicht möglich.');
  let id;
  commit((p) => {
    const a = newArea(n);
    const l = newLine(1);
    a.lines.push(l);
    p.areas.push(a);
    const sb = buses(p).find((b) => b.owner === l.segments[0]);
    addDevice(p, sb, 'SV');
    if (p.backbone.enabled || a.lines.length) addDevice(p, buses(p).find((b) => b.owner === a), 'SV');
    id = a.id;
  });
  select(id);
}

function addLine(areaId) {
  const ar = state.p.areas.find((a) => a.id === areaId);
  const n = nextLineNumber(ar);
  if (!n) return toast(`Bereich ${ar.area} hat schon 15 Linien.`);
  let id;
  commit((p) => {
    const a = p.areas.find((x) => x.id === areaId);
    const l = newLine(n);
    a.lines.push(l);
    addDevice(p, buses(p).find((b) => b.owner === l.segments[0]), 'SV');
    if (a.mainMedium === 'TP' && !a.mainDevices.some((d) => d.type === 'SV')) addDevice(p, buses(p).find((b) => b.owner === a), 'SV');
    id = l.id;
  });
  select(id);
}

function addSegment(lineId) {
  let id;
  commit((p) => {
    const f = findById(p, lineId);
    const ln = f.el;
    if (ln.segments.length >= 4) return;
    const i = ln.segments.length;
    const used = usedNumbers(p, f.area.area, ln.line);
    let dev = i * 64;
    if (used.has(dev)) dev = nextFreeNumber(p, f.area.area, ln.line, i);
    const sg = newSegment('LV', dev);
    ln.segments.push(sg);
    addDevice(p, buses(p).find((b) => b.owner === sg), 'SV');
    id = sg.id;
  });
  select(id);
}

function openAddMenu(busId, pos) {
  const bus = busById(state.p, busId);
  if (!bus) return;
  const menu = $('#addMenu');
  const types = allowedTypes(bus.medium);
  const tlnLabel = bus.medium === 'RF' ? 'Funk-Teilnehmer' : bus.medium === 'IP' ? 'KNX IP-Teilnehmer' : 'Teilnehmer';
  let html = '';
  if (types.includes('TLN')) {
    html += `<h4>${tlnLabel}</h4><div class="grid">`;
    for (const [k, v] of Object.entries(CATEGORIES)) {
      html += `<button data-type="TLN" data-cat="${k}"><svg viewBox="0 0 20 20">${ICONS[k]}</svg>${esc(v)}</button>`;
    }
    html += '</div>';
  }
  const infra = types.filter((t) => t !== 'TLN');
  if (infra.length) {
    html += '<h4>Infrastruktur</h4>';
    for (const t of infra) {
      html += `<button data-type="${t}"><svg viewBox="0 0 20 20">${ICONS[t]}</svg>${esc(t === 'IPI' && bus.medium === 'IP' ? 'KNX IP-Gerät mit Tunnel' : DEVICE_TYPES[t].label)}</button>`;
    }
  }
  menu.innerHTML = html;
  menu.hidden = false;
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = Math.max(8, Math.min(pos.x - 20, innerWidth - w - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(pos.y + 6, innerHeight - h - 8)) + 'px';
  menu.querySelector('button')?.focus();
  menu.onclick = (e) => {
    const b = e.target.closest('button[data-type]');
    if (!b) return;
    closeAddMenu();
    let id;
    commit((p) => {
      const bb = busById(p, busId);
      const extra = b.dataset.cat ? { cat: b.dataset.cat } : {};
      if (b.dataset.type === 'TLN') extra.name = suggestName(p, CATEGORIES[b.dataset.cat]);
      id = addDevice(p, bb, b.dataset.type, extra).id;
    });
    select(id);
  };
}
function closeAddMenu() { $('#addMenu').hidden = true; }

function suggestName(p, base) {
  const names = new Set();
  for (const b of buses(p)) for (const d of b.devices) names.add(d.name);
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
}

// ---------- Eigenschaften ----------

function renderProps() {
  const panel = $('#panel-props');
  const f = findById(state.p, state.sel);
  if (!f) return panelProject(panel);
  if (f.kind === 'device') return panelDevice(panel, f);
  if (f.kind === 'area') return panelArea(panel, f);
  if (f.kind === 'line') return panelLine(panel, f);
  if (f.kind === 'segment') return panelSegment(panel, f);
  panelProject(panel);
}

// Kleine Helfer für Formulare
const field = (label, inner, cls = '') => `<label class="field ${cls}"><span>${label}</span>${inner}</label>`;
const text = (name, val, attrs = '') => `<input type="text" name="${name}" value="${esc(val)}" ${attrs}>`;
const select_ = (name, val, opts) => `<select name="${name}">${Object.entries(opts).map(([k, v]) => `<option value="${k}"${String(k) === String(val) ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
const segmented = (name, val, opts) => `<div class="seg-mode" role="radiogroup">${Object.entries(opts).map(([k, v]) => `<label><input type="radio" name="${name}" value="${k}"${k === val ? ' checked' : ''}>${esc(v)}</label>`).join('')}</div>`;

function bind(panel, handlers) {
  panel.oninput = null;
  panel.onchange = (e) => {
    const h = handlers[e.target.name];
    if (h) h(e.target.type === 'checkbox' ? e.target.checked : e.target.value, e.target);
  };
  panel.onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (b && handlers['@' + b.dataset.act]) handlers['@' + b.dataset.act](b);
  };
}

function panelProject(panel) {
  const p = state.p;
  const s = stats(p);
  const tpls = Object.entries(TEMPLATES).map(([k, t]) => `<button class="btn small" data-act="tpl" data-k="${k}">${esc(t.label)}</button>`).join('');
  panel.innerHTML = `
    <h2>${esc(p.name)}</h2>
    <p class="kind">Projekt</p>
    <div class="stats"><div><b>${s.areas}</b><span>Bereiche</span></div><div><b>${s.lines}</b><span>Linien</span></div><div><b>${s.devices}</b><span>Geräte</span></div></div>
    <h3>Schriftfeld</h3>
    ${field('Projektname', text('name', p.name))}
    ${field('Bearbeiter', text('author', p.author))}
    ${field('Datum', `<input type="date" name="date" value="${esc(p.date)}">`)}
    <h3>Bereichslinie</h3>
    <label class="check"><input type="checkbox" name="bb" ${p.backbone.enabled ? 'checked' : ''}> Bereichslinie (Backbone) verwenden</label>
    ${p.backbone.enabled ? field('Medium', segmented('bbMedium', p.backbone.medium, { IP: 'IP', TP: 'TP' })) : ''}
    <p class="hint">${p.backbone.enabled ? (p.backbone.medium === 'IP' ? 'Die Bereiche hängen über KNX IP-Router am Netzwerk. Die Router haben die Adresse x.0.0.' : 'Die Bereiche hängen über Bereichskoppler (x.0.0) an der TP-Bereichslinie 0.0.') : 'Ohne Bereichslinie sind mehrere Bereiche nicht miteinander verbunden.'}</p>
    ${p.backbone.enabled ? `<div class="btnrow"><button class="btn small" data-act="bbdev">Gerät an der Bereichslinie</button></div>` : ''}
    <div class="btnrow"><button class="btn primary" data-act="area">Bereich hinzufügen</button></div>
    <h3>Vorlage laden</h3>
    <div class="btnrow">${tpls}</div>
    <p class="hint">Klicke auf ein Element in der Zeichnung, um es zu bearbeiten. Mit dem Mausrad zoomst du, mit gedrückter Maustaste verschiebst du die Zeichnung.</p>`;
  bind(panel, {
    name: (v) => commit((p) => { p.name = v.trim() || 'Projekt'; }),
    author: (v) => commit((p) => { p.author = v.trim(); }),
    date: (v) => commit((p) => { p.date = v; }),
    bb: (v) => commit((p) => { p.backbone.enabled = v; }),
    bbMedium: (v) => commit((p) => {
      p.backbone.medium = v;
      p.backbone.devices = p.backbone.devices.filter((d) => DEVICE_TYPES[d.type].media.includes(v));
    }),
    '@area': () => addArea(),
    '@bbdev': (b) => { const r = b.getBoundingClientRect(); openAddMenu('bb', { x: r.left + 20, y: r.bottom }); },
    '@tpl': (b) => { if (confirm(`Vorlage „${TEMPLATES[b.dataset.k].label}“ laden? Das aktuelle Projekt wird ersetzt (Rückgängig ist möglich).`)) setProject(TEMPLATES[b.dataset.k].build()); },
  });
}

function couplerSection(c, edge, opts = {}) {
  const graph = couplerGraph(state.p);
  const e = graph.edges.find((x) => x.id === c.id);
  const table = e ? [...filterTable(state.p, e, graph)].sort(gaSort) : [];
  const extra = new Set(c.extraGAs || []);
  const tunnelsField = opts.ipRouter
    ? field('Tunnel', `<select name="ctun">${[0, 1, 2, 4, 8].map((n) => `<option ${n === (c.tunnels || []).length ? 'selected' : ''}>${n}</option>`).join('')}</select>`)
      + ((c.tunnels || []).length ? `<p class="hint">Tunneladressen: <span class="chips">${c.tunnels.map((t) => `<span class="chip">${opts.prefix}${t}</span>`).join('')}</span></p>` : '')
    : '';
  return `
    ${field('Bezeichnung', text('cname', c.name, `placeholder="${esc(edge)}"`))}
    ${tunnelsField}
    <h3>Filter</h3>
    ${field('Gruppentelegramme', select_('cgroup', c.group, FILTER_MODES))}
    ${field('Physikalisch', select_('cphys', c.phys, FILTER_MODES))}
    ${field('Broadcast', select_('cbc', c.bc, { route: 'Weiterleiten', block: 'Sperren' }))}
    <label class="check"><input type="checkbox" name="cauto" ${c.autoTable !== false ? 'checked' : ''}> Filtertabelle aus den Geräten darunter erzeugen</label>
    ${field('Zusätzlich', `<textarea name="cextra" placeholder="z. B. 1/0/1 1/0/2">${esc((c.extraGAs || []).join(' '))}</textarea>`, 'stack')}
    <p class="hint">Filtertabelle (${table.length} Einträge):</p>
    <div class="chips">${table.length ? table.map((g) => `<span class="chip${extra.has(g) ? ' manual' : ''}">${g}</span>`).join('') : '<span class="hint">leer – Gruppentelegramme werden gesperrt</span>'}</div>`;
}
const gaSort = (a, b) => a.localeCompare(b, 'de', { numeric: true });

function couplerHandlers(getC) {
  return {
    cname: (v) => commit((p) => { getC(p).name = v.trim(); }),
    cgroup: (v) => commit((p) => { getC(p).group = v; }),
    cphys: (v) => commit((p) => { getC(p).phys = v; }),
    cbc: (v) => commit((p) => { getC(p).bc = v; }),
    cauto: (v) => commit((p) => { getC(p).autoTable = v; }),
    cextra: (v, t) => {
      const { ok, bad } = parseGAList(v);
      if (bad.length) toast(`Keine gültigen Gruppenadressen: ${bad.join(', ')}`);
      commit((p) => { getC(p).extraGAs = ok; });
      void t;
    },
  };
}

function panelArea(panel, f) {
  const ar = f.el;
  const p = state.p;
  const k = couplerKind('area', p.backbone.medium, ar.mainMedium);
  const getA = (pp) => pp.areas.find((a) => a.id === ar.id);
  panel.innerHTML = `
    <h2>Bereich ${ar.area}${ar.name ? ' ' + esc(ar.name) : ''}</h2>
    <p class="kind">${p.backbone.enabled ? `${esc(k.label)} ${fmtPA(ar.area, 0, 0)}` : 'Bereich ohne Bereichslinie'}</p>
    ${field('Bereichsnummer', `<input type="number" name="num" min="1" max="15" value="${ar.area}">`)}
    ${field('Name', text('aname', ar.name))}
    ${field('Hauptlinie', segmented('mainMedium', ar.mainMedium, { TP: 'TP', IP: 'IP' }))}
    <p class="hint">${ar.mainMedium === 'IP' ? 'Die Linien hängen über KNX IP-Router (x.y.0) an der IP-Hauptlinie.' : 'Die Linien hängen über Linienkoppler (x.y.0) an der TP-Hauptlinie.'}</p>
    <div class="btnrow"><button class="btn primary" data-act="line">Linie hinzufügen</button><button class="btn" data-act="maindev">Gerät an der Hauptlinie</button></div>
    ${p.backbone.enabled ? `<h3>${esc(k.label)} ${fmtPA(ar.area, 0, 0)}</h3>${k.invalid ? `<p class="err-text">${esc(k.label)} – bitte Hauptlinie auf TP stellen.</p>` : ''}${couplerSection(ar.coupler, k.label, { ipRouter: p.backbone.medium === 'IP', prefix: `${ar.area}.0.` })}` : ''}
    <h3>Bereich entfernen</h3>
    <div class="btnrow"><button class="btn danger" data-act="del">Bereich ${ar.area} löschen</button></div>`;
  bind(panel, {
    num: (v) => {
      const n = Number(v);
      if (!(n >= 1 && n <= 15)) return toast('Bereichsnummern gehen von 1 bis 15.');
      if (p.areas.some((a) => a.area === n && a.id !== ar.id)) return toast(`Bereich ${n} gibt es schon.`);
      commit((pp) => { getA(pp).area = n; });
      toast(`Alle Adressen in Bereich ${n} wurden angepasst.`);
    },
    aname: (v) => commit((pp) => { getA(pp).name = v.trim(); }),
    mainMedium: (v) => commit((pp) => {
      const a = getA(pp);
      a.mainMedium = v;
      a.mainDevices = a.mainDevices.filter((d) => DEVICE_TYPES[d.type].media.includes(v));
    }),
    ctun: (v) => commit((pp) => { const a = getA(pp); a.coupler.tunnels = []; a.coupler.tunnels = nextTunnelNumbers(pp, a.area, 0, Number(v)); }),
    ...couplerHandlers((pp) => getA(pp).coupler),
    '@line': () => addLine(ar.id),
    '@maindev': (b) => { const r = b.getBoundingClientRect(); openAddMenu(`${ar.id}:main`, { x: r.left, y: r.bottom }); },
    '@del': () => removeSelected(),
  });
}

function panelLine(panel, f) {
  const ln = f.el, ar = f.area;
  const k = couplerKind('line', ar.mainMedium, ln.medium);
  const getL = (pp) => findById(pp, ln.id).el;
  const segs = ln.segments.map((s, i) => `<li data-ref="${s.id}">${i === 0 ? 'Segment 1 (am Koppler)' : `Segment ${i + 1} über ${SEG_KINDS[s.coupler.kind].label}`} – ${s.devices.length} Geräte</li>`).join('');
  panel.innerHTML = `
    <h2>Linie ${ar.area}.${ln.line}${ln.name ? ' ' + esc(ln.name) : ''}</h2>
    <p class="kind">${ln.noCoupler ? 'Linie ohne Koppler' : `${esc(k.label)} ${fmtPA(ar.area, ln.line, 0)}`}</p>
    ${field('Liniennummer', `<input type="number" name="num" min="1" max="15" value="${ln.line}">`)}
    ${field('Name', text('lname', ln.name))}
    ${field('Medium', segmented('medium', ln.medium, { TP: 'TP', RF: 'RF' }))}
    <label class="check"><input type="checkbox" name="noc" ${ln.noCoupler ? 'checked' : ''}> Ohne Linienkoppler (Einzelanlage)</label>
    ${k.invalid && !ln.noCoupler ? `<p class="err-text">${esc(k.label)}.</p>` : ''}
    <div class="btnrow">
      <button class="btn primary" data-act="dev">Gerät hinzufügen</button>
      ${ln.medium === 'TP' && ln.segments.length < 4 ? '<button class="btn" data-act="seg">Segment anfügen</button>' : ''}
    </div>
    ${ln.medium === 'TP' ? `<h3>Segmente</h3><ul class="seglist">${segs}</ul><p class="hint">Jedes TP-Segment trägt bis zu 64 Teilnehmer und braucht eine eigene Spannungsversorgung.</p>` : ''}
    ${!ln.noCoupler ? `<h3>${esc(k.label)} ${fmtPA(ar.area, ln.line, 0)}</h3>${couplerSection(ln.coupler, k.label, { ipRouter: ar.mainMedium === 'IP', prefix: `${ar.area}.${ln.line}.` })}` : ''}
    <h3>Linie entfernen</h3>
    <div class="btnrow"><button class="btn danger" data-act="del">Linie ${ar.area}.${ln.line} löschen</button></div>`;
  bind(panel, {
    num: (v) => {
      const n = Number(v);
      if (!(n >= 1 && n <= 15)) return toast('Liniennummern gehen von 1 bis 15.');
      if (ar.lines.some((l) => l.line === n && l.id !== ln.id)) return toast(`Linie ${ar.area}.${n} gibt es schon.`);
      commit((pp) => { getL(pp).line = n; });
      toast(`Alle Geräte heißen jetzt ${ar.area}.${n}.x`);
    },
    lname: (v) => commit((pp) => { getL(pp).name = v.trim(); }),
    medium: (v) => {
      const bad = ln.segments.flatMap((s) => s.devices).filter((d) => !DEVICE_TYPES[d.type].media.includes(v));
      if (bad.length && !confirm(`${bad.length} Geräte passen nicht zu ${v} und werden entfernt. Fortfahren?`)) return render();
      commit((pp) => {
        const l = getL(pp);
        l.medium = v;
        if (v !== 'TP') {
          const all = l.segments.flatMap((s) => s.devices);
          l.segments = [l.segments[0]];
          l.segments[0].devices = all;
        }
        for (const s of l.segments) s.devices = s.devices.filter((d) => DEVICE_TYPES[d.type].media.includes(v));
      });
    },
    noc: (v) => commit((pp) => { getL(pp).noCoupler = v; }),
    ctun: (v) => commit((pp) => { const l = getL(pp); l.coupler.tunnels = []; l.coupler.tunnels = nextTunnelNumbers(pp, ar.area, l.line, Number(v)); }),
    ...couplerHandlers((pp) => getL(pp).coupler),
    '@dev': (b) => { const r = b.getBoundingClientRect(); openAddMenu(ln.segments[ln.segments.length - 1].id, { x: r.left, y: r.bottom }); },
    '@seg': () => addSegment(ln.id),
    '@del': () => removeSelected(),
  });
  panel.querySelectorAll('li[data-ref]').forEach((li) => { li.onclick = () => select(li.dataset.ref); });
}

function panelSegment(panel, f) {
  const sg = f.el, ln = f.line, ar = f.area;
  if (!sg.coupler) { state.sel = ln.id; return renderProps(); }
  const c = sg.coupler;
  const getS = (pp) => findById(pp, sg.id).el;
  panel.innerHTML = `
    <h2>${esc(SEG_KINDS[c.kind].label)}</h2>
    <p class="kind">Linie ${ar.area}.${ln.line}, Segment ${f.index + 1}</p>
    ${field('Art', segmented('kind', c.kind, { LV: 'Linienverstärker', SK: 'Segmentkoppler' }))}
    <p class="hint">${c.kind === 'LV' ? 'Ein Linienverstärker leitet alle Telegramme weiter und verlängert die Linie um ein Segment.' : 'Ein Segmentkoppler trennt die Segmente wie ein Linienkoppler und filtert Gruppentelegramme.'}</p>
    ${field('Adresse', `<div class="pa-input"><span class="prefix">${ar.area}.${ln.line}.</span><input type="number" name="dev" min="1" max="255" value="${c.dev ?? ''}"></div>`)}
    ${c.kind === 'SK' ? couplerSection(c, 'Segmentkoppler') : field('Bezeichnung', text('cname', c.name))}
    <div class="btnrow"><button class="btn primary" data-act="dev">Gerät in diesem Segment</button></div>
    <h3>Segment entfernen</h3>
    <p class="hint">Die Geräte dieses Segments wandern ins Segment davor.</p>
    <div class="btnrow"><button class="btn danger" data-act="del">Segment ${f.index + 1} entfernen</button></div>`;
  bind(panel, {
    kind: (v) => commit((pp) => { getS(pp).coupler.kind = v; }),
    dev: (v) => {
      const n = Number(v);
      if (!(n >= 1 && n <= 255)) return toast('Teilnehmernummern gehen von 1 bis 255.');
      commit((pp) => { getS(pp).coupler.dev = n; });
    },
    ...couplerHandlers((pp) => getS(pp).coupler),
    '@dev': (b) => { const r = b.getBoundingClientRect(); openAddMenu(sg.id, { x: r.left, y: r.bottom }); },
    '@del': () => removeSelected(),
  });
}

function panelDevice(panel, f) {
  const d = f.el, bus = f.bus;
  const t = DEVICE_TYPES[d.type];
  const getD = (pp) => findById(pp, d.id).el;
  const where = bus.kind === 'backbone' ? 'Bereichslinie 0.0' : bus.kind === 'main' ? `Hauptlinie ${bus.a}.0` : `Linie ${bus.a}.${bus.l}${bus.segIndex ? `, Segment ${bus.segIndex + 1}` : ''}`;
  const typeLabel = d.type === 'TLN' ? (bus.medium === 'RF' ? 'Funk-Teilnehmer' : bus.medium === 'IP' ? 'KNX IP-Teilnehmer' : 'Teilnehmer') : t.label;
  const dupes = d.dev !== null && addressables(state.p).filter((x) => x.a === bus.a && x.l === bus.l && x.d === d.dev).length > 1;
  const icon = `<svg viewBox="0 0 20 20" width="22" height="22" style="vertical-align:-4px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round">${iconFor(d)}</svg>`;
  panel.innerHTML = `
    <h2>${icon} ${esc(d.name || typeLabel)}</h2>
    <p class="kind">${esc(typeLabel)} an ${esc(where)}</p>
    ${field('Name', text('dname', d.name))}
    ${d.type === 'TLN' ? field('Art', select_('cat', d.cat, CATEGORIES)) : ''}
    ${t.addr ? field('Adresse', `<div class="pa-input"><span class="prefix">${bus.a}.${bus.l}.</span><input type="number" name="dev" min="1" max="255" value="${d.dev ?? ''}"><button type="button" class="btn small" data-act="free" title="Nächste freie Nummer">frei</button></div>`) : ''}
    ${dupes ? `<p class="err-text">Die Adresse ${fmtPA(bus.a, bus.l, d.dev)} ist mehrfach vergeben.</p>` : ''}
    ${d.type === 'SV' ? field('Nennstrom', select_('mA', d.mA, { 160: '160 mA', 320: '320 mA', 640: '640 mA', 1280: '1280 mA' })) : ''}
    ${d.type === 'IPI' ? field('Tunnel', `<select name="tun">${[0, 1, 2, 4, 8].map((n) => `<option ${n === (d.tunnels || []).length ? 'selected' : ''}>${n}</option>`).join('')}</select>`) + ((d.tunnels || []).length ? `<div class="chips">${d.tunnels.map((x) => `<span class="chip">${bus.a}.${bus.l}.${x}</span>`).join('')}</div>` : '') : ''}
    ${!t.addr ? `<p class="hint">${d.type === 'SV' ? 'Die Spannungsversorgung hat keine physikalische Adresse.' : 'Ein Switch ist kein KNX-Gerät und hat keine KNX-Adresse.'}</p>` : ''}
    ${t.addr ? `<h3>Gruppenadressen</h3>
    ${field('Sendet auf', `<textarea name="sends" placeholder="1/0/1">${esc(d.sends.join(' '))}</textarea>`, 'stack')}
    ${field('Hört auf', `<textarea name="listens" placeholder="1/0/1 1/0/2">${esc(d.listens.join(' '))}</textarea>`, 'stack')}
    <p class="hint">Dreistufig wie 1/0/1, mehrere mit Leerzeichen trennen.</p>
    <div class="btnrow"><button class="btn go" data-act="sim">Telegramm von hier senden</button></div>` : ''}
    <h3>Gerät</h3>
    <div class="btnrow">
      <button class="btn" data-act="up">Nach oben</button>
      <button class="btn" data-act="down">Nach unten</button>
      <button class="btn" data-act="dup">Duplizieren</button>
      <button class="btn danger" data-act="del">Löschen</button>
    </div>`;
  const gaHandler = (key) => (v) => {
    const { ok, bad } = parseGAList(v);
    if (bad.length) toast(`Ignoriert, keine gültigen Gruppenadressen: ${bad.join(', ')}`);
    commit((pp) => { getD(pp)[key] = ok; });
  };
  bind(panel, {
    dname: (v) => commit((pp) => { getD(pp).name = v.trim(); }),
    cat: (v) => commit((pp) => { getD(pp).cat = v; }),
    dev: (v) => {
      const n = Number(v);
      if (!(n >= 1 && n <= 255)) { toast('Teilnehmernummern gehen von 1 bis 255.'); return render(); }
      commit((pp) => { getD(pp).dev = n; });
    },
    mA: (v) => commit((pp) => { getD(pp).mA = Number(v); }),
    tun: (v) => commit((pp) => { const x = getD(pp); x.tunnels = []; x.tunnels = nextTunnelNumbers(pp, bus.a, bus.l, Number(v)).filter((n) => n !== x.dev); }),
    sends: gaHandler('sends'),
    listens: gaHandler('listens'),
    '@free': () => commit((pp) => { const x = getD(pp); x.dev = null; x.dev = nextFreeNumber(pp, bus.a, bus.l, bus.segIndex || 0); }),
    '@up': () => move(-1),
    '@down': () => move(1),
    '@dup': () => duplicate(),
    '@del': () => removeSelected(),
    '@sim': () => {
      state.sim.senderId = d.id;
      state.sim.type = 'group';
      state.sim.ga = d.sends[0] || d.listens[0] || state.sim.ga;
      setTab('sim');
    },
  });
}

function move(dir) {
  commit((p) => {
    const f = findById(p, state.sel);
    if (f?.kind !== 'device') return;
    const list = f.bus.devices;
    const j = f.index + dir;
    if (j < 0 || j >= list.length) return;
    [list[f.index], list[j]] = [list[j], list[f.index]];
  });
}

function duplicate() {
  const f = findById(state.p, state.sel);
  if (f?.kind !== 'device') return;
  let id;
  commit((p) => {
    const g = findById(p, state.sel);
    const copy = clone(g.el);
    delete copy.id;
    copy.name = suggestName(p, g.el.name.replace(/ \d+$/, '') || DEVICE_TYPES[g.el.type].label);
    copy.dev = null;
    const type = copy.type;
    delete copy.type;
    if (type === 'IPI') copy.tunnels = undefined;
    const d = addDevice(p, g.bus, type, copy);
    if (type === 'IPI') d.tunnels = nextTunnelNumbers(p, g.bus.a, g.bus.l, (g.el.tunnels || []).length).filter((n) => n !== d.dev);
    const list = g.bus.devices;
    list.splice(list.indexOf(d), 1);
    list.splice(g.index + 1, 0, d);
    id = d.id;
  });
  select(id);
}

function removeSelected() {
  const f = findById(state.p, state.sel);
  if (!f) return;
  if (f.kind === 'area' && !confirm(`Bereich ${f.el.area} mit allen Linien und Geräten löschen?`)) return;
  if (f.kind === 'line' && !confirm(`Linie ${f.area.area}.${f.el.line} mit allen Geräten löschen?`)) return;
  commit((p) => {
    const g = findById(p, state.sel);
    if (g.kind === 'device') g.bus.devices.splice(g.index, 1);
    if (g.kind === 'area') p.areas = p.areas.filter((a) => a.id !== g.el.id);
    if (g.kind === 'line') g.area.lines = g.area.lines.filter((l) => l.id !== g.el.id);
    if (g.kind === 'segment' && g.index > 0) {
      const segs = g.line.segments;
      segs[g.index - 1].devices.push(...g.el.devices);
      segs.splice(g.index, 1);
    }
  });
  state.sel = null;
  render();
  toast('Gelöscht. Mit Strg+Z holst du es zurück.');
}

// ---------- Prüfung ----------

function renderCheck() {
  const panel = $('#panel-check');
  const list = state.issues;
  const errors = list.filter((i) => i.level === 'error').length;
  const warns = list.filter((i) => i.level === 'warn').length;
  const label = { error: 'Fehler', warn: 'Warnung', info: 'Hinweis' };
  panel.innerHTML = `
    <h2>Prüfung</h2>
    <p class="kind">${errors} Fehler, ${warns} Warnungen, ${list.length - errors - warns} Hinweise</p>
    ${!errors && !warns ? '<div class="empty"><strong>Keine Fehler gefunden</strong>Adressen, Spannungsversorgungen und Medien passen zusammen.</div>' : ''}
    <ul class="issues">${list.map((i) => `<li data-ref="${esc(i.ref || '')}"><span class="mark ${i.level}" title="${label[i.level]}"></span><span>${esc(i.text)}</span></li>`).join('')}</ul>`;
  panel.querySelectorAll('li[data-ref]').forEach((li) => {
    li.onclick = () => { if (li.dataset.ref && findById(state.p, li.dataset.ref)) select(li.dataset.ref); };
  });
}

// ---------- Telegramm-Simulation ----------

function senderOptions() {
  const opts = [];
  for (const b of buses(state.p)) {
    for (const d of b.devices) {
      if (!DEVICE_TYPES[d.type].addr) continue;
      const pa = d.dev !== null ? fmtPA(b.a, b.l, d.dev) : '';
      opts.push({ id: d.id, label: `${pa}  ${d.name || DEVICE_TYPES[d.type].label}` });
    }
  }
  return opts;
}

function renderSimPanel() {
  const panel = $('#panel-sim');
  const s = state.sim;
  const opts = senderOptions();
  if (s.senderId && !opts.some((o) => o.id === s.senderId)) s.senderId = null;
  const gas = allGAs(state.p);
  const r = s.result;
  panel.innerHTML = `
    <h2>Telegramm verfolgen</h2>
    <p class="kind">Klicke in der Zeichnung auf ein Gerät, um es als Sender zu wählen.</p>
    <div class="sim-form">
      ${field('Sender', `<select name="sender"><option value="">– Gerät wählen –</option>${opts.map((o) => `<option value="${o.id}"${o.id === s.senderId ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`)}
      ${field('Art', segmented('type', s.type, { group: 'Gruppe', phys: 'Physikalisch', bc: 'Broadcast' }))}
      ${s.type === 'group' ? field('Gruppenadresse', `<input type="text" name="ga" list="galist" value="${esc(s.ga)}" placeholder="1/0/1"><datalist id="galist">${gas.map((g) => `<option value="${g}">`).join('')}</datalist>`) : ''}
      ${s.type === 'phys' ? field('Ziel', `<input type="text" name="dest" list="palist" value="${esc(s.dest)}" placeholder="1.1.5"><datalist id="palist">${addressables(state.p).map((x) => `<option value="${fmtPA(x.a, x.l, x.d)}">${esc(x.el.name || '')}</option>`).join('')}</datalist>`) : ''}
      ${field('Routingzähler', select_('rc', s.rc, { 7: '7 – unbegrenzt', 6: '6 – Standard', 5: '5', 4: '4', 3: '3', 2: '2', 1: '1', 0: '0' }))}
      ${field('Tempo', `<span class="speed"><input type="range" name="speed" min="0.4" max="3" step="0.1" value="${s.speed}" aria-label="Tempo der Animation"></span>`)}
    </div>
    <div class="btnrow"><button class="btn go" data-act="send">Telegramm senden</button>${r ? '<button class="btn" data-act="clear">Zurücksetzen</button>' : ''}</div>
    ${r ? `<h3>Ablauf</h3><ul class="issues log">${r.log.map((l) => `<li ${l.ref ? `data-ref="${l.ref}"` : ''}><span class="mark ${l.level}"></span><span>${esc(l.text)}</span></li>`).join('')}</ul>` : `<p class="hint">Grün: Koppler leitet weiter. Rot: Koppler sperrt. Ob ein Gruppentelegramm durchkommt, entscheidet die Filtertabelle des Kopplers – sie wird automatisch aus den Gruppenadressen der Geräte darunter gebildet.</p>`}`;
  bind(panel, {
    sender: (v) => { s.senderId = v || null; },
    type: (v) => { s.type = v; renderSimPanel(); },
    ga: (v) => { s.ga = v; },
    dest: (v) => { s.dest = v; },
    rc: (v) => { s.rc = Number(v); },
    speed: (v) => { s.speed = Number(v); },
    '@send': () => runSim(),
    '@clear': () => { s.result = null; state.stopAnim?.(); clearSim($('#sheet svg')); renderSimPanel(); },
  });
  panel.querySelector('[name="ga"]')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { s.ga = e.target.value; runSim(); } });
  panel.querySelector('[name="dest"]')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { s.dest = e.target.value; runSim(); } });
  panel.querySelectorAll('.log li[data-ref]').forEach((li) => {
    li.onclick = () => flash(li.dataset.ref);
  });
}

function runSim() {
  const s = state.sim;
  if (s.type === 'group') {
    const { ok } = parseGAList(s.ga);
    if (!ok.length) return toast('Bitte eine gültige Gruppenadresse eingeben, z. B. 1/0/1.');
    s.ga = ok[0];
  }
  const result = simulate(state.p, { senderId: s.senderId, type: s.type, ga: s.ga, dest: s.dest, rc: s.rc });
  s.result = result;
  renderSimPanel();
  if (!result.ok) return;
  state.stopAnim?.();
  const svg = $('#sheet svg');
  state.stopAnim = animate(svg, state.lay, result, { speed: s.speed });
}

function flash(id) {
  const n = $(`#sheet [data-id="${CSS.escape(id)}"]`);
  if (!n) return;
  n.animate([{ opacity: 1 }, { opacity: 0.2 }, { opacity: 1 }], { duration: 600, iterations: 2 });
}

// ---------- Reiter ----------

function setTab(tab) {
  const prev = state.tab;
  state.tab = tab;
  document.querySelectorAll('.tabs [role="tab"]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  for (const t of ['props', 'sim', 'check']) $(`#panel-${t}`).hidden = t !== tab;
  if (prev === 'sim' || tab === 'sim') { state.stopAnim?.(); state.sim.result = null; }
  render();
}

// ---------- Export und Dateien ----------

function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

const fileBase = () => (state.p.name || 'knx-topologie').replace(/[^\wäöüÄÖÜß.-]+/g, '_');

function cleanSVG() {
  const lay = layout(state.p, { edit: false });
  return { svg: renderSVG(state.p, lay, { stats: stats(state.p) }), lay };
}

async function exportPNG() {
  const { svg, lay } = cleanSVG();
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const scale = Math.min(3, 8000 / Math.max(lay.width, lay.height));
  const c = document.createElement('canvas');
  c.width = Math.round(lay.width * scale); c.height = Math.round(lay.height * scale);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  c.toBlob((b) => download(`${fileBase()}.png`, b), 'image/png');
}

// Adressliste für Tabellenkalkulation (Semikolon, wie in Excel üblich)
function addressCSV(p) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Adresse', 'Name', 'Typ', 'Ort', 'Medium', 'Sendet auf', 'Hört auf']];
  const graph = couplerGraph(p);
  for (const e of graph.edges) {
    if (!e.addr) continue;
    rows.push([fmtPA(e.addr.a, e.addr.l, e.addr.d), e.c.name || '', e.kind.label, '', '', '', '']);
  }
  for (const b of buses(p)) {
    const where = b.kind === 'backbone' ? 'Bereichslinie 0.0' : b.kind === 'main' ? `Hauptlinie ${b.a}.0` : `Linie ${b.a}.${b.l}${b.segIndex ? ` Segment ${b.segIndex + 1}` : ''}`;
    for (const d of b.devices) {
      const t = DEVICE_TYPES[d.type];
      const typ = d.type === 'TLN' ? CATEGORIES[d.cat] : t.label;
      const pa = t.addr && d.dev !== null ? fmtPA(b.a, b.l, d.dev) : '';
      rows.push([pa, d.name, typ, where, b.medium, d.sends.join(' '), d.listens.join(' ')]);
      for (const x of d.tunnels || []) rows.push([fmtPA(b.a, b.l, x), `Tunnel ${d.name}`, 'Tunneladresse', where, b.medium, '', '']);
    }
  }
  const key = (r) => (r[0] ? r[0].split('.').map((n) => n.padStart(3, '0')).join('.') : 'zzz');
  const [head, ...body] = rows;
  body.sort((a, b) => key(a).localeCompare(key(b)));
  return [head, ...body].map((r) => r.map(q).join(';')).join('\r\n');
}

async function encodeProject(p) {
  const bytes = new TextEncoder().encode(JSON.stringify(p));
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = '';
  buf.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function decodeProject(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return sanitize(JSON.parse(await new Response(stream).text()));
}

function initToolbar() {
  $('#projectName').addEventListener('change', (e) => commit((p) => { p.name = e.target.value.trim() || 'Projekt'; }));
  $('#btnUndo').onclick = undo;
  $('#btnRedo').onclick = redo;
  $('#btnHelp').onclick = () => $('#dlgHelp').showModal();
  $('#btnNew').onclick = () => {
    $('#tplList').innerHTML = Object.entries(TEMPLATES).map(([k, t]) => `<button value="${k}"><b>${esc(t.label)}</b><span>${esc(t.hint)}</span></button>`).join('');
    $('#dlgNew').showModal();
  };
  $('#dlgNew').addEventListener('close', () => {
    const v = $('#dlgNew').returnValue;
    if (TEMPLATES[v]) { setProject(TEMPLATES[v].build()); setTab('props'); }
  });
  $('#btnSave').onclick = () => {
    download(`${fileBase()}.knxtopo.json`, new Blob([JSON.stringify(state.p, null, 2)], { type: 'application/json' }));
    toast('Projekt als Datei gespeichert.');
  };
  $('#btnOpen').onclick = () => $('#fileInput').click();
  $('#fileInput').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      setProject(sanitize(JSON.parse(await f.text())));
      toast(`„${state.p.name}“ geöffnet.`);
    } catch (err) {
      toast(err.message.startsWith('Die Datei') ? err.message : 'Die Datei konnte nicht gelesen werden – ist es ein gespeichertes KNX-Topologie-Projekt?');
    }
  };
  const menu = $('#exportMenu');
  $('#btnExport').onclick = (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    $('#btnExport').setAttribute('aria-expanded', String(!menu.hidden));
  };
  menu.onclick = async (e) => {
    const b = e.target.closest('[data-export]');
    if (!b) return;
    menu.hidden = true;
    const kind = b.dataset.export;
    if (kind === 'svg') download(`${fileBase()}.svg`, new Blob([cleanSVG().svg], { type: 'image/svg+xml' }));
    if (kind === 'png') exportPNG().catch(() => toast('PNG-Export ist fehlgeschlagen.'));
    if (kind === 'csv') download(`${fileBase()}-adressen.csv`, new Blob(['\ufeff' + addressCSV(state.p)], { type: 'text/csv' }));
    if (kind === 'print') {
      const old = state.tab;
      state.tab = 'print';
      render();
      setTimeout(() => { window.print(); state.tab = old; render(); }, 50);
    }
    if (kind === 'link') {
      try {
        const url = `${location.origin}${location.pathname}#p=${await encodeProject(state.p)}`;
        await navigator.clipboard.writeText(url);
        toast('Link kopiert. Wer ihn öffnet, sieht dieses Projekt.');
      } catch { toast('Der Link konnte nicht kopiert werden.'); }
    }
  };
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu')) menu.hidden = true;
    if (!e.target.closest('#addMenu') && !e.target.closest('.ghost') && !e.target.closest('[data-act]')) closeAddMenu();
  });
  document.querySelectorAll('.tabs [role="tab"]').forEach((b) => { b.onclick = () => setTab(b.dataset.tab); });

  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') { closeAddMenu(); menu.hidden = true; }
    if (typing) return;
    if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); }
    else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); $('#btnSave').click(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && state.sel) { e.preventDefault(); removeSelected(); }
    else if (e.key === 'Escape' && state.sel) select(null);
    else if (e.key === '0' && !mod) fit();
  });
  window.addEventListener('resize', () => { if (state.lay) applyView(); });
}

let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

// ---------- Start ----------

state.p = load();
initStage();
initToolbar();
render();
requestAnimationFrame(fit);
document.fonts?.ready.then(() => render());

// für Tests in der Konsole
window.knx = { state, render, newProject, encodeProject, decodeProject, cleanSVG, undo, redo };
void MEDIA;
