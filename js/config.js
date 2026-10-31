// Všechna laditelná čísla hry na jednom místě. Ceny a parametry nástrojů/vozidel jsou v catalog.js.

// ---------- planeta ----------
// Hra běží buď na Měsíci, nebo (po odletu raketou) na Marsu. Planeta se vybere při načtení stránky
// (sessionStorage ms2_planet, ve Web Workeru parametr ?planet= v adrese) a všechny moduly ji
// převezmou jako konstanty – přepnutí planety = uložit hru a znovu načíst stránku (main.js switchPlanet).
//
// Měsíc: poloměr 304 m, ikosaedr s frekvencí 33 → 10 892 hexů (hex ≈ 10 m), terén 240 dílků na stěnu
// (~1,3 m) po kusech 5×5, prachová mapa 960 bodů na hranu stěny (bod ≈ 0,33 m).
// Mars: 4× větší plocha (poloměr 608 m, jako skutečný poměr Mars/Měsíc), stejně velké hexy (43 562),
// terén se stejně jemnými dílky, mapa prachu s body ≈ 0,44 m, gravitace 3,71 m/s², rezavé barvy a obloha.
export const PLANETS = {
  moon: {
    id: 'moon', name: 'Měsíc', gen: 'Měsíce', loc: 'na Měsíci', acc: 'Měsíc',
    radius: 304, hexFreq: 33, terrainSeg: 240, terrainChunks: 5, faceTexels: 960, gravity: 1.62,
    craters: 300, seed: 1969, noise: 0,
    clean: [226, 216, 196], done: [196, 224, 240], dirt: [0.44, 0.38, 0.31],
    sky: 0x020306, skyDay: null, ambient: 0x1c2433, sun: 0xfff2dc, sunPower: 1.3, earth: true,
  },
  mars: {
    id: 'mars', name: 'Mars', gen: 'Marsu', loc: 'na Marsu', acc: 'Mars',
    radius: 608, hexFreq: 66, terrainSeg: 480, terrainChunks: 10, faceTexels: 1440, gravity: 3.71,
    craters: 520, seed: 1976, noise: 517,
    clean: [150, 92, 68], done: [196, 150, 124], dirt: [1.42, 1.02, 0.74],
    sky: 0x07040a, skyDay: 0xc79a6e, ambient: 0x33231c, sun: 0xffe8cf, sunPower: 1.1, earth: false,
  },
};

function pickPlanet() {
  try {
    const q = new URLSearchParams(globalThis.location?.search || '').get('planet');
    if (PLANETS[q]) return q;
  } catch { /* nic */ }
  try {
    const s = globalThis.sessionStorage?.getItem('ms2_planet');
    if (PLANETS[s]) return s;
  } catch { /* nic */ }
  return 'moon';
}
export const PLANET = PLANETS[pickPlanet()];
export const PLANET_KEY = 'ms2_planet';

// Rozměry aktuální planety (jméno MOON zůstalo z doby, kdy byl jen Měsíc).
export const MOON = { radius: PLANET.radius, hexFreq: PLANET.hexFreq, terrainSeg: PLANET.terrainSeg, terrainChunks: PLANET.terrainChunks };

// Nejvyšší a nejnižší bod terénu (m) – pro rychlé konce paprsků stínů a dohled za obzor.
export const RELIEF = { maxH: 50, minH: -40 };

// Prachová mapa: body na hranu stěny ikosaedru. Hodnota = množství prachu (0–max).
export const DUST = { faceTexels: PLANET.faceTexels, max: 100 };

// Základna: střed na „přivrácené straně“. flat = poloměr roviny, clean = poloměr bez prachu,
// noStations = kam nejde postavit stanici robota.
export const BASE = { dir: [0, 0, 1], flat: 34, clean: 27, noStations: 32 };
export const DEPOT = { dir: BASE.dir, r: 5 };        // výkup prachu uprostřed základny (poloměr zóny v m)
export const INTERACT_RADIUS = 3.2;                  // jak blízko musíš být k budově / vozidlu (m)

export const TICK_MS = 100;                          // pracovní tick (zametání, výkup, roboti) 10× za s
export const UNITS_PER_KG = 1000;                    // jednotky prachu v mapě → kg
export const PRICE_PER_KG = 3;                       // $ za kg prachu ve výkupu
export const HEX_BONUS = 100;                        // $ za každý dočištěný hexový sektor
export const HEX_DONE_LEFT = 0.01;                   // hex je hotový, když v něm zbývá ≤ 1 % prachu
export const WIN_LEFT = 0.01;                        // Měsíc je hotový, když zbývá ≤ 1 % hexů
export const OFFLINE_CAP_S = 8 * 3600;               // offline práce robotů max 8 h
export const SAVE_KEY = 'moonsweep_v5';             // uložená hra verze 1 (jen pro import postupu)
export const MAX_VEHICLES = 10;                      // parkovacích míst u garáže (flotila)

// Fyzika: gravitace míří do středu Měsíce.
export const MOON_GRAVITY = PLANET.gravity;          // m/s² (Měsíc 1,62, Mars 3,71)
export const JUMP_SPEED = 2.6;                       // m/s → skok ~2 m vysoko, ~3 s ve vzduchu
export const WALK_SPEED = 5;                         // m/s
export const AIR_CONTROL = 0.6;                      // jak moc jde ve vzduchu měnit směr (0–1)

// Slunce obíhá kolem osy Měsíce (sklon 1,54°). Skutečný lunární den = 29,5 dne, tady zkrácený.
// dayLength = celý cyklus v s (6 min = 3 min den + 3 min noc), warpSpeed = zrychlení při podržení T.
export const SUN = { dayLength: 360, tilt: 1.54 * Math.PI / 180, warpSpeed: 15 };

// Země visí díky vázané rotaci pořád na stejném místě oblohy nad přivrácenou stranou.
export const EARTH_DIR = (() => {
  const v = [0.9, 0.25, 0.5];
  const l = Math.hypot(...v);
  return v.map(c => c / l);
})();

// Kvalitu grafiky řídí js/settings.js (menu „Grafika“ ve hře).
export const CAMERA = { distance: 12, minDistance: 6, maxDistance: 120 };
