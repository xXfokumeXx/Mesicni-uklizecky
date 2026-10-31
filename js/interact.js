// Interakce klávesou E: otevření budovy, nastoupení/vystoupení (i jako cestující do přepravníku),
// umístění a přesun stanice robota, umístění depa a stavba pásu z depa do základny nebo do jiného depa.
// Stavba = stavební sada ve vybraném políčku hotbaru (hotbar.js).
import { MOON, INTERACT_RADIUS, PLANET } from './config.js';
import { nearRocket, rocketReady, cleanPercent, launchSeconds } from './rocket.js';
import { vehicleById, SILO } from './catalog.js';
import { game } from './state.js';
import { BUILDINGS, nearDoor } from './base.js';
import { enterVehicle, exitVehicle, isRagdoll, riding, boardVehicle, leaveRide } from './player.js';
import { purchase } from './econ.js';
import { vehicleTakenBy, isClient, reportParked, seatsTaken } from './net.js';
import { canPlaceStation, placeStation, moveStation } from './robots.js';
import { canPlaceDepot, placeDepot, buildBelt, beltCost, beltPath, beltLoad, beltTargets, canMoveDepot, moveDepot } from './depots.js';
import { heldKit, putKit, clearKit } from './hotbar.js';
import { stationPrice } from './equipment.js';
import { cellDir } from './planet/hexgrid.js';
import { madd, norm, angleBetween } from './planet/vec.js';

const R = MOON.radius;
const encDir = p => [Math.round(p[0] * 1e6), Math.round(p[1] * 1e6), Math.round(p[2] * 1e6)];
const kg = v => `${Math.round(v).toLocaleString('cs-CZ')} kg`;

// Režim umisťování (podle sady ve vybraném políčku hotbaru):
// kind = 'station' (nová stanice), 'move' (přesun stanice index), 'depot' (nové depo), 'dmove' (přesun depa index).
export const placing = { active: false, kind: 'station', index: -1, point: null, valid: false };

// Stavební sada do hotbaru (do ruky); postaví se klávesou E.
export function startPlacing(kind = 'station', index = -1) {
  putKit({ kit: kind, i: index });
  placing.point = null;
}
// Zahodí sadu ve vybraném políčku (sebraná stanice zůstane, kde byla).
export function cancelPlacing() {
  clearKit();
  placing.active = false;
  placing.index = -1;
}

// Bod 5 m před astronautem, kam by se stavba postavila.
export function updatePlacing() {
  const s = game.s;
  const kit = heldKit();
  placing.active = !!kit && s.driving < 0 && !riding();
  if (!placing.active) return;
  placing.kind = kit.kit;
  placing.index = kit.kit === 'move' || kit.kit === 'dmove' ? kit.i : -1;
  placing.point = norm(madd(s.p, s.f, 5 / R));
  if (placing.kind === 'depot') placing.valid = canPlaceDepot(placing.point) && s.money >= SILO.price;
  else if (placing.kind === 'dmove') placing.valid = !!s.depots[placing.index] && canMoveDepot(placing.index, placing.point) && s.money >= SILO.moveCost;
  else if (placing.kind === 'move') placing.valid = !!s.stations[placing.index] && canPlaceStation(placing.point, placing.index);
  else placing.valid = canPlaceStation(placing.point) && s.money >= stationPrice();
}

// Výsledek nákupu (true/false nebo Promise) → 'placed' / 'denied' pro hlášku v main.js.
const outcome = (r, done) => (r && typeof r.then === 'function' ? r.then(ok => (ok ? done : 'denied')) : (r ? done : null));

function placeAction() {
  const kind = placing.kind;
  if (!placing.valid) {
    const why = kind === 'dmove' && game.s.money < SILO.moveCost ? `Přesun depa stojí $${SILO.moveCost.toLocaleString('cs-CZ')} – zatím málo peněz`
      : kind === 'depot' || kind === 'dmove' ? 'Tady depo postavit nejde (mimo základnu, volný hex)' : 'Tady stanici postavit nejde (mimo základnu, volný hex)';
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
  if (kind === 'dmove') {
    return {
      label: `Přesunout depo ${placing.index + 1} sem · $${SILO.moveCost.toLocaleString('cs-CZ')}`, key: 'E',
      run: () => {
        const point = placing.point, i = placing.index;
        cancelPlacing();
        return outcome(purchase('depmove', [i, ...encDir(point)], SILO.moveCost, () => moveDepot(i, point)), 'dmoved');
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

// Cíl pásu, který se postaví u depa: index do beltTargets() (0 = Výkup). Mění se klávesou R.
let beltPick = { depot: -1, k: 0 };
export function cycleBeltTarget() {
  const di = nearDepot(game.s.p);
  if (di < 0 || game.s.depots[di].belt) return false;
  const n = beltTargets(di).length;
  beltPick = { depot: di, k: beltPick.depot === di ? (beltPick.k + 1) % n : 1 % n };
  return true;
}
function beltTarget(di) {
  const list = beltTargets(di);
  if (beltPick.depot !== di) beltPick = { depot: di, k: 0 };
  return list[beltPick.k % list.length] ?? -1;
}
const targetName = to => (to < 0 ? 'Výkup' : `depo ${game.s.depots.findIndex(d => d.hex === to) + 1}`);

// Klávesa G u depa: vezme depo do hotbaru a dá se postavit jinde (za SILO.moveCost).
export function startDepotMove() {
  const s = game.s;
  if (s.driving >= 0 || riding() || isRagdoll() || placing.active) return false;
  const di = nearDepot(s.p);
  if (di < 0) return false;
  startPlacing('dmove', di);
  return true;
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

  const ride = riding();
  if (ride) {
    return { label: `Vystoupit z přepravníku (sedadlo ${ride.seat + 1})`, key: 'E', run: () => { leaveRide(); } };
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
    if (by && base.seats) {                          // přepravník: přisednout jako cestující
      const taken = seatsTaken(nearest);
      let seat = 0;
      while (taken.has(seat)) seat++;
      if (seat >= base.seats) return { label: `${base.name} je plný (řídí ${by})`, key: 'E', run: null };
      return { label: `Přisednout k řidiči ${by} (místo ${seat + 1} z ${base.seats})`, key: 'E', run: () => { boardVehicle(nearest, seat); } };
    }
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
      const to = beltTarget(di);
      const cost = beltCost(di, to);
      const hexes = beltPath(d.hex, to).hexes;
      const afford = s.money >= cost;
      const more = `${beltTargets(di).length > 1 ? ' · R = jiný cíl' : ''} · G = přesunout`;
      return {
        label: `Depo ${di + 1} · ${kg(d.store)} · ${afford ? 'postavit' : 'na'} pás → ${targetName(to)} (${hexes} hexů) · $${cost.toLocaleString('cs-CZ')}${afford ? '' : ' – zatím málo peněz'}${more}`,
        key: 'E',
        run: afford ? () => outcome(purchase('belt', [di, to], cost, () => buildBelt(di, to)), 'belt') : null,
      };
    }
    return {
      label: `Depo ${di + 1} · na skladě ${kg(d.store)} · na pásu ${kg(beltLoad(d))} → ${targetName(d.to ?? -1)} · přesunout jinam ($${SILO.moveCost.toLocaleString('cs-CZ')})`,
      key: 'E', run: () => { startPlacing('dmove', di); return 'dcarry'; },
    };
  }

  // raketa na odvrácené straně: odlet, až bude planeta na 100 % čistá
  if (nearRocket(s.p)) {
    if (launchSeconds() >= 0) return { label: 'Raketa startuje…', key: '🚀', run: null };
    if (!rocketReady()) {
      return { label: `Raketa domů čeká, až bude ${PLANET.name} na 100 % čistý · hotovo ${cleanPercent().toLocaleString('cs-CZ')} %`, key: 'E', run: null };
    }
    return {
      label: PLANET.id === 'moon' ? 'Nastoupit do rakety a odletět · kurz Mars' : 'Nastoupit do rakety a odletět domů na Zemi',
      key: 'E', run: () => 'liftoff',
    };
  }

  // budovy (do Výkupu: hologram planety a burza)
  for (const b of BUILDINGS) {
    if (!nearDoor(s.p, b)) continue;
    if (b.id === 'depot') return { label: 'Výkup prachu · hologram a burza', key: 'E', run: () => openFacility('depot') };
    if (b.id === 'garage' && !s.garage) {
      return { label: 'Staveniště garáže', key: 'E', run: () => openFacility('garage') };
    }
    return { label: `Vstoupit: ${b.name}`, key: 'E', run: () => openFacility(b.id) };
  }
  return null;
}
