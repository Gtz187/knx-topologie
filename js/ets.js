// Import von ETS-Projekten (.knxproj). Die Datei ist ein ZIP-Archiv mit XML:
// P-xxxx/0.xml enthält Topologie und Gruppenadressen, M-xxxx/Hardware.xml die
// Produktnamen der Hersteller. Alles läuft im Browser, nichts wird hochgeladen.
import {
  newProject, newArea, newLine, newSegment, newDevice, fmtGA, DEVICE_TYPES,
} from './model.js';

// ---------- ZIP lesen (ohne Bibliothek, entpackt per DecompressionStream) ----------

export function readZip(buf) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Die Datei ist kein ETS-Projekt (kein ZIP-Archiv).');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen)).replace(/\\/g, '/');
    entries.set(name, { name, flags, method, size, local, encrypted: (flags & 1) === 1 || method === 99 });
    p += 46 + nameLen + extraLen + commentLen;
  }
  const read = async (name) => {
    const e = entries.get(name);
    if (!e) return null;
    if (e.encrypted) throw new Error('Das ETS-Projekt ist mit einem Passwort geschützt. Bitte in der ETS ohne Passwort exportieren.');
    const start = e.local + 30 + dv.getUint16(e.local + 26, true) + dv.getUint16(e.local + 28, true);
    const data = u8.subarray(start, start + e.size);
    if (e.method === 0) return data;
    if (e.method !== 8) throw new Error(`Unbekannte Kompression in ${name}.`);
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  };
  const text = async (name) => {
    const b = await read(name);
    return b && new TextDecoder().decode(b);
  };
  return { entries, read, text };
}

// ---------- Kleiner XML-Parser (reicht für die wohlgeformten ETS-Dateien) ----------

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unesc = (s) => s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#'
  ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
  : ENT[e] ?? m));

export function parseXML(src) {
  const root = { name: '#root', attrs: {}, children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  const attrRe = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(src))) {
    if (!m[2]) continue;
    const name = m[2].replace(/^.*:/, '');
    if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
    const attrs = {};
    let a;
    attrRe.lastIndex = 0;
    while ((a = attrRe.exec(m[3]))) attrs[a[1]] = unesc(a[2] ?? a[3]);
    const el = { name, attrs, children: [] };
    stack[stack.length - 1].children.push(el);
    if (!m[4]) stack.push(el);
  }
  return root;
}

const kids = (el, name) => (el ? el.children.filter((c) => c.name === name) : []);
const kid = (el, name) => kids(el, name)[0];
function* walk(el, name) {
  for (const c of el.children) {
    if (c.name === name) yield c;
    yield* walk(c, name);
  }
}
const find = (el, name) => walk(el, name).next().value;

// ---------- ETS-Projekt auswerten ----------

// ETS-Medientypen: MT-0 TP, MT-1 PL110, MT-2 RF, MT-5 IP
const MEDIUM = { 'MT-0': 'TP', 'MT-1': 'PL', 'MT-2': 'RF', 'MT-5': 'IP' };
const mediumOf = (el) => {
  const ref = el.attrs.MediumTypeRefId || kid(el, 'Segment')?.attrs.MediumTypeRefId || '';
  return MEDIUM[ref.replace(/^.*_/, '')] || 'TP';
};

// Kategorie aus dem Produktnamen raten
const CAT_RULES = [
  [/präsenz|praesenz|presence|bewegung|motion|melder/i, 'praesenz'],
  [/wetter|weather|meteo/i, 'wetter'],
  [/taster|tastsensor|push.?button|schalter|switch(?!.*actuator)|bedien/i, 'taster'],
  [/dimm/i, 'dimmer'],
  [/jalousie|rollladen|rolladen|blind|shutter|beschattung|markise/i, 'jalousie'],
  [/heiz|heating|stellantrieb|ventil|valve|thermostat|raumtemp|klima|hvac|fan.?coil/i, 'heizung'],
  [/display|visu|panel|touch|bildschirm|server|gateway/i, 'display'],
  [/logik|logic/i, 'logik'],
  [/sensor|binäreingang|binary input|eingang|input/i, 'sensor'],
  [/aktor|actuator|schalt|relay|relais/i, 'aktor'],
];
const guessCat = (text) => CAT_RULES.find(([re]) => re.test(text))?.[1] || 'sonstiges';

/**
 * Liest eine .knxproj-Datei und baut daraus ein Projekt.
 * @returns {Promise<{ project, notes: string[], stats: { devices, gas } }>}
 */
export async function importETS(buf) {
  let zip = readZip(buf);
  const names = [...zip.entries.keys()];
  let p0 = names.find((n) => /^P-[^/]+\/0\.xml$/i.test(n));
  let projXml = names.find((n) => /^P-[^/]+\/project\.xml$/i.test(n));
  if (!p0) {
    // Geschützte Projekte liegen als verschlüsseltes P-xxxx.zip im Archiv
    const inner = names.find((n) => /^P-[^/]+\.zip$/i.test(n));
    if (!inner) throw new Error('In der Datei steckt kein ETS-Projekt (P-…/0.xml fehlt).');
    const outer = zip;
    const raw = await outer.read(inner);
    if (outer.entries.get(inner).encrypted) throw new Error('Das ETS-Projekt ist mit einem Passwort geschützt. Bitte in der ETS ohne Passwort exportieren.');
    zip = readZip(raw);
    const inn = [...zip.entries.keys()];
    if ([...zip.entries.values()].some((e) => e.encrypted)) throw new Error('Das ETS-Projekt ist mit einem Passwort geschützt. Bitte in der ETS ohne Passwort exportieren.');
    p0 = inn.find((n) => /(^|\/)0\.xml$/i.test(n));
    projXml = inn.find((n) => /(^|\/)project\.xml$/i.test(n));
    if (!p0) throw new Error('In der Datei steckt kein ETS-Projekt (0.xml fehlt).');
    // Herstellerdaten bleiben im äußeren Archiv
    zip.hardware = outer;
  }
  const notes = [];

  // Produktnamen und Eigenschaften aus den Herstellerdaten
  const products = new Map();
  const hwZip = zip.hardware || zip;
  for (const n of hwZip.entries.keys()) {
    if (!/^M-[^/]+\/Hardware\.xml$/i.test(n)) continue;
    const doc = parseXML(await hwZip.text(n));
    for (const hw of walk(doc, 'Hardware')) {
      const flags = {
        coupler: hw.attrs.IsCoupler === 'true' || hw.attrs.IsCoupler === '1',
        power: hw.attrs.IsPowerSupply === 'true' || hw.attrs.IsPowerSupply === '1',
        choke: hw.attrs.IsChoke === 'true' || hw.attrs.IsChoke === '1',
        ip: hw.attrs.IsIPEnabled === 'true' || hw.attrs.IsIPEnabled === '1',
        noAddr: hw.attrs.HasIndividualAddress === 'false' || hw.attrs.HasIndividualAddress === '0',
      };
      for (const pr of walk(hw, 'Product')) products.set(pr.attrs.Id, { text: pr.attrs.Text || hw.attrs.Name || '', order: pr.attrs.OrderNumber || '', ...flags });
    }
  }

  const doc = parseXML(await zip.text(p0));
  const project = find(doc, 'Project');
  const inst = find(project || doc, 'Installation');
  if (!inst) throw new Error('Im ETS-Projekt fehlt die Installation.');

  // Gruppenadressen: Id → "1/2/3"
  const gaById = new Map();
  for (const g of walk(inst, 'GroupAddress')) {
    const ga = fmtGA(Number(g.attrs.Address));
    gaById.set(g.attrs.Id, ga);
    gaById.set(g.attrs.Id.replace(/^.*_/, ''), ga);
  }
  const gaOf = (ref) => gaById.get(ref) || gaById.get(ref.replace(/^.*_/, ''));

  let name = inst.attrs.Name || '';
  if (projXml) {
    const pd = parseXML(await zip.text(projXml));
    name = find(pd, 'ProjectInformation')?.attrs.Name || name;
  }
  const p = newProject(name || 'ETS-Projekt');
  p.author = '';

  // Ein ETS-Gerät in unser Modell übersetzen
  const convert = (di, medium) => {
    const prod = products.get(di.attrs.ProductRefId) || {};
    const label = di.attrs.Name || prod.text || di.attrs.Description || '';
    const addr = di.attrs.Address !== undefined && !prod.noAddr ? Number(di.attrs.Address) : null;
    const sends = [], listens = [];
    for (const co of walk(di, 'ComObjectInstanceRef')) {
      const links = (co.attrs.Links || '').split(/\s+/).filter(Boolean).map(gaOf).filter(Boolean);
      for (const s of kids(kid(co, 'Connectors'), 'Send')) { const g = gaOf(s.attrs.GroupAddressRefId || ''); if (g) links.unshift(g); }
      for (const r of kids(kid(co, 'Connectors'), 'Receive')) { const g = gaOf(r.attrs.GroupAddressRefId || ''); if (g) links.push(g); }
      // Die erste Verknüpfung ist die sendende Gruppenadresse
      if (links[0] && !sends.includes(links[0])) sends.push(links[0]);
      for (const g of links) if (!listens.includes(g)) listens.push(g);
    }
    const tunnels = [...walk(di, 'AdditionalAddresses')].flatMap((x) => kids(x, 'Address')).map((x) => Number(x.attrs.Address)).filter((n) => n > 0 && n < 256);
    const t = `${label} ${prod.text || ''}`;
    let type = 'TLN';
    if (prod.power || /spannungsversorgung|power supply|netzteil|stromversorgung/i.test(t)) type = 'SV';
    else if (prod.choke || /drossel|choke/i.test(t)) type = 'SV';
    else if (medium === 'RF' && /repeater|retransmitter/i.test(t)) type = 'RFR';
    else if (/usb/i.test(t) && /schnittstelle|interface/i.test(t)) type = 'PI';
    else if (/schnittstelle|interface/i.test(t) && (prod.ip || /\bip\b|knxnet/i.test(t))) type = 'IPI';
    else if (medium === 'IP' && /switch/i.test(t) && addr === null) type = 'SW';
    if (!DEVICE_TYPES[type].media.includes(medium)) type = 'TLN';
    const d = newDevice(type, { name: label, dev: DEVICE_TYPES[type].addr ? addr : null });
    if (type === 'TLN') { d.cat = guessCat(t); d.sends = sends; d.listens = listens; }
    if (type === 'SV') delete d.mA;
    if (type === 'IPI') d.tunnels = tunnels;
    if (type === 'PI' || type === 'IPI') { d.sends = sends; d.listens = listens; }
    return { d, addr, prod, coupler: prod.coupler || /koppler|coupler|router|verstärker|repeater/i.test(t), label, tunnels };
  };
  const devicesIn = (line) => [...walk(line, 'DeviceInstance')];

  const areas = kids(find(inst, 'Topology'), 'Area');
  let bbMedium = null;
  let anyAreaCoupler = false;
  for (const a of areas) {
    const an = Number(a.attrs.Address);
    const lines = kids(a, 'Line');
    if (an === 0) {
      // Geräte 0.0.x hängen direkt an der Bereichslinie
      for (const ln of lines) {
        bbMedium = mediumOf(ln) === 'IP' ? 'IP' : 'TP';
        for (const di of devicesIn(ln)) {
          const x = convert(di, bbMedium);
          if (x.addr !== 0) p.backbone.devices.push(x.d);
        }
      }
      continue;
    }
    if (an > 15) continue;
    const main = lines.find((l) => Number(l.attrs.Address) === 0);
    let mainMedium = main ? mediumOf(main) : 'TP';
    if (mainMedium !== 'IP') mainMedium = 'TP';
    const ar = newArea(an, mainMedium);
    ar.name = a.attrs.Name || '';
    if (main) {
      for (const di of devicesIn(main)) {
        const x = convert(di, mainMedium);
        if (x.addr === 0) {
          anyAreaCoupler = true;
          ar.coupler.name = x.label;
          if (x.prod.ip || /\bip\b/i.test(x.label)) bbMedium ||= 'IP';
          if (x.tunnels.length) ar.coupler.tunnels = x.tunnels;
        } else ar.mainDevices.push(x.d);
      }
    }
    for (const l of lines) {
      const ln = Number(l.attrs.Address);
      if (ln === 0 || ln > 15) continue;
      let medium = mediumOf(l);
      if (medium === 'PL') { notes.push(`Linie ${an}.${ln} ist Powerline – als TP übernommen.`); medium = 'TP'; }
      if (medium === 'IP') { notes.push(`Linie ${an}.${ln} ist eine IP-Linie – als TP übernommen.`); medium = 'TP'; }
      const line = newLine(ln, medium);
      line.name = l.attrs.Name || '';
      const segs = [line.segments[0]];
      const rest = [];
      for (const di of devicesIn(l)) {
        const x = convert(di, medium);
        if (x.addr === 0) {
          line.coupler.name = x.label;
          if (x.tunnels.length) line.coupler.tunnels = x.tunnels;
          continue;
        }
        if (medium === 'TP' && x.coupler && [64, 128, 192].includes(x.addr)) {
          const s = newSegment(/segment/i.test(x.label) ? 'SK' : 'LV', x.addr);
          s.coupler.name = x.label;
          segs.push(s);
          continue;
        }
        rest.push(x);
      }
      segs.sort((s1, s2) => (s1.coupler?.dev ?? 0) - (s2.coupler?.dev ?? 0));
      for (const x of rest) {
        // Geräte ohne Adresse (Spannungsversorgungen) der Reihe nach auf die Segmente verteilen
        const seg = x.addr !== null ? [...segs].reverse().find((s) => (s.coupler?.dev ?? 0) <= x.addr)
          : x.d.type === 'SV' ? segs.find((s) => !s.devices.some((d) => d.type === 'SV')) || segs[0] : segs[0];
        seg.devices.push(x.d);
      }
      line.segments = segs;
      ar.lines.push(line);
    }
    p.areas.push(ar);
  }
  if (!p.areas.length) throw new Error('Im ETS-Projekt sind keine Bereiche und Linien angelegt.');
  p.areas.sort((x, y) => x.area - y.area);
  p.areas.forEach((ar) => ar.lines.sort((x, y) => x.line - y.line));

  p.backbone.medium = bbMedium || (p.areas.some((ar) => ar.mainMedium === 'IP') ? 'IP' : 'TP');
  const single = p.areas.length === 1 && p.areas[0].lines.length === 1 && !p.areas[0].mainDevices.length && !anyAreaCoupler && !p.backbone.devices.length;
  if (single) {
    p.backbone.enabled = false;
    if (!p.areas[0].lines[0].coupler.name) p.areas[0].lines[0].noCoupler = true;
  } else {
    p.backbone.enabled = p.areas.length > 1 || anyAreaCoupler || p.backbone.devices.length > 0;
  }
  const gas = new Set([...gaById.values()]).size;
  const devices = p.backbone.devices.length + p.areas.reduce((n, ar) => n + ar.mainDevices.length
    + ar.lines.reduce((m, l) => m + l.segments.reduce((k, sg) => k + sg.devices.length, 0), 0), 0);
  return { project: p, notes, stats: { devices, gas } };
}
