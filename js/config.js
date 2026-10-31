// Všechna laditelná čísla hry na jednom místě. Ceny a parametry nástrojů/vozidel jsou v catalog.js.

// Měsíc (verze 2): poloměr 304 m (obvod ≈ 1,9 km, plocha 1,6× proti v1).
// Hexové sektory: ikosaedr s frekvencí 33 → 10·33² + 2 = 10 892 hexů, hex ≈ 10 m napříč (jako v1).
// Terén: každá stěna ikosaedru rozdělená na 240 dílků (~1,3 m), kreslí se po kusech (5×5 na stěnu).
export const MOON = { radius: 304, hexFreq: 33, terrainSeg: 240, terrainChunks: 5 };

// Nejvyšší a nejnižší bod terénu (m) – pro rychlé konce paprsků stínů a dohled za obzor.
export const RELIEF = { maxH: 50, minH: -40 };

// Prachová mapa: 960 bodů na hranu stěny → bod ≈ 0,33 m. Hodnota = množství prachu (0–max).
export const DUST = { faceTexels: 960, max: 100 };

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
export const MOON_GRAVITY = 1.62;                    // m/s²
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
