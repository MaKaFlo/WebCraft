# WebCraft ⛏️

Ein Block-Spiel im Browser, das sich mit einem **Minecraft-Server** verbindet: **Paper** (als Plugin) oder **Fabric** (als Mod, damit auch für Vanilla). WebCraft-Spieler sind auf dem Server **echte Spieler**: Sie stehen in der Tab-Liste, bekommen Schaden, sterben, benutzen Befehle und Menüs von Plugins und Mods. Für den Server gibt es keinen Unterschied zu einem Minecraft-Spieler. So können Leute ohne Minecraft-Account mit Freunden auf dem Server spielen.

Version 0.8.0 · **Paper 26.3** oder **Fabric 26.3** · JDK 25

## Aufbau

```
webcraft/
├── pom.xml              Maven-Elternprojekt (Module webcraft-plugin, webcraft-web)
├── webcraft-common/     Code, den Plugin und Mod teilen (Chunks, Block-Palette, Texturen, WebSocket-Server)
├── webcraft-plugin/     Paper-Plugin "WebCraft": WebCraft-Spieler als echte Server-Spieler
├── webcraft-fabric/     Fabric-Mod "WebCraft": dasselbe für Fabric-Server (Gradle)
├── webcraft-web/        Das Spiel (eine einzige HTML-Datei, three.js), Docker-Container mit nginx
│   ├── src/             Client-Quellcode, index.html, texturen.zip (eingebaute Texturen)
│   ├── Dockerfile       baut die Seite und liefert sie mit nginx aus
│   ├── docker-compose.yml
│   └── .env.example     Einstellungen für docker compose
├── tools/
│   ├── fetch-paper.sh   lädt Paper 26.3 nach .paper/ (zum Bauen des Plugins nötig)
│   ├── make_pack.py     baut texturen.zip aus dem Pixel-Perfection-Paket
│   ├── items.json       Liste aller Items und Blöcke (für make_pack.py)
│   └── test/            Test-Helfer (Bot-Spieler, Screenshot im Headless-Browser)
├── CLAUDE.md            Technische Übersicht zum Weiterentwickeln
└── README.md
```

## Bauen

Voraussetzungen: **JDK 25**, **Maven 3.9+**, `curl`, `python3`. Node.js wird von Maven selbst heruntergeladen.

```bash
tools/fetch-paper.sh          # einmalig: Paper 26.3 nach .paper/ laden und entpacken
mvn package
```

Ergebnis:

- `webcraft-plugin/target/webcraft-0.8.0.jar`: das Plugin
- `webcraft-web/target/webcraft.html`: das Spiel (gleiche Datei wie `webcraft-web/dist/index.html`)

Warum Paper herunterladen? Das Plugin benutzt die Server-Interna (`net.minecraft.*`, Mojang-Namen), die es in keinem Maven-Repository gibt. Statt `.paper/` geht auch jeder andere Paper-26.3-Ordner, der einmal gestartet wurde: `mvn package -Dpaper.dir=/pfad/zum/server`.

Nur die Webseite, ohne Maven: `cd webcraft-web && npm ci && npm run build`.

Die **Fabric-Mod** wird mit Gradle gebaut (Minecraft und Fabric lädt Gradle selbst herunter):

```bash
cd webcraft-fabric
./gradlew build                # -> build/libs/webcraft-fabric-0.8.0.jar
```

Die Version steht für die Mod in `webcraft-fabric/gradle.properties` (bei einem Versionswechsel dort mit ändern).

### GitHub

`.github/workflows/build.yml` baut bei jedem Push auf `main` das Plugin, die Fabric-Mod und die Seite (unter *Actions* als Download). Ein Tag `v1.2.3` baut genau diese Version und legt ein Release mit `webcraft-1.2.3.jar`, `webcraft-fabric-1.2.3.jar` und `webcraft.html` an:

```bash
git tag v0.7.1
git push origin v0.7.1
```

## Plugin installieren

1. Alte `webcraft-*.jar` aus `plugins/` löschen, `webcraft-0.8.0.jar` reinlegen.
2. Server neu starten. Die Einstellungen stehen in `plugins/WebCraft/config.yml`.
3. Der Port aus `config.yml` (Standard `25007`) muss von außen erreichbar sein, oder der nginx-Container leitet ihn weiter (siehe unten).

**Umstieg von gg (GgBridge):** `gg-bridge-*.jar` löschen, `webcraft-*.jar` reinlegen. Beim ersten Start übernimmt WebCraft den Ordner `plugins/GgBridge` (Config, Texturen, Block-Log). Dabei bleibt das alte Namens-Präfix `gg_`, damit alle ihre Inventare und Positionen behalten. Neue Server bekommen `wc_`. Danach kann `plugins/GgBridge` weg. Statt `/webcraft` geht auch `/wc`.

**Whitelist:** Hat der Server eine Whitelist, gilt sie auch für WebCraft: `/whitelist add wc_Name`. Das Spiel zeigt den genauen Befehl an, falls er fehlt.

**Server-Updates:** Das Plugin greift tief in den Server und passt nur zu Paper 26.3. Für eine neue Minecraft-Version muss es angepasst und neu gebaut werden.

## Fabric-Mod installieren (Fabric und Vanilla)

Vanilla-Server können keine Plugins oder Mods laden. Für Vanilla installiert man deshalb **Fabric** (https://fabricmc.net/use/server/): Die Welt und das Spiel bleiben wie Vanilla, und Minecraft-Spieler brauchen nichts extra.

1. Fabric-Server für Minecraft 26.3 aufsetzen.
2. In den Ordner `mods/` legen: **`webcraft-fabric-0.8.0.jar`** und die **Fabric API** für 26.3 (https://modrinth.com/mod/fabric-api).
3. Server starten. Die Einstellungen stehen in `config/webcraft/webcraft.properties` (gleiche Werte wie die `config.yml` des Plugins, `allowed-origins` mit Komma getrennt). Danach `/webcraft reload`.
4. Port `25007` freigeben oder den nginx-Container nehmen, genau wie beim Plugin.

**Whitelist:** `/webcraft whitelist Name` setzt den WebCraft-Spieler `wc_Name` auf die Whitelist. Das normale `/whitelist add` fragt bei Mojang nach, und dort gibt es WebCraft-Namen nicht.

Texturen für alle liegen bei Fabric in `config/webcraft/texturen.zip`, das Block-Log in `config/webcraft/blocklog.csv`.

## Webseite mit Docker (nginx)

```bash
cd webcraft-web
cp .env.example .env      # Werte anpassen
docker compose up -d --build
```

Die Seite läuft dann auf `http://<host>:8080`. nginx leitet `/ws` als WebSocket an das Plugin weiter. Dadurch braucht der Browser nur die Webseite zu erreichen, und hinter einem HTTPS-Proxy funktioniert automatisch `wss://`.

Alle Adressen kommen nur aus Umgebungsvariablen (`.env`), nichts davon steht im Code:

| Variable | Bedeutung | Standard |
|---|---|---|
| `WC_HTTP_PORT` | Port der Webseite auf dem Host | `8080` |
| `WC_BACKEND` | `host:port` des Plugins (WebSocket), Ziel für `/ws` | `host.docker.internal:25007` (Plugin auf demselben Rechner) |
| `WC_SERVER` | Adresse, die im Login schon eingetragen ist. Leer = über diese Webseite (`ws(s)://<host>/ws`) | leer |
| `WC_NAME_PREFIX` | Namens-Präfix des Plugins (`name-prefix` in `config.yml`), nur für die Anzeige im Login | `wc_` |

Die Seite holt sich die Werte beim Start aus `/config.js`, die nginx aus der Umgebung erzeugt (`webcraft-web/nginx/default.conf.template`).

Ohne Docker geht auch: `webcraft.html` direkt im Browser öffnen und die Server-Adresse (`ws://host:25007`) eintragen. Oder mit `?server=ws://host:25007` an der Adresse.

Wenn Webseite und Plugin auf verschiedenen Domains laufen, in `config.yml` unter `allowed-origins` die Adresse der Webseite eintragen.

## Steuerung

| Taste | Was |
|---|---|
| `WASD`, `W` zweimal | Laufen, Rennen |
| `Leertaste` | Springen, Schwimmen (zweimal tippen: Fliegen, wenn erlaubt) |
| `W` zweimal im Wasser | Schwimmen wie in Minecraft: hinlegen, schneller, dahin wo du schaust (nach unten schauen = tauchen) |
| `Shift` | Schleichen |
| Linksklick | Angreifen, Abbauen (halten) |
| Rechtsklick | Bauen, Türen/Truhen/Werkbank benutzen, Essen und Bogen (halten) |
| `1`-`9`, Mausrad | Hotbar |
| `E` | Inventar mit Rüstung und Crafting (im Kreativmodus mit Item-Auswahl) |
| `Tab` (halten) | Alle Spieler auf dem Server |
| `F` | Item in die zweite Hand |
| `Q` / `Shift+Q` | Ein Item / ganzen Stapel wegwerfen |
| `J` | Auto-Jump an/aus (Standard: an) |
| `T` oder `/` | Chat und Befehle |
| `Esc` | Spielmenü, Einstellungen (auch Lautstärke), Textur-Studio |

Im Inventar: Maus über ein Item zeigt seinen Namen. Shift+Klick verschiebt, `1`-`9` legt das Item unter der Maus auf die Hotbar. Im Kreativmodus: rechts im Inventar alle Items mit Suche. Klick legt 1 Stück in den gewählten Hotbar-Platz, Shift+Klick einen ganzen Stapel, `Entf` leert den Platz unter der Maus.

## Befehle (für OPs)

- `/webcraft status`: wer ist über WebCraft online, Chunks, Tracking
- `/webcraft kick <name>`: WebCraft-Spieler rauswerfen (normales `/kick` und `/ban` gehen auch)
- `/webcraft reload`: Config und `texturen.zip` neu laden
- `/webcraft whitelist <name>` (nur Fabric): WebCraft-Spieler auf die Whitelist setzen

## Textur-Studio 🎨 (eigene Grafiken mit ChatGPT)

`Esc` → **Textur-Studio**:

1. Links einen Block oder ein Item aussuchen (bei Blöcken auch nur Oben/Seiten/Unten).
2. Oben den **Stil** einstellen (gilt für alle Texturen).
3. **Prompt kopieren** und in ChatGPT einfügen.
4. In ChatGPT das Bild kopieren, zurück in WebCraft `Strg`+`V` drücken.

Das Bild wird auf 32×32 Pixel verkleinert (bei Items wird der Hintergrund entfernt) und ist sofort im Spiel.

- Eigene Texturen bleiben im Browser (IndexedDB).
- **Für alle auf den Server laden** gibt sie allen WebCraft-Spielern (Recht `webcraft.textures`, Standard: OPs). Sie landen in `plugins/WebCraft/texturen.zip`.
- **Paket herunterladen** / **Paket laden**: alles als ZIP sichern und wieder holen.
- Minecraft-Spieler sehen weiter ihre normalen Texturen.

**Normale Minecraft-Texturenpakete** (Java-Edition-.zip) funktionieren direkt: für dich über **Paket laden**, für alle als `plugins/WebCraft/texturen.zip` plus `/webcraft reload`. Fehlendes kommt aus den eingebauten Texturen, Animationen (`.mcmeta`) werden übernommen. Bitte nur Pakete nehmen, deren Ersteller das Weitergeben erlaubt.

## Was WebCraft kann

- ✅ Leben, Hunger, Rüstung, Erfahrung, Luft unter Wasser (mit wenig Hunger, 3 Keulen oder weniger, kann man nicht sprinten)
- ✅ Kämpfen gegen Mobs und Spieler, Rückstoß, Fallschaden, Sterben und Wiederbeleben
- ✅ Lifesteal: mehr als 10 Herzen werden angezeigt, verlorene und gewonnene Herzen auch
- ✅ Plugin-Befehle und Plugin-Menüs (Truhen-GUIs), Rechts- und Linksklick-Abilities
- ✅ Truhen, Öfen, Werkbank, Türen, Betten, Eimer: alles über den echten Server
- ✅ Mobs und Tiere als Blockfiguren mit eigener Form: Creeper, Spinne, Huhn, Biene, Fledermaus, Papagei, Fische, Delfin, Tintenfisch, Ghast, Blaze, Breeze, Phantom, Wächter, Schleim, Shulker, Wither, Enderdrache ... Tiere mit Schwanz, Hörnern, Ohren, langem Hals. Flügel schlagen, Tentakel wackeln
- ✅ Echte Blockformen: Stufen oben/unten, Schnee-Schichten, Türen und Falltüren offen/zu, Zäune, Portale
- ✅ Hologramme und Schilder von Plugins, Text-Anzeigen, fallender Sand und Kies
- ✅ Kämpfen wie in Minecraft: Hand mit Item, Schlag-Animation, Angriffs-Anzeige unter dem Fadenkreuz (voll aufladen = mehr Schaden), Treffer-Sounds
- ✅ Mobs um WebCraft-Spieler laufen, sterben und spawnen jetzt richtig (vorher standen sie teilweise still)
- ✅ Items auf dem Boden mit Bild statt grauer Würfel, jedes Item hat ein Bild
- ✅ Andere Spieler schwingen den Arm (auch beim Abbauen)
- ✅ Echte Pixel-Bilder für fast alle Items, Items in der Hand und auf dem Boden mit Dicke wie in Minecraft
- ✅ Bewegte Texturen: Feuer (brennt an den Blockseiten), Wasser, Lava, Portale, Seelaterne ...; Risse beim Abbauen
- ✅ Essen und Trinken mit Animation (Essen zum Mund, Krümel, Geräusch), Bogen spannen; andere sehen den Arm oben
- ✅ Rechtsklick auf Mobs: mit Dorfbewohnern handeln, Tiere füttern, reiten, Namensschild ...
- ✅ Menüs wie in Minecraft: Braustand (mit Fortschritt und Lohenstaub), Ofen mit Fortschritt, Zaubertisch mit den drei Angeboten, Handel, Amboss mit Umbenennen, Schleifstein, Schmiedetisch
- ✅ Geworfene Sachen sind sichtbar: Windkugel, Schneeball, Enderperle, Tränke, Pfeile, Dreizack, Feuerwerk
- ✅ Treppen, Zäune und Mauern in ihrer echten Form; Treppen kann man hochlaufen
- ✅ Alle Blockänderungen kommen an, auch von /setblock, /fill, WorldEdit, Kolben, Explosionen
- ✅ Weltgrenze: wird als Wand angezeigt, die Welt lädt bis an den Rand
- ✅ Langsame Chunks (neue Welt erzeugen) blockieren das Laden nicht mehr, kein Festhängen am Rand der geladenen Welt
- ✅ Bauen und Abbauen sieht man sofort, der Server korrigiert, falls er Nein sagt; Abbauen klappt auch, wenn der Server laggt
- ✅ Tab-Liste mit allen Spielern, Scoreboard rechts (Bestenliste), Rüstung bei Spielern und Mobs sichtbar
- ✅ Man sieht, was andere Spieler und Mobs in der Hand halten (Schwert, Spitzhacke, Blöcke ...)
- ✅ Tiere in ihren echten Farben: rosa, blaue, schwarze Schafe (geschorene ohne Wolle), braune Pilzkühe, Schneefüchse, Axolotl, Katzen, Pferde, Wölfe, Kuh/Schwein/Huhn je nach Biom; Dorfbewohner mit Berufsfarbe
- ✅ Nochmal einloggen mit demselben Namen (zweiter Tab, abgerissene Verbindung) wirft die alte Sitzung raus, statt zu blockieren
- ✅ Wer in Blöcken steckt (Block kam zurück, Lag), wird wie in Minecraft rausgeschoben; beim Einloggen auch auf dem Server
- ✅ Abbauen im Fallen oder unter Wasser dauert wie in Minecraft länger, abgebaute Blöcke kommen dadurch nicht mehr zurück
- ✅ Esc öffnet ein Spielmenü mit Einstellungen (Maus, Sichtfeld, Auto-Jump) und "Verbindung trennen"

### Noch offen

- ⏳ Skins (WebCraft-Spieler sehen für andere wie Steve aus)
- ⏳ Partikel, Tag/Nacht am Himmel, fließendes Wasser
- ⏳ Menüs für Steinsäge, Webstuhl, Leuchtfeuer
- ⏳ Mobs haben Farben, aber noch keine echten Texturen
- ⏳ Rund 230 neuere Blöcke haben noch keine eigene Textur

## Gegen Griefing

Jeder Block, den ein WebCraft-Spieler abbaut oder setzt, steht in `plugins/WebCraft/blocklog.csv`. Spawn-Schutz und Schutz-Plugins gelten automatisch auch für WebCraft-Spieler, weil sie echte Spieler sind. WebCraft-Namen bekommen ein Präfix (`wc_`), damit niemand einen echten Minecraft-Account übernehmen kann.

## Lizenzen

- Eingebaute Texturen (`webcraft-web/src/texturen.zip`): gebaut aus **Pixel Perfection Community Edition** (XSSheep und Community, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)), keine Minecraft-Originalgrafik. Neuere Blöcke sind daraus umgefärbt. Neu bauen: `python3 tools/make_pack.py <PixelPerfectionCE-Ordner> tools/items.json webcraft-web/src/texturen.zip`.
- three.js: MIT. Java-WebSocket: MIT (im Plugin-Jar enthalten, verschoben nach `de.p300.webcraft.lib.websocket`).
- Minecraft ist eine Marke von Mojang/Microsoft. WebCraft ist kein offizielles Produkt.
