// Interakce klávesou E: otevření budovy, nastoupení/vystoupení, umístění a přesun stanice robota,
// umístění depa a stavba pásu z depa do základny.
import { MOON, INTERACT_RADIUS } from './config.js';
import { vehicleById, SILO } from './catalog.js';
import { game } from './state.js';
import { BUILDINGS, nearDoor } from './base.js';
import { enterVehicle, exitVehicle, isRagdoll } from './player.js';
import { purchase } from './econ.js';
import { vehicleTakenBy, isClient, reportParked } from './net.js';
import { canPlaceStation, placeStation, moveStation } from './robots.js';
import { canPlaceDepot, placeDepot, buildBelt, beltCost, beltPath, beltLoad } from './depots.js';
import { stationPrice } from './equipment.js';
import { cellDir } from './planet/hexgrid.js';
import { madd, norm, angleBetween } from './planet/vec.js';

const R = MOON.radius;
const encDir = p => [Math.round(p[0] * 1e6), Math.round(p[1] * 1e6), Math.round(p[2] * 1e6)];
const kg = v => `${Math.round(v).toLocaleString('cs-CZ')} kg`;

// Režim umisťování: kind = 'station' (nová stanice), 'move' (přesun stanice index), 'depot' (nové depo).
export const placing = { active: false, kind: 'station', index: -1, point: null, valid: false };

export function startPlacing(kind = 'station', index = -1) {
  placing.active = true;
  placing.kind = kind;
  placing.index = index;
  placing.point = null;
}
export function cancelPlacing() {
  placing.active = false;
  placing.index = -1;
}

// Bod 5 m před astronautem, kam by se stavba postavila.
export function updatePlacing() {
  if (!placing.active) return;
  const s = game.s;
  placing.point = norm(madd(s.p, s.f, 5 / R));
  if (placing.kind === 'depot') placing.valid = canPlaceDepot(placing.point) && s.money >= SILO.price;
  else if (placing.kind === 'move') placing.valid = !!s.stations[placing.index] && canPlaceStation(placing.point, placing.index);
  else placing.valid = canPlaceStation(placing.point) && s.money >= stationPrice();
}

// Výsledek nákupu (true/false nebo Promise) → 'placed' / 'denied' pro hlášku v main.js.
const outcome = (r, done) => (r && typeof r.then === 'function' ? r.then(ok => (ok ? done : 'denied')) : (r ? done : null));

function placeAction() {
  const kind = placing.kind;
  if (!placing.valid) {
    const why = kind === 'depot' ? 'Tady depo postavit nejde (mimo základnu, volný hex)' : 'Tady stanici postavit nejde (mimo základnu, volný hex)';
    return { label: `${why} · Esc zruší`, key: 'Esc', run: null };
  }
  if (kind === 'move') {
    return {
      label: 'Položit stanici robota tady', key: 'E',
      run: () => {
        const point = placing.point, i = placing.index;
        cancelPlacing();
        return outcome(purchase('stmove', [i, ...encDir(point)], 0, () => moveStation(i, point)), 'moved');
      },
    };
  }
  if (kind === 'depot') {
    return {
      label: 'Postavit depo tady', key: 'E',
      run: () => {
        const point = placing.point;
        cancelPlacing();
        return outcome(purchase('dep', encDir(point), SILO.price, () => placeDepot(point)), 'depot');
      },
    };
  }
  return {
    label: 'Postavit stanici robota tady', key: 'E',
    run: () => {
      const point = placing.point;
      cancelPlacing();
      return outcome(purchase('st', encDir(point), stationPrice(), () => placeStation(point)), 'placed');
    },
  };
}

// Nejbližší stanice robota v dosahu (index) nebo −1.
function nearStation(p) {
  let best = -1, bestD = INTERACT_RADIUS;
  game.s.stations.forEach((st, i) => {
    const d = angleBetween(p, cellDir(st.hex)) * R;
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

function nearDepot(p) {
  let best = -1, bestD = SILO.zone + 1;
  game.s.depots.forEach((d, i) => {
    const dist = angleBetween(p, cellDir(d.hex)) * R;
    if (dist < bestD) { bestD = dist; best = i; }
  });
  return best;
}

// Co jde právě udělat? Vrací { label, run } nebo null.
// openFacility(id) otevře okno budovy.
export function currentAction(openFacility) {
  const s = game.s;

  if (isRagdoll()) return { label: 'Letíš vzduchem… za chvíli se zvedneš', key: '…', run: null };

  if (placing.active) return placeAction();

  if (s.driving >= 0) {
    const v = s.vehicles[s.driving];
    const i = s.driving;
    return {
      label: vehicleById(v.type).kind === 'push' ? 'Pustit vozík' : 'Vystoupit', key: 'E',
      run: () => { exitVehicle(); if (isClient()) reportParked(i); },
    };
  }

  // vozidla v dosahu
  let nearest = -1, best = INTERACT_RADIUS + 1.5;
  s.vehicles.forEach((v, i) => {
    const d = angleBetween(s.p, v.p) * R;
    if (d < best) { best = d; nearest = i; }
  });
  if (nearest >= 0) {
    const base = vehicleById(s.vehicles[nearest].type);
    const by = vehicleTakenBy(nearest);
    if (by) return { label: `${base.name} právě řídí ${by}`, key: 'E', run: null };
    const label = base.kind === 'push' ? `Chopit se: ${base.name}` : `Nastoupit: ${base.name}`;
    return { label, key: 'E', run: () => enterVehicle(nearest) };
  }

  // stanice robota: sebrat a přenést jinam
  const st = nearStation(s.p);
  if (st >= 0) {
    return { label: 'Sebrat stanici robota a přenést ji jinam', key: 'E', run: () => { startPlacing('move', st); return 'carry'; } };
  }

  // depo: pás do základny
  const di = nearDepot(s.p);
  if (di >= 0) {
    const d = s.depots[di];
    if (!d.belt) {
      const cost = beltCost(di);
      const hexes = beltPath(d.hex).hexes;
      const afford = s.money >= cost;
      return {
        label: `Depo · ${kg(d.store)} · ${afford ? 'postavit' : 'na'} pás do základny (${hexes} hexů) · $${cost.toLocaleString('cs-CZ')}${afford ? '' : ' – zatím málo peněz'}`,
        key: 'E',
        run: afford ? () => outcome(purchase('belt', [di], cost, () => buildBelt(di)), 'belt') : null,
      };
    }
    return { label: `Depo · na skladě ${kg(d.store)} · na pásu ${kg(beltLoad(d))}`, key: 'E', run: null };
  }

  // budovy
  for (const b of BUILDINGS) {
    if (b.id === 'depot' || !nearDoor(s.p, b)) continue;
    if (b.id === 'garage' && !s.garage) {
      return { label: 'Staveniště garáže', key: 'E', run: () => openFacility('garage') };
    }
    return { label: `Vstoupit: ${b.name}`, key: 'E', run: () => openFacility(b.id) };
  }
  return null;
}
