// Interakce klávesou E: otevření budovy, nastoupení/vystoupení, umístění stanice robota.
import { MOON, INTERACT_RADIUS } from './config.js';
import { vehicleById } from './catalog.js';
import { game } from './state.js';
import { BUILDINGS, nearDoor } from './base.js';
import { enterVehicle, exitVehicle, isRagdoll } from './player.js';
import { purchase } from './econ.js';
import { vehicleTakenBy, isClient, reportParked } from './net.js';
import { canPlaceStation, placeStation } from './robots.js';
import { stationPrice } from './equipment.js';
import { madd, norm, angleBetween } from './planet/vec.js';

const R = MOON.radius;

// Režim umisťování stanice robota (po koupi v obchodě).
export const placing = { active: false, point: null, valid: false };

export function startPlacing() {
  placing.active = true;
}
export function cancelPlacing() {
  placing.active = false;
}

// Bod 5 m před astronautem, kam by se stanice postavila.
export function updatePlacing() {
  if (!placing.active) return;
  const s = game.s;
  placing.point = norm(madd(s.p, s.f, 5 / R));
  placing.valid = canPlaceStation(placing.point) && s.money >= stationPrice();
}

// Co jde právě udělat? Vrací { label, run } nebo null.
// openFacility(id) otevře okno budovy.
export function currentAction(openFacility) {
  const s = game.s;

  if (isRagdoll()) return { label: 'Letíš vzduchem… za chvíli se zvedneš', key: '…', run: null };

  if (placing.active) {
    return placing.valid
      ? {
        label: 'Postavit stanici robota tady', key: 'E',
        run: () => {
          const point = placing.point;
          placing.active = false;
          const r = purchase('st', [Math.round(point[0] * 1e6), Math.round(point[1] * 1e6), Math.round(point[2] * 1e6)], stationPrice(), () => placeStation(point));
          return r && typeof r.then === 'function' ? r.then(ok => (ok ? 'placed' : 'denied')) : (r ? 'placed' : null);
        },
      }
      : { label: 'Tady stanici postavit nejde (mimo základnu, volný hex) · Esc zruší', key: 'Esc', run: null };
  }

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
