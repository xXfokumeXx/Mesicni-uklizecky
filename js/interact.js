// Interakce klávesou E: otevření budovy, nastoupení/vystoupení (i jako cestující do přepravníku),
// umístění a přesun stanice robota (depa a pásy se ve 3.0 staví kladivem – build.js, logistics.js).
// Stavba = stavební sada ve vybraném políčku hotbaru (hotbar.js).
import { MOON, INTERACT_RADIUS, PLANET } from './config.js';
import { nearRocket, rocketReady, cleanPercent, launchSeconds } from './rocket.js';
import { vehicleById } from './catalog.js';
import { game } from './state.js';
import { BUILDINGS, nearDoor, inBuyback } from './base.js';
import { enterVehicle, exitVehicle, isRagdoll, riding, boardVehicle, leaveRide, playerFx, landAircraft, airPose } from './player.js';
import { carryPrompt, carriedBy } from './carry.js';
import { airHome, LAAC } from './laac.js';
import { purchase } from './econ.js';
import { vehicleTakenBy, isClient, reportParked, seatsTaken } from './net.js';
import { canPlaceStation, placeStation, moveStation, stationUpgradeOffer, upgradeStation } from './robots.js';
import { STATION_MK, stationMk } from './catalog.js';
import { depotAt, depotRoom, DEPOT, stationHasBelt } from './logistics.js';
import { heldKit, putKit, clearKit } from './hotbar.js';
import { stationPrice } from './equipment.js';
import { cellDir } from './planet/hexgrid.js';
import { madd, norm, angleBetween } from './planet/vec.js';
import { buildPrompt } from './build.js';
import { structureToUse, garageName, structureById } from './structures.js';
import { activeEquipment } from './equipment.js';

const R = MOON.radius;
const encDir = p => [Math.round(p[0] * 1e6), Math.round(p[1] * 1e6), Math.round(p[2] * 1e6)];
const kg = v => `${Math.round(v).toLocaleString('cs-CZ')} kg`;

// Režim umisťování (podle sady ve vybraném políčku hotbaru):
// kind = 'station' (nová stanice, index = MK), 'move' (přesun stanice index).
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
  placing.index = kit.kit === 'move' || kit.kit === 'station' ? kit.i : -1;   // u nové stanice = MK úroveň
  placing.point = norm(madd(s.p, s.f, 5 / R));
  if (placing.kind === 'move') placing.valid = !!s.stations[placing.index] && canPlaceStation(placing.point, placing.index);
  else placing.valid = canPlaceStation(placing.point) && s.money >= stationPrice() + STATION_MK[Math.max(1, placing.index)].extra;
}

// Výsledek nákupu (true/false nebo Promise) → 'placed' / 'denied' pro hlášku v main.js.
const outcome = (r, done) => (r && typeof r.then === 'function' ? r.then(ok => (ok ? done : 'denied')) : (r ? done : null));

function placeAction() {
  const kind = placing.kind;
  if (!placing.valid) {
    const why = 'Tady stanici postavit nejde (mimo základnu, volný hex)';
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
  const mk = Math.max(1, placing.index);
  return {
    label: `Postavit tady: ${STATION_MK[mk].name}`, key: 'E',
    run: () => {
      const point = placing.point;
      cancelPlacing();
      return outcome(purchase('st', [...encDir(point), mk], stationPrice() + STATION_MK[mk].extra, () => placeStation(point, mk)), 'placed');
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

// Klávesa R u stanice robota: vylepšení na Vysavač MK1 / MK2 (L-31). Vrací výsledek nákupu, nebo null.
export function stationUpgradeNear() {
  const s = game.s;
  if (s.driving >= 0 || riding() || placing.active) return null;
  const i = nearStation(s.p);
  const o = i >= 0 ? stationUpgradeOffer(i) : null;
  if (!o || o.reason) return null;
  return outcome(purchase('stup', [i], o.price, () => upgradeStation(i)), 'stup');
}

// V zóně plného depa s nákladem: text varování (s „ · “ na konci), jinak ''
function depotFull(s) {
  const id = depotAt(s.p);
  if (!id) return '';
  const load = activeEquipment().item?.load || 0;
  return load > 0.05 && depotRoom(structureById(id)) < 0.1 ? `Depo je plné (${DEPOT.cap.toLocaleString('cs-CZ')} kg) – napoj pás nebo vyvez prach · ` : '';
}

// Co jde právě udělat? Vrací { label, run } nebo null.
// openFacility(id) otevře okno budovy.
export function currentAction(openFacility) {
  const s = game.s;

  if (isRagdoll()) return { label: 'Letíš vzduchem… za chvíli se zvedneš', key: '…', run: null };

  if (placing.active) return placeAction();

  const bp = buildPrompt();                          // kladivo: stavění / bourání / stavební lišta
  if (bp) return bp;

  const ride = riding();
  if (ride) {
    return { label: `Vystoupit z přepravníku (sedadlo ${ride.seat + 1})`, key: 'E', run: () => { leaveRide(); } };
  }

  const full = depotFull(s);                           // plné depo s nákladem v zásobníku (D-05)
  if (s.driving >= 0) {
    const v = s.vehicles[s.driving];
    const i = s.driving;
    // výsypka depa (L-63): stav nakládání před textem výstupu
    const d = playerFx.dump;
    const dump = !d ? '' : d.state === 'dump' ? `Vysypávání do depa · ${d.rate} kg/s · ` : d.state === 'wait' ? `Výsypka depa · zastav (${d.rate} kg/s) · `
      : d.state === 'full' ? 'Depo je plné · ' : 'Zásobník je prázdný · ';
    const hint = !d && depotAt(s.p) && (v.load || 0) > 0.05 ? 'Vozidlo vysypeš do depa výsypkou za ním (rameno se žlutou zónou) · ' : '';
    if (vehicleById(v.type).kind === 'air' && v.air?.mode !== 'ground') {        // letoun ve vzduchu (3.1, L-66): E = přistát
      if (v.air?.mode === 'land') return { label: 'Přistávání…', key: '…', run: null };
      // Kondor nad silem (nakládání prachu) a převoz vozidla (Mula lano / Kondor ruka) – 3.1, L-67
      const sl = playerFx.silo;
      const silo = !sl ? '' : sl.state === 'load' ? `Nakládání ze sila · ${sl.rate} kg/s · ` : sl.state === 'wait' ? 'Silo · zastav a nakládej · '
        : sl.state === 'low' ? 'Silo · vystoupej 6–14 m nad silo · ' : sl.state === 'high' ? 'Silo · klesni na 6–14 m nad silo · ' : sl.state === 'full' ? 'Nákladový prostor je plný · ' : 'Silo je prázdné · ';
      const cp = carryPrompt(v, airPose());
      if (cp && !cp.soft) return { label: `${silo}${cp.label}`, key: cp.run ? 'E' : '…', run: cp.run ? () => { const m = cp.run(); return m ? { blocked: m } : null; } : null };
      const home = airHome(v);
      const onPad = home && angleBetween(home.dir, s.p) * R <= LAAC.landReach;
      return { label: `${dump}${silo}Přistát${onPad ? ' na plošinu' : ''} · mezerník / Shift = výš / níž${cp?.soft ? ` · ${cp.label}` : ''}`, key: 'E', run: () => { const msg = landAircraft(); return msg ? { blocked: msg } : null; } };
    }
    return {
      label: `${dump}${hint}${full}${vehicleById(v.type).kind === 'push' ? 'Pustit vozík' : vehicleById(v.type).kind === 'air' ? 'Vystoupit · W / mezerník = vzlétnout' : 'Vystoupit'}`, key: 'E',
      run: () => { exitVehicle(); if (isClient()) reportParked(i); },
    };
  }

  // Výkup: otevře se kdekoli ve 3 vysýpacích zónách pod rameny pásů (kruhy 3,5 m) i u vchodu; vozidlo zaparkované u něj má přednost, jen když stojíš přímo u něj
  const inDepot = inBuyback(s.p);

  // vozidla v dosahu
  let nearest = -1, best = inDepot ? 2.2 : INTERACT_RADIUS + 1.5;
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
    if (carriedBy(nearest)) return { label: `${base.name} právě nese letoun`, key: '…', run: null };   // 3.1
    const label = base.kind === 'push' ? `Chopit se: ${base.name}` : `Nastoupit: ${base.name}`;
    return { label, key: 'E', run: () => enterVehicle(nearest) };
  }

  // stanice robota: sebrat a přenést jinam
  const st = nearStation(s.p);
  if (st >= 0) {
    const up = stationUpgradeOffer(st);
    const tail = up ? (up.reason ? ` · ${up.name}: ${up.reason}` : ` · R = vylepšit na ${up.name} ($${up.price.toLocaleString('cs-CZ')})`) : '';
    const S = s.stations[st], mk = stationMk(S);
    const store = ` · zásobník ${Math.round(S.store || 0)} / ${mk.store} kg${stationHasBelt(S) ? '' : ' · bez pásu – prach se neprodá (pás z oranžové zásuvky)'}`;
    return { label: `${mk.name}${store} · E = přenést jinam${tail}`, key: 'E', run: () => { startPlacing('move', st); return 'carry'; } };
  }

  if (full) return { label: full.replace(/ · $/, ''), key: '!', run: null };

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
  if (inDepot) return { label: 'Výkup prachu · hologram a burza', key: 'E', run: () => openFacility('depot') };
  const su = structureToUse(s.p);                    // stavby postavené kladivem (garáž…)
  if (su?.b.type === 'garage') return { label: `Vstoupit: ${garageName(su.b.id)}`, key: 'E', run: () => openFacility('garage', su.b.id) };
  if (su?.b.type === 'charger') return { label: 'Nabíječka · sloty a rychlonabíjení', key: 'E', run: () => openFacility('charger', su.b.id) };
  if (su?.b.type === 'swapper') return { label: 'Výměník baterií · regál', key: 'E', run: () => openFacility('swapper', su.b.id) };
  if (su?.b.type === 'sinter') return { label: 'Slinovna · stav výroby', key: 'E', run: () => openFacility('sinter', su.b.id) };
  if (su?.b.type === 'laac') return { label: 'LAAC · letouny, hangár, plošiny a vylepšení', key: 'E', run: () => openFacility('laac', su.b.id) };   // 3.1
  if (su?.b.type === 'research') return { label: 'Výzkumné centrum · strom technologií', key: 'E', run: () => openFacility('research', su.b.id) };
  for (const b of BUILDINGS) {
    if (!nearDoor(s.p, b)) continue;
    return { label: b.id === 'depot' ? 'Výkup prachu · hologram a burza' : `Vstoupit: ${b.name}`, key: 'E', run: () => openFacility(b.id) };
  }
  return null;
}
