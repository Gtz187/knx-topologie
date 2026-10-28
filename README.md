# KNX Topologie

KNX-Anlagen im Browser zeichnen – mit allen Medien, automatisch vergebenen physikalischen Adressen und einer Simulation, die zeigt, welchen Weg ein Telegramm nimmt und wo es gesperrt wird.

**Direkt starten:** https://gtz187.github.io/knx-topologie/

![Editor mit Beispielprojekt](docs/editor.png)

## Was das Tool kann

**Medien:** TP (Busleitung), IP (KNXnet/IP) und RF (Funk). Die Bereichslinie (Backbone) kann TP oder IP sein, Hauptlinien ebenfalls, Linien TP oder RF. Powerline ist bewusst nicht enthalten.

**Geräte und Koppler**

| Element | Kürzel | Adresse |
|---|---|---|
| Bereichskoppler (TP/TP) | BK | x.0.0 |
| KNX IP-Router als Bereichskoppler | IP-R | x.0.0 |
| Linienkoppler (TP/TP) | LK | x.y.0 |
| KNX IP-Router als Linienkoppler | IP-R | x.y.0 |
| Medienkoppler TP/RF bzw. IP/RF | MK, IP/RF | x.y.0 |
| Linienverstärker | LV | x.y.64 / 128 / 192 |
| Segmentkoppler | SK | x.y.64 / 128 / 192 |
| Teilnehmer (Taster, Aktoren, Sensoren …) | TLN | x.y.1 … |
| Spannungsversorgung | SV | – |
| Programmierschnittstelle (USB) | USB | x.y.255 |
| KNX IP-Schnittstelle mit Tunneladressen | IP-S | x.y.n, Tunnel von oben |
| LAN-Switch | Switch | – |
| RF-Repeater | RF-Rep | x.y.n |

Welcher Koppler eingesetzt wird, ergibt sich aus den Medien: Hängt eine TP-Linie an einer IP-Hauptlinie, wird automatisch ein KNX IP-Router daraus.

**Adressen:** Geräte speichern nur ihre Teilnehmernummer, Bereich und Linie kommen aus der Position im Baum. Unter dem Linienkoppler 1.1.0 heißt also alles 1.1.x. Neue Geräte bekommen die nächste freie Nummer – im ersten Segment ab .1, im zweiten ab .65, im dritten ab .129. Wird eine Linie umnummeriert, wandern alle Adressen mit.

**Prüfung:** doppelte Adressen, fehlende Spannungsversorgung, mehr als 64 Teilnehmer pro Segment, zu schwache SV, unpassende Medienkombinationen, Gruppenadressen ohne Sender oder Empfänger.

**Telegramm-Simulation:** Sender anklicken, Gruppenadresse eingeben, „Telegramm senden“. Punkte laufen über die Leitungen, jeder Koppler zeigt ✓ oder ✕, das Protokoll nennt den Grund. Berücksichtigt werden:

- Filtertabellen (automatisch aus den Gruppenadressen der Geräte unterhalb, plus manuelle Einträge)
- Kopplereinstellungen je Telegrammart: filtern, alles weiterleiten, sperren
- Physikalisch adressierte Telegramme (Weg über die Adresshierarchie) und Broadcasts
- Routingzähler (Standard 6, 7 = unbegrenzt, 0 = Ende)
- Linienverstärker leiten alles weiter, Segmentkoppler filtern

![Telegramm-Simulation](docs/telegramm.png)

**Sonstiges:** Rückgängig/Wiederholen, automatisches Speichern im Browser, Projekt als Datei speichern und öffnen, Export als SVG, PNG und Adressliste (CSV), Drucken, Projekt als Link weitergeben, Schriftfeld wie auf einer technischen Zeichnung, heller und dunkler Modus.

## Bedienung

| Aktion | So geht's |
|---|---|
| Bereich, Linie, Segment, Gerät anlegen | auf die gestrichelten Felder klicken |
| Element bearbeiten | anklicken, rechts erscheinen die Eigenschaften |
| Löschen / Duplizieren | <kbd>Entf</kbd> / <kbd>Strg</kbd>+<kbd>D</kbd> |
| Rückgängig / Wiederholen | <kbd>Strg</kbd>+<kbd>Z</kbd> / <kbd>Strg</kbd>+<kbd>Y</kbd> |
| Zoomen / Verschieben | Mausrad / mit gedrückter Maustaste ziehen |
| Alles zeigen | <kbd>0</kbd> oder „Einpassen“ |

## Lokal starten

Das Tool ist reines HTML/CSS/JavaScript ohne Build-Schritt. Weil es ES-Module nutzt, braucht es einen kleinen Webserver:

```sh
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```

Tests der Simulations- und Prüflogik (Node 20 oder neuer):

```sh
npm test
```

## Aufbau

| Datei | Inhalt |
|---|---|
| `js/model.js` | Datenmodell, Gerätekatalog, Adressvergabe |
| `js/routing.js` | Telegramm-Simulation (ohne DOM, testbar) |
| `js/validate.js` | Prüfregeln |
| `js/layout.js` | automatisches Layout und Leitungsgraph |
| `js/render.js` | SVG-Zeichnung |
| `js/sim.js` | Animation der Telegramme |
| `js/app.js` | Oberfläche, Speichern, Export |
| `js/templates.js` | Vorlagen |

## Grenzen

Die Simulation bildet das Verhalten von Kopplern nach KNX-Logik nach, ersetzt aber keine ETS. Filtertabellen werden so erzeugt, wie die ETS es typischerweise tut (alle Gruppenadressen, die unterhalb des Kopplers verwendet werden). Leitungslängen und Busspannung werden nicht berechnet.

KNX ist eine eingetragene Marke der KNX Association. Dieses Projekt ist unabhängig und steht in keiner Verbindung zur KNX Association.

## Lizenz

MIT
