// Stanice robotů. Každá stanice má jednoho robota, který čistí hexy do vzdálenosti 2 hexů
// od hexu stanice (19 hexů), projíždí je v řádcích jako sekačka a plný se vrací vyložit do stanice.
import { MOON, BASE, UNITS_PER_KG } from './config.js';
import { STATION } from './catalog.js';
import { game, dustPrice, hexBonus } from './state.js';
import { stationPrice } from './equipment.js';
import { grid, dirToCell, cellDir, HEX_SPACING } from './planet/hexgrid.js';
import { hexes, sweepCapsule, clearHex } from './planet/dustmap.js';
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
    && !(game.s.depots || []).some(d => d.hex === hex);
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

export function placeStation(p) {
  const price = stationPrice();
  if (game.s.money < price || !canPlaceStation(p)) return false;
  game.s.money -= price;
  const hex = dirToCell(p);
  const home = cellDir(hex);
  game.s.stations.push({
    hex,
    robot: { p: home, t: home, hex: -1, k: -1, load: 0, mode: 'work' },
  });
  return true;
}

// Nejbližší nedočištěný hex v oblasti stanice.
function nextOpenHex(st, from) {
  let best = -1, bestDot = -2;
  for (const c of hexArea(st.hex)) {
    if (hexes.done[c] || !hexes.init[c]) continue;
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
  const home = cellDir(st.hex);

  if (rb.mode !== 'work') {
    rb.t = home;
  } else if (rb.load >= STATION.hopper - 0.05) {
    rb.mode = 'unload';
    rb.t = home;
  }

  const dist = angleBetween(rb.p, rb.t) * R;
  const from = rb.p;
  if (dist > 0.05) {
    rb.p = norm(madd(rb.p, tangentTo(rb.p, rb.t), Math.min(STATION.speed * dt, dist) / R));
  }

  let completed = [];
  if (rb.mode === 'work') {
    const limit = Math.ceil((STATION.hopper - rb.load) * UNITS_PER_KG);
    const r = sweepCapsule(from, rb.p, STATION.width / 2, Math.round(STATION.power * dt * 10), limit);
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
    let budget = STATION.kgPerSec * seconds * UNITS_PER_KG;
    while (budget > 0) {
      const c = nextOpenHex(st, st.robot.p);
      if (c < 0 || hexes.left[c] > budget) break;
      const { got, completed } = clearHex(c);
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
