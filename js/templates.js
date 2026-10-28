// Vorlagen für neue Projekte. Jede baut ein vollständiges, gültiges Projekt.
import { newProject, newArea, newLine, newSegment, addDevice, buses } from './model.js';

const busOf = (p, owner) => buses(p).find((b) => b.owner === owner);

function fill(p, owner, list) {
  const bus = busOf(p, owner);
  for (const [type, extra] of list) addDevice(p, bus, type, extra);
}

const T = (name, cat, sends = [], listens = []) => ['TLN', { name, cat, sends, listens }];
const SV = (mA = 640) => ['SV', { mA }];

export const TEMPLATES = {
  demo: {
    label: 'Beispiel mit allen Medien',
    hint: 'IP-Backbone, TP-Linien mit Segmenten, RF-Linie',
    build() {
      const p = newProject('Einfamilienhaus mit Garage');
      p.backbone = { enabled: true, medium: 'IP', devices: [] };
      fill(p, p.backbone, [
        ['SW', { name: 'Switch Technikraum' }],
        ['IPI', { name: 'Visualisierung', cat: 'display' }],
      ]);
      p.backbone.devices[1].sends = ['1/0/1', '2/0/1'];
      p.backbone.devices[1].listens = ['1/1/1', '3/1/1'];

      const a1 = newArea(1); a1.name = 'Wohnhaus'; p.areas.push(a1);
      const l11 = newLine(1); l11.name = 'Erdgeschoss'; a1.lines.push(l11);
      const l12 = newLine(2); l12.name = 'Obergeschoss'; a1.lines.push(l12);
      const l13 = newLine(3, 'RF'); l13.name = 'Funk Wohnzimmer'; l13.rfAck = true; a1.lines.push(l13);
      fill(p, a1, [SV(320), T('Wetterstation Dach', 'wetter', ['3/1/1', '2/0/9'])]);

      fill(p, l11.segments[0], [
        SV(),
        T('Schaltaktor 8-fach', 'aktor', ['1/1/1'], ['1/0/1', '1/0/2']),
        T('Jalousieaktor 4-fach', 'jalousie', [], ['2/0/1', '2/0/9']),
        T('Taster Flur', 'taster', ['1/0/1']),
        T('Präsenzmelder Küche', 'praesenz', ['1/0/2']),
        ['PI', { name: 'USB-Schnittstelle' }],
      ]);
      l11.segments.push(newSegment('LV', 64));
      fill(p, l11.segments[1], [
        SV(320),
        T('Heizungsaktor', 'heizung', [], ['3/0/1']),
        T('Raumtemperaturregler Bad', 'sensor', ['3/0/1']),
      ]);

      fill(p, l12.segments[0], [
        SV(),
        T('Dimmaktor 4-fach', 'dimmer', [], ['1/0/3', '1/0/1']),
        T('Taster Schlafen', 'taster', ['1/0/3', '2/0/2']),
        T('Jalousieaktor 2-fach', 'jalousie', [], ['2/0/2', '2/0/9']),
      ]);

      fill(p, l13.segments[0], [
        T('Funktaster Sofa', 'taster', ['1/0/4']),
        T('Funk-Schaltaktor Stehlampe', 'aktor', [], ['1/0/4', '1/0/1']),
        ['RFR', { name: 'RF-Repeater Flur' }],
      ]);
      l13.rf = { w: 30, h: 16, mk: { x: 1.5, y: 1.5 }, obstacles: [{ id: 'o1', kind: 'wall', x1: 18, y1: 0, x2: 18, y2: 9 }] };
      [[6, 6], [12, 12], [20, 12]].forEach(([x, y], i) => { l13.segments[0].devices[i].pos = { x, y }; });

      const a2 = newArea(2); a2.name = 'Garage'; p.areas.push(a2);
      const l21 = newLine(1); l21.name = 'Garage'; a2.lines.push(l21);
      fill(p, a2, [SV(160)]);
      fill(p, l21.segments[0], [
        SV(320),
        T('Schaltaktor Tor', 'aktor', [], ['4/0/1', '4/1/1']),
        T('Taster Garage', 'taster', ['4/0/1', '1/0/1']),
      ]);
      l21.segments.push(newSegment('SK', 64));
      fill(p, l21.segments[1], [
        SV(160),
        T('Bewegungsmelder Einfahrt', 'praesenz', ['4/1/1']),
      ]);
      return p;
    },
  },

  single: {
    label: 'Einzelne Linie',
    hint: 'Kleine Anlage ohne Koppler',
    build() {
      const p = newProject('Wohnung');
      p.backbone.enabled = false;
      const a = newArea(1); p.areas.push(a);
      const l = newLine(1); l.noCoupler = true; l.name = 'Wohnung'; a.lines.push(l);
      fill(p, l.segments[0], [
        SV(320),
        T('Schaltaktor 4-fach', 'aktor', [], ['1/0/1', '1/0/2']),
        T('Taster Wohnen', 'taster', ['1/0/1']),
        T('Taster Küche', 'taster', ['1/0/2']),
        ['PI', { name: 'USB-Schnittstelle' }],
      ]);
      return p;
    },
  },

  rf: {
    label: 'Reine Funkanlage',
    hint: 'KNX RF ohne Busleitung, mit Repeater und Wänden',
    build() {
      const p = newProject('Funk-Nachrüstung Altbau');
      p.backbone.enabled = false;
      const a = newArea(1); p.areas.push(a);
      const l = newLine(1, 'RF'); l.noCoupler = true; l.rfAck = true; l.name = 'Wohnung'; a.lines.push(l);
      fill(p, l.segments[0], [
        T('Taster Wohnzimmer', 'taster', ['1/0/1']),
        T('Schaltaktor Stehlampe', 'aktor', [], ['1/0/1']),
        ['RFR', { name: 'Repeater Flur' }],
        T('Dimmaktor Schlafzimmer', 'dimmer', [], ['1/0/1', '1/0/2']),
        T('Taster Schlafzimmer', 'taster', ['1/0/2']),
      ]);
      const d = l.segments[0].devices;
      l.rf = { w: 30, h: 16, mk: null, obstacles: [
        { id: 'w1', kind: 'wall', x1: 11, y1: 0, x2: 11, y2: 7 },
        { id: 'w2', kind: 'concrete', x1: 20, y1: 9.5, x2: 20, y2: 16 },
      ] };
      const pos = [[3, 4], [7, 12], [15, 12], [26, 4], [24, 12]];
      d.forEach((x, i) => { x.pos = { x: pos[i][0], y: pos[i][1] }; });
      return p;
    },
  },

  tp: {
    label: 'Klassisch TP',
    hint: 'TP-Backbone mit Bereichs- und Linienkopplern',
    build() {
      const p = newProject('Bürogebäude');
      p.backbone = { enabled: true, medium: 'TP', devices: [] };
      fill(p, p.backbone, [SV(640)]);
      for (const [an, name] of [[1, 'Bauteil A'], [2, 'Bauteil B']]) {
        const a = newArea(an); a.name = name; p.areas.push(a);
        fill(p, a, [SV(640)]);
        for (const ln of [1, 2]) {
          const l = newLine(ln); l.name = `${ln}. OG`; a.lines.push(l);
          fill(p, l.segments[0], [
            SV(640),
            T('Schaltaktor 12-fach', 'aktor', [], [`${an}/${ln}/1`]),
            T('Präsenzmelder Büro', 'praesenz', [`${an}/${ln}/1`]),
          ]);
        }
      }
      return p;
    },
  },

  ipbackbone: {
    label: 'IP-Router als Linienkoppler',
    hint: 'IP-Hauptlinie, TP- und RF-Linien darunter',
    build() {
      const p = newProject('Gewerbehalle');
      p.backbone.enabled = false;
      const a = newArea(1, 'IP'); a.name = 'Halle'; p.areas.push(a);
      fill(p, a, [['SW', { name: 'Switch Verteiler' }], ['IPI', { name: 'Server Visualisierung' }]]);
      for (const ln of [1, 2]) {
        const l = newLine(ln); l.name = `Verteiler ${ln}`; a.lines.push(l);
        fill(p, l.segments[0], [SV(640), T('Schaltaktor Hallenlicht', 'aktor', [], ['1/0/1']), T('Taster Tor', 'taster', ['1/0/1'])]);
      }
      const rf = newLine(3, 'RF'); rf.name = 'Funk Büro'; a.lines.push(rf);
      fill(p, rf.segments[0], [T('Funktaster', 'taster', ['1/0/1'])]);
      return p;
    },
  },

  empty: {
    label: 'Leeres Projekt',
    hint: 'Eine Linie mit Spannungsversorgung',
    build() {
      const p = newProject('Neues Projekt');
      p.backbone.enabled = false;
      const a = newArea(1); p.areas.push(a);
      const l = newLine(1); l.noCoupler = true; a.lines.push(l);
      fill(p, l.segments[0], [SV()]);
      return p;
    },
  },
};
