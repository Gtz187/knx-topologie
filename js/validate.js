// Prüfregeln für die Topologie. Liefert eine Liste von Hinweisen mit Bezug zum Element.
import { buses, addressables, fmtPA, couplerKind, DEVICE_TYPES } from './model.js';

const MAX_TLN_SEGMENT = 64;

export function validate(p) {
  const out = [];
  const add = (level, text, ref) => out.push({ level, text, ref });

  // Doppelte Adressen
  const seen = new Map();
  for (const x of addressables(p)) {
    const k = fmtPA(x.a, x.l, x.d);
    if (!seen.has(k)) seen.set(k, []);
    seen.get(k).push(x);
  }
  for (const [k, list] of seen) {
    if (list.length > 1) {
      const names = list.map((x) => (x.kind === 'tunnel' ? `Tunnel von ${x.el.name || 'Gerät'}` : x.el.name || 'Koppler')).join(', ');
      add('error', `Adresse ${k} ist mehrfach vergeben: ${names}.`, list[1].el.id);
    }
  }

  for (const x of addressables(p)) {
    if (x.d > 255 || x.d < 0) add('error', `Teilnehmernummer ${x.d} ist ungültig (0–255).`, x.el.id);
    if (x.kind === 'device' && x.d === 0) add('error', `${x.el.name || 'Gerät'}: Teilnehmernummer 0 ist für den Koppler reserviert.`, x.el.id);
  }

  // Bereiche und Linien
  const areaNums = new Map();
  for (const ar of p.areas) {
    if (areaNums.has(ar.area)) add('error', `Bereich ${ar.area} gibt es mehrfach.`, ar.id);
    areaNums.set(ar.area, true);
    if (ar.area < 1 || ar.area > 15) add('error', `Bereichsnummer ${ar.area} ist ungültig (1–15).`, ar.id);
    if (p.backbone.enabled) {
      const k = couplerKind('area', p.backbone.medium, ar.mainMedium);
      if (k.invalid) add('error', `Bereich ${ar.area}: ${k.label}. Stelle die Hauptlinie auf TP um.`, ar.id);
    } else if (p.areas.length > 1) {
      add('warn', `Bereich ${ar.area} ist ohne Bereichslinie mit keinem anderen Bereich verbunden.`, ar.id);
    }
    const lineNums = new Set();
    for (const ln of ar.lines) {
      if (lineNums.has(ln.line)) add('error', `Linie ${ar.area}.${ln.line} gibt es mehrfach.`, ln.id);
      lineNums.add(ln.line);
      if (ln.line < 1 || ln.line > 15) add('error', `Liniennummer ${ln.line} ist ungültig (1–15).`, ln.id);
      if (!ln.noCoupler) {
        const k = couplerKind('line', ar.mainMedium, ln.medium);
        if (k.invalid) add('error', `Linie ${ar.area}.${ln.line}: ${k.label}.`, ln.id);
      } else if (ar.lines.length > 1 || ar.mainDevices.length || p.backbone.enabled) {
        add('warn', `Linie ${ar.area}.${ln.line} hat keinen Koppler und ist vom Rest der Anlage getrennt.`, ln.id);
      }
      if (ln.segments.length > 4) add('error', `Linie ${ar.area}.${ln.line}: Mehr als 4 Segmente sind nicht zulässig.`, ln.id);
      const total = ln.segments.reduce((n, s) => n + s.devices.filter((d) => DEVICE_TYPES[d.type].addr).length, 0);
      if (total > 255) add('error', `Linie ${ar.area}.${ln.line} hat ${total} Geräte – mehr als 255 sind nicht adressierbar.`, ln.id);
    }
    if (!ar.lines.length && !ar.mainDevices.length) add('info', `Bereich ${ar.area} ist noch leer.`, ar.id);
  }

  // Busse: Spannungsversorgung, Last, Medium
  for (const b of buses(p)) {
    const label = b.kind === 'backbone' ? 'Bereichslinie' : b.kind === 'main' ? `Hauptlinie ${b.a}.0` : `Linie ${b.a}.${b.l}${b.segIndex ? `, Segment ${b.segIndex + 1}` : ''}`;
    const ref = b.kind === 'segment' ? (b.segIndex ? b.owner.id : b.line.id) : b.kind === 'main' ? b.area.id : 'bb';
    for (const d of b.devices) {
      if (!DEVICE_TYPES[d.type].media.includes(b.medium)) {
        add('error', `${d.name || DEVICE_TYPES[d.type].label} passt nicht auf ${b.medium} (${label}).`, d.id);
      }
      if (d.type === 'IPI' && b.medium === 'TP' && !(d.tunnels || []).length) {
        add('info', `${d.name || 'IP-Schnittstelle'}: Keine Tunneladresse eingetragen.`, d.id);
      }
    }
    if (b.medium === 'TP') {
      const sv = b.devices.filter((d) => d.type === 'SV');
      const load = b.devices.filter((d) => d.type !== 'SV').length + couplersOn(p, b);
      const empty = load === 0;
      if (!sv.length && !empty) add('error', `${label}: Keine Spannungsversorgung – ohne SV funktioniert der TP-Bus nicht.`, ref);
      if (sv.length > 2) add('warn', `${label}: ${sv.length} Spannungsversorgungen – mehr als zwei pro Segment nur mit Abstand ≥ 200 m.`, ref);
      if (sv.length === 2) add('info', `${label}: Zwei Spannungsversorgungen – mindestens 200 m Leitung dazwischen einhalten.`, ref);
      if (load > MAX_TLN_SEGMENT) add('error', `${label}: ${load} Busteilnehmer – maximal ${MAX_TLN_SEGMENT} pro Segment.`, ref);
      const mA = sv.reduce((n, d) => n + (d.mA || 0), 0);
      if (sv.length && load * 10 > mA) add('warn', `${label}: ${load} Teilnehmer brauchen ca. ${load * 10} mA, die SV liefert nur ${mA} mA.`, ref);
    }
    if (b.medium === 'IP') {
      if (b.devices.some((d) => d.type === 'SV')) add('error', `${label}: IP braucht keine KNX-Spannungsversorgung.`, ref);
    }
  }

  // Gruppenadressen ohne Empfänger / ohne Sender
  const senders = new Map();
  const listeners = new Map();
  for (const b of buses(p)) for (const d of b.devices) {
    d.sends.forEach((g) => { if (!senders.has(g)) senders.set(g, d); });
    d.listens.forEach((g) => { if (!listeners.has(g)) listeners.set(g, d); });
  }
  for (const [g, d] of senders) if (!listeners.has(g)) add('info', `Auf ${g} sendet ${d.name || 'ein Gerät'}, aber niemand hört zu.`, d.id);
  for (const [g, d] of listeners) if (!senders.has(g)) add('info', `${d.name || 'Ein Gerät'} hört auf ${g}, aber niemand sendet darauf.`, d.id);

  const order = { error: 0, warn: 1, info: 2 };
  return out.sort((x, y) => order[x.level] - order[y.level]);
}

// Koppler zählen auf beiden Seiten als ein Busteilnehmer
function couplersOn(p, b) {
  let n = 0;
  if (b.kind === 'backbone') n += p.areas.length;
  if (b.kind === 'main') {
    if (p.backbone.enabled) n += 1;
    n += b.area.lines.filter((l) => !l.noCoupler).length;
  }
  if (b.kind === 'segment') {
    const segs = b.line.segments;
    const i = b.segIndex;
    if (i === 0 && !b.line.noCoupler) n += 1;
    if (i > 0) n += 1;
    if (i < segs.length - 1) n += 1;
  }
  return n;
}
