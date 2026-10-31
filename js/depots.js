// Depa a nadzemní pásy. Depo je sklad prachu mimo základnu: hráč do jeho zóny vysype zásobník
// stejně jako do Výkupu. Peníze ale přinese až pás – vede po nejkratší cestě (hlavní kružnici)
// z depa do Výkupu uprostřed základny, odebírá z depa SILO.beltRate kg/s a prach po něm jede
// rychlostí SILO.beltSpeed. Prodá se, až dojede do Výkupu. Pás stojí SILO.beltPerHex za každý hex.
// Pás může vést i do jiného depa (d.to = hex cílového depa, −1 = Výkup): prach se pak přisype
// do jeho skladu a dál ho veze pás toho depa. Řetěz dep nesmí tvořit smyčku.
import { MOON, BASE } from './config.js';
import { SILO } from './catalog.js';
import { game, dustPrice } from './state.js';
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
  game.s.depots.push({ hex: dirToCell(p), store: 0, belt: false, to: -1, transit: [] });
  return true;
}

// Přesun depa i na jiné místo za SILO.moveCost: sklad, pás i zboží na pásu zůstanou, pás se
// přestaví po nové trase zdarma; pásy jiných dep, které do něj vedly, míří na nové místo.
export function canMoveDepot(i, p) {
  if (angleBetween(p, BASE.dir) * R < BASE.noStations) return false;
  const hex = dirToCell(p);
  if (hex === game.s.depots[i]?.hex) return false;                // stejné místo = žádný přesun
  return !game.s.stations.some(st => st.hex === hex) && !game.s.depots.some((d, k) => k !== i && d.hex === hex);
}

export function moveDepot(i, p) {
  const d = game.s.depots[i];
  if (!d || game.s.money < SILO.moveCost || !canMoveDepot(i, p)) return false;
  game.s.money -= SILO.moveCost;
  const old = d.hex, hex = dirToCell(p);
  for (const x of game.s.depots) if (x.to === old) x.to = hex;
  d.hex = hex;
  return true;
}

// Bod na hlavní kružnici mezi a a b (t = 0…1).
function slerp(a, b, ang, t) {
  const s = Math.sin(ang);
  const wa = Math.sin((1 - t) * ang) / s, wb = Math.sin(t * ang) / s;
  return norm([a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb]);
}

// Trasa pásu z depa do Výkupu (to = −1) nebo do depa na hexu to:
// { points (bod každé ~2,5 m), length (m), hexes (kolik hexů pás přechází) }.
export function beltPath(hex, to = -1) {
  const key = `${hex}>${to}`;
  if (pathCache.has(key)) return pathCache.get(key);
  const a = cellDir(hex), b = to >= 0 ? cellDir(to) : BASE.dir;
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
  pathCache.set(key, path);
  return path;
}

export const beltCost = (i, to = -1) => beltPath(game.s.depots[i].hex, to).hexes * SILO.beltPerHex;
export const depotByHex = hex => game.s.depots.find(d => d.hex === hex) || null;

// Může pás z depa i vést do cíle to? (Výkup vždy; depo jen jiné a takové, z něhož řetěz pásů nevede zpět)
export function validBeltTarget(i, to) {
  const d = game.s.depots[i];
  if (!d) return false;
  if (to === -1) return true;
  if (to === d.hex || !depotByHex(to)) return false;
  for (let t = to, n = 0; t >= 0 && n < 64; n++) {
    const x = depotByHex(t);
    if (!x || !x.belt) return true;
    if (x.to === d.hex) return false;
    t = x.to;
  }
  return true;
}

// Možné cíle pásu z depa i: Výkup a ostatní depa (nejbližší první).
export function beltTargets(i) {
  const d = game.s.depots[i];
  if (!d) return [];
  const from = cellDir(d.hex);
  const others = game.s.depots
    .filter(x => x.hex !== d.hex && validBeltTarget(i, x.hex))
    .sort((a, b) => angleBetween(from, cellDir(a.hex)) - angleBetween(from, cellDir(b.hex)))
    .map(x => x.hex);
  return [-1, ...others];
}

export function buildBelt(i, to = -1) {
  const d = game.s.depots[i];
  if (!d || d.belt || !validBeltTarget(i, to)) return false;
  const cost = beltCost(i, to);
  if (game.s.money < cost) return false;
  game.s.money -= cost;
  d.belt = true;
  d.to = to;
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
      if (d.acc > 0) d.transit.push([beltPath(d.hex, d.to).length / SILO.beltSpeed, d.acc]);
      d.acc = 0;
      d.accT = 0;
    }
    for (const e of d.transit) e[0] -= dt;
    while (d.transit.length && d.transit[0][0] <= 0) {
      const kg = d.transit.shift()[1];
      const next = d.to >= 0 ? depotByHex(d.to) : null;
      if (next) next.store += kg;                     // do dalšího depa v řetězu
      else earned += kg * dustPrice();
    }
  }
  game.s.money += earned;
  return earned;
}

// Kolik pásů vede z depa do Výkupu (pro pořadí offline výpočtu: nejdřív depa na začátku řetězu).
function chainDepth(d) {
  let n = 0;
  for (let x = d; x && x.belt && x.to >= 0 && n < 64; n++) x = depotByHex(x.to);
  return n;
}

// Offline: pás za dobu nepřítomnosti doveze, co jede, a z depa odebere, co stihne.
export function depotsOffline(seconds) {
  let earned = 0;
  const order = game.s.depots.filter(d => d.belt).sort((a, b) => chainDepth(b) - chainDepth(a));
  for (const d of order) {
    let kg = (d.acc || 0) + d.transit.reduce((a, e) => a + e[1], 0);
    const take = Math.min(d.store, SILO.beltRate * seconds);
    kg += take;
    d.store -= take;
    d.acc = 0;
    d.transit = [];
    const next = d.to >= 0 ? depotByHex(d.to) : null;
    if (next) next.store += kg;
    else earned += kg * dustPrice();
  }
  game.s.money += earned;
  return earned;
}
