// Rozmístění základny: budovy, jejich vchody, parkoviště garáže a místo startu.
// Souřadnice v metrech v tečné rovině středu základny: x = východ, y = sever.
import { MOON, BASE, INTERACT_RADIUS, BUYBACK } from './config.js';
import { norm, angleBetween, tangentTo, anyTangent, cross, dot } from './planet/vec.js';

const R = MOON.radius;
const C = BASE.dir;
const E1 = [1, 0, 0];   // východ (tečna ve středu základny [0, 0, 1])
const E2 = [0, 1, 0];   // sever

export function baseDir(x, y) {
  return norm([C[0] + E1[0] * x / R + E2[0] * y / R, C[1] + E1[1] * x / R + E2[1] * y / R, C[2] + E1[2] * x / R + E2[2] * y / R]);
}

// Pevné budovy základny 3.0: jen Výkup, Dílna a Obchod (modely GLB, D-12). Garáž a vše ostatní se staví kladivem (structures.js).
// x, y = střed (m), face = kam míří čelo modelu (+Z) v souřadnicích základny. Obdélníky [x0, x1, z0, z1] jsou v místních
// souřadnicích modelu (X vpravo, Z vpřed – stejně jako structures.js axes): pad = betonová deska (nedá se na ni stavět,
// hexy pod ní jsou od začátku čisté), solid = pevné části (kolize, pásy tudy nevedou), door = bod pro E, doorR = dosah.
export const BUILDINGS = [
  { id: 'depot', name: 'Výkup prachu', x: 0, y: 0, face: [0, -1], pad: [-7.8, 7.8, -6.75, 6.75],
    // šestiúhelník (vrcholy na ±X, stěny 4,92 m od středu) jako 3 obdélníky
    solid: [[-2.84, 2.84, -4.92, 4.92], [-4.3, -2.84, -2.46, 2.46], [2.84, 4.3, -2.46, 2.46], [-5.3, -4.3, -0.8, 0.8], [4.3, 5.3, -0.8, 0.8]],
    door: [-1.0, 6.4], doorR: 2.6,
    // ramena pásů na střeše (README modelu: vystupy_pasu) – pás do Výkupu na ně najede rampou do výšky y
    belts: [{ id: 'e', at: [4.806, 2.775], dir: [0.866, 0.5], y: 5.5 }, { id: 'w', at: [-4.806, 2.775], dir: [-0.866, 0.5], y: 5.5 }, { id: 'n', at: [0, -5.55], dir: [0, -1], y: 5.5 }] },
  { id: 'workshop', name: 'Dílna', x: 21, y: 0, face: [-1, 0], pad: [-11.65, 11.65, -9.75, 9.75],
    solid: [[-11.1, 5.85, -9.0, 2.6], [5.8, 9.6, -7.9, -4.5]], door: [0.5, 4.6], doorR: 4 },
  { id: 'toolshop', name: 'Obchod s nástroji', x: -16, y: 0, face: [1, 0], pad: [-6.4, 6.4, -5.25, 5.25],
    solid: [[-5.7, 4.0, -5.2, 1.1], [4.0, 5.3, -3.6, -0.1]], door: [1.5, 2.8], doorR: 3.2 },
];

// Místní bod budovy (mx vpravo, mz vpřed) → [x, y] v souřadnicích základny
export const toBase = (b, mx, mz) => [b.x - mx * b.face[1] + mz * b.face[0], b.y + mx * b.face[0] + mz * b.face[1]];
const rectR = r => Math.max(Math.hypot(r[0], r[2]), Math.hypot(r[1], r[2]), Math.hypot(r[0], r[3]), Math.hypot(r[1], r[3]));

for (const b of BUILDINGS) {
  b.dir = baseDir(b.x, b.y);
  b.p = b.dir;
  b.facing = tangentTo(b.dir, [b.face[0], b.face[1], 0]);
  const e1 = anyTangent(b.dir), e2 = cross(b.dir, e1);
  b.yaw = Math.atan2(dot(b.facing, e2), dot(b.facing, e1));        // stejně jako structures.js yawFor
  b.r = rectR(b.pad);                                                // poloměr desky (rychlé vyřazení podle vzdálenosti)
  b.doorDir = baseDir(...toBase(b, b.door[0], b.door[1]));
}

export const building = id => BUILDINGS.find(b => b.id === id);

// Vysýpací zóny Výkupu: pod koncem každého ramene pro pás (jihovýchod nad násypkou, jihozápad, sever).
// V zóně se vysype prach a E otevře Výkup. { id, x, y, dir }
export const BUYBACK_ZONES = building('depot').belts.map(a => {
  const [x, y] = toBase(building('depot'), a.at[0] + a.dir[0] * BUYBACK.out, a.at[1] + a.dir[1] * BUYBACK.out);
  return { id: a.id, x, y, dir: baseDir(x, y) };
});
// Je bod p v některé vysýpací zóně (extra = rezerva v m, např. kontrola výdělku klienta u hostitele)?
export const inBuyback = (p, extra = 0) => BUYBACK_ZONES.some(z => angleBetween(p, z.dir) * R < BUYBACK.r + extra);
// Nejbližší vysýpací zóna (drony)
export const nearestBuyback = p => BUYBACK_ZONES.reduce((a, z) => (angleBetween(p, z.dir) < angleBetween(p, a.dir) ? z : a));

// ---------- overhaul základny (D-12): vzhled + čisté hexy, kreslí scene/basePlaza.js ----------
// Náměstí = šestiúhelník kolem Výkupu (vrcholy na sever a jih, poloměr r), cesty = pásy betonu (w = šířka),
// stavební zóna = obrysy s nápisy (nic nevynucují). Na náměstí se nestaví (structures.js canPlace), cesty stavbám nevadí.
// (Přistávací plocha z prvního návrhu odstraněná – bez funkce; možná s létajícími vozidly v dalším updatu.)
export const PLAZA = { r: 13 };
export const PATHS = [
  { from: [0, -12.2], to: [0, -24], w: 3 },               // jih → stavební zóna
];
export const PLOTS = [
  { name: 'GARÁŽ', x: -14, y: -38, w: 22.5, h: 20.3 },
  { name: 'NABÍJEČKA', x: 14, y: -36, w: 23, h: 16 },
  { name: 'SOLÁR', x: -6, y: -20, w: 4.5, h: 3.5 },
  { name: 'SOLÁR', x: 6, y: -20, w: 4.5, h: 3.5 },
];
export const LAMPS = [[0, 12.6], [-8, -10.4], [8, -10.4], [2.4, -18], [-2.4, -24]];
export const SIGNPOST = [-3.4, -12.4];
// Bod (x, y) na náměstí? (šestiúhelník s vrcholy na ±y)
export function onPlaza(x, y, margin = 0) {
  const r = PLAZA.r + margin, a = r * Math.sqrt(3) / 2;
  const ax = Math.abs(x), ay = Math.abs(y);
  return ax <= a && ay <= r - ax / Math.sqrt(3);
}
// Bod na cestě?
export function onPath(x, y, margin = 0) {
  return PATHS.some(({ from: [x0, y0], to: [x1, y1], w }) => {
    const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy;
    const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / L2));
    return Math.hypot(x - x0 - dx * t, y - y0 - dy * t) <= w / 2 + margin;
  });
}

// Hexy pod pevnými budovami základny – jen ty jsou od začátku bez prachu (3.0: žádný čistý kruh kolem základny,
// takže se nedá „dočistit“ okrajový hex za odměnu). Hex patří budově, když do něj zasahuje její plocha (vzorky po obvodu).
export function baseCleanCells(dirToCell) {
  const cells = new Set();
  for (const b of BUILDINGS) {
    const [x0, x1, z0, z1] = b.pad;
    const nx = Math.ceil((x1 - x0) / 1.5), nz = Math.ceil((z1 - z0) / 1.5);
    for (let i = 0; i <= nx; i++) {
      for (let k = 0; k <= nz; k++) cells.add(dirToCell(baseDir(...toBase(b, x0 + (x1 - x0) * i / nx, z0 + (z1 - z0) * k / nz))));
    }
  }
  // beton náměstí a cest (D-12) – mřížka po 1,5 m přes okolí základny
  for (let x = -30; x <= 30; x += 1.5) {
    for (let y = -30; y <= 30; y += 1.5) {
      if (onPlaza(x, y) || onPath(x, y)) cells.add(dirToCell(baseDir(x, y)));
    }
  }
  return cells;
}

export const SPAWN = baseDir(0, -9);
export const SPAWN_FACING = E2;

// Parkovací místa jsou od 3.0 u konkrétní garáže (structures.js garageSlot / homeSpot).

// Je bod blízko vchodu budovy?
export function nearDoor(p, b) {
  return angleBetween(p, b.doorDir) * R < (b.doorR || INTERACT_RADIUS);
}

export const distanceToBase = p => angleBetween(p, C) * R;
