// Telegramm-Simulation: berechnet, welchen Weg ein Telegramm durch die
// Topologie nimmt und an welchem Koppler es weitergeleitet oder gesperrt wird.
// Reine Logik ohne DOM, damit sie auch in Node getestet werden kann.
import { propagate, key as rfKey } from './rf.js';
import { buses, addressables, parsePA, fmtPA, couplerKind, SEG_KINDS, FILTER_MODES, DEVICE_TYPES } from './model.js';

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

// Zeitbasis der Simulation in "Telegrammlängen": tx = Telegramm auf einer Linie,
// ack = Quittung, proc = Verarbeitung im Koppler, wait = Wartezeit vor einer Wiederholung.
export const TIMING = { tx: 1, ack: 0.6, proc: 0.3, wait: 0.5, slot: 0.3 };
export const MAX_REPEATS = 3;

/**
 * Simuliert ein Telegramm mit Quittungen und Wiederholungen.
 * Auf TP quittieren alle angesprochenen Empfänger gleichzeitig; ein Koppler, der
 * weiterleitet, quittiert auf seiner Seite und sendet das Telegramm auf der
 * anderen Seite neu. Ohne Quittung wiederholt der Sender bis zu dreimal.
 * Über IP (Routing per Multicast) und KNX RF Ready gibt es keine Schicht-2-Quittung,
 * KNX RF Multi quittiert per Fast-Ack in Zeitschlitzen.
 * @param {object} p Projekt
 * @param {object} t { senderId, type: 'group'|'phys'|'bc', ga, dest, rc }
 * @returns {{ ok, events, buses, receivers, log }}
 */
export function simulate(p, t) {
  const graph = couplerGraph(p);
  const log = [];
  const events = [];
  const receivers = [];
  const reached = new Map();
  const fail = (text) => ({ ok: false, events, buses: reached, receivers, log: [{ level: 'error', text }] });

  const senderBus = graph.buses.find((b) => b.devices.some((d) => d.id === t.senderId));
  if (!senderBus) return fail('Bitte zuerst einen Sender auswählen.');
  const sender = senderBus.devices.find((d) => d.id === t.senderId);
  if (sender.off) return fail(`${sender.name || 'Das Gerät'} ist ausgeschaltet und kann nicht senden.`);
  const pa = (b, n) => (n !== null && n !== undefined ? fmtPA(b.a, b.l, n) : '–');
  const senderPA = sender.dev !== null && sender.dev !== undefined ? pa(senderBus, sender.dev) : pa(senderBus, sender.tunnels?.[0]);

  let destPA = null;
  if (t.type === 'phys') {
    destPA = parsePA(t.dest);
    if (!destPA) return fail(`„${t.dest}“ ist keine gültige physikalische Adresse (Format 1.1.5).`);
  }
  if (t.type === 'group' && !t.ga) return fail('Bitte eine Gruppenadresse angeben (z. B. 1/0/1).');

  const rc0 = Number.isInteger(t.rc) ? t.rc : 6;
  const what = t.type === 'group' ? `ein Gruppentelegramm an ${t.ga}` : t.type === 'phys' ? `ein Telegramm an ${fmtPA(destPA.a, destPA.l, destPA.d)}` : 'einen Broadcast';
  log.push({ level: 'info', text: `${sender.name || 'Gerät'} (${senderPA}) sendet ${what}.`, ref: sender.id });

  const tables = new Map();
  const tableOf = (e) => {
    if (!tables.has(e.id)) tables.set(e.id, filterTable(p, e, graph));
    return tables.get(e.id);
  };
  const busName = (b) => (b.kind === 'backbone' ? 'Bereichslinie' : b.kind === 'main' ? `Hauptlinie ${b.a}.0` : `Linie ${b.a}.${b.l}${b.segIndex ? `/${b.segIndex + 1}` : ''}`);
  const nameOf = (ref) => (ref.device ? (graph.buses.flatMap((b) => b.devices).find((d) => d.id === ref.device)?.name || 'Gerät') : graph.edges.find((e) => e.id === ref.coupler)?.name);

  const isAddressed = (d, bus) => {
    if (!DEVICE_TYPES[d.type].addr) return false;
    if (t.type === 'group') return d.listens.includes(t.ga);
    if (t.type === 'bc') return d.dev !== null && d.dev !== undefined;
    return (d.dev !== null && samePA({ a: bus.a, l: bus.l, d: d.dev }, destPA)) || (d.tunnels || []).some((x) => samePA({ a: bus.a, l: bus.l, d: x }, destPA));
  };

  const queue = [{ busId: senderBus.id, from: { device: sender.id }, t0: 0, rc: rc0, via: null }];
  reached.set(senderBus.id, { t: 0 });
  const T = TIMING;

  while (queue.length) {
    const cur = queue.shift();
    const bus = graph.buses.find((b) => b.id === cur.busId);
    const fromDev = cur.from.device;
    // TP quittiert immer; RF nur mit KNX RF Multi (Fast-Ack, eigene Zeitschlitze je Empfänger)
    const rfAck = bus.medium === 'RF' && bus.line?.rfAck;
    const quittung = bus.medium === 'TP' || rfAck;

    // Funk: wer ist in Reichweite? (Repeater senden nach)
    let radio = null;
    const levelOf = new Map();
    if (bus.medium === 'RF' && bus.line) {
      const lc = bus.line.noCoupler ? null : bus.line.coupler;
      radio = propagate(bus.line, fromDev ? { device: fromDev } : { coupler: true }, !(lc && lc.off));
      for (const w of radio.waves) for (const l of w.links) if (l.ok && !levelOf.has(rfKey(l.to))) levelOf.set(rfKey(l.to), w.level);
    }
    const rxTime = (k) => cur.t0 + (radio ? (levelOf.get(k) || 0) * (T.tx + T.proc) : 0) + T.tx;

    // Wer hängt an diesem Bus?
    const targets = [];
    for (const d of bus.devices) {
      if (d.id === fromDev || !DEVICE_TYPES[d.type].addr) continue;
      targets.push({ ref: { device: d.id }, d, addressed: isAddressed(d, bus) });
    }
    const adj = [];
    for (const e of graph.edges) {
      if (e.id === cur.via) continue;
      const side = e.upper === bus.id ? 'up' : e.lower === bus.id ? 'down' : null;
      if (!side) continue;
      if (radio && side === 'down' && fromDev && !radio.coupler) {
        log.push({ level: 'block', text: `${e.name} ist außer Funkreichweite – das Telegramm kommt nicht aus der RF-Linie heraus.`, ref: e.id, t: cur.t0 + T.tx });
        continue;
      }
      adj.push({ e, side, dir: side === 'up' ? 'down' : 'up' });
      targets.push({ ref: { coupler: e.id, side }, addressed: false });
    }

    // Entscheidungen beim ersten Empfang
    const ackers = [];
    const tRx = cur.t0 + T.tx;
    for (const x of targets) {
      if (!x.d || !x.addressed) continue;
      if (x.d.off) {
        events.push({ kind: 'off', t: tRx, ref: x.ref, busId: bus.id });
        log.push({ level: 'warn', text: `${x.d.name || 'Gerät'} ist ausgeschaltet und empfängt nichts.`, ref: x.d.id, t: tRx });
        continue;
      }
      if (radio && !levelOf.has(x.d.id)) {
        const why = x.d.power === 'battery' ? 'ist ein Batteriegerät und sendet nur' : 'ist außer Funkreichweite oder abgeschirmt';
        events.push({ kind: 'off', t: tRx, ref: x.ref, busId: bus.id, text: x.d.power === 'battery' ? 'nur Sender' : 'kein Empfang' });
        log.push({ level: 'warn', text: `${x.d.name || 'Gerät'} ${why}.`, ref: x.d.id, t: tRx });
        continue;
      }
      receivers.push({ id: x.d.id, busId: bus.id });
      events.push({ kind: 'rx', t: rxTime(x.d.id), ref: x.ref, busId: bus.id });
      ackers.push(x.ref);
    }
    const tDecide = radio ? rxTime('mk') : tRx;
    const forward = [];
    for (const a of adj) {
      const target = a.dir === 'down' ? a.e.lower : a.e.upper;
      if (destPA && a.e.addr && samePA(a.e.addr, destPA) && !a.e.c.off) {
        receivers.push({ id: a.e.id, coupler: true });
        events.push({ kind: 'rx', t: tDecide, ref: { coupler: a.e.id, side: a.side }, busId: bus.id });
        ackers.push({ coupler: a.e.id, side: a.side });
        continue;
      }
      if (reached.has(target)) continue;
      const dcs = a.e.c.off ? { pass: false, rc: cur.rc, reason: 'Koppler ist ausgeschaltet' } : decide(a.e, a.dir, t, destPA, cur.rc, tableOf);
      events.push({ kind: 'coupler', t: tDecide, couplerId: a.e.id, side: a.side, pass: dcs.pass, reason: dcs.reason });
      log.push({ level: dcs.pass ? 'pass' : 'block', text: `${a.dir === 'down' ? '↓' : '↑'} ${a.e.name}: ${dcs.pass ? 'nimmt an' : 'gesperrt'} – ${dcs.reason}`, ref: a.e.id, t: tDecide });
      if (dcs.pass) {
        forward.push({ a, target, rc: dcs.rc });
        ackers.push({ coupler: a.e.id, side: a.side });
        reached.set(target, { t: 0 });
      }
    }

    // Senden, quittieren, ggf. wiederholen
    let tDone = tRx;
    let tEnd = tRx; // Ende der eigentlichen Aussendung
    if (radio) {
      const lcId = bus.line.noCoupler ? null : bus.line.coupler.id;
      const asRef = (r) => (r.coupler ? { coupler: lcId, side: 'down' } : r);
      for (const w of radio.waves) {
        const tw = cur.t0 + w.level * (T.tx + T.proc);
        const to = w.links.filter((l) => l.ok && (!l.to.coupler || lcId)).map((l) => {
          const ref = asRef(l.to);
          const tg = targets.find((x) => (ref.device ? x.ref.device === ref.device : x.ref.coupler === ref.coupler));
          return { ...ref, addressed: !!tg?.addressed };
        });
        events.push({ kind: 'tx', t: tw, dur: T.tx, busId: bus.id, medium: 'RF', from: asRef(w.from), to, attempt: 0, range: w.range, retrans: w.level > 0 });
        if (w.level > 0) log.push({ level: 'info', text: `${nameOf(asRef(w.from))} frischt das Funktelegramm auf und sendet es weiter.`, ref: w.from.device, t: tw });
        tEnd = Math.max(tEnd, tw + T.tx);
      }
      tDone = tEnd;
    }
    for (let attempt = 0; attempt <= MAX_REPEATS; attempt++) {
      const ts = attempt === 0 ? cur.t0 : tDone + (attempt - 1) * (T.tx + T.wait) + T.wait;
      if (!radio || attempt > 0) {
        events.push({ kind: 'tx', t: ts, dur: T.tx, busId: bus.id, medium: bus.medium, from: cur.from, to: targets.filter((x) => !radio || levelOf.has(x.ref.device || 'mk')).map((x) => ({ ...x.ref, addressed: x.addressed })), attempt });
      }
      const tAfter = radio && attempt === 0 ? tEnd : ts + T.tx;
      if (attempt > 0) log.push({ level: 'warn', text: `${nameOf(cur.from)} hat keine Quittung bekommen und wiederholt (${attempt}/${MAX_REPEATS}) auf ${busName(bus)}.`, ref: cur.from.device || cur.from.coupler, t: ts });
      if (!quittung) { tDone = tAfter; break; }
      if (ackers.length && rfAck) {
        // Fast-Ack: jeder Empfänger antwortet in seinem eigenen Zeitschlitz
        ackers.forEach((a, i) => events.push({ kind: 'ack', t: tAfter + i * T.slot, dur: T.ack, busId: bus.id, from: [a], to: cur.from }));
        log.push({ level: 'ok', text: `${busName(bus)}: ${ackers.length} Fast-Ack${ackers.length > 1 ? 's' : ''} in eigenen Zeitschlitzen an ${nameOf(cur.from)}.`, ref: cur.from.device || cur.from.coupler, t: tAfter });
        tDone = tAfter + (ackers.length - 1) * T.slot + T.ack;
        break;
      }
      if (ackers.length) {
        events.push({ kind: 'ack', t: tAfter, dur: T.ack, busId: bus.id, from: ackers, to: cur.from });
        log.push({ level: 'ok', text: `${busName(bus)}: ${ackers.length === 1 ? nameOf(ackers[0]) + ' quittiert' : `${ackers.length} Teilnehmer quittieren gleichzeitig`} an ${nameOf(cur.from)}.`, ref: cur.from.device || cur.from.coupler, t: tAfter });
        tDone = tAfter + T.ack;
        break;
      }
      tDone = tAfter;
      if (attempt === MAX_REPEATS) {
        tDone = tAfter + T.wait;
        events.push({ kind: 'giveup', t: tDone, ref: cur.from, busId: bus.id });
        log.push({ level: 'block', text: `${nameOf(cur.from)} gibt nach ${MAX_REPEATS} Wiederholungen auf – niemand hat quittiert.`, ref: cur.from.device || cur.from.coupler, t: tDone });
      }
    }
    if (!quittung) log.push({ level: 'info', text: `${busName(bus)}: ${bus.medium === 'IP' ? 'KNX IP-Routing per Multicast' : 'KNX RF Ready'} kennt keine Quittung – keine Wiederholung.`, t: tDone });

    for (const f of forward) {
      const side = f.a.dir === 'down' ? 'down' : 'up';
      queue.push({ busId: f.target, from: { coupler: f.a.e.id, side }, t0: tDone + T.proc, rc: f.rc, via: f.a.e.id });
      events.push({ kind: 'through', t: tDone, dur: T.proc, couplerId: f.a.e.id, dir: f.a.dir });
    }
    queue.sort((x, y) => x.t0 - y.t0);
  }

  // Zusammenfassung
  const rcv = receivers.length;
  if (t.type === 'group') {
    const missing = [];
    for (const b of graph.buses) {
      if (reached.has(b.id)) continue;
      for (const d of b.devices) if (d.listens.includes(t.ga) && !d.off) missing.push(d);
    }
    log.push({ level: rcv ? 'ok' : 'warn', text: rcv ? `${rcv} Empfänger haben das Telegramm bekommen.` : 'Kein eingeschaltetes Gerät hat das Telegramm bekommen.' });
    if (missing.length) log.push({ level: 'warn', text: `Nicht erreicht: ${missing.map((m) => m.name || 'Gerät').join(', ')} – sie hören auf ${t.ga}, aber ein Koppler lässt das Telegramm nicht durch.`, ref: missing[0].id });
  } else if (t.type === 'phys') {
    const exists = addressables(p).some((x) => samePA(x, destPA));
    log.push({ level: rcv ? 'ok' : 'warn', text: rcv ? 'Ziel erreicht.' : exists ? 'Ziel nicht erreicht.' : `Es gibt kein Gerät mit der Adresse ${t.dest}.` });
  } else {
    log.push({ level: 'ok', text: `${rcv} Geräte haben den Broadcast empfangen.` });
  }
  events.sort((a, b) => a.t - b.t);
  return { ok: true, events, buses: reached, receivers, log, duration: Math.max(0, ...events.map((e) => e.t + (e.dur || 0))) };
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
