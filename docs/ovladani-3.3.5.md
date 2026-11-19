# Ovládání na dotyku – stav před 3.3.5 a co se změnilo

## Před 3.3.5 (3.3.0–3.3.3)
- **Joystick** (`js/touch.js`): plovoucí. Střed vznikl pod palcem v levé polovině obrazovky. Když palec vyjel za poloměr 60 px, `joyMove` posunul **střed za palcem** (`joy.cx += …`), takže joystick „ujížděl“ po obrazovce.
- **Tlačítka vpravo** (`css/touch.css`): `.touch__side` byla mřížka (`display: grid`, 2 sloupce) a v ní `.touch__group` (flexbox s `flex-wrap: wrap-reverse`) se všemi situačními tlačítky včetně skoku a nástroje, pod ní tlačítko akce přes celou šířku. Celek byl přichycený k pravému dolnímu rohu, takže **když se objevilo tlačítko akce (72 px), všechno nad ním vyjelo o řádek výš** – i skok. Stejně tak se tlačítka přeskupovala, když se jiná objevila nebo zmizela.
- **Situační tlačítka** (`kdyPlati` v `main.js` → `setActionRules`): skok a nástroj při chůzi; Stavět, Bourat s kladivem; ⟲ ⟳ ✗ Zlom při stavění; Boost, Auto, Ramena, 🔋 ve vozidle; ▲ ▼ Lano ± v letounu; Vylepšit u stanice robota.

## 3.3.5 – Pepův Master controller patch
- **Joystick:** střed se během držení **nikdy nehýbe**, knoflík zůstane na okraji (100 %). Nové nastavení `joyMode`:
  - `pevny` (výchozí): základna je stále vidět vlevo dole, střed 110 px od okrajů bezpečné oblasti (× velikost tlačítek), v klidu 40 % průhlednost. Chytí ho dotyk do 1,8× poloměru od středu; dotyk jinde v levé polovině = kamera / klepnutí jako vpravo.
  - `plovouci`: střed pod palcem jako dřív, ale bez ujíždění.
- **Tlačítka vpravo:** každé má **pevný slot** (`SIDE` v `touch.js`, souřadnice `--sx`, `--sy`, `position: absolute`). Prázdný slot zůstane prázdný.
  - skok: roh (0, 0), 76 px · akce: vlevo od skoku (x 88, y 2), roste doleva · nástroj: nad skokem (x 10, y 88) · 🔋: nad nástrojem (x 10, y 152)
  - řada 1 (y 88) a řada 2 (y 152), sloupce x 88 / 176 / 264. Slot sdílí jen tlačítka, která nikdy neplatí zároveň:
    - chůze: Vylepšit (r1 c1)
    - kladivo: Stavět r1c1, Bourat r1c2, ✗ r1c3, ⟳ r2c1, ⟲ r2c2, Zlom r2c3
    - vozidlo: Boost r1c1, Auto r1c2, Ramena r1c3
    - letoun: ▼ r1c1, ▲ r2c1, Lano − r1c2, Lano + r2c2
  - Odchylka od zadání (část 2, stavění): ✓ zůstává na **tlačítku akce** (slot A) a skok ve slotu S, jako všude jinde – nic se nepřehazuje, ani při stavění.
- **Tlačítko akce** se objeví plynule na místě (0,15 s). Prvních 150 ms po objevení klepnutí neplatí. Dotyk, který začal dřív (palec už ležel na místě), tlačítko nespustí, protože `pointerdown` na něm nevznikne.
- **Nastavení → Ovládání:** Joystick na obrazovce (Pevný / Plovoucí), Ukázat rozložení tlačítek (postupně chůze, kladivo, vozidlo, letoun po 1,5 s; jen ve hře).
- Hotbar na dotyku začíná nejméně 240 px od okraje, aby nezasahoval do pevného joysticku.
