import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { importETS } from '../js/ets.js';
import { validate } from '../js/validate.js';
import { simulate } from '../js/routing.js';
import { sanitize } from '../js/model.js';

for (const style of ['ets6', 'ets5']) {
  test(`ETS-Import (${style}): Topologie, Adressen, Gruppenadressen`, async () => {
    const buf = await readFile(new URL(`./fixtures/${style}.knxproj`, import.meta.url));
    const { project: p, stats } = await importETS(buf);
    sanitize(JSON.parse(JSON.stringify(p)));
    assert.equal(p.name, 'Testhaus & Garten');
    assert.equal(p.backbone.enabled, true);
    assert.equal(p.backbone.medium, 'IP');
    assert.deepEqual(p.areas.map((a) => a.area), [1, 2]);
    const [a1] = p.areas;
    assert.equal(a1.coupler.name, 'IP-Router Haus');
    const eg = a1.lines[0];
    assert.equal(eg.name, 'Erdgeschoss');
    assert.equal(eg.segments.length, 2);
    assert.equal(eg.segments[1].coupler.kind, 'LV');
    assert.equal(eg.segments[1].devices.find((d) => d.dev === 65).name, 'Taster Bad');
    const aktor = eg.segments[0].devices.find((d) => d.dev === 1);
    assert.deepEqual(aktor.listens, ['0/0/1', '0/0/2']);
    assert.equal(eg.segments[0].devices.filter((d) => d.type === 'SV').length, 1);
    const funk = a1.lines[1];
    assert.equal(funk.medium, 'RF');
    assert.equal(funk.segments[0].devices[0].name, 'Funk-Taster');
    assert.equal(funk.segments[0].devices[0].cat, 'taster');
    assert.equal(stats.devices, 10);
    assert.equal(stats.gas, 3);
    // Simulation läuft auf dem importierten Projekt
    const taster = eg.segments[0].devices.find((d) => d.dev === 2);
    const r = simulate(p, { senderId: taster.id, type: 'group', ga: '0/0/1' });
    assert.ok(r.receivers.some((x) => x.id === aktor.id));
    assert.ok(Array.isArray(validate(p)));
  });
}

test('ETS-Import: kein ZIP gibt eine verständliche Meldung', async () => {
  await assert.rejects(importETS(new TextEncoder().encode('hallo').buffer), /kein ETS-Projekt/);
});
