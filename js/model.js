// Datenmodell, Gerätekatalog, Adressvergabe und Vorlagen.
// Die Geräte speichern nur ihre Teilnehmernummer – Bereich und Linie ergeben
// sich aus der Position im Baum. So passt 1.1.x immer zum Linienkoppler 1.1.0.

export const MEDIA = {
  TP: { label: 'TP', long: 'Twisted Pair' },
  IP: { label: 'IP', long: 'KNXnet/IP' },
  RF: { label: 'RF', long: 'Funk (868 MHz)' },
};

// Gerätetypen. `media` = auf welchen Medien das Gerät vorkommen darf.
export const DEVICE_TYPES = {
  TLN: { label: 'Teilnehmer', short: 'TLN', media: ['TP', 'IP', 'RF'], addr: true },
  SV:  { label: 'Spannungsversorgung', short: 'SV', media: ['TP'], addr: false },
  PI:  { label: 'Programmierschnittstelle (USB)', short: 'USB', media: ['TP'], addr: true },
  IPI: { label: 'KNX IP-Schnittstelle', short: 'IP-S', media: ['TP', 'IP'], addr: true, tunnels: true },
  SW:  { label: 'LAN-Switch', short: 'Switch', media: ['IP'], addr: false },
  RFR: { label: 'RF-Repeater', short: 'RF-Rep', media: ['RF'], addr: true },
};

export const CATEGORIES = {
  taster: 'Taster',
  aktor: 'Schaltaktor',
  dimmer: 'Dimmaktor',
  jalousie: 'Jalousieaktor',
  heizung: 'Heizungsaktor',
  praesenz: 'Präsenzmelder',
  sensor: 'Sensor',
  wetter: 'Wetterstation',
  display: 'Display / Visu',
  logik: 'Logikmodul',
  sonstiges: 'Sonstiges',
};

export const FILTER_MODES = {
  filter: 'Filtern',
  route: 'Alles weiterleiten',
  block: 'Sperren',
};

let idCounter = 0;
export const uid = (p = 'n') => `${p}${Date.now().toString(36)}${(idCounter++).toString(36)}`;

export function newCoupler(extra = {}) {
  return {
    id: uid('c'),
    name: '',
    group: 'filter',   // Gruppentelegramme
    phys: 'filter',    // physikalisch adressierte Telegramme
    bc: 'route',       // Broadcast
    autoTable: true,   // Filtertabelle aus den Geräten darunter erzeugen
    extraGAs: [],      // zusätzliche Einträge in der Filtertabelle
    ...extra,
  };
}

export function newDevice(type, extra = {}) {
  const d = { id: uid('d'), type, name: '', dev: null, sends: [], listens: [] };
  if (type === 'TLN') d.cat = 'aktor';
  if (type === 'SV') d.mA = 640;
  if (type === 'IPI') d.tunnels = [];
  return Object.assign(d, extra);
}

export function newSegment(kind = null, dev = null) {
  return {
    id: uid('s'),
    coupler: kind ? newCoupler({ kind, dev }) : null,
    devices: [],
  };
}

export function newLine(num, medium = 'TP') {
  return { id: uid('l'), line: num, name: '', medium, noCoupler: false, coupler: newCoupler(), segments: [newSegment()] };
}

export function newArea(num, mainMedium = 'TP') {
  return { id: uid('a'), area: num, name: '', mainMedium, coupler: newCoupler(), mainDevices: [], lines: [] };
}

export function newProject(name = 'Neues Projekt') {
  return {
    format: 'knx-topologie',
    version: 1,
    name,
    author: '',
    date: new Date().toISOString().slice(0, 10),
    backbone: { enabled: true, medium: 'IP', devices: [] },
    areas: [],
  };
}

// ---------- Adressen ----------

export const fmtPA = (a, l, d) => `${a}.${l}.${d}`;

export function parsePA(s) {
  const m = String(s).trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{1,3})$/);
  if (!m) return null;
  const [a, l, d] = m.slice(1).map(Number);
  if (a > 15 || l > 15 || d > 255) return null;
  return { a, l, d };
}

// Gruppenadressen: 3-stufig (0–31/0–7/0–255), 2-stufig (0–31/0–2047) oder frei (0–65535)
export function parseGA(s) {
  const t = String(s).trim();
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{1,3})$/);
  if (m) {
    const [h, mi, u] = m.slice(1).map(Number);
    if (h > 31 || mi > 7 || u > 255) return null;
    return (h << 11) | (mi << 8) | u;
  }
  m = t.match(/^(\d{1,2})\/(\d{1,4})$/);
  if (m) {
    const [h, u] = m.slice(1).map(Number);
    if (h > 31 || u > 2047) return null;
    return (h << 11) | u;
  }
  return null;
}

export const fmtGA = (n) => `${n >> 11}/${(n >> 8) & 7}/${n & 255}`;

export function normalizeGA(s) {
  const n = parseGA(s);
  return n === null ? null : fmtGA(n);
}

export function parseGAList(text) {
  const ok = [];
  const bad = [];
  for (const part of String(text).split(/[\s,;]+/).filter(Boolean)) {
    const g = normalizeGA(part);
    if (g) { if (!ok.includes(g)) ok.push(g); } else bad.push(part);
  }
  return { ok, bad };
}

// ---------- Kopplertypen aus den Medien ableiten ----------

export function couplerKind(level, upper, lower) {
  if (level === 'area') {
    if (upper === 'TP' && lower === 'TP') return { short: 'BK', label: 'Bereichskoppler' };
    if (upper === 'IP' && lower === 'TP') return { short: 'IP-R', label: 'KNX IP-Router als Bereichskoppler' };
    if (upper === 'IP' && lower === 'IP') return { short: 'IP', label: 'IP-Hauptlinie direkt am IP-Backbone', invalid: true };
    return { short: '?', label: 'Diese Medienkombination ist nicht vorgesehen', invalid: true };
  }
  if (upper === 'TP' && lower === 'TP') return { short: 'LK', label: 'Linienkoppler' };
  if (upper === 'IP' && lower === 'TP') return { short: 'IP-R', label: 'KNX IP-Router als Linienkoppler' };
  if (upper === 'TP' && lower === 'RF') return { short: 'MK', label: 'Medienkoppler TP/RF' };
  if (upper === 'IP' && lower === 'RF') return { short: 'IP/RF', label: 'KNX IP/RF-Medienkoppler' };
  if (upper === 'IP' && lower === 'IP') return { short: 'IP-R', label: 'KNX IP-Router (IP/IP)', invalid: true };
  return { short: '?', label: 'Diese Medienkombination ist nicht vorgesehen', invalid: true };
}

export const SEG_KINDS = {
  LV: { short: 'LV', label: 'Linienverstärker' },
  SK: { short: 'SK', label: 'Segmentkoppler' },
};

// ---------- Durchlaufen des Baums ----------

// Liefert alle "Busse" (Leitungsabschnitte) mit ihren Geräten.
// Jeder Bus kennt Bereich/Linie für die Adressbildung.
export function buses(p) {
  const out = [];
  if (p.backbone.enabled) {
    out.push({ id: 'bb', kind: 'backbone', medium: p.backbone.medium, a: 0, l: 0, devices: p.backbone.devices, owner: p.backbone });
  }
  for (const ar of p.areas) {
    out.push({ id: `${ar.id}:main`, kind: 'main', medium: ar.mainMedium, a: ar.area, l: 0, devices: ar.mainDevices, owner: ar, area: ar });
    for (const ln of ar.lines) {
      ln.segments.forEach((sg, i) => {
        out.push({ id: sg.id, kind: 'segment', medium: ln.medium, a: ar.area, l: ln.line, devices: sg.devices, owner: sg, area: ar, line: ln, segIndex: i });
      });
    }
  }
  return out;
}

// Alle Elemente mit Adresse (Geräte und Koppler), praktisch für Prüfung und Simulation.
export function addressables(p) {
  const list = [];
  for (const b of buses(p)) {
    for (const d of b.devices) {
      if (DEVICE_TYPES[d.type].addr && d.dev !== null && d.dev !== undefined) {
        list.push({ kind: 'device', el: d, a: b.a, l: b.l, d: d.dev, bus: b });
      }
      for (const t of d.tunnels || []) {
        list.push({ kind: 'tunnel', el: d, a: b.a, l: b.l, d: t, bus: b });
      }
    }
  }
  const tun = (c, a, l) => (c.tunnels || []).forEach((t) => list.push({ kind: 'tunnel', el: c, a, l, d: t }));
  for (const ar of p.areas) {
    if (p.backbone.enabled) {
      list.push({ kind: 'coupler', el: ar.coupler, owner: ar, a: ar.area, l: 0, d: 0 });
      tun(ar.coupler, ar.area, 0);
    }
    for (const ln of ar.lines) {
      if (!ln.noCoupler) {
        list.push({ kind: 'coupler', el: ln.coupler, owner: ln, a: ar.area, l: ln.line, d: 0 });
        tun(ln.coupler, ar.area, ln.line);
      }
      ln.segments.forEach((sg) => {
        if (sg.coupler && sg.coupler.dev !== null) list.push({ kind: 'coupler', el: sg.coupler, owner: sg, a: ar.area, l: ln.line, d: sg.coupler.dev });
      });
    }
  }
  return list;
}

// Belegte Teilnehmernummern einer Linie (Bereich a, Linie l)
export function usedNumbers(p, a, l) {
  const used = new Set();
  for (const x of addressables(p)) if (x.a === a && x.l === l) used.add(x.d);
  return used;
}

// Vorschlag für die nächste freie Nummer.
// Segment 0 nutzt 1–63, Segment s nutzt 64·s+1 … 64·s+63 (klassische Aufteilung mit Linienverstärkern).
export function nextFreeNumber(p, a, l, segIndex = 0) {
  const used = usedNumbers(p, a, l);
  const ranges = [];
  const lo = segIndex * 64 + 1;
  ranges.push([lo, Math.min(lo + 62, 254)]);
  ranges.push([1, 254]);
  for (const [from, to] of ranges) {
    for (let n = from; n <= to; n++) if (!used.has(n)) return n;
  }
  return null;
}

// Tunneladressen werden von oben (255 abwärts) vergeben, wie es die meisten Hersteller vorschlagen.
export function nextTunnelNumbers(p, a, l, count) {
  const used = usedNumbers(p, a, l);
  const out = [];
  for (let n = 255; n >= 1 && out.length < count; n--) if (!used.has(n)) out.push(n);
  return out.sort((x, y) => x - y);
}

export function nextAreaNumber(p) {
  const used = new Set(p.areas.map((a) => a.area));
  for (let n = 1; n <= 15; n++) if (!used.has(n)) return n;
  return null;
}

export function nextLineNumber(area) {
  const used = new Set(area.lines.map((l) => l.line));
  for (let n = 1; n <= 15; n++) if (!used.has(n)) return n;
  return null;
}

// Medium, an dem ein Bus hängt (für erlaubte Gerätetypen)
export function allowedTypes(medium) {
  return Object.entries(DEVICE_TYPES).filter(([, t]) => t.media.includes(medium)).map(([k]) => k);
}

export function defaultName(dev, medium) {
  if (dev.type === 'TLN') return CATEGORIES[dev.cat] || 'Teilnehmer';
  if (dev.type === 'SV') return `Spannungsversorgung ${dev.mA} mA`;
  if (dev.type === 'IPI' && medium === 'IP') return 'KNX IP-Gerät (Tunnel)';
  return DEVICE_TYPES[dev.type].label;
}

// Gerät an einen Bus hängen, inkl. sinnvoller Adresse
export function addDevice(p, bus, type, extra = {}) {
  const d = newDevice(type, extra);
  if (DEVICE_TYPES[type].addr && d.dev === null) {
    d.dev = type === 'PI' ? pickHigh(p, bus) : nextFreeNumber(p, bus.a, bus.l, bus.segIndex || 0);
  }
  if (type === 'IPI' && !extra.tunnels) {
    d.tunnels = nextTunnelNumbers(p, bus.a, bus.l, 1).filter((n) => n !== d.dev);
  }
  bus.devices.push(d);
  return d;
}

function pickHigh(p, bus) {
  const used = usedNumbers(p, bus.a, bus.l);
  for (let n = 255; n >= 1; n--) if (!used.has(n)) return n;
  return null;
}

// Findet zu einer ID das Element und seinen Kontext
export function findById(p, id) {
  if (!id) return null;
  if (id === 'bb') return { kind: 'backbone', el: p.backbone };
  for (const b of buses(p)) {
    const i = b.devices.findIndex((d) => d.id === id);
    if (i >= 0) return { kind: 'device', el: b.devices[i], bus: b, index: i };
  }
  for (const ar of p.areas) {
    if (ar.id === id || ar.coupler.id === id) return { kind: 'area', el: ar };
    for (const ln of ar.lines) {
      if (ln.id === id || ln.coupler.id === id) return { kind: 'line', el: ln, area: ar };
      for (let i = 0; i < ln.segments.length; i++) {
        const sg = ln.segments[i];
        if (sg.id === id || (sg.coupler && sg.coupler.id === id)) return { kind: 'segment', el: sg, line: ln, area: ar, index: i };
      }
    }
  }
  return null;
}

export function busById(p, id) {
  return buses(p).find((b) => b.id === id) || null;
}

// Alle Gruppenadressen, die im Projekt vorkommen
export function allGAs(p) {
  const set = new Set();
  for (const b of buses(p)) for (const d of b.devices) [...d.sends, ...d.listens].forEach((g) => set.add(g));
  return [...set].sort((x, y) => parseGA(x) - parseGA(y));
}

export function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

// Projekt aus JSON übernehmen und fehlende Felder ergänzen
export function sanitize(raw) {
  if (!raw || raw.format !== 'knx-topologie') throw new Error('Die Datei ist kein KNX-Topologie-Projekt.');
  const p = Object.assign(newProject(), raw);
  p.backbone = Object.assign({ enabled: true, medium: 'IP', devices: [] }, raw.backbone);
  const fixDev = (d) => ({ ...d, sends: d.sends || [], listens: d.listens || [] });
  const fixC = (c, extra) => Object.assign(newCoupler(extra), c);
  p.backbone.devices = p.backbone.devices.map(fixDev);
  p.areas = (raw.areas || []).map((ar) => ({
    ...newArea(ar.area), ...ar,
    coupler: fixC(ar.coupler),
    mainDevices: (ar.mainDevices || []).map(fixDev),
    lines: (ar.lines || []).map((ln) => ({
      ...newLine(ln.line), ...ln,
      coupler: fixC(ln.coupler),
      segments: (ln.segments && ln.segments.length ? ln.segments : [newSegment()]).map((sg) => ({
        id: sg.id || uid('s'),
        coupler: sg.coupler ? fixC(sg.coupler) : null,
        devices: (sg.devices || []).map(fixDev),
      })),
    })),
  }));
  return p;
}
