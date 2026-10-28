// Zeichnet das Layout als SVG. Das SVG bringt seine Stile selbst mit,
// damit Export als SVG/PNG genauso aussieht wie im Browser.
import { CATEGORIES, DEVICE_TYPES, MEDIA } from './model.js';
import { G } from './layout.js';

export const COLORS = {
  paper: '#EDF1EE', grid: '#DDE4DF', gridMajor: '#CCD6CF',
  ink: '#22302A', ink2: '#5B6A62', ink3: '#8C9992',
  tpSheath: '#4F9A53', tpRed: '#D33A2C', tpBlack: '#1E2320',
  ip: '#2F6DB3', ipCore: '#A9C8EE', rf: '#7A4CC2',
  module: '#F8F9F7', moduleEdge: '#A3AEA7', coupler: '#2D3934',
  signal: '#F08A24', pass: '#2E9B57', block: '#D33A2C', led: '#FF3B30',
};
const C = COLORS;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Icons, 20×20, Strichzeichnungen
export const ICONS = {
  taster: '<rect x="3" y="3" width="14" height="14" rx="2.5"/><path d="M6.5 7.5h7M6.5 12.5h7"/>',
  aktor: '<path d="M3 14h4l7-6M14 14h3"/><circle cx="7" cy="14" r="1.2"/><circle cx="14" cy="14" r="1.2"/>',
  dimmer: '<path d="M10 3.5a4.5 4.5 0 0 1 2.6 8.2V14H7.4v-2.3A4.5 4.5 0 0 1 10 3.5zM8 16.5h4"/>',
  jalousie: '<rect x="3.5" y="3" width="13" height="2"/><path d="M4.5 8h11M4.5 11h11M4.5 14h11M10 5v11"/>',
  heizung: '<path d="M4 4v12M8 4v12M12 4v12M16 4v12M3 6h14M3 14h14"/>',
  praesenz: '<circle cx="10" cy="13" r="1.6"/><path d="M6.5 9.5a5 5 0 0 1 7 0M4 7a8.5 8.5 0 0 1 12 0"/>',
  sensor: '<path d="M8.5 4.5a1.5 1.5 0 0 1 3 0v7.2a3 3 0 1 1-3 0z"/><path d="M10 8v5"/>',
  wetter: '<circle cx="7.5" cy="7.5" r="2.6"/><path d="M7.5 2.5v1.2M2.5 7.5h1.2M4 4l.8.8M11 4l-.8.8"/><path d="M8 16h7.5a2.5 2.5 0 0 0-.4-5 3.5 3.5 0 0 0-6.6 1.2A2 2 0 0 0 8 16z"/>',
  display: '<rect x="2.5" y="4" width="15" height="10" rx="1"/><path d="M7 17h6M10 14v3"/>',
  logik: '<path d="M4 4h6a6 6 0 0 1 0 12H4z"/><path d="M2 7h2M2 13h2M16 10h2"/>',
  sonstiges: '<circle cx="10" cy="10" r="6"/><circle cx="10" cy="10" r="1.5"/>',
  SV: '<path d="M10 2.5v4M6 6.5h8M7.5 9.5h5M9 12.5h2"/><path d="M5 15.5h3M6.5 14v3M12 15.5h3"/>',
  PI: '<path d="M10 17V4M10 4l-2 2.2M10 4l2 2.2M10 12l-4-2.5V8M10 10l4-2.2V6.5"/><circle cx="10" cy="17" r="1.3"/><rect x="5" y="6.6" width="2" height="1.6"/><circle cx="14" cy="5.6" r="1"/>',
  IPI: '<circle cx="10" cy="10" r="6.5"/><path d="M3.5 10h13M10 3.5c-2.2 2-2.2 11 0 13M10 3.5c2.2 2 2.2 11 0 13"/>',
  SW: '<rect x="2.5" y="6" width="15" height="8" rx="1"/><path d="M5 9.5h1.5M8 9.5h1.5M11 9.5h1.5M14 9.5h1"/><path d="M5 12h10"/>',
  RFR: '<path d="M10 9v8M7.5 17h5"/><circle cx="10" cy="7.5" r="1.4"/><path d="M6.8 4.5a4.5 4.5 0 0 0 0 6M13.2 4.5a4.5 4.5 0 0 1 0 6M4.6 2.6a7.5 7.5 0 0 0 0 9.8M15.4 2.6a7.5 7.5 0 0 1 0 9.8"/>',
};

export function iconFor(d) {
  if (d.type === 'TLN') return ICONS[d.cat] || ICONS.sonstiges;
  return ICONS[d.type] || ICONS.sonstiges;
}

const STYLE = `
.paper{fill:${C.paper}}
text{font-family:'IBM Plex Sans Condensed','Arial Narrow',Arial,sans-serif;fill:${C.ink}}
.mono{font-family:'IBM Plex Mono',ui-monospace,Menlo,Consolas,monospace}
.area-frame{fill:rgba(255,255,255,.42);stroke:${C.ink3};stroke-width:1;stroke-dasharray:5 4}
.area-title{font-size:15px;font-weight:600}
.area-name{font-size:15px;fill:${C.ink2}}
.col-label{font-size:11.5px;fill:${C.ink2}}
.bus-label{font-size:12px;font-weight:600}
.bus-medium{font-size:10.5px;font-weight:600;fill:#fff}
.card .body{fill:${C.module};stroke:${C.moduleEdge};stroke-width:1}
.card .strip{fill:#E3E8E4}
.card .ico{fill:none;stroke:${C.ink};stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.card .name{font-size:13px;font-weight:600}
.card .sub{font-size:11px;fill:${C.ink2}}
.card .pa{font-size:12px;font-weight:600}
.card .led{fill:#7A2A24}
.card.sel .body{stroke:${C.signal};stroke-width:2}
.card.sel .led{fill:${C.led};filter:url(#glow)}
.card.err .body{stroke:${C.block}}
.card.sv .strip{fill:#F3E2B8}
.card.sw .strip,.card.ipi .strip{fill:#DCE7F4}
.card.rf .strip{fill:#E7DDF4}
.cpl .body{fill:${C.coupler}}
.cpl text{fill:#fff}
.cpl .t1{font-size:13px;font-weight:600}
.cpl .t2{font-size:11.5px;fill:#C9D3CE}
.cpl .pa{font-size:12.5px;font-weight:600;fill:#fff}
.cpl .kind{font-size:11px;font-weight:700;fill:${C.coupler}}
.cpl .kindbg{fill:#F2C14E}
.cpl.invalid .kindbg{fill:${C.block}}
.cpl.invalid .kind{fill:#fff}
.cpl.sel .body{stroke:${C.signal};stroke-width:3}
.cpl.err .body{stroke:${C.block};stroke-width:2}
.cpl .led{fill:#7A2A24}
.cpl.sel .led{fill:${C.led};filter:url(#glow)}
.hdr .body{fill:rgba(255,255,255,.7);stroke:${C.ink2};stroke-width:1.2;stroke-dasharray:4 3}
.hdr .t1{font-size:13px;font-weight:600}
.hdr .t2{font-size:11.5px;fill:${C.ink2}}
.hdr.sel .body{stroke:${C.signal};stroke-width:2;stroke-dasharray:none}
.stub{fill:none;stroke-linecap:round}
.ghost rect{fill:none;stroke:${C.ink3};stroke-width:1.2;stroke-dasharray:4 4}
.ghost text{font-size:12.5px;fill:${C.ink2}}
.ghost:hover rect{stroke:${C.signal};fill:rgba(240,138,36,.06)}
.ghost:hover text{fill:${C.ink}}
.tb line,.tb rect{stroke:${C.ink};fill:none;stroke-width:1}
.tb .k{font-size:10.5px;fill:${C.ink2}}
.tb .v{font-size:13px;font-weight:600}
.tb .big{font-size:16px;font-weight:600}
.lg text{font-size:11.5px;fill:${C.ink2}}
.tun{font-size:10.5px;fill:${C.ink2}}
.dim .card,.dim .cpl,.dim .hdr,.dim .bus{opacity:.32}
.dim .card.lit,.dim .cpl.lit,.dim .hdr.lit,.dim .bus.lit{opacity:1}
.card.rx .body{stroke:${C.pass};stroke-width:2.5}
.card.tx .body{stroke:${C.signal};stroke-width:2.5}
.badge text{font-size:12px;font-weight:700;fill:#fff}
`;

// Ein Busstück im Stil des Mediums
function busSeg(medium, kind, [x1, y1, x2, y2]) {
  const thick = kind === 'backbone' ? 1.5 : kind === 'main' ? 1.2 : 1;
  const d = `M${x1} ${y1}L${x2} ${y2}`;
  if (medium === 'TP') {
    // grüner Mantel mit roter und schwarzer Ader wie im echten Buskabel
    const horiz = y1 === y2;
    const o = 1.7 * thick;
    const off = (s) => (horiz ? `M${x1} ${y1 + s}L${x2} ${y2 + s}` : `M${x1 + s} ${y1}L${x2 + s} ${y2}`);
    return `<path d="${d}" stroke="${C.tpSheath}" stroke-width="${8 * thick}" stroke-linecap="round" opacity=".9"/>`
      + `<path d="${off(-o)}" stroke="${C.tpRed}" stroke-width="${1.5 * thick}"/>`
      + `<path d="${off(o)}" stroke="${C.tpBlack}" stroke-width="${1.5 * thick}"/>`;
  }
  if (medium === 'IP') {
    return `<path d="${d}" stroke="${C.ip}" stroke-width="${6 * thick}" stroke-linecap="round"/>`
      + `<path d="${d}" stroke="${C.ipCore}" stroke-width="${1.3 * thick}" stroke-dasharray="7 5"/>`;
  }
  return `<path d="${d}" stroke="${C.rf}" stroke-width="${2.6 * thick}" stroke-dasharray="2 6" stroke-linecap="round"/>`
    + `<path d="${d}" stroke="${C.rf}" stroke-width="${8 * thick}" stroke-linecap="round" opacity=".12"/>`;
}

function stubPath(medium, pts) {
  const d = 'M' + pts.map((p) => p.join(' ')).join('L');
  const col = medium === 'TP' ? C.tpSheath : medium === 'IP' ? C.ip : C.rf;
  const w = medium === 'RF' ? 2 : 3;
  const dash = medium === 'RF' ? ' stroke-dasharray="2 5"' : '';
  return `<path class="stub" d="${d}" stroke="${col}" stroke-width="${w}"${dash}/>`;
}

const mediumChip = (x, y, medium) => {
  const col = medium === 'TP' ? C.tpSheath : medium === 'IP' ? C.ip : C.rf;
  return `<rect x="${x}" y="${y - 9}" width="24" height="17" rx="3" fill="${col}"/><text class="bus-medium" x="${x + 12}" y="${y + 3.5}" text-anchor="middle">${medium}</text>`;
};

// Kürzt Text auf eine ungefähre Pixelbreite
function fit(s, px, cw) {
  return trunc(s, Math.max(4, Math.floor(px / cw)));
}

function trunc(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function renderSVG(p, lay, st = {}) {
  const sel = st.selected;
  const errs = st.errorIds || new Set();
  const parts = [];
  const W = lay.width, H = lay.height;

  parts.push(`<defs><style>${STYLE}</style>
<pattern id="grid" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M12 0H0V12" fill="none" stroke="${C.grid}" stroke-width=".6"/></pattern>
<pattern id="grid5" width="60" height="60" patternUnits="userSpaceOnUse"><rect width="60" height="60" fill="url(#grid)"/><path d="M60 0H0V60" fill="none" stroke="${C.gridMajor}" stroke-width=".9"/></pattern>
<filter id="glow" x="-2" y="-2" width="5" height="5"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="lift" x="-.1" y="-.2" width="1.2" height="1.5"><feDropShadow dx="0" dy="1.2" stdDeviation="1.2" flood-color="#22302A" flood-opacity=".18"/></filter>
</defs>`);
  parts.push(`<rect class="paper" x="0" y="0" width="${W}" height="${H}"/><rect x="0" y="0" width="${W}" height="${H}" fill="url(#grid5)"/>`);
  parts.push(`<g id="content" class="${st.dim ? 'dim' : ''}">`);

  // Bereichsrahmen
  for (const a of lay.areas) {
    parts.push(`<g class="area" data-id="${a.id}"><rect class="area-frame" x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" rx="10"/>`
      + `<text class="area-title" x="${a.x + G.PAD + G.BX + 14}" y="${a.y + 22}">${esc(a.title)}<tspan class="area-name" dx="8">${esc(a.name)}</tspan></text></g>`);
  }
  for (const l of lay.labels) parts.push(`<text class="col-label" x="${l.x}" y="${l.y}">${esc(l.text)}</text>`);

  // Busse
  for (const [id, geo] of lay.bus) {
    parts.push(`<g class="bus" data-bus="${id}">${geo.segs.map((s) => busSeg(geo.medium, geo.kind, s)).join('')}</g>`);
  }
  // Stichleitungen zu Kopplern
  for (const c of lay.couplers) {
    const a = lay.cAttach.get(c.id);
    if (!a || c.level === 'segment') continue;
    const [ux, uy] = a.up.node.split(',').map(Number);
    parts.push(`<g class="bus" data-cstub="${c.id}">${stubPath(c.upper, [[ux, uy], [ux, c.y]])}</g>`);
    if (c.level === 'area') {
      const [dx, dy] = a.down.node.split(',').map(Number);
      parts.push(`<g class="bus" data-cstub="${c.id}">${stubPath(c.lower, [[dx, c.y + c.h], [dx, dy]])}</g>`);
    }
  }
  // Stichleitungen zu Geräten
  for (const card of lay.cards) {
    const a = lay.attach.get(card.id);
    parts.push(`<g class="bus" data-dstub="${card.id}">${stubPath(card.medium, a.stub)}</g>`);
  }
  // Busbeschriftungen
  for (const [, geo] of lay.bus) {
    if (!geo.label) continue;
    const { x, y, text, medium } = geo.label;
    parts.push(`<g class="bus-lbl">${mediumChip(x - 6, y - 22, medium)}<text class="bus-label" x="${x + 24}" y="${y - 18}">${esc(text)}</text></g>`);
  }

  // Koppler
  for (const c of lay.couplers) {
    const isSel = sel === c.id || sel === c.ownerId;
    const cls = [c.level === 'header' ? 'hdr' : 'cpl', isSel ? 'sel' : '', c.kind?.invalid ? 'invalid' : '', errs.has(c.id) || errs.has(c.ownerId) ? 'err' : ''].join(' ');
    const id = c.level === 'header' ? c.ownerId : c.id;
    if (c.level === 'header') {
      parts.push(`<g class="${cls}" data-id="${id}" data-sel="${c.ownerId}"><rect class="body" x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="6"/>`
        + `<text class="t1" x="${c.x + 14}" y="${c.y + 24}">${esc(c.title)}</text><text class="t2" x="${c.x + 14}" y="${c.y + 42}">${esc(trunc(c.name || 'ohne Linienkoppler', 30))}</text>`
        + `${mediumChip(c.x + c.w - 34, c.y + 20, c.lower)}</g>`);
      continue;
    }
    const top = c.upper === 'TP' ? C.tpSheath : c.upper === 'IP' ? C.ip : C.rf;
    const bot = c.lower === 'TP' ? C.tpSheath : c.lower === 'IP' ? C.ip : C.rf;
    const kw = Math.max(28, c.kind.short.length * 7.5 + 12);
    const sub = c.level === 'segment' ? c.kind.label : c.kind.label.replace(/^KNX /, '');
    parts.push(`<g class="${cls}" data-id="${c.id}" data-sel="${c.ownerId}" filter="url(#lift)">`
      + `<rect class="body" x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="5"/>`
      + `<rect x="${c.x + 4}" y="${c.y}" width="${c.w - 8}" height="3.5" fill="${top}"/>`
      + `<rect x="${c.x + 4}" y="${c.y + c.h - 3.5}" width="${c.w - 8}" height="3.5" fill="${bot}"/>`
      + `<rect class="kindbg" x="${c.x + 32}" y="${c.y + 10}" width="${kw}" height="18" rx="3"/>`
      + `<text class="kind" x="${c.x + 32 + kw / 2}" y="${c.y + 23}" text-anchor="middle">${esc(c.kind.short)}</text>`
      + (c.pa ? `<text class="pa mono" x="${c.x + 40 + kw}" y="${c.y + 23.5}">${c.pa}</text>` : '')
      + `<circle class="led" cx="${c.x + c.w - 14}" cy="${c.y + 15}" r="3.2"/>`
      + `<text class="t1" x="${c.x + 32}" y="${c.y + (c.level === 'segment' ? 41 : 42)}">${esc(trunc(c.level === 'segment' ? (c.name || sub) : `${c.title}${c.name ? ' ' + c.name : ''}`, 27))}</text>`
      + (c.level !== 'segment' ? `<text class="t2" x="${c.x + 32}" y="${c.y + 56}">${esc(trunc(sub, 32))}</text>` : '')
      + `<title>${esc(c.kind.label)}${c.pa ? ' ' + c.pa : ''}</title>`
      + `</g>`);
    if (c.tunnels?.length) parts.push(`<text class="tun mono" x="${c.x + c.w}" y="${c.y + c.h + 12}" text-anchor="end">Tunnel ${esc(tunnelRange(c.tunnels))}</text>`);
  }

  // Gerätekarten
  for (const card of lay.cards) {
    const d = card.el;
    const t = DEVICE_TYPES[d.type];
    const isSel = sel === d.id;
    const cls = ['card', d.type.toLowerCase(), card.medium === 'RF' && d.type === 'TLN' ? 'rf' : '', isSel ? 'sel' : '', errs.has(d.id) ? 'err' : ''].join(' ');
    const tun = card.tunnels.length ? `Tunnel ${tunnelRange(card.tunnels)}` : '';
    const sub = d.type === 'SV' ? `${d.mA || '?'} mA` : d.type === 'TLN' ? (CATEGORIES[d.cat] || 'Teilnehmer') + (card.medium !== 'TP' ? ` ${MEDIA[card.medium].label}` : '') : tun || t.label;
    const name = d.name || (d.type === 'TLN' ? CATEGORIES[d.cat] : t.label);
    const { x, y, w, h } = card;
    const paW = card.pa ? card.pa.length * 7.3 + 6 : 0;
    parts.push(`<g class="${cls}" data-id="${d.id}">`
      + `<rect class="body" x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/>`
      + `<path class="strip" d="M${x + 4} ${y}h26v${h}h-26a4 4 0 0 1-4-4v-${h - 8}a4 4 0 0 1 4-4z"/>`
      + `<g class="ico" transform="translate(${x + 5} ${y + h / 2 - 10})">${iconFor(d)}</g>`
      + `<text class="name" x="${x + 38}" y="${y + 19}">${esc(fit(name, w - 38 - (t.addr ? 22 : 8), 6.5))}</text>`
      + `<text class="sub" x="${x + 38}" y="${y + 36}">${esc(fit(sub, w - 38 - paW - 10, 5.3))}</text>`
      + (card.pa ? `<text class="pa mono" x="${x + w - 9}" y="${y + 36}" text-anchor="end">${card.pa}</text>` : '')
      + (t.addr ? `<circle class="led" cx="${x + w - 12}" cy="${y + 14}" r="3"/>` : '')
      + `<title>${esc(name)}${card.pa ? ' ' + card.pa : ''}${tun ? ' – ' + esc(tun) : ''}</title>`
      + `</g>`);
  }

  // Platzhalter zum Hinzufügen
  for (const g of lay.ghosts) {
    parts.push(`<g class="ghost" data-action="${g.action}" data-ctx='${esc(JSON.stringify(g.ctx))}' tabindex="0" role="button" aria-label="${esc(g.label)}">`
      + (g.stub ? `<path d="M${g.stub[0]} ${g.stub[1]}V${g.y}" stroke="${C.ink3}" stroke-dasharray="3 4" fill="none"/>` : '')
      + `<rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="5"/>`
      + `<text x="${g.x + g.w / 2}" y="${g.y + g.h / 2 + 4.5}" text-anchor="middle">+ ${esc(g.label)}</text></g>`);
  }

  parts.push('</g>');
  parts.push(legend(lay.legend));
  parts.push(titleBlock(p, lay.titleBlock, st.stats));
  parts.push('<g id="sim-layer"></g>');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${parts.join('')}</svg>`;
}

function tunnelRange(list) {
  if (list.length <= 2) return list.join(', ');
  return `${list[0]} … ${list[list.length - 1].split('.').pop()} (${list.length})`;
}

function legend({ x, y }) {
  const row = (i, medium, text) => {
    const yy = y + 14 + i * 22;
    return busSeg(medium, 'segment', [x, yy, x + 46, yy]) + `<text x="${x + 58}" y="${yy + 4}">${text}</text>`;
  };
  return `<g class="lg">${row(0, 'TP', 'TP – Busleitung')}${row(1, 'IP', 'IP – Ethernet')}${row(2, 'RF', 'RF – Funk 868 MHz')}</g>`;
}

function titleBlock(p, { x, y, w, h }, stats = {}) {
  const c1 = x + 86, r1 = y + h * 0.42, r2 = y + h * 0.71;
  const midX = x + w * 0.62;
  return `<g class="tb"><rect x="${x}" y="${y}" width="${w}" height="${h}"/>`
    + `<line x1="${x}" y1="${r1}" x2="${x + w}" y2="${r1}"/><line x1="${x}" y1="${r2}" x2="${x + w}" y2="${r2}"/>`
    + `<line x1="${c1}" y1="${y}" x2="${c1}" y2="${y + h}"/><line x1="${midX}" y1="${r1}" x2="${midX}" y2="${y + h}"/>`
    + `<text class="k" x="${x + 8}" y="${y + 15}">Projekt</text><text class="big" x="${c1 + 10}" y="${y + 25}">${esc(trunc(p.name, 26))}</text>`
    + `<text class="k" x="${x + 8}" y="${r1 + 16}">Bearbeiter</text><text class="v" x="${c1 + 10}" y="${r1 + 17}">${esc(trunc(p.author || '–', 13))}</text>`
    + `<text class="k" x="${midX + 8}" y="${r1 + 17}">${esc(p.date || '')}</text>`
    + `<text class="k" x="${x + 8}" y="${r2 + 16}">Umfang</text><text class="v" x="${c1 + 10}" y="${r2 + 17}">${stats.devices ?? 0} Geräte</text>`
    + `<text class="k" x="${midX + 8}" y="${r2 + 17}">${stats.lines ?? 0} Linien, ${stats.areas ?? 0} Bereiche</text>`
    + `</g>`;
}

export const CARD_H = G.CARDH;
