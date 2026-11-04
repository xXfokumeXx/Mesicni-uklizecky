// Stanice robotů. Každá stanice má jednoho robota, který čistí hexy do vzdálenosti 2 hexů
// od hexu stanice (19 hexů), projíždí je v řádcích jako sekačka a plný se vrací vyložit do stanice.
import { MOON, BASE, UNITS_PER_KG } from './config.js';
import { STATION, STATION_MK, stationMk } from './catalog.js';
import { isDone } from './research.js';
import { game, dustPrice, hexBonus } from './state.js';
import { stationPrice } from './equipment.js';
import { grid, dirToCell, cellDir, HEX_SPACING } from './planet/hexgrid.js';
import { hexes, sweepCapsule, clearHex } from './planet/dustmap.js';
import { rockHit, rockPush, hexHasRock, rockTexels, rockVersion } from './rocks.js';
import { cross, madd, norm, tangentTo, angleBetween, anyTangent } from './planet/vec.js';

const R = MOON.radius;
const HALF = HEX_SPACING * 0.62;          // polovina strany čtverce, který pokryje celý hex
const areaCache = new Map();

// Hexy v okruhu `rings` od hexu (včetně).
export function hexArea(hex, rings = STATION.rings) {
  const key = hex * 10 + rings;
  if (areaCache.has(key)) return areaCache.get(key);
  let ring = [hex];
  const seen = new Set(ring);
  for (let r = 0; r < rings; r++) {
    const next = [];
    for (const c of ring) {
      for (let m = 0; m < 6; m++) {
        const nb = grid.neighbors[c * 6 + m];
        if (nb >= 0 && !seen.has(nb)) { seen.add(nb); next.push(nb); }
      }
    }
    ring = next;
  }
  const area = [...seen];
  areaCache.set(key, area);
  return area;
}

// Může tu stát stanice? (mimo základnu a ne na hexu, kde už stojí stanice nebo depo)
// skip = index stanice, která se právě přesouvá (její starý hex se nepočítá).
export function canPlaceStation(p, skip = -1) {
  if (angleBetween(p, BASE.dir) * R < BASE.noStations) return false;
  const hex = dirToCell(p);
  return !game.s.stations.some((st, i) => i !== skip && st.hex === hex)
    && !(game.s.buildings || []).some(b => dirToCell(b.p) === hex);   // ani pod stavbou 3.0
}

// Přesune stanici i s robotem na nové místo (zdarma). Náplň robota se vyloží a prodá.
export function moveStation(i, p) {
  const st = game.s.stations[i];
  if (!st || !canPlaceStation(p, i)) return false;
  const rb = st.robot;
  if (rb.load > 0) game.s.money += rb.load * dustPrice();
  st.hex = dirToCell(p);
  const home = cellDir(st.hex);
  st.robot = { p: home, t: home, hex: -1, k: -1, load: 0, mode: 'work' };
  return true;
}

// Vylepšení stanice na místě na další MK (L-31): platí se rozdíl příplatků. null = už je MK2.
export function stationUpgradeOffer(i) {
  const st = game.s.stations[i];
  if (!st) return null;
  const from = Math.max(1, st.mk | 0);
  if (from >= 2) return null;
  const next = STATION_MK[from + 1];
  const price = next.extra - STATION_MK[from].extra;
  const reason = !isDone(next.research) ? 'nejdřív výzkum' : game.s.money < price ? `stojí $${price.toLocaleString('cs-CZ')} – málo peněz` : '';
  return { name: next.name, price, reason, to: from + 1 };
}
export function upgradeStation(i) {
  const o = stationUpgradeOffer(i);
  if (!o || o.reason) return false;
  game.s.money -= o.price;
  game.s.stations[i].mk = o.to;
  return true;
}

export function placeStation(p, mk = 0) {
  mk = Math.max(1, Math.min(2, mk | 0));
  const price = stationPrice() + STATION_MK[mk].extra;
  if (game.s.money < price || !canPlaceStation(p) || (STATION_MK[mk].research && !isDone(STATION_MK[mk].research))) return false;
  game.s.money -= price;
  const hex = dirToCell(p);
  const home = cellDir(hex);
  game.s.stations.push({
    hex, mk,
    robot: { p: home, t: home, hex: -1, k: -1, load: 0, mode: 'work' },
  });
  return true;
}

// Kameny (rocks.js): robot se o kámen zasekne a objede ho, prach pod kamenem nevyčistí. Hex s kamenem, který po
// celém průjezdu není hotový, robot přeskočí (jinak by ho projížděl pořád dokola), dokud se nějaký kámen nerozbije
// nebo se nezmění stavby (rockVersion) – pak ho zkusí znovu.
const ROBOT_R = STATION.width / 2;
const skipped = new WeakMap();                    // robot → { v: rockVersion, set: hexy přeskočené kvůli kameni }
function skipOf(rb) {
  let k = skipped.get(rb);
  if (!k || k.v !== rockVersion()) skipped.set(rb, (k = { v: rockVersion(), set: new Set() }));
  return k.set;
}

// Nejbližší nedočištěný hex v oblasti stanice (skip = hexy, které se teď vynechají).
function nextOpenHex(st, from, skip = skipOf(st.robot)) {
  let best = -1, bestDot = -2;
  for (const c of hexArea(st.hex, stationMk(st).rings)) {
    if (hexes.done[c] || !hexes.init[c] || skip.has(c)) continue;
    const d = grid.dirs[c * 3] * from[0] + grid.dirs[c * 3 + 1] * from[1] + grid.dirs[c * 3 + 2] * from[2];
    if (d > bestDot) { bestDot = d; best = c; }
  }
  return best;
}

// Další bod „sekačky“: řádky přes hex tam a zpátky.
function waypoint(rb) {
  const c = cellDir(rb.hex);
  const e1 = anyTangent(c), e2 = cross(c, e1);
  const row = rb.k >> 1;
  const y = -HALF + row * STATION.rowGap;
  if (y > HALF) return null;
  const x = ((row & 1) ^ (rb.k & 1)) ? HALF : -HALF;
  return norm(madd(madd(c, e1, x / R), e2, y / R));
}

function nextTarget(st) {
  const rb = st.robot;
  rb.k++;
  let t = rb.hex >= 0 && !hexes.done[rb.hex] ? waypoint(rb) : null;
  if (!t && rb.hex >= 0 && !hexes.done[rb.hex] && hexHasRock(rb.hex)) skipOf(rb).add(rb.hex);   // projel celý, zbytek je u kamene
  if (!t) {
    const next = nextOpenHex(st, rb.p);
    if (next < 0) {                                  // oblast je čistá → domů
      rb.mode = 'idle';
      rb.t = cellDir(st.hex);
      return;
    }
    rb.hex = next;
    rb.k = 0;
    t = waypoint(rb);
  }
  rb.t = t;
}

// Krok robota; vrací seznam dočištěných hexů.
export function robotTick(st, dt) {
  const rb = st.robot;
  const mk = stationMk(st);
  const home = cellDir(st.hex);

  if (rb.mode !== 'work') {
    rb.t = home;
  } else if (rb.load >= mk.hopper - 0.05) {
    rb.mode = 'unload';
    rb.t = home;
  }

  const dist = angleBetween(rb.p, rb.t) * R;
  const from = rb.p;
  if (dist > 0.05) {
    rb.p = norm(madd(rb.p, tangentTo(rb.p, rb.t), Math.min(mk.speed * dt, dist) / R));
    // kámen: robot se zasekne, sjede po jeho okraji; když se nehne ~1 s, vezme další bod řádku
    let k = rockHit(rb.p, ROBOT_R), hit = k >= 0;
    for (let n = 0; n < 3 && k >= 0; n++) { rb.p = rockPush(k, rb.p, ROBOT_R).p; k = rockHit(rb.p, ROBOT_R); }   // skupinka kamenů
    if (hit) {
      const moved = angleBetween(from, rb.p) * R;
      rb.stuck = moved < mk.speed * dt * 0.3 ? (rb.stuck || 0) + dt : 0;
      if (rb.stuck > 1) {
        rb.stuck = 0;
        if (rb.mode === 'work') nextTarget(st);
        else rb.p = norm(madd(rb.p, tangentTo(rb.p, rb.t), (2 * ROBOT_R + 2.5) / R));   // cestou domů kámen přeskočí
      }
    } else rb.stuck = 0;
  }

  let completed = [];
  if (rb.mode === 'work') {
    const limit = Math.ceil((mk.hopper - rb.load) * UNITS_PER_KG);
    const r = sweepCapsule(from, rb.p, STATION.width / 2, Math.round(STATION.power * (mk.speed / 2.5) * dt * 10), limit);
    rb.load += r.got / UNITS_PER_KG;
    completed = r.completed;
    game.s.money += completed.length * hexBonus();
    if (dist <= 0.05) nextTarget(st);
  } else if (dist <= 0.3) {
    // ve stanici: vyložit a pokračovat
    if (rb.load > 0) {
      game.s.money += rb.load * dustPrice();
      rb.load = 0;
    }
    if (rb.mode === 'unload' || (rb.mode === 'idle' && nextOpenHex(st, rb.p) >= 0)) {
      rb.mode = 'work';
      rb.k = -1;
      nextTarget(st);
    }
  }
  return completed;
}

// Offline: každý robot vyčistí celé hexy ve své oblasti podle průměrného výkonu.
export function simulateOffline(seconds) {
  const s = game.s;
  const before = s.money;
  for (const st of s.stations) {
    let budget = stationMk(st).kgPerSec * seconds * UNITS_PER_KG;
    const tried = new Set();                         // hexy s kamenem jen jednou (prach pod kamenem zůstane)
    while (budget > 0) {
      const c = nextOpenHex(st, st.robot.p, tried);
      if (c < 0 || hexes.left[c] > budget) break;
      tried.add(c);
      const { got, completed } = clearHex(c, rockTexels(c));
      budget -= Math.max(got, 1);
      s.money += got / UNITS_PER_KG * dustPrice() + (completed ? hexBonus() : 0);
    }
    const rb = st.robot;
    rb.p = cellDir(st.hex);
    rb.load = 0;
    rb.mode = 'work';
    rb.hex = -1;
    rb.k = -1;
    nextTarget(st);
  }
  return s.money - before;
}
