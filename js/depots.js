// Depa a nadzemní pásy. Depo je sklad prachu mimo základnu: hráč do jeho zóny vysype zásobník
// stejně jako do Výkupu. Peníze ale přinese až pás – vede po nejkratší cestě (hlavní kružnici)
// z depa do Výkupu uprostřed základny, odebírá z depa SILO.beltRate kg/s a prach po něm jede
// rychlostí SILO.beltSpeed. Prodá se, až dojede do Výkupu. Pás stojí SILO.beltPerHex za každý hex.
import { MOON, BASE, PRICE_PER_KG } from './config.js';
import { SILO } from './catalog.js';
import { game } from './state.js';
import { dirToCell, cellDir } from './planet/hexgrid.js';
import { angleBetween, norm, anyTangent } from './planet/vec.js';

const R = MOON.radius;
const pathCache = new Map();

// Může tu stát depo? (mimo základnu, na hexu bez stanice a bez jiného depa)
export function canPlaceDepot(p) {
  if (angleBetween(p, BASE.dir) * R < BASE.noStations) return false;
  const hex = dirToCell(p);
  return !game.s.stations.some(st => st.hex === hex) && !game.s.depots.some(d => d.hex === hex);
}

export function placeDepot(p) {
  if (game.s.money < SILO.price || !canPlaceDepot(p)) return false;
  game.s.money -= SILO.price;
  game.s.depots.push({ hex: dirToCell(p), store: 0, belt: false, transit: [] });
  return true;
}

// Bod na hlavní kružnici mezi a a b (t = 0…1).
function slerp(a, b, ang, t) {
  const s = Math.sin(ang);
  const wa = Math.sin((1 - t) * ang) / s, wb = Math.sin(t * ang) / s;
  return norm([a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb]);
}

// Trasa pásu z depa do Výkupu: { points (bod každé ~2,5 m), length (m), hexes (kolik hexů pás přechází) }.
export function beltPath(hex) {
  if (pathCache.has(hex)) return pathCache.get(hex);
  const a = cellDir(hex), b = BASE.dir;
  let legs = [[a, b]];
  if (angleBetween(a, b) > Math.PI - 0.02) {          // depo přesně naproti základně: oklikou přes rovník
    const m = anyTangent(b);
    legs = [[a, m], [m, b]];
  }
  const points = [];
  const cells = new Set();
  let length = 0;
  for (const [p, q] of legs) {
    const ang = angleBetween(p, q);
    const len = ang * R;
    const n = Math.max(2, Math.ceil(len / 2.5));
    for (let k = points.length ? 1 : 0; k <= n; k++) points.push(slerp(p, q, ang, k / n));
    const fine = Math.max(2, Math.ceil(len));        // hexy pod pásem – vzorek po 1 m
    for (let k = 0; k <= fine; k++) cells.add(dirToCell(slerp(p, q, ang, k / fine)));
    length += len;
  }
  const path = { points, length, hexes: cells.size };
  pathCache.set(hex, path);
  return path;
}

export const beltCost = i => beltPath(game.s.depots[i].hex).hexes * SILO.beltPerHex;

export function buildBelt(i) {
  const d = game.s.depots[i];
  if (!d || d.belt) return false;
  const cost = beltCost(i);
  if (game.s.money < cost) return false;
  game.s.money -= cost;
  d.belt = true;
  return true;
}

// Kolik prachu právě jede po pásu (u připojeného hráče hodnota od hostitele).
export function beltLoad(d) {
  if (d.tk !== undefined) return d.tk;
  let kg = d.acc || 0;
  for (const e of d.transit) kg += e[1];
  return kg;
}

// Depo, do jehož zóny míří bod p (index), nebo −1.
export function depotAt(p) {
  const list = game.s.depots;
  for (let i = 0; i < list.length; i++) {
    if (angleBetween(p, cellDir(list[i].hex)) * R < SILO.zone) return i;
  }
  return -1;
}

// Vysype náklad do depa (hostitel / hráč sám).
export function depositToDepot(i, kg) {
  const d = game.s.depots[i];
  if (!d || !(kg > 0)) return false;
  d.store += kg;
  return true;
}

// Pracovní tick: pás odebírá z depa, prach jede do základny a ve Výkupu se prodá. Vrací výdělek.
export function depotTick(dt) {
  let earned = 0;
  for (const d of game.s.depots) {
    if (!d.belt) continue;
    const take = Math.min(d.store, SILO.beltRate * dt);
    d.store -= take;
    d.acc = (d.acc || 0) + take;
    d.accT = (d.accT || 0) + dt;
    if (d.accT >= 1) {                                // náklad za každou sekundu jede jako jedna dávka
      if (d.acc > 0) d.transit.push([beltPath(d.hex).length / SILO.beltSpeed, d.acc]);
      d.acc = 0;
      d.accT = 0;
    }
    for (const e of d.transit) e[0] -= dt;
    while (d.transit.length && d.transit[0][0] <= 0) earned += d.transit.shift()[1] * PRICE_PER_KG;
  }
  game.s.money += earned;
  return earned;
}

// Offline: pás za dobu nepřítomnosti doveze, co jede, a z depa odebere, co stihne.
export function depotsOffline(seconds) {
  let earned = 0;
  for (const d of game.s.depots) {
    if (!d.belt) continue;
    let kg = (d.acc || 0) + d.transit.reduce((a, e) => a + e[1], 0);
    const take = Math.min(d.store, SILO.beltRate * seconds);
    kg += take;
    d.store -= take;
    d.acc = 0;
    d.transit = [];
    earned += kg * PRICE_PER_KG;
  }
  game.s.money += earned;
  return earned;
}
