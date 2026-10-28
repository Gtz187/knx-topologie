// Automatisches Layout: Bereiche nebeneinander, Linien als Spalten,
// Geräte untereinander. Liefert Geometrie für das Zeichnen und einen
// Graphen je Bus, über den die Telegramm-Animation ihre Wege findet.
import { buses, couplerKind, SEG_KINDS, DEVICE_TYPES, fmtPA } from './model.js';
import { ensureRF } from './rf.js';

export const G = {
  COLW: 250,      // Spaltenbreite
  COLGAP: 30,     // Abstand zwischen Spalten
  AREAGAP: 46,    // zusätzlicher Abstand zwischen Bereichen
  PAD: 22,        // Innenabstand des Bereichsrahmens
  BX: 18,         // x-Versatz des Busses in der Spalte
  CARDX: 36,      // x-Versatz der Gerätekarten
  CARDH: 46,
  CARDGAP: 10,
  BOXH: 66,       // Kopplerhöhe
  SEGH: 50,       // Höhe Linienverstärker/Segmentkoppler
  GHOSTH: 32,
  MARGIN: 48,
  RFW: 340,       // Breite eines Funkfelds
};

const key = (x, y) => `${Math.round(x)},${Math.round(y)}`;

class BusGeo {
  constructor(id, medium, kind) {
    this.id = id; this.medium = medium; this.kind = kind;
    this.segs = [];        // Linienstücke zum Zeichnen
    this.adj = new Map();  // Graph für Wegsuche
  }
  line(x1, y1, x2, y2) {
    this.segs.push([x1, y1, x2, y2]);
    const a = key(x1, y1), b = key(x2, y2);
    if (!this.adj.has(a)) this.adj.set(a, new Set());
    if (!this.adj.has(b)) this.adj.set(b, new Set());
    this.adj.get(a).add(b); this.adj.get(b).add(a);
  }
  // Polylinie durch sortierte Punkte entlang einer Achse
  chain(points) {
    for (let i = 1; i < points.length; i++) {
      const [x1, y1] = points[i - 1], [x2, y2] = points[i];
      if (x1 !== x2 || y1 !== y2) this.line(x1, y1, x2, y2);
    }
  }
  path(fromKey, toKey) {
    if (fromKey === toKey) return [fromKey];
    const prev = new Map([[fromKey, null]]);
    const q = [fromKey];
    while (q.length) {
      const k = q.shift();
      if (k === toKey) break;
      for (const n of this.adj.get(k) || []) if (!prev.has(n)) { prev.set(n, k); q.push(n); }
    }
    if (!prev.has(toKey)) return null;
    const out = [];
    for (let k = toKey; k; k = prev.get(k)) out.unshift(k);
    return out;
  }
}

export function layout(p, opts = {}) {
  const edit = !!opts.edit;
  const { COLW, COLGAP, AREAGAP, PAD, BX, CARDX, CARDH, CARDGAP, BOXH, SEGH, GHOSTH, MARGIN, RFW } = G;
  const out = {
    areas: [], cards: [], couplers: [], ghosts: [], labels: [], radios: [], rfDevs: [],
    bus: new Map(), attach: new Map(), cAttach: new Map(),
  };
  const busList = buses(p);
  const busOf = (owner) => busList.find((b) => b.owner === owner);

  const bb = p.backbone.enabled;
  const Y_BB = MARGIN + 40;
  const BK_TOP = Y_BB + 34;
  const Y_MAIN = bb ? BK_TOP + BOXH + 34 : MARGIN + 74;
  const LK_TOP = Y_MAIN + 34;
  const CARD_TOP = LK_TOP + BOXH + 24;

  let x = MARGIN + PAD;
  let bottom = CARD_TOP;

  // Gerätekarten untereinander an einem senkrechten Bus
  const stack = (geo, bus, colX, startY, devices, segIndex, ghostCtx) => {
    const bx = colX + BX;
    let y = startY;
    const pts = [];
    for (const d of devices) {
      const cy = y + CARDH / 2;
      pts.push([bx, cy]);
      const hasAddr = DEVICE_TYPES[d.type].addr && d.dev !== null && d.dev !== undefined;
      out.cards.push({
        id: d.id, el: d, x: colX + CARDX, y, w: COLW - CARDX, h: CARDH, busId: bus.id, medium: bus.medium,
        pa: hasAddr ? fmtPA(bus.a, bus.l, d.dev) : null,
        tunnels: (d.tunnels || []).map((t) => fmtPA(bus.a, bus.l, t)),
      });
      out.attach.set(d.id, { busId: bus.id, node: key(bx, cy), stub: [[bx, cy], [colX + CARDX, cy]] });
      y += CARDH + CARDGAP;
    }
    if (edit && ghostCtx) {
      out.ghosts.push({ action: 'add-device', x: colX + CARDX, y, w: COLW - CARDX, h: GHOSTH, label: 'Gerät hinzufügen', ctx: ghostCtx });
      y += GHOSTH + CARDGAP;
    }
    return { pts, end: y };
  };

  // Backbone-Geräte als eigene Spalte ganz links
  const bbGeo = bb ? new BusGeo('bb', p.backbone.medium, 'backbone') : null;
  const bbNodes = [];
  if (bb) {
    out.bus.set('bb', bbGeo);
    const bus = busOf(p.backbone);
    if (p.backbone.devices.length || edit) {
      const colX = x;
      const bx = colX + BX;
      bbNodes.push([bx, Y_BB]);
      const s = stack(bbGeo, bus, colX, BK_TOP, p.backbone.devices, 0, { busId: 'bb' });
      if (s.pts.length) bbGeo.chain([[bx, Y_BB], ...s.pts]);
      bottom = Math.max(bottom, s.end);
      out.labels.push({ kind: 'col', x: colX + CARDX, y: BK_TOP - 10, text: 'Geräte an der Bereichslinie' });
      x += COLW + COLGAP + AREAGAP / 2;
    }
  }

  for (const ar of p.areas) {
    const areaX = x;
    const main = busOf(ar);
    const mainGeo = new BusGeo(main.id, ar.mainMedium, 'main');
    out.bus.set(main.id, mainGeo);
    const mainNodes = [];
    let areaBottom = CARD_TOP;

    // Geräte an der Hauptlinie
    if (ar.mainDevices.length || edit) {
      const colX = x, bx = colX + BX;
      mainNodes.push([bx, Y_MAIN]);
      const s = stack(mainGeo, main, colX, LK_TOP, ar.mainDevices, 0, { busId: main.id });
      if (s.pts.length) mainGeo.chain([[bx, Y_MAIN], ...s.pts]);
      areaBottom = Math.max(areaBottom, s.end);
      out.labels.push({ kind: 'col', x: colX + CARDX, y: LK_TOP - 10, text: `Geräte an der Hauptlinie ${ar.area}.0` });
      x += COLW + COLGAP;
    }

    for (const ln of ar.lines) {
      const colX = x, bx = colX + BX;
      const kind = couplerKind('line', ar.mainMedium, ln.medium);
      if (!ln.noCoupler) {
        mainNodes.push([bx, Y_MAIN]);
        out.couplers.push({
          id: ln.coupler.id, ownerId: ln.id, level: 'line', x: colX, y: LK_TOP, w: COLW, h: BOXH, bx,
          kind, upper: ar.mainMedium, lower: ln.medium, pa: fmtPA(ar.area, ln.line, 0),
          title: `Linie ${ar.area}.${ln.line}`, name: ln.name, c: ln.coupler,
          tunnels: (ln.coupler.tunnels || []).map((t) => fmtPA(ar.area, ln.line, t)),
        });
      } else {
        out.couplers.push({
          id: ln.id, ownerId: ln.id, level: 'header', x: colX, y: LK_TOP, w: COLW, h: BOXH, bx,
          lower: ln.medium, title: `Linie ${ar.area}.${ln.line}`, name: ln.name,
        });
      }
      if (ln.medium === 'RF') {
        // Funkfeld: kleiner Grundriss statt Geräteliste
        const rf = ensureRF(ln);
        const sg = ln.segments[0];
        const sb = busOf(sg);
        const W = RFW - 8;
        const sc = W / rf.w;
        const fx = colX + 4, fy = LK_TOP + BOXH + 30;
        const P = (pt) => [Math.round((fx + pt.x * sc) * 10) / 10, Math.round((fy + pt.y * sc) * 10) / 10];
        const geo = new BusGeo(sg.id, 'RF', 'rf');
        out.bus.set(sg.id, geo);
        const ant = ln.noCoupler ? null : P(rf.mk);
        out.radios.push({ busId: sg.id, lineId: ln.id, x: fx, y: fy, w: W, h: rf.h * sc, sc, rf, ant, feed: ln.noCoupler ? null : [bx, LK_TOP + BOXH], coupler: ln.noCoupler ? null : ln.coupler });
        for (const d of sg.devices) {
          const [cx, cy] = P(d.pos);
          out.rfDevs.push({ id: d.id, el: d, cx, cy, busId: sg.id, pa: DEVICE_TYPES[d.type].addr && d.dev !== null ? fmtPA(ar.area, ln.line, d.dev) : null });
          out.attach.set(d.id, { busId: sg.id, node: key(cx, cy), stub: [[cx, cy], [cx, cy]], rf: true });
        }
        if (!ln.noCoupler) {
          out.cAttach.set(ln.coupler.id, { up: { busId: main.id, node: key(bx, Y_MAIN) }, down: { busId: sg.id, node: key(ant[0], ant[1]) }, mid: [bx, LK_TOP + BOXH + 8] });
        }
        let y = fy + rf.h * sc + 14;
        if (edit) {
          out.ghosts.push({ action: 'add-device', x: colX + 4, y, w: W / 2 - 4, h: GHOSTH, label: 'Gerät hinzufügen', ctx: { busId: sg.id } });
          out.ghosts.push({ action: 'edit-rf', x: colX + 4 + W / 2 + 4, y, w: W / 2 - 4, h: GHOSTH, label: 'Grundriss bearbeiten', ctx: { lineId: ln.id } });
          y += GHOSTH + CARDGAP;
        }
        areaBottom = Math.max(areaBottom, y);
        x += RFW + COLGAP;
        continue;
      }
      let y = LK_TOP + BOXH;
      let prevGeo = null;
      ln.segments.forEach((sg, i) => {
        const sb = busOf(sg);
        const geo = new BusGeo(sg.id, ln.medium, 'segment');
        out.bus.set(sg.id, geo);
        if (i > 0) {
          y += 14;
          const segTop = y;
          const k = SEG_KINDS[sg.coupler?.kind] || SEG_KINDS.LV;
          prevGeo.chain([[bx, prevGeo.endY], [bx, segTop]]);
          out.couplers.push({
            id: sg.coupler.id, ownerId: sg.id, level: 'segment', x: colX, y: segTop, w: COLW, h: SEGH, bx,
            kind: k, upper: ln.medium, lower: ln.medium,
            pa: sg.coupler.dev !== null && sg.coupler.dev !== undefined ? fmtPA(ar.area, ln.line, sg.coupler.dev) : null,
            title: `Segment ${i + 1}`, name: sg.coupler.name, c: sg.coupler,
          });
          out.cAttach.set(sg.coupler.id, { up: { busId: prevGeo.id, node: key(bx, segTop) }, down: { busId: sg.id, node: key(bx, segTop + SEGH) } });
          y = segTop + SEGH;
        }
        const top = y;
        const s = stack(geo, sb, colX, top + 22, sg.devices, i, { busId: sg.id });
        const lastY = s.pts.length ? s.pts[s.pts.length - 1][1] : top + 28;
        geo.chain([[bx, top], ...(s.pts.length ? s.pts : [[bx, lastY]])]);
        geo.endY = lastY;
        geo.topKey = key(bx, top);
        if (i === 0 && !ln.noCoupler) {
          out.cAttach.set(ln.coupler.id, { up: { busId: main.id, node: key(bx, Y_MAIN) }, down: { busId: sg.id, node: key(bx, top) } });
        }
        y = s.end;
        prevGeo = geo;
      });
      if (edit && ln.medium === 'TP' && ln.segments.length < 4) {
        out.ghosts.push({ action: 'add-segment', x: colX + CARDX, y, w: COLW - CARDX, h: GHOSTH, label: 'Segment anfügen', ctx: { lineId: ln.id } });
        y += GHOSTH + CARDGAP;
      }
      areaBottom = Math.max(areaBottom, y);
      x += COLW + COLGAP;
    }

    if (edit) {
      const colX = x;
      out.ghosts.push({ action: 'add-line', x: colX, y: LK_TOP, w: COLW * 0.72, h: BOXH, label: 'Linie hinzufügen', ctx: { areaId: ar.id }, stub: [colX + BX, Y_MAIN] });
      mainNodes.push([colX + BX, Y_MAIN]);
      x += COLW * 0.72 + COLGAP;
    }

    // Hauptlinie zeichnen
    const firstBx = areaX + BX;
    if (bb) {
      const k = couplerKind('area', p.backbone.medium, ar.mainMedium);
      out.couplers.push({
        id: ar.coupler.id, ownerId: ar.id, level: 'area', x: areaX, y: BK_TOP, w: COLW, h: BOXH, bx: firstBx,
        kind: k, upper: p.backbone.medium, lower: ar.mainMedium, pa: fmtPA(ar.area, 0, 0),
        title: `Bereich ${ar.area}`, name: ar.name, c: ar.coupler,
        tunnels: (ar.coupler.tunnels || []).map((t) => fmtPA(ar.area, 0, t)),
      });
      bbNodes.push([firstBx, Y_BB]);
      mainNodes.push([firstBx, Y_MAIN]);
      out.cAttach.set(ar.coupler.id, { up: { busId: 'bb', node: key(firstBx, Y_BB) }, down: { busId: main.id, node: key(firstBx, Y_MAIN) } });
    }
    const showMain = bb || ar.mainDevices.length || ar.lines.some((l) => !l.noCoupler) || edit;
    if (showMain && mainNodes.length) {
      const xs = [...new Set(mainNodes.map((n) => n[0]))].sort((a, b) => a - b);
      if (xs.length === 1) xs.push(xs[0] + COLW * 0.5);
      mainGeo.chain(xs.map((v) => [v, Y_MAIN]));
      mainGeo.label = { x: xs[0], y: Y_MAIN, text: `Hauptlinie ${ar.area}.0`, medium: ar.mainMedium };
    }
    const right = x - COLGAP;
    out.areas.push({
      id: ar.id, x: areaX - PAD, y: bb ? BK_TOP - 34 : Y_MAIN - 62, w: right - areaX + PAD * 2, h: areaBottom - (bb ? BK_TOP - 34 : Y_MAIN - 62) + PAD,
      title: `Bereich ${ar.area}`, name: ar.name,
    });
    bottom = Math.max(bottom, areaBottom);
    x += AREAGAP;
  }

  if (edit) {
    const gy = bb ? BK_TOP : Y_MAIN - BOXH / 2;
    out.ghosts.push({ action: 'add-area', x, y: gy, w: COLW * 0.72, h: BOXH, label: 'Bereich hinzufügen', ctx: {}, stub: bb ? [x + BX, Y_BB] : null });
    if (bb) bbNodes.push([x + BX, Y_BB]);
    x += COLW * 0.72 + COLGAP;
  }

  if (bb && bbNodes.length) {
    const xs = [...new Set(bbNodes.map((n) => n[0]))].sort((a, b) => a - b);
    if (xs.length === 1) xs.push(xs[0] + COLW);
    bbGeo.chain(xs.map((v) => [v, Y_BB]));
    bbGeo.label = { x: xs[0], y: Y_BB, text: 'Bereichslinie 0.0', medium: p.backbone.medium };
  }

  // Geräte-Anschlüsse an Hauptlinien und Backbone wurden über stack() angelegt
  out.width = Math.max(x + MARGIN, 900);
  out.height = bottom + 150;
  out.titleBlock = { x: out.width - MARGIN - 330, y: bottom + 40, w: 330, h: 92 };
  out.legend = { x: MARGIN, y: bottom + 40 };
  out.Y = { Y_BB, BK_TOP, Y_MAIN, LK_TOP };
  return out;
}

// Weg auf einem Bus zwischen zwei Knoten als Punktliste
export function busPath(lay, busId, fromNode, toNode) {
  const geo = lay.bus.get(busId);
  if (!geo) return null;
  const keys = geo.path(fromNode, toNode);
  return keys ? keys.map((k) => k.split(',').map(Number)) : null;
}
