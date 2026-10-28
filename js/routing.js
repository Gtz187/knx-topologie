// Telegramm-Simulation: berechnet, welchen Weg ein Telegramm durch die
// Topologie nimmt und an welchem Koppler es weitergeleitet oder gesperrt wird.
// Reine Logik ohne DOM, damit sie auch in Node getestet werden kann.
import { buses, addressables, parsePA, fmtPA, couplerKind, SEG_KINDS, FILTER_MODES } from './model.js';

// Koppler als Kanten zwischen zwei Bussen
export function couplerGraph(p) {
  const bl = buses(p);
  const byOwner = new Map(bl.map((b) => [b.owner, b]));
  const edges = [];
  for (const ar of p.areas) {
    const main = byOwner.get(ar);
    const areaBuses = [main.id];
    for (const ln of ar.lines) for (const sg of ln.segments) areaBuses.push(sg.id);
    if (p.backbone.enabled) {
      const k = couplerKind('area', p.backbone.medium, ar.mainMedium);
      edges.push({
        id: ar.coupler.id, c: ar.coupler, level: 'area', upper: 'bb', lower: main.id,
        below: new Set(areaBuses), addr: { a: ar.area, l: 0, d: 0 }, kind: k,
        inside: (pa) => pa.a === ar.area,
        name: ar.coupler.name || `${k.label} ${ar.area}.0.0`,
      });
    }
    for (const ln of ar.lines) {
      const segIds = ln.segments.map((s) => s.id);
      if (!ln.noCoupler) {
        const k = couplerKind('line', ar.mainMedium, ln.medium);
        edges.push({
          id: ln.coupler.id, c: ln.coupler, level: 'line', upper: main.id, lower: segIds[0],
          below: new Set(segIds), addr: { a: ar.area, l: ln.line, d: 0 }, kind: k,
          inside: (pa) => pa.a === ar.area && pa.l === ln.line,
          name: ln.coupler.name || `${k.label} ${ar.area}.${ln.line}.0`,
        });
      }
      ln.segments.forEach((sg, i) => {
        if (i === 0 || !sg.coupler) return;
        const below = new Set(segIds.slice(i));
        const k = SEG_KINDS[sg.coupler.kind] || SEG_KINDS.LV;
        edges.push({
          id: sg.coupler.id, c: sg.coupler, level: 'segment', upper: segIds[i - 1], lower: sg.id,
          below, addr: sg.coupler.dev !== null ? { a: ar.area, l: ln.line, d: sg.coupler.dev } : null,
          kind: k, repeater: sg.coupler.kind === 'LV',
          inside: (pa) => insideSegments(p, pa, ar, ln, below, sg.coupler.dev),
          name: sg.coupler.name || `${k.label} ${ar.area}.${ln.line}.${sg.coupler.dev ?? '–'}`,
        });
      });
    }
  }
  return { buses: bl, edges };
}

// Für Segmentkoppler entscheidet der tatsächliche Einbauort des Ziels.
function insideSegments(p, pa, ar, ln, below, ownDev) {
  if (pa.a !== ar.area || pa.l !== ln.line) return false;
  const hit = addressables(p).find((x) => x.a === pa.a && x.l === pa.l && x.d === pa.d && x.bus);
  if (hit) return below.has(hit.bus.id);
  return pa.d >= (ownDev ?? 64);
}

// Filtertabelle eines Kopplers: alle Gruppenadressen, die unterhalb benutzt werden, plus manuelle Einträge.
export function filterTable(p, edge, graph = couplerGraph(p)) {
  const set = new Set(edge.c.extraGAs || []);
  if (edge.c.autoTable !== false) {
    for (const b of graph.buses) {
      if (!edge.below.has(b.id)) continue;
      for (const d of b.devices) [...d.sends, ...d.listens].forEach((g) => set.add(g));
    }
  }
  return set;
}

const samePA = (x, pa) => x.a === pa.a && x.l === pa.l && x.d === pa.d;

/**
 * Simuliert ein Telegramm.
 * @param {object} p Projekt
 * @param {object} t { senderId, type: 'group'|'phys'|'bc', ga, dest, rc }
 * @returns {{ steps, buses, receivers, log, ok }}
 */
export function simulate(p, t) {
  const graph = couplerGraph(p);
  const log = [];
  const steps = []; // zeitlich geordnete Ereignisse für die Animation
  const receivers = [];
  const reached = new Map(); // busId → { t, rc, via }

  const senderBus = graph.buses.find((b) => b.devices.some((d) => d.id === t.senderId));
  if (!senderBus) return { ok: false, steps, buses: reached, receivers, log: [{ level: 'error', text: 'Bitte zuerst einen Sender auswählen.' }] };
  const sender = senderBus.devices.find((d) => d.id === t.senderId);
  const senderPA = sender.dev !== null && sender.dev !== undefined ? fmtPA(senderBus.a, senderBus.l, sender.dev) : (sender.tunnels?.[0] !== undefined ? fmtPA(senderBus.a, senderBus.l, sender.tunnels[0]) : '–');

  let destPA = null;
  if (t.type === 'phys') {
    destPA = parsePA(t.dest);
    if (!destPA) return { ok: false, steps, buses: reached, receivers, log: [{ level: 'error', text: `„${t.dest}“ ist keine gültige physikalische Adresse (Format 1.1.5).` }] };
  }
  if (t.type === 'group' && !t.ga) return { ok: false, steps, buses: reached, receivers, log: [{ level: 'error', text: 'Bitte eine Gruppenadresse angeben (z. B. 1/0/1).' }] };

  const rc0 = Number.isInteger(t.rc) ? t.rc : 6;
  const what = t.type === 'group' ? `Gruppentelegramm an ${t.ga}` : t.type === 'phys' ? `Telegramm an ${fmtPA(destPA.a, destPA.l, destPA.d)}` : 'Broadcast';
  log.push({ level: 'info', text: `${sender.name || 'Gerät'} (${senderPA}) sendet ${what}, Routingzähler ${rc0}.`, ref: sender.id });

  const tables = new Map();
  const tableOf = (e) => {
    if (!tables.has(e.id)) tables.set(e.id, filterTable(p, e, graph));
    return tables.get(e.id);
  };

  const all = addressables(p);
  const queue = [{ busId: senderBus.id, rc: rc0, t: 0, via: null }];
  reached.set(senderBus.id, { t: 0, rc: rc0, via: null });
  steps.push({ kind: 'send', t: 0, deviceId: sender.id, busId: senderBus.id });

  while (queue.length) {
    const cur = queue.shift();
    const bus = graph.buses.find((b) => b.id === cur.busId);
    steps.push({ kind: 'bus', t: cur.t, busId: bus.id, from: cur.via });

    // Empfänger auf diesem Bus
    for (const d of bus.devices) {
      if (d.id === sender.id) continue;
      let hit = false;
      if (t.type === 'group') hit = d.listens.includes(t.ga);
      else if (t.type === 'bc') hit = d.dev !== null && d.dev !== undefined;
      else hit = (d.dev !== null && samePA({ a: bus.a, l: bus.l, d: d.dev }, destPA)) || (d.tunnels || []).some((x) => samePA({ a: bus.a, l: bus.l, d: x }, destPA));
      if (hit) {
        receivers.push({ id: d.id, busId: bus.id });
        steps.push({ kind: 'receive', t: cur.t + 1, deviceId: d.id, busId: bus.id });
      }
    }

    // Angrenzende Koppler
    for (const e of graph.edges) {
      let dir = null;
      if (e.upper === bus.id) dir = 'down';
      else if (e.lower === bus.id) dir = 'up';
      if (!dir || e.id === cur.via) continue;
      const target = dir === 'down' ? e.lower : e.upper;
      if (reached.has(target)) continue;

      const d = decide(e, dir, t, destPA, cur.rc, tableOf);
      const arrow = dir === 'down' ? '↓' : '↑';
      steps.push({ kind: 'coupler', t: cur.t + 1, couplerId: e.id, dir, pass: d.pass, reason: d.reason, fromBus: bus.id, toBus: target, rcIn: cur.rc, rcOut: d.rc });
      log.push({
        level: d.pass ? 'pass' : 'block',
        text: `${arrow} ${e.name}: ${d.pass ? 'weitergeleitet' : 'gesperrt'} – ${d.reason}`,
        ref: e.id,
      });
      if (d.pass) {
        reached.set(target, { t: cur.t + 2, rc: d.rc, via: e.id });
        queue.push({ busId: target, rc: d.rc, t: cur.t + 2, via: e.id });
      }
    }
  }

  // Koppler selbst als Ziel (z. B. beim Programmieren eines Linienkopplers)
  if (destPA) {
    for (const e of graph.edges) {
      if (e.addr && samePA(e.addr, destPA) && (reached.has(e.upper) || reached.has(e.lower))) {
        receivers.push({ id: e.id, coupler: true });
        const side = reached.has(e.lower) ? e.lower : e.upper;
        steps.push({ kind: 'receive', t: reached.get(side).t + 1, couplerId: e.id, busId: side });
      }
    }
  }
  steps.sort((x, y) => x.t - y.t);
  const rcv = receivers.length;
  if (t.type === 'group') {
    const missing = [];
    for (const b of graph.buses) {
      if (reached.has(b.id)) continue;
      for (const d of b.devices) if (d.listens.includes(t.ga)) missing.push(d);
    }
    log.push({ level: rcv ? 'ok' : 'warn', text: rcv ? `${rcv} Empfänger erreicht.` : 'Kein Gerät hört auf diese Gruppenadresse.' });
    if (missing.length) {
      log.push({ level: 'warn', text: `Nicht erreicht: ${missing.map((m) => m.name || 'Gerät').join(', ')} – diese Geräte hören auf ${t.ga}, das Telegramm kommt aber nicht bis zu ihnen.`, ref: missing[0].id });
    }
  } else if (t.type === 'phys') {
    const exists = all.some((x) => samePA(x, destPA));
    log.push({ level: rcv ? 'ok' : 'warn', text: rcv ? 'Ziel erreicht.' : exists ? 'Ziel nicht erreicht – das Telegramm wurde unterwegs gesperrt.' : `Es gibt kein Gerät mit der Adresse ${t.dest}.` });
  } else {
    log.push({ level: 'ok', text: `${rcv} Geräte haben den Broadcast empfangen.` });
  }

  return { ok: true, steps, buses: reached, receivers, log };
}

function decide(e, dir, t, destPA, rc, tableOf) {
  // Routingzähler: 7 wird nie heruntergezählt, 0 bedeutet Ende.
  if (rc === 0) return { pass: false, rc, reason: 'Routingzähler ist 0' };
  const next = rc === 7 ? 7 : rc - 1;
  const rcText = rc === 7 ? 'Routingzähler 7 (unbegrenzt)' : `Routingzähler ${rc} → ${next}`;

  if (e.repeater) return { pass: true, rc: next, reason: `Linienverstärker leitet alles weiter, ${rcText}` };

  const c = e.c;
  if (t.type === 'bc') {
    if (c.bc === 'block') return { pass: false, rc, reason: 'Broadcasts sind gesperrt' };
    return { pass: true, rc: next, reason: `Broadcast, ${rcText}` };
  }
  if (t.type === 'group') {
    if (c.group === 'block') return { pass: false, rc, reason: 'Gruppentelegramme sind gesperrt' };
    if (c.group === 'route') return { pass: true, rc: next, reason: `${FILTER_MODES.route}, ${rcText}` };
    if (tableOf(e).has(t.ga)) return { pass: true, rc: next, reason: `${t.ga} steht in der Filtertabelle, ${rcText}` };
    return { pass: false, rc, reason: `${t.ga} steht nicht in der Filtertabelle` };
  }
  // physikalisch adressiert
  if (c.phys === 'block') return { pass: false, rc, reason: 'Physikalische Telegramme sind gesperrt' };
  if (e.addr && samePA(e.addr, destPA)) return { pass: false, rc, reason: 'Telegramm ist an den Koppler selbst gerichtet' };
  if (c.phys === 'route') return { pass: true, rc: next, reason: `${FILTER_MODES.route}, ${rcText}` };
  const inside = e.inside(destPA);
  if (dir === 'down' && inside) return { pass: true, rc: next, reason: `Ziel liegt unterhalb, ${rcText}` };
  if (dir === 'up' && !inside) return { pass: true, rc: next, reason: `Ziel liegt außerhalb, ${rcText}` };
  return { pass: false, rc, reason: dir === 'down' ? 'Ziel liegt nicht unterhalb' : 'Ziel liegt auf dieser Seite' };
}
