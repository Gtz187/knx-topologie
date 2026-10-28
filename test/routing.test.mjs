import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES } from '../js/templates.js';
import { simulate } from '../js/routing.js';
import { validate } from '../js/validate.js';
import { buses, addressables, fmtPA, normalizeGA, parsePA } from '../js/model.js';

const byName = (p, n) => { for (const b of buses(p)) for (const d of b.devices) if (d.name === n) return { d, b }; throw new Error(n); };
const pa = (p, n) => { const { d, b } = byName(p, n); return fmtPA(b.a, b.l, d.dev); };

test('Gruppenadressen werden normalisiert', () => {
  assert.equal(normalizeGA('1/0/1'), '1/0/1');
  assert.equal(normalizeGA('1/257'), '1/1/1');
  assert.equal(normalizeGA('32/0/0'), null);
  assert.deepEqual(parsePA('1.1.5'), { a: 1, l: 1, d: 5 });
  assert.equal(parsePA('16.1.1'), null);
});

test('Adressen passen zu Bereich und Linie', () => {
  for (const t of Object.values(TEMPLATES)) {
    const p = t.build();
    const keys = addressables(p).map((x) => fmtPA(x.a, x.l, x.d));
    assert.equal(new Set(keys).size, keys.length, `doppelte Adressen in ${t.label}: ${keys}`);
  }
  const p = TEMPLATES.demo.build();
  assert.match(pa(p, 'Schaltaktor 8-fach'), /^1\.1\.\d+$/);
  assert.match(pa(p, 'Heizungsaktor'), /^1\.1\.6[5-9]$/);
  assert.match(pa(p, 'Funktaster Sofa'), /^1\.3\./);
});

test('Vorlagen sind fehlerfrei', () => {
  for (const t of Object.values(TEMPLATES)) {
    const errs = validate(t.build()).filter((x) => x.level === 'error');
    assert.deepEqual(errs, [], t.label);
  }
});

test('Gruppentelegramm geht über Filtertabelle zu allen Empfängern', () => {
  const p = TEMPLATES.demo.build();
  const r = simulate(p, { senderId: byName(p, 'Taster Flur').d.id, type: 'group', ga: '1/0/1', rc: 6 });
  const names = r.receivers.map((x) => byName2(p, x.id));
  for (const n of ['Schaltaktor 8-fach', 'Dimmaktor 4-fach', 'Funk-Schaltaktor Stehlampe']) assert.ok(names.includes(n), n);
});
function byName2(p, id) { for (const b of buses(p)) for (const d of b.devices) if (d.id === id) return d.name; return id; }

test('Linienkoppler sperrt fremde Gruppenadresse', () => {
  const p = TEMPLATES.demo.build();
  const r = simulate(p, { senderId: byName(p, 'Taster Flur').d.id, type: 'group', ga: '9/9/9'.replace('9/9','9/7'), rc: 6 });
  assert.ok(r.log.some((l) => l.level === 'block'));
  assert.equal(r.receivers.length, 0);
});

test('Gesperrter Koppler blockiert, Routingzähler 0 blockiert', () => {
  const p = TEMPLATES.demo.build();
  p.areas[0].lines[1].coupler.group = 'block';
  const r = simulate(p, { senderId: byName(p, 'Taster Flur').d.id, type: 'group', ga: '1/0/1', rc: 6 });
  assert.ok(!r.receivers.some((x) => byName2(p, x.id) === 'Dimmaktor 4-fach'));
  const r2 = simulate(p, { senderId: byName(p, 'Taster Flur').d.id, type: 'group', ga: '1/0/1', rc: 0 });
  assert.equal(r2.receivers.map((x) => byName2(p, x.id)).join(), 'Schaltaktor 8-fach');
});

test('Physikalisches Telegramm findet seinen Weg und nur dorthin', () => {
  const p = TEMPLATES.demo.build();
  const dest = pa(p, 'Bewegungsmelder Einfahrt');
  const r = simulate(p, { senderId: byName(p, 'Visualisierung').d.id, type: 'phys', dest, rc: 6 });
  assert.deepEqual(r.receivers.map((x) => byName2(p, x.id)), ['Bewegungsmelder Einfahrt']);
  // Linie 1.2 darf nicht erreicht werden
  assert.ok(!r.buses.has(p.areas[0].lines[1].segments[0].id));
});

test('Broadcast erreicht alle', () => {
  const p = TEMPLATES.demo.build();
  const r = simulate(p, { senderId: byName(p, 'Visualisierung').d.id, type: 'bc', rc: 7 });
  // alle außer Sender und Batterie-Funkgeräten (die senden nur)
  const battery = ['Funktaster Sofa'];
  const all = addressables(p).filter((x) => x.kind === 'device' && !battery.includes(x.el.name)).length - 1;
  assert.equal(r.receivers.length, all);
});

test('Empfänger quittieren gleichzeitig, Koppler quittiert und sendet neu', () => {
  const p = TEMPLATES.demo.build();
  const r = simulate(p, { senderId: byName(p, 'Taster Flur').d.id, type: 'group', ga: '1/0/1', rc: 6 });
  const seg = p.areas[0].lines[0].segments[0].id;
  const ack = r.events.find((e) => e.kind === 'ack' && e.busId === seg);
  assert.ok(ack, 'Quittung auf Linie 1.1');
  assert.equal(ack.to.device, byName(p, 'Taster Flur').d.id);
  assert.ok(ack.from.some((x) => x.coupler === p.areas[0].lines[0].coupler.id), 'LK quittiert');
  assert.ok(ack.from.some((x) => x.device === byName(p, 'Schaltaktor 8-fach').d.id));
  // auf Linie 1.2 sendet der Linienkoppler das Telegramm neu
  const tx12 = r.events.find((e) => e.kind === 'tx' && e.busId === p.areas[0].lines[1].segments[0].id);
  assert.equal(tx12.from.coupler, p.areas[0].lines[1].coupler.id);
  assert.ok(tx12.t > ack.t);
  // IP-Backbone ohne Quittung
  assert.ok(!r.events.some((e) => e.kind === 'ack' && e.busId === 'bb'));
});

test('Ohne Quittung wird dreimal wiederholt', () => {
  // Einzellinie ohne Koppler: Aktor aus → niemand quittiert
  const p = TEMPLATES.single.build();
  byName(p, 'Schaltaktor 4-fach').d.off = true;
  const r = simulate(p, { senderId: byName(p, 'Taster Wohnen').d.id, type: 'group', ga: '1/0/1', rc: 6 });
  const tx = r.events.filter((e) => e.kind === 'tx');
  assert.equal(tx.length, 4);
  assert.ok(r.events.some((e) => e.kind === 'giveup'));
  assert.equal(r.receivers.length, 0);
});

test('Ausgeschalteter Linienkoppler leitet nicht weiter', () => {
  const p = TEMPLATES.demo.build();
  p.areas[0].lines[1].coupler.off = true;
  const r = simulate(p, { senderId: byName(p, 'Taster Flur').d.id, type: 'group', ga: '1/0/1', rc: 6 });
  assert.ok(!r.receivers.some((x) => byName2(p, x.id) === 'Dimmaktor 4-fach'));
});

test('Funk: Wand aus Beton blockt, Repeater sendet weiter', async () => {
  const { ensureRF, newObstacle } = await import('../js/rf.js');
  const p = TEMPLATES.single.build();
  const a = p.areas[0];
  const l = a.lines[0];
  l.medium = 'RF';
  l.segments[0].devices = l.segments[0].devices.filter((d) => d.type !== 'SV' && d.type !== 'PI');
  const rf = ensureRF(l);
  const [akt, t1] = l.segments[0].devices;
  t1.pos = { x: 2, y: 5 }; akt.pos = { x: 40, y: 5 }; rf.w = 50;
  let r = simulate(p, { senderId: t1.id, type: 'group', ga: '1/0/1', rc: 6 });
  assert.equal(r.receivers.length, 0, 'zu weit weg');
  // Repeater dazwischen
  const rep = { id: 'rep1', type: 'RFR', name: 'Rep', dev: 50, sends: [], listens: [], pos: { x: 20, y: 5 }, power: 'mains', repeat: true };
  l.segments[0].devices.push(rep);
  r = simulate(p, { senderId: t1.id, type: 'group', ga: '1/0/1', rc: 6 });
  assert.deepEqual(r.receivers.map((x) => x.id), [akt.id]);
  assert.ok(r.events.some((e) => e.kind === 'tx' && e.retrans));
  // Betonwand vor dem Aktor
  rf.obstacles.push(newObstacle('concrete', 30, 0, 30, 10));
  r = simulate(p, { senderId: t1.id, type: 'group', ga: '1/0/1', rc: 6 });
  assert.equal(r.receivers.length, 0, 'Beton blockt');
});
