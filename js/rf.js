// Funkausbreitung in einer RF-Linie: Positionen in Metern, Hindernisse als
// Strecken. Eine Wand verdoppelt die "gefühlte" Entfernung, Beton/Metall blockt.
// Netzgeräte mit Repeater-Funktion senden ein empfangenes Telegramm einmal neu.
import { uid } from './model.js';

export const OBSTACLES = {
  wall: { label: 'Wand (dämpft)', factor: 2 },
  concrete: { label: 'Beton / Metall (blockt)', factor: Infinity },
};

export const RF_DEFAULTS = { w: 30, h: 18, range: 22, batteryRange: 18 };

// Batteriegeräte senden nur – typisch für Taster und Melder
const BATTERY_CATS = new Set(['taster', 'praesenz', 'sensor', 'wetter']);

export function ensureRF(line) {
  if (!line.rf) line.rf = { w: RF_DEFAULTS.w, h: RF_DEFAULTS.h, obstacles: [], mk: null };
  const rf = line.rf;
  rf.obstacles ||= [];
  if (!rf.mk) rf.mk = { x: 1.5, y: 1.5 };
  const devs = line.segments.flatMap((s) => s.devices);
  devs.forEach((d, i) => {
    if (!d.power) d.power = d.type === 'TLN' && BATTERY_CATS.has(d.cat) ? 'battery' : 'mains';
    if (d.type === 'RFR') { d.power = 'mains'; d.repeat = true; }
    if (!d.pos) d.pos = freeSpot(rf, devs, i);
  });
  return rf;
}

// Neue Geräte auf freie Rasterplätze verteilen (3 Spalten, 6 m Zeilenabstand)
function freeSpot(rf, devs, i) {
  const cols = 3;
  const used = devs.filter((d) => d.pos).map((d) => d.pos);
  for (let n = i; n < i + 60; n++) {
    const x = Math.round(rf.w / 6 + (n % cols) * (rf.w / cols));
    const y = Math.min(rf.h - 2, 4 + Math.floor(n / cols) * 6 + (n % 2) * 2);
    if (!used.some((u) => Math.hypot(u.x - x, u.y - y) < 3)) return { x, y };
  }
  return { x: rf.w / 2, y: rf.h / 2 };
}

export const canReceive = (d) => d.power !== 'battery';
export const rangeOf = (d) => d.range || (d.power === 'battery' ? RF_DEFAULTS.batteryRange : RF_DEFAULTS.range);

function segX(a, b, c, d) {
  const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (Math.abs(den) < 1e-9) return false;
  const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den;
  const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den;
  return t > 0 && t < 1 && u >= 0 && u <= 1 ? { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) } : false;
}

// Verbindung zwischen zwei Punkten: Entfernung, durchquerte Hindernisse, wirksame Entfernung
export function link(rf, a, b) {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const hits = [];
  let factor = 1;
  for (const o of rf.obstacles) {
    const p = segX(a, b, { x: o.x1, y: o.y1 }, { x: o.x2, y: o.y2 });
    if (p) { hits.push({ id: o.id, kind: o.kind, at: p }); factor *= OBSTACLES[o.kind]?.factor ?? 1; }
  }
  return { dist, hits, eff: dist * factor };
}

/**
 * Breitet ein Funktelegramm aus.
 * @param line RF-Linie (mit rf und Geräten)
 * @param from { device: id } oder { coupler: true } für den Medienkoppler
 * @param couplerOn ob der Medienkoppler eingeschaltet ist
 * @returns {{ waves, reached: Set, parent: Map, coupler: boolean }}
 *   waves: [{ from, pos, range, level, links: [{ to, pos, ok, dist, eff, hits }] }]
 */
export function propagate(line, from, couplerOn = true) {
  const rf = ensureRF(line);
  const devs = line.segments.flatMap((s) => s.devices);
  const nodes = devs.map((d) => ({ ref: { device: d.id }, d, pos: d.pos }));
  const mk = { ref: { coupler: true }, pos: rf.mk, mk: true };
  const all = line.noCoupler ? nodes : [...nodes, mk];
  const start = from.coupler ? mk : nodes.find((n) => n.d.id === from.device);
  if (!start) return { waves: [], reached: new Set(), coupler: false };

  const reached = new Set([key(start.ref)]);
  const parent = new Map(); // wer hat wen zuerst erreicht – auf diesem Weg läuft die Quittung zurück
  const repeated = new Set();
  const waves = [];
  let front = [{ node: start, level: 0 }];
  while (front.length) {
    const next = [];
    for (const { node, level } of front) {
      const range = node.mk ? RF_DEFAULTS.range : rangeOf(node.d);
      const wave = { from: node.ref, pos: node.pos, range, level, links: [] };
      for (const n of all) {
        if (n === node) continue;
        const l = link(rf, node.pos, n.pos);
        const listens = n.mk ? couplerOn : canReceive(n.d) && !n.d.off;
        const ok = l.eff <= range && listens;
        wave.links.push({ to: n.ref, pos: n.pos, ok, dist: l.dist, eff: l.eff, hits: l.hits, deaf: !listens, inRange: l.eff <= range });
        if (ok && !reached.has(key(n.ref))) {
          reached.add(key(n.ref));
          parent.set(key(n.ref), node.ref);
          // Repeater (Netzgeräte mit Weiterleitung) senden einmal neu
          if (!n.mk && n.d.repeat && n.d.power !== 'battery' && !repeated.has(n.d.id)) {
            repeated.add(n.d.id);
            next.push({ node: n, level: level + 1 });
          }
        }
      }
      waves.push(wave);
    }
    front = next;
  }
  return { waves, reached, parent, coupler: reached.has('mk') };
}

export const key = (ref) => (ref.coupler ? 'mk' : ref.device);

export function newObstacle(kind, x1, y1, x2, y2) {
  return { id: uid('o'), kind, x1, y1, x2, y2 };
}
