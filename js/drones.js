// UFO drony. Dron startuje nad Výkupem, sám si najde nejbližší nedočištěný hex kdekoli na Měsíci
// (který si nevzal jiný dron), přeletí k němu a čistí ho v řádcích jako robot – jen 4× rychleji.
// Plný zásobník vyloží ve Výkupu nebo v nejbližším depu s pásem a letí zpátky do práce.
// Režimy: 'fly' = přelet k hexu (nečistí), 'work' = čistí, 'unload' = letí vyložit, 'idle' = vše čisté.
import { MOON, BASE, PRICE_PER_KG, HEX_BONUS, UNITS_PER_KG } from './config.js';
import { DRONE } from './catalog.js';
import { game } from './state.js';
import { grid, cellDir, HEX_SPACING } from './planet/hexgrid.js';
import { hexes, sweepCapsule, clearHex } from './planet/dustmap.js';
import { depositToDepot } from './depots.js';
import { cross, madd, norm, tangentTo, angleBetween, anyTangent } from './planet/vec.js';

const R = MOON.radius;
const HALF = HEX_SPACING * 0.62;          // polovina strany čtverce, který pokryje celý hex

export const dronePrice = () => Math.round(DRONE.price * DRONE.priceMult ** game.s.drones.length);

const newDrone = () => ({ p: BASE.dir.slice(), t: BASE.dir.slice(), hex: -1, k: -1, load: 0, mode: 'idle', wait: 0 });

export function buyDrone() {
  const price = dronePrice();
  if (game.s.money < price) return false;
  game.s.money -= price;
  game.s.drones.push(newDrone());
  return true;
}

// Nejbližší nedočištěný hex na celém Měsíci, který nemá jiný dron.
function nearestOpenHex(from, skip) {
  let best = -1, bestDot = -2;
  const D = grid.dirs;
  for (let c = 0; c < grid.cells; c++) {
    if (hexes.done[c] || !hexes.init[c] || skip.has(c)) continue;
    const d = D[c * 3] * from[0] + D[c * 3 + 1] * from[1] + D[c * 3 + 2] * from[2];
    if (d > bestDot) { bestDot = d; best = c; }
  }
  return best;
}

const claimed = me => new Set(game.s.drones.filter(d => d !== me && d.hex >= 0).map(d => d.hex));

// Bod „sekačky“ k v hexu dronu (řádky tam a zpátky), nebo null, když je hex projetý.
function waypoint(dr) {
  const c = cellDir(dr.hex);
  const e1 = anyTangent(c), e2 = cross(c, e1);
  const row = dr.k >> 1;
  const y = -HALF + row * DRONE.rowGap;
  if (y > HALF + DRONE.rowGap * 0.5) return null;
  const x = ((row & 1) ^ (dr.k & 1)) ? HALF : -HALF;
  return norm(madd(madd(c, e1, x / R), e2, Math.min(HALF, y) / R));
}

// Kam vyložit: Výkup, nebo depo s pásem, je-li blíž. { dir, depot }.
function dropPoint(from) {
  let best = { dir: BASE.dir, depot: -1 }, bestA = angleBetween(from, BASE.dir);
  game.s.depots.forEach((d, i) => {
    if (!d.belt) return;
    const dir = cellDir(d.hex), a = angleBetween(from, dir);
    if (a < bestA) { bestA = a; best = { dir, depot: i }; }
  });
  return best;
}

function nextHex(dr) {
  const c = nearestOpenHex(dr.p, claimed(dr));
  dr.hex = c;
  dr.k = 0;
  if (c < 0) {                                       // Měsíc je čistý → nad Výkup
    dr.mode = 'idle';
    dr.t = BASE.dir.slice();
    return;
  }
  dr.mode = 'fly';
  dr.t = waypoint(dr);
}

// Krok dronu; vrací seznam dočištěných hexů.
export function droneTick(dr, dt) {
  if (dr.mode === 'work' && dr.load >= DRONE.hopper - 0.05) {
    dr.mode = 'unload';
    dr.drop = dropPoint(dr.p);
    dr.t = dr.drop.dir;
  }
  if (dr.mode === 'idle') {
    dr.wait -= dt;
    if (dr.wait <= 0) { dr.wait = 3; nextHex(dr); }
  }

  const dist = angleBetween(dr.p, dr.t) * R;
  const from = dr.p;
  const speed = dr.mode === 'work' ? DRONE.speed : DRONE.cruise;
  if (dist > 0.05) dr.p = norm(madd(dr.p, tangentTo(dr.p, dr.t), Math.min(speed * dt, dist) / R));
  const arrived = dist <= speed * dt + 0.05;

  let completed = [];
  if (dr.mode === 'work') {
    const limit = Math.ceil((DRONE.hopper - dr.load) * UNITS_PER_KG);
    const r = sweepCapsule(from, dr.p, DRONE.width / 2, Math.round(DRONE.power * dt * 10), limit);
    dr.load += r.got / UNITS_PER_KG;
    completed = r.completed;
    game.s.money += completed.length * HEX_BONUS;
    if (hexes.done[dr.hex]) nextHex(dr);
    else if (arrived) {
      dr.k++;
      const t = waypoint(dr);
      if (t) dr.t = t;
      else { dr.k = -1; nextHex(dr); }            // hex projetý, ale zbyl prach v rohu → znovu od kraje
    }
  } else if (dr.mode === 'fly' && arrived) {
    if (dr.hex < 0 || hexes.done[dr.hex]) nextHex(dr);
    else dr.mode = 'work';
  } else if (dr.mode === 'unload' && arrived) {
    const drop = dr.drop || dropPoint(dr.p);
    if (drop.depot >= 0 && game.s.depots[drop.depot]?.belt) depositToDepot(drop.depot, dr.load);
    else game.s.money += dr.load * PRICE_PER_KG;
    dr.load = 0;
    dr.drop = null;
    if (dr.hex >= 0 && !hexes.done[dr.hex]) { dr.mode = 'fly'; dr.t = waypoint(dr) || cellDir(dr.hex); }
    else nextHex(dr);
  }
  return completed;
}

// Offline: každý dron vyčistí celé hexy podle průměrného výkonu (nejbližší ke své poloze).
export function dronesOffline(seconds) {
  const s = game.s;
  const before = s.money;
  for (const dr of s.drones) {
    let budget = DRONE.kgPerSec * seconds * UNITS_PER_KG;
    for (let n = 0; budget > 0 && n < 3000; n++) {
      const c = nearestOpenHex(dr.p, claimed(dr));
      if (c < 0 || hexes.left[c] > budget) break;
      const { got, completed } = clearHex(c);
      budget -= Math.max(got, 1);
      s.money += got / UNITS_PER_KG * PRICE_PER_KG + (completed ? HEX_BONUS : 0);
      dr.p = cellDir(c);
    }
    dr.load = 0;
    dr.hex = -1;
    dr.mode = 'idle';
    dr.wait = 0;
  }
  return s.money - before;
}
