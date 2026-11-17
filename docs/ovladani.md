# Ovládání – inventura všech vstupů (3.3, fáze M1)

Stav kódu 3.2.0 + M1 (17. 11. 2026). Sloupec **Dotyk** je návrh podle `Update 3.3/PREDAVKA-MOBILNI-OVLADANI.md` (části 5–7) a `PLAN-3.3.md`; doplní se ve fázích M2–M4.
**Akce** = id v registru `js/actions.js` (klávesnice i dotyk volají stejnou funkci). `drz` = akce drží klávesu v `input.keys`, dokud je tlačítko dole.

## Pohyb a kamera

| Akce | Klávesa / myš | Kde v kódu | Kdy platí | Dotyk |
|---|---|---|---|---|
| Chůze / plyn / brzda, couvání | W S, ↑ ↓ | `input.move()` → `player.js walk / drive / fly` | vždy (ne v ragdollu) | joystick nahoru / dolů (`input.axis.fwd`, plynule) |
| Otáčení postavy / řízení | A D, ← → | `input.turn()` → `main.js frame` (`rotateHeading`) | vždy | joystick do stran (`input.axis.turn`) |
| Jdi / jeď / leť sem | levé tlačítko (i tažení – cíl jde za kurzorem) | `input.js pointerdown` → `pickDir` → `input.target`, `input.tick` přepočet 15×/s | bez otevřeného okna | klepnutí vpravo; podržení 0,5 s = táhni cíl |
| Otáčení kamery, náklon | pravé tlačítko + tažení | `input.js` `rotate` / `tilt` → `cam.orbit / cam.tilt` | vždy | tah jedním prstem vpravo |
| Kamera po 45° | tlačítka ↺ ↻ | `main.js bindButtons` `cam-left/right` | vždy | schovat (nahrazuje tah) |
| Zoom | kolečko, tlačítka + − | `input.js wheel` → `zoom`, `zoom-in/out` | vždy (s kladivem + R = otáčení stavby, Mula s navijákem = lano) | dva prsty (roztažení / stažení) |
| Ptačí pohled → mapa planety → zpět | M, tlačítko Mapa | akce `mapa` → `main.js cycleView` | bez okna a chatu | tlačítko 🗺 v horní liště |
| Mapa: otáčení glóbu | tažení, WSAD / šipky | `scene/moonMap.js` | otevřená mapa | tah (už funguje, Pointer Events) |
| Mapa: zoom | kolečko, Q / E, + − PageUp/Down | `moonMap.js KEY_ZOOM`, `main.js zoom` | otevřená mapa | tlačítka ± (už jsou), dva prsty |
| Mapa: cíl cesty | klik (pohyb < 6 px) | `moonMap.js pointerup` → `goTo` | otevřená mapa | klepnutí (už funguje) |

## Akce postavy a vozidla

| Akce | Klávesa / myš | Kde v kódu | Kdy platí | Dotyk |
|---|---|---|---|---|
| Akce (budova, nastoupit, vystoupit, vysypat, sebrat stanici, postavit sadu, přistát, zaháknout / uchopit / položit) | E, klik na `#prompt` | akce `akce` → `main.js doAction` → `interact.js currentAction` | když je výzva `#prompt` | velké tlačítko s textem výzvy |
| Držení E: bourání, nouzové uvolnění lana (1 s) | držet E | `input.keys.e` → `build.js updateBuild`, `player.js carryTick` | s kladivem a cílem / Mula s vozidlem | podržet tlačítko (akce `akce`, `drz: 'e'`) |
| Skok, jetpack ve vzduchu | mezerník | akce `skok` (`main.js jet`), `input.jump` → `tryJump` | pěšky | tlačítko ⤒ |
| Letoun: stoupat | držet mezerník | `input.jump` → `player.js fly` | v letounu | podržet ⤒ / „nahoru“ |
| Letoun: klesat | držet Shift | `input.boost` → `player.js fly` | v letounu | podržet „dolů“ (akce `boost`) |
| Boost vozidla | držet Shift | `input.boost` → `player.js drive` | vozidlo s boostem | podržet » (akce `boost`) |
| Autopilot (Autocruise → hrana → vypnuto) | C | akce `autopilot` → `toggleAutopilot`; W / S mění rychlost (`autopilot.js`, i joystick přes půl) | pozemní vozidlo | tlačítko A |
| Mód Prachocucu (jízda ↔ sběr) | F | akce `rezim` → `prachocuc.js toggleArm` | v Prachocucu | tlačítko F / „Ramena“ |
| Objednat / zrušit baterii dronem | B, tlačítko `#btn-drone` | akce `objednat-baterii` → `main.js orderBattery` | ve vozidle | tlačítko 🔋 (`#btn-drone` už je) |
| Délka lana Muly 8–20 m | kolečko | akce `lano-minus` / `lano-plus` → `main.js winch` | Mula s navijákem nese vozidlo | tlačítka lano − / + |
| Světla vozidla a čelovka | L | akce `svetla` → `main.js toggleLights` | vždy | tlačítko 💡 |
| Políčko hotbaru 1–9 | 1–9 (podle polohy klávesy), klik na políčko | akce `slot` (argument index) → `hotbar.js selectSlot`; `hotbarUi.js` | vždy | klepnutí na políčko (už funguje) |
| Zničit nástroj / kladivo | × v políčku hotbaru | `hotbarUi.js` → `dropFromHotbar` | vždy | × (na `hover: none` už viditelné) |
| Jiný cíl pásu z depa / vylepšení stanice | R | akce `jiny-cil` → `main.js onAlt` (`stationUpgradeNear`), `interact.js cycleBeltTarget` | u depa / stanice | tlačítko R podle výzvy |
| Přesunout depo | E u depa s kladivem v ruce | `build.js buildPrompt` → `startDepotMove` | kladivo, u depa | tlačítko akce |

## Stavění (kladivo)

| Akce | Klávesa / myš | Kde v kódu | Kdy platí | Dotyk |
|---|---|---|---|---|
| Kladivo do ruky / zpět | Q | akce `nastroj` → `build.js toggleHammer` | pěšky, kladivo koupené | tlačítko 🔨 |
| Stavební lišta | V | akce `stavet` → `build.js toggleMenu` | kladivo v ruce | tlačítko Stavět |
| Bourací režim | X | akce `bourat` → `build.js toggleDemolish` | kladivo v ruce | tlačítko Bourat |
| Poloha hologramu | pohyb myši (bez stisku) | `input.cursor` → `main.js frame` → `updateBuild` | stavění | tah prstem po terénu |
| Postavit / bod pásu / napojit kabel | levý klik | `main.js input.capture` → `placeNow / beltClick / connectNow` | stavění | tlačítko ✓ (stavba), klepnutí (pás, kabel) |
| Zrušit hologram | pravý klik, Esc | `input.capture`, akce `zrusit` → `main.js cancel` | stavění | tlačítko ✗ |
| Otočit stavbu | R + kolečko, držet , . (Shift = po 15°) | `main.js zoom` → `rotateBy`; `build.js` `keys[',' / '.']` | stavění | ⟲ ⟳ (akce `otocit-vlevo/-vpravo`, `drz`), dva prsty |
| LAAC: strana 1. plošiny | R + kolečko, , . | `build.js` (`laacRot`) | stavění LAAC | ⟲ ⟳ |
| Zlom pásu | držet Alt | `build.js build.alt` | stavění pásu | přepínač ∠ (akce `zlom`, `drz: 'alt'`) |
| Ruční kabel z kotvy | klik na kotvu s kladivem | `main.js input.capture` → `startCable` | kladivo v ruce | klepnutí na kotvu |
| Zbořit | držet levé tlačítko / E na stavbě 1 s | `build.mouseHold`, `keys.e` → `updateBuild` | bourací režim | klepnout = vybrat, podržet „Zbořit“ 1 s |

## Okna a menu

| Akce | Klávesa / myš | Kde v kódu | Kdy platí | Dotyk |
|---|---|---|---|---|
| Menu pauzy | Esc, tlačítko Menu | akce `menu`, `main.js bindButtons` (Esc v zachytávací fázi) | ve hře | tlačítko ≡ v horní liště |
| Zavřít okno | Esc, E, křížek, klik vedle | `facility.js` (`facility-close`, `facility-backdrop`) | okno budovy | křížek |
| Zavřít nastavení / Novinky | Esc | `settingsMenu.js`, `versionUi.js` | otevřené okno | křížek |
| Úspěchy | U, tlačítko | akce `uspechy` | bez okna | v menu / tlačítko |
| Chat | Enter, tlačítko | akce `chat` (`kdyPlati`: multiplayer) → `chat.js` (Esc zavře) | multiplayer | tlačítko 💬 |
| Nastavení grafiky | tlačítko Grafika, menu pauzy | `settingsMenu.js` | vždy | tlačítko v menu |
| Hologram Výkupu: otáčení, zoom | tažení, kolečko | `scene/hologram.js` | okno Výkupu | tah, dva prsty (M4) |
| Ladicí výpis | F3 (Shift+F3 rozpad) | `main.js`, `debug.js` | vždy | – (jen pro vývoj) |

## Zrušené
- **G** – přesun depa klávesou (od 3.0 se depo přesouvá kladivem přes E; `onMove` už main.js nepředával, klávesa nic nedělala). Z registru vypuštěno v M1.
- **T** – zrychlení času, zrušeno 11. 11. (3.1.1). `s.warp` zůstává kvůli starým uložením.
