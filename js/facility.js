// Okna budov (Obchod s nástroji, Dílna, Garáž, Výkup) a okno Úspěchy: mřížka karet vlevo, detail vpravo.
// Výkup: hologram planety (scene/hologram.js) a burza s ekonomickými vylepšeními.
// Obsah se skládá z dat (catalog.js + stav hry), akce volají equipment.js přes econ.js
// (v multiplayeru schvaluje nákupy hostitel). Verze 2: Šatna v Dílně, Flotila v Garáži.
import {
  TOOLS, VEHICLES, TOOL_UPGRADES, VEHICLE_UPGRADES, STATION, BOOTS, SILO, DRONE, BELT, JETPACK, MARKET, HEXUP,
  vehicleById, SUIT_COLORS, HELMET_PROPS, propById, batteryCap, SOLAR_ROOF, STATION_MK,
} from './catalog.js';
import { MOON, PRICE_PER_KG, HEX_BONUS, PLANET } from './config.js';
import { game, dustPrice, hexBonus } from './state.js';
import {
  toolStats, vehicleStats, ownsTool, buyTool, equipTool, toolUpgradeCost, upgradeTool, toolSellValue, sellTool,
  bootsLevel, walkSpeed, bootsUpgradeCost, upgradeBoots, vehicleCount, fleetFull,
  buyVehicle, rehomeVehicle, ownsHammer, buyHammer, vehicleUpgradeCost, vehicleUpgradeLock, upgradeVehicle, stationPrice,
  vehicleSellValue, sellVehicle, upgradeFits, beltLevel, beltUpgradeCost, upgradeBelt, ownsJetpack, buyJetpack,
  marketLevel, marketUpgradeCost, upgradeMarket, hexupLevel, hexupUpgradeCost, upgradeHexup,
} from './equipment.js';
import { hammerSlot, heldHammer } from './hotbar.js';
import { holoCounts } from './scene/hologram.js';
import { cleanPercent } from './rocket.js';
import { purchase, callVehicle } from './econ.js';
import { vehicleTakenBy, isClient, seatsTaken } from './net.js';
import { dronePrice, buyDrone } from './drones.js';
import { ACHIEVEMENTS, hasAch, achIcon, achCount } from './achievements.js';
import { profile, saveProfile, sanitizeName } from './profile.js';
import { distanceToBase } from './base.js';
import { HAMMER, GARAGE_SLOTS, fleetCapacity, freeSlots, garages, garageName, isParkedHome, structureById, homeSpot, STRUCTURES, CHARGER_RATE, chargerSlotOffer, chargerAddSlot, chargerFastOffer, chargerFaster, swapperRackOffer, swapperAddRack, SWAP } from './structures.js';
import { live, netInfo, vehicleOnSlot, networks, slotRate, swapperEta } from './energy.js';
import { angleBetween } from './planet/vec.js';
import { instantiate, isReady, preloadModels } from './assets/models.js';
import { brickPrice, SINTER, beltAt, sinterTime, sinterUpPrice, upgradeSinter } from './logistics.js';
import {
  TECH, TECH_MODEL, BRANCHES, techById, techState, researchOffer, startResearch, unqueueResearch, researchProgress, researchCenter, isDone, RESEARCH_POWER,
} from './research.js';
import { fmt } from './format.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const m = v => (v < 1 ? `${Math.round(v * 100)} cm` : `${v.toFixed(2).replace(/\.?0+$/, '')} m`);
const kg = v => `${v < 10 ? v.toFixed(1) : Math.round(v)} kg`;
const money = v => '$' + fmt(v);
const hex = n => '#' + n.toString(16).padStart(6, '0');
const fmtInt = n => n.toLocaleString('cs-CZ');

const TITLES = { toolshop: 'Obchod s nástroji', workshop: 'Dílna', garage: 'Garáž', trophies: 'Úspěchy', depot: 'Výkup prachu', charger: 'Nabíječka vozidel', research: 'Výzkumné centrum', swapper: 'Výměník baterií', sinter: 'Slinovna' };

let thumb = null;            // generátor náhledů (scene/thumbs.js)
let hooks = null;            // { onOpen, onClose, onChange, onPlaceStation, onLook, wardrobe, headModel }
const view = { id: null, tab: null, sel: null, ctx: null };      // ctx = id stavby (okno garáže)
let busy = false;            // čeká se na hostitele (multiplayer)

// Pořadové číslo vozidla stejného typu („Zametač se sedačkou #2“).
function vehicleName(i) {
  const v = game.s.vehicles[i];
  const base = vehicleById(v.type);
  const same = game.s.vehicles.filter(x => x.type === v.type);
  if (same.length < 2) return base.name;
  return `${base.name} #${game.s.vehicles.slice(0, i + 1).filter(x => x.type === v.type).length}`;
}

// ---------- obsah jednotlivých budov ----------

function toolsTab(forUpgrades) {
  const list = forUpgrades ? TOOLS.filter(t => ownsTool(t.id)) : TOOLS;
  return list.map(t => {
    const owned = ownsTool(t.id);
    const inHand = owned && game.s.tool === t.id && game.s.driving < 0 && !heldHammer();
    const st = toolStats(t.id);
    const item = game.s.tools[t.id];
    const chip = inHand ? ['V RUCE', 'active'] : owned ? ['KOUPENO', 'owned'] : ['V OBCHODĚ', 'store'];
    const detail = {
      eyebrow: 'Ruční nástroj',
      title: t.name,
      desc: t.desc,
      stats: [
        ['Šířka pásu', m(st.width)],
        ['Zásobník', kg(st.hopper)],
        ['Síla', `${st.power} / tick`],
        ...(owned ? [['Náplň', `${kg(item.load)} / ${kg(st.hopper)}`]] : []),
      ],
    };
    if (forUpgrades) {
      detail.upgrades = Object.entries(TOOL_UPGRADES).map(([key, u]) => {
        const lv = item.lv[key];
        const cost = toolUpgradeCost(t.id, key);
        const next = { ...item.lv, [key]: lv + 1 };
        const after = key === 'width' ? m(t.width * (1 + u.step * next.width))
          : key === 'hopper' ? kg(t.hopper * (1 + u.step * next.hopper)) : `${t.power + u.step * next.power}`;
        const now = key === 'width' ? m(st.width) : key === 'hopper' ? kg(st.hopper) : `${st.power}`;
        return {
          name: u.name, lv, max: u.max, effect: cost === null ? now : `${now} → ${after}`,
          cost, run: () => purchase('tup', [t.id, key], cost, () => upgradeTool(t.id, key)),
        };
      });
    } else if (!owned) {
      detail.action = { label: `Koupit · ${money(t.price)}`, disabled: game.s.money < t.price, run: () => purchase('tool', [t.id], t.price, () => buyTool(t.id)) };
    } else if (!inHand) {
      detail.action = { label: 'Vzít do ruky', disabled: game.s.driving >= 0, run: () => equipTool(t.id) };
    } else {
      detail.action = { label: 'Máš v ruce', disabled: true };
    }
    if (!forUpgrades && owned) detail.action2 = toolSellAction(t);
    return { key: t.id, name: t.name, chip, thumb: () => thumb(`tool-${t.id}`, () => instantiate('tool', t.id).root), detail };
  });
}

// Prodej nástroje v Obchodě (30 % ceny i vylepšení), dvojklikem jako u vozidel; potom jde koupit znovu.
function toolSellAction(t) {
  const value = toolSellValue(t.id);
  const key = `tool:${t.id}`;
  if (sellArmed !== key) return { label: `Prodat za ${money(value)} (30 % ceny)`, danger: true, run: () => { sellArmed = key; return 'stay'; } };
  return {
    label: `Opravdu prodat? Vrátí se ${money(value)}`, danger: true, armed: true,
    run: () => { sellArmed = null; return purchase('tsell', [t.id, value], 0, () => sellTool(t.id)); },
  };
}

// Vysavače MK1 / MK2 (L-31): nová stanice vyšší úrovně; stávající se vylepší na místě klávesou R
function vacuumItem(mk) {
  const M = STATION_MK[mk], price = stationPrice() + M.extra;
  const n = game.s.stations.filter(st => (st.mk | 0) === mk).length;
  const ok = isDone(M.research);
  return {
    key: `vac${mk}`, name: M.name,
    chip: ok ? [n ? `${n}× POSTAVENO` : 'V OBCHODĚ', n ? 'owned' : 'store'] : ['ZAMČENO', 'locked'],
    thumb: () => thumb('station', () => instantiate('station').root),
    detail: {
      eyebrow: 'Automatizace · výzkum', title: M.name,
      desc: `Stanice s rychlejším robotem${mk >= 2 ? ', který uklízí o prstenec hexů dál' : ''}. Stávající stanici vylepšíš na místě: stoupni si k ní a stiskni R (zaplatí se jen rozdíl).`,
      stats: [
        ['Oblast', mk >= 2 ? '37 hexů (3 kolem stanice)' : '19 hexů (2 kolem stanice)'],
        ['Zásobník robota', kg(M.hopper)], ['Rychlost', `${String(M.speed).replace('.', ',')} m/s`],
        ['Vylepšení MK1 → MK2', money(M.extra - STATION_MK[mk - 1].extra)],
      ],
      action: !ok ? { label: `🔒 Nejdřív výzkum „${M.name}“ (Výzkumné centrum)`, disabled: true }
        : { label: `Koupit a umístit · ${money(price)}`, disabled: game.s.money < price, run: () => { hooks.onPlaceStation(mk); return 'close'; } },
    },
  };
}

function stationsTab() {
  const price = stationPrice();
  return [{
    key: 'station',
    name: 'Vysavač MK1',
    chip: [`${game.s.stations.length}× POSTAVENO`, game.s.stations.length ? 'owned' : 'store'],
    thumb: () => thumb('station', () => instantiate('station').root),
    detail: {
      eyebrow: 'Automatizace',
      title: 'Vysavač MK1',
      desc: 'Stanice s robotem, který čistí hexy do vzdálenosti 2 hexů od stanice a sám se do ní vykládá. Po výzkumu „Vysavač MK2“ ji vylepšíš na místě klávesou R.',
      stats: [
        ['Oblast', '19 hexů (2 kolem stanice)'],
        ['Šířka pásu robota', m(STATION.width)],
        ['Zásobník robota', kg(STATION.hopper)],
        ['Rychlost', `${String(STATION.speed).replace('.', ',')} m/s`],
        ['Postaveno', `${game.s.stations.length}`],
      ],
      action: {
        label: `Koupit a umístit · ${money(price)}`,
        disabled: game.s.money < price,
        run: () => { hooks.onPlaceStation(); return 'close'; },
      },
    },
  }, vacuumItem(2)];    // UFO dron se kupuje ve Výzkumném centru (F-02 / L-32)
}

function droneItem() {
  const price = dronePrice();
  const n = game.s.drones.length;
  return {
    key: 'drone',
    name: 'UFO dron',
    chip: [n ? `${n}× LÉTÁ` : 'V OBCHODĚ', n ? 'owned' : 'store'],
    thumb: () => thumb('drone', () => instantiate('drone').root),
    detail: {
      eyebrow: 'Automatizace · létající',
      title: 'UFO dron',
      desc: 'Autonomní dron bez stanice: vzlétne nad Výkupem, sám si najde nejbližší nedočištěný hex kdekoli na Měsíci '
        + 'a uklidí ho 4× rychleji než robot ze stanice. Plný se vyloží ve Výkupu nebo v depu s pásem. Každý další dron je dražší.',
      stats: [
        ['Šířka pásu', m(DRONE.width)],
        ['Rychlost čištění', `${DRONE.speed} m/s (přelet ${DRONE.cruise} m/s)`],
        ['Zásobník', kg(DRONE.hopper)],
        ['Ve vzduchu', `${n}`],
      ],
      action: {
        label: `Koupit · ${money(price)}`,
        disabled: game.s.money < price,
        run: () => purchase('drone', [], price, buyDrone),
      },
    },
  };
}

function vehiclesShopTab() {
  const full = fleetFull();
  return VEHICLES.map(v => {
    const count = vehicleCount(v.id);
    const chip = count ? [`VLASTNÍŠ ${count}×`, 'owned'] : ['V OBCHODĚ', 'store'];
    const stats = v.kind === 'transport'
      ? [['Max. rychlost', `${v.speed.toFixed(1)} m/s`], ['Zametání', 'ne – jen přesun']]
      : [['Šířka sání', m(v.width)], ['Zásobník', kg(v.hopper)], ['Max. rychlost', `${v.speed.toFixed(1)} m/s`]];
    stats.push(['Ve flotile', `${count}×`]);
    return {
      key: v.id, name: v.name, chip,
      thumb: () => thumb(`veh-${v.id}`, () => instantiate(`vehicle-${v.id}`).root),
      detail: {
        eyebrow: v.kind === 'push' ? 'Zametací vozík' : v.kind === 'transport' ? 'Přepravní vozidlo' : 'Zametací vozidlo',
        title: v.name, desc: v.desc, stats,
        action: full
          ? { label: `Všechny garáže jsou plné (${fleetCapacity()} míst) – postav další kladivem`, disabled: true }
          : { label: `${count ? 'Koupit další' : 'Koupit'} · ${money(v.price)}`, disabled: game.s.money < v.price, run: () => purchase('veh', [v.id, view.ctx || ''], v.price, () => buyVehicle(v.id, view.ctx)) },
      },
    };
  });
}

// Kde vozidlo je a kdo s ním jede.
function vehicleStatus(i) {
  const v = game.s.vehicles[i];
  if (game.s.driving === i) return { chip: ['ŘÍDÍŠ TY', 'active'], text: 'Právě s ním jedeš ty', home: false, busy: true };
  const by = vehicleTakenBy(i);
  if (by) return { chip: [`ŘÍDÍ ${by.toUpperCase()}`, 'active'], text: `Řídí ${by}`, home: false, busy: true };
  const riders = seatsTaken(i).size;
  if (riders) return { chip: ['CESTUJÍCÍ', 'active'], text: `Cestující: ${riders}`, home: false, busy: true };
  const home = garageName(v.garage);
  if (isParkedHome(v)) return { chip: ['NA PARKOVIŠTI', 'store'], text: `${home}, místo ${(v.spot | 0) + 1}`, home: true, busy: false };
  const far = Math.round(angleBetween(v.p, homeSpot(v).dir) * MOON.radius);
  return { chip: ['VENKU', 'owned'], text: `Stojí venku · ${far} m od domova (${home})`, home: false, busy: false };
}

function fleetTab() {
  return game.s.vehicles.map((veh, i) => {
    const v = vehicleById(veh.type);
    const st = vehicleStats(veh);
    const status = vehicleStatus(i);
    const stats = [['Stav', status.text]];
    if (v.hopper) stats.push(['Náplň', `${kg(veh.load)} / ${kg(st.hopper)}`], ['Šířka sání', m(st.width)]);
    stats.push(['Max. rychlost', `${st.speed.toFixed(1)} m/s`], ['Vylepšení', upgradeSummary(veh)]);
    return {
      key: `v${i}`, name: vehicleName(i), chip: status.chip,
      thumb: () => thumb(`veh-${v.id}`, () => instantiate(`vehicle-${v.id}`).root),
      detail: {
        eyebrow: `Flotila · vozidlo ${i + 1} z ${game.s.vehicles.length}`,
        title: vehicleName(i), desc: v.desc, stats,
        action: rehomeAction(i, status) || (status.home
          ? { label: 'Stojí na parkovišti', disabled: true }
          : { label: 'Přivolat na parkoviště', disabled: status.busy, run: () => callVehicle(i) }),
        action2: sellAction(i, status.busy),
      },
    };
  });
}

// V okně jiné garáže: přeřadit vozidlo sem (domov se změní, vozidlo zůstane stát, kde je).
function rehomeAction(i, status) {
  const veh = game.s.vehicles[i];
  if (!view.ctx || veh.garage === view.ctx || !structureById(view.ctx)) return null;
  if (!freeSlots(view.ctx).length) return { label: `${garageName(view.ctx)} je plná`, disabled: true };
  return { label: `Přeřadit do: ${garageName(view.ctx)}`, disabled: status.busy, run: () => purchase('vhome', [i, veh.uid, view.ctx], 0, () => rehomeVehicle(i, view.ctx)) };
}

// Prodej vozidla: první klik se zeptá, druhý prodá (75 % ceny včetně vylepšení).
let sellArmed = null;                // uid vozidla / 'tool:<id>', u kterého se čeká na potvrzení prodeje
function sellAction(i, busyVeh) {
  const veh = game.s.vehicles[i];
  const value = vehicleSellValue(i);
  if (busyVeh) return { label: `Prodat · ${money(value)} (nejdřív z něj musí všichni vystoupit)`, disabled: true, danger: true };
  if (sellArmed !== veh.uid) {
    return { label: `Prodat za ${money(value)} (75 % ceny)`, danger: true, run: () => { sellArmed = veh.uid; return 'stay'; } };
  }
  return {
    label: `Opravdu prodat? Vrátí se ${money(value)}`, danger: true, armed: true,
    run: () => {
      sellArmed = null;
      return purchase('vsell', [i, veh.uid], 0, () => !vehicleTakenBy(i) && sellVehicle(i));
    },
  };
}

function fleetSummary() {
  const list = game.s.vehicles;
  if (!list.length) return '';
  let cap = 0, load = 0, out = 0, moving = 0;
  list.forEach((v, i) => {
    cap += vehicleStats(v).hopper;
    load += v.load;
    const st = vehicleStatus(i);
    if (st.busy) moving++;
    else if (!st.home) out++;
  });
  return `${list.length} / ${fleetCapacity()} vozidel (${garages().length} × ${GARAGE_SLOTS} míst) · zásobníky ${kg(cap)} · náplň ${kg(load)} · v jízdě ${moving} · venku ${out}`;
}

function upgradeSummary(veh) {
  const v = vehicleById(veh.type);
  const parts = [];
  if (v.width) parts.push(`šířka ${veh.lv.width}/5`);
  parts.push(`rychlost ${veh.lv.speed}/5`);
  if (upgradeFits(veh.type, 'hopper')) parts.push(`zásobník ${veh.lv.hopper | 0}/${VEHICLE_UPGRADES.hopper.max}`);
  if (upgradeFits(veh.type, 'boost')) parts.push(`boost ${veh.lv.boost | 0}/${VEHICLE_UPGRADES.boost.max}`);
  if (veh.lv.solar) parts.push(`střecha ${veh.lv.solar}/${VEHICLE_UPGRADES.solar.max}`);
  if (veh.lv.cruise) parts.push(veh.lv.edge ? 'autocruise + hrana' : 'autocruise');
  return parts.join(' · ');
}

function vehiclesUpgradeTab() {
  return game.s.vehicles.map((veh, i) => {
    const v = vehicleById(veh.type);
    const st = vehicleStats(veh);
    const ups = Object.entries(VEHICLE_UPGRADES)
      .filter(([key]) => !(key === 'width' && !v.width) && upgradeFits(veh.type, key))
      .map(([key, u]) => {
        const lv = veh.lv[key] | 0;
        const cost = vehicleUpgradeCost(i, key);
        const pct = k => `${Math.round((1.5 + u.step * k) * 100)} %`;
        const cap = x => `${fmtInt(Math.round(batteryCap({ ...veh, lv: { ...veh.lv, battery: x } })))} ⚡`;
        const roof = x => (SOLAR_ROOF[x] ? `${Math.round(SOLAR_ROOF[x].cover * 100)} % jízdy · ${String(SOLAR_ROOF[x].rest).replace('.', ',')} ⚡/s ve stání` : 'bez střechy');
        const auto = x => (key === 'cruise' ? (x ? 'C = autocruise' : 'bez autocruise') : (x ? 'C 2× = asistent hrany' : 'bez asistenta hrany'));
        const now = key === 'cruise' || key === 'edge' ? auto(lv) : key === 'width' ? m(st.width) : key === 'boost' ? (lv ? pct(lv) : 'bez boostu')
          : key === 'hopper' ? kg(st.hopper) : key === 'battery' ? cap(lv) : key === 'solar' ? roof(lv) : `${st.speed.toFixed(1)} m/s`;
        const after = key === 'cruise' || key === 'edge' ? auto(lv + 1) : key === 'width' ? m(v.width * (1 + u.step * (lv + 1)))
          : key === 'boost' ? pct(lv + 1) : key === 'hopper' ? kg(v.hopper * (1 + u.step * (lv + 1)))
            : key === 'battery' ? cap(lv + 1) : key === 'solar' ? roof(lv + 1) : `${(v.speed * (1 + u.step * (lv + 1))).toFixed(1)} m/s`;
        const locked = vehicleUpgradeLock(key, lv, veh);
        return { name: u.name, lv, max: u.max, effect: cost === null ? now : `${now} → ${after}`, cost, locked, run: () => purchase('vup', [i, key], cost, () => upgradeVehicle(i, key)) };
      });
    return {
      key: `v${i}`, name: vehicleName(i), chip: [game.s.driving === i ? 'POUŽÍVÁŠ' : 'VLASTNÍŠ', 'owned'],
      thumb: () => thumb(`veh-${v.id}`, () => instantiate(`vehicle-${v.id}`).root),
      detail: {
        eyebrow: 'Vozidlo', title: vehicleName(i),
        desc: upgradeFits(veh.type, 'boost') ? `${v.desc} Boost: podrž Shift a přepravník skokově zrychlí (vydrží 4 s, pak se dobíjí).` : v.desc,
        stats: [['Šířka sání', v.width ? m(st.width) : '–'], ...(v.hopper ? [['Zásobník', kg(st.hopper)]] : []), ['Max. rychlost', `${st.speed.toFixed(1)} m/s`], ...(st.boost > 1 ? [['S boostem', `${(st.speed * st.boost).toFixed(1)} m/s`]] : [])],
        upgrades: ups,
      },
    };
  });
}

function astronautTab() {
  const lv = bootsLevel();
  const max = BOOTS.levels.length - 1;
  const cost = bootsUpgradeCost();
  const ms = v => `${v.toFixed(2).replace(/\.?0+$/, '').replace('.', ',')} m/s`;
  const now = ms(walkSpeed(lv));
  return [{
    key: 'boots',
    name: BOOTS.name,
    chip: [lv ? `ÚROVEŇ ${lv}` : 'ZÁKLAD', lv ? 'owned' : 'store'],
    thumb: () => thumb(`boots-${lv}`, () => instantiate('boots', lv).root),
    detail: {
      eyebrow: 'Astronaut',
      title: BOOTS.levels[lv].name,
      desc: BOOTS.desc,
      stats: [
        ['Rychlost chůze', now],
        ['Další úroveň', cost === null ? '–' : BOOTS.levels[lv + 1].name],
      ],
      upgrades: [{
        name: 'Rychlost chůze', lv, max,
        effect: cost === null ? now : `${now} → ${ms(walkSpeed(lv + 1))}`,
        cost, run: () => purchase('boots', [], cost, upgradeBoots),
      }],
    },
  }, beltItem(), jetpackItem(), hammerItem()];
}

function beltItem() {
  const lv = beltLevel();
  const max = BELT.levels.length - 1;
  const cost = beltUpgradeCost();
  const slots = BELT.levels[lv].slots;
  return {
    key: 'belt',
    name: BELT.name,
    chip: [lv ? `${slots} POLÍČKA` : '1 POLÍČKO', lv ? 'owned' : 'store'],
    thumb: () => thumb(`belt-${lv}`, () => instantiate('utility-belt', lv).root),
    detail: {
      eyebrow: 'Astronaut',
      title: BELT.levels[lv].name,
      desc: BELT.desc,
      stats: [
        ['Políček v hotbaru', `${slots}`],
        ['Další úroveň', cost === null ? '–' : BELT.levels[lv + 1].name],
      ],
      upgrades: [{
        name: 'Políčka hotbaru', lv, max,
        effect: cost === null ? `${slots}` : `${slots} → ${BELT.levels[lv + 1].slots}`,
        cost, run: () => purchase('gbelt', [], cost, upgradeBelt),
      }],
    },
  };
}

function hammerItem() {
  const own = ownsHammer();
  const k = hammerSlot();
  return {
    key: 'hammer',
    name: HAMMER.name,
    chip: own ? ['KOUPENO', 'owned'] : ['V NABÍDCE', 'store'],
    thumb: () => thumb('hammer', () => instantiate('hammer').root),
    detail: {
      eyebrow: 'Astronaut · stavění',
      title: HAMMER.name,
      desc: HAMMER.desc,
      stats: [['Klávesy', 'Q kladivo · V stavět · X bourat'], ['Hotbar', own ? (k >= 0 ? `políčko ${k + 1}` : 'bez políčka (Q ho tam dá)') : 'zabere 1 políčko'], ['Bourání vrátí', '60 % ceny']],
      action: own
        ? { label: k >= 0 ? `Máš ho v políčku ${k + 1} · Q = vzít do ruky` : 'Máš ho · Q = dát do hotbaru', disabled: true }
        : { label: `Koupit · ${money(HAMMER.price)}`, disabled: game.s.money < HAMMER.price, run: () => purchase('hammer', [], HAMMER.price, buyHammer) },
    },
  };
}

function jetpackItem() {
  const own = ownsJetpack();
  return {
    key: 'jetpack',
    name: JETPACK.name,
    chip: own ? ['NA ZÁDECH', 'owned'] : ['V NABÍDCE', 'store'],
    thumb: () => thumb('jetpack', () => instantiate('jetpack').root),
    detail: {
      eyebrow: 'Astronaut',
      title: JETPACK.name,
      desc: JETPACK.desc,
      stats: [['Rychlost výstřelu', `${JETPACK.speed} m/s`], ['Nabití', 'po každém dopadu na zem']],
      action: own
        ? { label: 'Máš ho na zádech · mezerník ve vzduchu', disabled: true }
        : { label: `Koupit · ${money(JETPACK.price)}`, disabled: game.s.money < JETPACK.price, run: () => purchase('jet', [], JETPACK.price, buyJetpack) },
    },
  };
}

// ---------- Výkup: burza a hologram ----------

// Ikona burzy (graf) / prémie (hex s dolarem) jako obrázek karty.
function exchangeIcon(kind, lv) {
  const on = lv > 0;
  const fg = on ? '#7fd38a' : '#9aa3b2';
  const body = kind === 'market'
    ? `<polyline points="40,130 85,105 120,115 160,70 200,45" fill="none" stroke="${fg}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`
      + `<polygon points="200,30 212,58 184,52" fill="${fg}"/>`
    : `<polygon points="120,22 177,55 177,120 120,153 63,120 63,55" fill="none" stroke="${fg}" stroke-width="9"/>`
      + `<text x="120" y="108" font-size="62" font-weight="700" text-anchor="middle" fill="${fg}">$</text>`;
  const pips = Array.from({ length: 5 }, (_, k) => `<circle cx="${84 + k * 18}" cy="160" r="5" fill="${k < lv ? '#f2b33d' : '#4a4f5c'}"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="170" viewBox="0 0 240 170">${body}${pips}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function exchangeItem(key, U, lv, cost, run, valueNow, valueNext, stats) {
  const pct = l => `+${Math.round(l * U.step * 100)} %`;
  return {
    key,
    name: U.name,
    chip: [lv ? pct(lv) : 'ZÁKLAD', lv ? 'owned' : 'store'],
    thumb: () => exchangeIcon(key, lv),
    detail: {
      eyebrow: `Výkup prachu · úroveň ${lv} z ${U.max}`,
      title: U.name,
      desc: U.desc,
      stats,
      upgrades: [{
        name: `${U.name} (${pct(1)} za úroveň)`, lv, max: U.max,
        effect: cost === null ? `${valueNow} · nejvyšší úroveň` : `${valueNow} → ${valueNext}`,
        cost, run: () => purchase(key, [], cost, run),
      }],
    },
  };
}

function marketTab() {
  const ml = marketLevel(), hl = hexupLevel();
  const price = l => `$${(PRICE_PER_KG * (1 + MARKET.step * l)).toFixed(2)} / kg`;
  const bonus = l => `$${Math.round(HEX_BONUS * (1 + HEXUP.step * l))} za hex`;
  return [
    exchangeItem('market', MARKET, ml, marketUpgradeCost(), upgradeMarket, price(ml), price(ml + 1), [
      ['Výkupní cena teď', `$${dustPrice().toFixed(2)} / kg`],
      ['Základní cena', `$${PRICE_PER_KG} / kg`],
      ['Další úroveň', ml >= MARKET.max ? '–' : price(ml + 1)],
    ]),
    exchangeItem('hexup', HEXUP, hl, hexupUpgradeCost(), upgradeHexup, bonus(hl), bonus(hl + 1), [
      ['Prémie teď', `$${hexBonus()} za hex`],
      ['Základní prémie', `$${HEX_BONUS} za hex`],
      ['Další úroveň', hl >= HEXUP.max ? '–' : bonus(hl + 1)],
    ]),
    bricksItem(),
  ];
}

// Cihly z pásu ve Výkupu (L-24): prodávat po $80, nebo skladovat do zásoby (baterie T5, výzkumy, stavby)
function bricksItem() {
  const store = game.s.brickMode === 'store';
  return {
    key: 'bricks', name: 'Cihly', chip: [store ? 'SKLADUJE' : 'PRODÁVÁ', store ? 'owned' : 'active'],
    thumb: () => modelThumb('sinter'),
    detail: {
      eyebrow: 'Výkup · cihly ze slinovny', title: store ? 'Cihly se skladují' : 'Cihly se prodávají',
      desc: `Cihly, které do Výkupu přiveze pás ze slinovny, se buď prodají po $${brickPrice()} (cena roste s burzou jako prach), nebo přibývají do zásoby (číslo v HUD pod penězi). Zásoba je potřeba na baterii Jádro, solár Koruna a vyšší výzkumy.`,
      stats: [['Zásoba cihel', fmtInt(game.s.bricks | 0)], ['Cena cihly', money(brickPrice())], ['Prach z pásu', `$${dustPrice().toFixed(2)} / kg`]],
      action: { label: store ? `Přepnout na prodej ($${brickPrice()} za cihlu)` : 'Přepnout na skladování', run: () => purchase('brickmode', [store ? 'sell' : 'store'], 0, () => { game.s.brickMode = store ? 'sell' : 'store'; return true; }) },
    },
  };
}

// ---------- slinovna (L-23, D-11) ----------
const SINTER_TEXT = { work: 'pracuje', idle: 'čeká na prach', full: 'výstup ucpaný – napoj pás z výstupu', power: 'málo energie – čeká na plných 15 ⚡/s' };
function sinterTab() {
  const b = structureById(view.ctx);
  if (!b) return [];
  const d = b.data;
  const inBelt = beltAt([b.id, 'in']), outBelt = beltAt([b.id, 'out']);
  const T = sinterTime(b), lv = b.lv | 0, up = sinterUpPrice(b), maxLv = SINTER.upPrices.length;
  const pic = () => modelThumb('sinter');
  return [{
    key: 'sinter', name: 'Výroba', chip: [SINTER_TEXT[d.state || 'idle'].split(' –')[0].toUpperCase(), d.state === 'work' ? 'active' : 'store'], thumb: () => modelThumb('sinter'),
    detail: {
      eyebrow: 'Slinovna', title: `Slinovna · ${SINTER_TEXT[d.state || 'idle']}`,
      desc: `Z ${SINTER.kgPerBrick} kg prachu vylisuje 1 regolitovou cihlu za ${T} s (${Math.round(60 / T)} cihel za minutu), při práci bere ${SINTER.power} ⚡/s – jede jen na plný výkon, jinak čeká a energie nabíjí baterie. Bez prachu nebere nic. Prach přiveze pás do násypky vlevo, cihly odvádí pás z výstupu vpravo – nejlépe do Výkupu.`,
      stats: [
        ['Prach v násypce', `${fmtInt(Math.round(d.hopper || 0))} / ${SINTER.hopper} kg`],
        ['Cihly na výstupu', `${d.out | 0} / ${SINTER.outCap}`],
        ['Vstupní pás', inBelt ? 'připojený' : 'chybí'],
        ['Výstupní pás', outBelt ? 'připojený' : 'chybí'],
      ],
    },
  }, {
    key: 'press', name: 'Rychlejší lis', chip: [lv ? `ÚROVEŇ ${lv} / ${maxLv}` : 'ZÁKLAD', lv ? 'owned' : 'store'], thumb: pic,
    detail: {
      eyebrow: 'Slinovna', title: 'Rychlejší lis',
      desc: `Každá úroveň zkrátí lisování cihly o 1 s (${SINTER.time} → ${SINTER.time - 1} → ${SINTER.time - 2} s). Spotřeba při práci zůstává ${SINTER.power} ⚡/s, takže cihla stojí méně energie.`,
      stats: [['Teď', `${T} s na cihlu · ${Math.round(60 / T)} cihel / min`], ['Další úroveň', up == null ? '–' : `${T - 1} s na cihlu · ${Math.round(60 / (T - 1))} cihel / min`]],
      action: up == null ? { label: 'Nejvyšší úroveň', disabled: true }
        : { label: game.s.money < up ? `Chybí peníze · ${money(up)}` : `Vylepšit · ${money(up)}`, disabled: game.s.money < up, run: () => purchase('sinterup', [b.id], up, () => upgradeSinter(b.id)) },
    },
  }];
}

function holoDetailHtml() {
  const c = holoCounts();
  const pc = n => (c.total ? `${(n / c.total * 100).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} %` : '–');
  const row = (cls, label, n) => `
    <div class="spec"><span class="spec__label"><span class="holo__dot holo__dot--${cls}"></span>${esc(label)}</span>
      <span class="spec__value">${fmtInt(n)} · ${pc(n)}</span></div>`;
  return `
    <div class="detail__head">
      <div class="detail__heading">
        <p class="detail__eyebrow">Výkup prachu · hologram</p>
        <h3 class="detail__title">${esc(PLANET.name)} z hexů</h3>
      </div>
    </div>
    <p class="detail__desc">${esc(game.s.title || 'Svět')} · ${fmtInt(c.total)} sektorů. Bílá tečka je raketa domů, modrá Výkup, blikající oranžová jsi ty.</p>
    <div class="detail__specs">
      ${row('done', 'Vyčištěné', c.done)}
      ${row('started', 'Rozpracované', c.started)}
      ${row('fresh', 'Nedotčené (0 %)', c.fresh)}
      <div class="spec"><span class="spec__label">Hotovo celkem</span><span class="spec__value">${cleanPercent().toLocaleString('cs-CZ')} %</span></div>
      <div class="spec"><span class="spec__label">Roboti · UFO drony</span><span class="spec__value">${game.s.stations.length} · ${(game.s.drones || []).length}</span></div>
      <div class="spec"><span class="spec__label">Výkupní cena</span><span class="spec__value">$${dustPrice().toFixed(2)} / kg · $${hexBonus()} za hex</span></div>
    </div>
    <p class="wardrobe__hint">Táhni myší = otočit · kolečko = přiblížit · víc čísel v záložce Statistiky</p>`;
}

// Statistiky světa (Výkup → Statistiky): úklid, automatizace, ekonomika a hráči.
function statsHtml() {
  const s = game.s;
  const c = holoCounts();
  const spec = (k, v) => `<div class="spec"><span class="spec__label">${esc(k)}</span><span class="spec__value">${esc(v)}</span></div>`;
  const group = (title, rows) => `<h3 class="wardrobe__heading">${esc(title)}</h3><div class="detail__specs">${rows.join('')}</div>`;
  const hours = ms => { const m = Math.round(ms / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
  const played = (s.playMs || 0) + (game.started ? Date.now() - game.started : 0);
  const depotsN = (s.buildings || []).filter(b => b.type === 'depot').length, belts = (s.belts || []).length;
  const players = Object.values(s.pstats || {}).sort((a, b) => (b.kg || 0) - (a.kg || 0));
  const prev = (s.history || []).map(h => `${h.planet === 'mars' ? 'Mars' : 'Měsíc'} (${hours(h.playMs || 0)})`).join(', ');
  return `
    <div class="wardrobe">
      ${group('Svět', [
        spec('Název', s.title || 'Svět'),
        spec('Planeta', PLANET.name + (prev ? ` · předtím ${prev}` : '')),
        spec('Sektorů (hexů)', fmtInt(c.total)),
        spec('Hotové hexy', `${fmtInt(c.done)} / ${fmtInt(c.total)} · ${cleanPercent().toLocaleString('cs-CZ')} %`),
        spec('Rozpracované · nedotčené', `${fmtInt(c.started)} · ${fmtInt(c.fresh)}`),
        spec('Odehráno', hours(played)),
      ])}
      ${group('Automatizace', [
        spec('Stanice robotů', `${s.stations.length}`),
        spec('UFO drony', `${(s.drones || []).length}`),
        spec('Depa · pásy', `${depotsN} · ${belts}`),
        spec('Zásoba cihel', fmtInt(s.bricks | 0)),
        spec('Vozidla ve flotile', `${s.vehicles.length}`),
      ])}
      ${group('Ekonomika', [
        spec('Peníze', money(s.money)),
        spec('Výkupní cena', `$${dustPrice().toFixed(2)} / kg (burza ${marketLevel()}/${MARKET.max})`),
        spec('Prémie za hex', `$${hexBonus()} (úroveň ${hexupLevel()}/${HEXUP.max})`),
      ])}
      ${players.length ? group('Hráči', players.map(p => spec(p.n || 'Astronaut', `${fmtInt(Math.round(p.kg || 0))} kg · vydělal(a) ${money(p.e || 0)} · utratil(a) ${money(p.sp || 0)}`))) : ''}
    </div>`;
}

// ---------- úspěchy ----------

function trophiesTab() {
  return ACHIEVEMENTS.map(a => {
    const on = hasAch(a.id);
    const stats = [['Stav', on ? `Získáno ${new Date(profile.ach[a.id]).toLocaleDateString('cs-CZ')}` : 'Zatím zamčeno']];
    if (a.goal) {
      const v = Math.min(a.goal, profile.achStats[a.stat] || 0);
      const num = x => (a.goal < 100 && x % 1 ? x.toLocaleString('cs-CZ', { maximumFractionDigits: a.goal < 50 ? 2 : 1 }) : fmt(x));
      const f = x => (a.unit === '$' ? money(x) : `${num(x)}${a.unit ? ` ${a.unit}` : ''}`);
      stats.push([a.rec ? 'Rekord' : 'Postup', `${f(v)} / ${f(a.goal)}`]);
    }
    return {
      key: a.id, name: a.name, chip: on ? ['ZÍSKÁNO', 'active'] : ['ZAMČENO', 'store'],
      thumb: () => achIcon(a),
      detail: { eyebrow: `Úspěch · ${achCount()} z ${ACHIEVEMENTS.length}`, title: a.name, desc: on ? a.desc : a.hint, stats },
    };
  });
}

// ---------- nabíječka (L-05, D-03) ----------

const SLOT_TEXT = { free: 'volný', charging: 'nabíjí', full: 'nabito', short: 'málo energie v síti' };
function chargerTab() {
  const b = structureById(view.ctx);
  if (!b) return [];
  const def = STRUCTURES.charger;
  const n = b.data.slots || 1, f = b.data.fast | 0;
  const L = live.get(b.id);
  const pic = () => thumb('str-charger', () => instantiate('charger').root);
  const slotStats = Array.from({ length: n }, (_, k) => {
    const i = vehicleOnSlot(b, k);
    const st = L?.slots?.[k]?.state || 'free';
    const v = game.s.vehicles[i];
    return [`Slot ${k + 1}`, v ? `${vehicleName(i)} · ${Math.round(v.charge / batteryCap(v) * 100)} % · ${SLOT_TEXT[st]}` : SLOT_TEXT[st]];
  });
  const slot = chargerSlotOffer(b), fast = chargerFastOffer(b);
  return [{
    key: 'slots', name: 'Sloty', chip: [`${n} / 4`, 'owned'], thumb: pic,
    detail: {
      eyebrow: 'Nabíječka vozidel', title: `Sloty (${n} / 4)`,
      desc: 'Zastav vozidlo na slotu (±1,5 m od značky) a nech ho stát – nabíjí se samo, vystupovat není potřeba. 3. a 4. slot se přistaví jako modul vlevo.',
      stats: [...slotStats, ['Výkon slotu', `${slotRate(b)} ⚡/s`]],
      action: slot.price === null ? { label: slot.reason, disabled: true }
        : { label: slot.reason ? `${slot.reason} · ${fmt(slot.price)}` : `Přidat slot · ${money(slot.price)}`, disabled: !!slot.reason, run: () => purchase('chslot', [b.id], slot.price, () => chargerAddSlot(b.id)) },
    },
  }, {
    key: 'fast', name: 'Rychlonabíjení', chip: [f ? `ÚROVEŇ ${f + 1}` : 'ZÁKLAD', f ? 'owned' : 'store'], thumb: pic,
    detail: {
      eyebrow: 'Nabíječka vozidel', title: 'Rychlonabíjení',
      desc: 'Zvýší výkon všech slotů: II = 20 ⚡/s, III = 40 ⚡/s (po výzkumu „Rychlonabíjení III“).',
      stats: [['Teď', `${CHARGER_RATE[f]} ⚡/s na slot`], ['Další úroveň', f >= 2 ? '–' : `${CHARGER_RATE[f + 1]} ⚡/s`]],
      action: fast.price === null ? { label: fast.reason, disabled: true }
        : { label: fast.reason ? `${fast.reason} · ${fmt(fast.price)}` : `Vylepšit · ${money(fast.price)}`, disabled: !!fast.reason, run: () => purchase('chfast', [b.id], fast.price, () => chargerFaster(b.id)) },
    },
  }];
}

// Stav sítě stavby jako informační řádek nad kartami (nabíječka, výměník, výzkumné centrum)
const NET_HINT = {
  charger: 'Postav kotvu vedení do 12 m od nabíječky (kabel se natáhne sám) a spoj ji se zdrojem – solárem nebo RTG.',
  swapper: 'Postav kotvu vedení do 12 m od sloupku přípojky (vlevo vzadu) a spoj ji se zdrojem.',
  research: 'Postav kotvu vedení do 12 m od přípojky v rohu budovy a spoj ji se zdrojem.',
  sinter: 'Postav kotvu vedení do 12 m od sloupku přípojky (vzadu) a spoj ji se zdrojem.',
};
const kw = v => `${v.toFixed(1).replace('.', ',')} ⚡/s`;
function netSummary() {
  const b = structureById(view.ctx);
  if (!b) return '';
  const L = live.get(b.id), net = netInfo.get(L?.net);
  if (!L?.wired) return `⚡ Bez kabelu – nefunguje. ${NET_HINT[b.type] || ''}`;
  if (!net) return '⚡ Síť: připojeno';
  return `⚡ Síť: výroba ${kw(net.prod)} · spotřeba ${kw(net.demand)} · baterie ${net.cap ? `${fmtInt(Math.round(net.stored))} / ${fmtInt(net.cap)} ⚡` : 'žádné'} · dostupnost ${Math.round(net.f * 100)} %`;
}
const summaryText = () => (view.tab === 'fleet' ? (game.s.vehicles.length ? fleetSummary() : null)
  : view.tab === 'tree' ? `${researchSummary()}\n${netSummary()}`
  : view.id === 'charger' || view.id === 'swapper' || view.id === 'sinter' ? netSummary() : null);

// ---------- výzkumné centrum (L-30 až L-32, D-10) ----------

const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
// Náhled modelu; GLB, který ještě není načtený, se dotáhne a okno se překreslí.
function modelThumb(id) {
  if (!isReady(id)) { preloadModels([id]).then(() => { if (facilityOpen()) render(); }); return BLANK; }
  return thumb(`m-${id}`, () => instantiate(id).root);
}
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const STATE_CHIP = { done: ['VYZKOUMÁNO', 'owned'], running: ['PROBÍHÁ', 'active'], queued: ['VE FRONTĚ', 'active'], available: ['DOSTUPNÉ', 'store'], locked: ['ZAMČENO', 'locked'] };

function researchSummary() {
  const pr = researchProgress(), q = game.s.research.queue;
  const rc = researchCenter();
  const f = rc ? live.get(rc.id)?.f ?? 0 : 0;
  if (!pr) return `Nic se nevyvíjí.${q.length ? ` Fronta: ${q.map(x => techById(x).name).join(', ')} (čeká na peníze).` : ' Vyber technologii a spusť výzkum.'}`;
  const power = f >= 0.98 ? `${RESEARCH_POWER} ⚡/s` : f > 0 ? `málo energie – ${Math.round(f * 100)} % rychlosti` : 'bez energie – stojí';
  return `Probíhá: ${pr.tech.name} · ${Math.round(pr.k * 100)} % · zbývá ${mmss(pr.left)} · ${power}${q.length ? ` · fronta: ${q.map(x => techById(x).name).join(', ')}` : ''}`;
}

function techItems() {
  return TECH.map(t => {
    const st = techState(t.id);
    const offer = researchOffer(t.id);
    const pr = researchProgress();
    const cost = `${money(t.price)}${t.bricks ? ` + ${t.bricks} cihel` : ''}`;
    let action;
    if (st.state === 'done') action = { label: 'Vyzkoumáno ✓', disabled: true };
    else if (st.state === 'running') action = { label: `Probíhá · ${Math.round((pr?.k || 0) * 100)} %`, disabled: true };
    else if (st.state === 'queued') action = { label: 'Odebrat z fronty', run: () => purchase('unqueue', [t.id], 0, () => unqueueResearch(t.id)) };
    else if (!offer.kind) action = { label: offer.reason || st.reason, disabled: true };
    else if (offer.kind === 'queue') action = { label: offer.reason || `Zařadit do fronty · ${cost} při spuštění`, disabled: !!offer.reason, run: () => purchase('research', [t.id], 0, () => startResearch(t.id)) };
    else action = { label: offer.reason ? `${offer.reason} · ${cost}` : `Spustit výzkum · ${cost}`, disabled: !!offer.reason, run: () => purchase('research', [t.id], t.price, () => startResearch(t.id)) };
    return {
      key: t.id, name: t.name, chip: STATE_CHIP[st.state], tech: t, st,
      thumb: () => modelThumb(TECH_MODEL[t.id]),
      detail: {
        eyebrow: `Výzkum · ${BRANCHES.find(b => b.id === t.branch).name}`, title: t.name, desc: t.desc,
        stats: [
          ['Cena', cost], ['Doba výzkumu', mmss(t.time)],
          ['Vyžaduje', (t.req || []).map(r => techById(r).name).join(', ') || '–'],
          ['Odemyká', t.unlocks],
          ...(st.state === 'running' && pr ? [['Průběh', `${Math.round(pr.k * 100)} % · zbývá ${mmss(pr.left)}`]] : []),
          ...(st.state === 'locked' && st.reason ? [['Stav', st.reason]] : []),
        ],
        action,
      },
    };
  });
}

// Strom technologií: tři sloupce (Energie, Automatizace, Vozidla), navazující výzkumy odsazené pod předchůdcem.
function treeHtml(items) {
  const pr = researchProgress();
  const node = it => {
    const depth = it.tech.req ? 1 : 0;
    const run = it.st.state === 'running';
    return `
      <button class="tech tech--${it.st.state}${it.key === view.sel ? ' tech--selected' : ''}" type="button" data-sel="${it.key}" style="--depth:${depth}">
        <span class="tech__name">${esc(it.name)}</span>
        <span class="tech__meta">${esc(it.chip[0])} · ${money(it.tech.price)}${it.tech.bricks ? ` + ${it.tech.bricks} 🧱` : ''} · ${mmss(it.tech.time)}</span>
        ${run ? `<span class="tech__bar"><span class="tech__fill" data-fill style="width:${Math.round((pr?.k || 0) * 100)}%"></span></span>` : ''}
      </button>`;
  };
  // pořadí ve sloupci: kořen a hned pod ním jeho následníci
  const ordered = branch => {
    const list = items.filter(it => it.tech.branch === branch);
    const out = [];
    const add = it => { if (out.includes(it)) return; out.push(it); list.filter(x => x.tech.req?.includes(it.key)).forEach(add); };
    list.filter(it => !it.tech.req).forEach(add);
    list.forEach(add);
    return out;
  };
  return `<div class="tree">${BRANCHES.map(b => `
    <div class="tree__col">
      <h3 class="tree__heading">${esc(b.name)}</h3>
      ${ordered(b.id).map(node).join('')}
    </div>`).join('')}</div>`;
}

// ---------- výměník baterií (L-09, D-04) ----------
function swapperTab() {
  const b = structureById(view.ctx);
  if (!b) return [];
  const rack = b.data.rack || [];
  const pic = () => modelThumb('swapper');
  const offer = swapperRackOffer(b);
  const eta = swapperEta(b);
  return [{
    key: 'rack', name: 'Regál', chip: [`${rack.filter(x => x >= 0.999).length} / ${rack.length} NABITÉ`, 'owned'], thumb: pic,
    detail: {
      eyebrow: 'Výměník baterií', title: `Regál (${rack.length} / 4)`,
      desc: `Zajeď vozidlem doprostřed výměníku a zastav – jeřáb vymění baterii za ${String(SWAP.dur).replace('.', ',')} s, vozidlo má 100 %. Vybitá baterie jde do regálu a nabíjí se ze sítě ${SWAP.rate} ⚡/s. Baterie jsou univerzální pro všechna vozidla.`,
      stats: [
        ...rack.map((x, k) => [`Baterie ${k + 1}`, x >= 0.999 ? 'nabitá' : `${Math.round(x * 100)} % · nabíjí se`]),
        ['Nejbližší nabitá', eta === 0 ? 'hned' : eta == null ? 'nenabíjí se (bez energie)' : `za ${Math.ceil(eta)} s`],
      ],
      action: offer.price === null ? { label: offer.reason, disabled: true }
        : { label: offer.reason ? `${offer.reason} · ${fmt(offer.price)}` : `Přidat baterii do regálu · ${money(offer.price)}`, disabled: !!offer.reason, run: () => purchase('swrack', [b.id], offer.price, () => swapperAddRack(b.id)) },
    },
  }];
}

function researchDronesTab() {
  const it = droneItem();
  if (!isDone('droneUfo')) {
    it.chip = ['ZAMČENO', 'locked'];
    it.detail.action = { label: '🔒 Nejdřív vyzkoumej „Dron UFO“', disabled: true };
  }
  return [it];
}

function tabsFor(id) {
  if (id === 'swapper') return [['rack', 'Výměník', swapperTab]];
  if (id === 'sinter') return [['sinter', 'Slinovna', sinterTab]];
  if (id === 'research') return [['tree', 'Strom technologií', techItems], ['drones', 'Drony', researchDronesTab]];
  if (id === 'toolshop') return [['tools', 'Nástroje', () => toolsTab(false)], ['stations', 'Roboti a depa', stationsTab]];
  if (id === 'workshop') {
    return [
      ['tools', 'Nástroje', () => toolsTab(true)], ['vehicles', 'Vozidla', vehiclesUpgradeTab],
      ['astronaut', 'Astronaut', astronautTab], ['wardrobe', 'Šatna', null],
    ];
  }
  if (id === 'trophies') return [['all', `Úspěchy (${achCount()}/${ACHIEVEMENTS.length})`, trophiesTab]];
  if (id === 'depot') return [['holo', 'Hologram', null], ['market', 'Burza', marketTab], ['stats', 'Statistiky', null]];
  if (id === 'garage') return [['vehicles', 'Vozidla', vehiclesShopTab], ['fleet', `Flotila (${game.s.vehicles.length})`, fleetTab]];
  if (id === 'charger') return [['slots', 'Nabíječka', chargerTab]];
  return [];
}

// ---------- šatna ----------

function wardrobeHtml() {
  const look = profile.look;
  const swatches = SUIT_COLORS.map((c, i) => `
    <button class="swatch${i === look.color ? ' swatch--active' : ''}" type="button" data-color="${i}"
      style="--swatch:${hex(c.hex)}" aria-pressed="${i === look.color}" title="${esc(c.name)}" aria-label="${esc(c.name)}"></button>`).join('');
  const cards = slot => HELMET_PROPS.filter(p => p.slot === slot).map(p => {
    const on = look[slot] === p.id;
    return `
      <button class="item-card item-card--compact${on ? ' item-card--selected' : ''}" type="button" data-prop="${p.id}" aria-pressed="${on}">
        <span class="item-card__chip item-card__chip--${on ? 'active' : 'store'}">${on ? 'NASAZENO' : slot === 'top' ? 'HELMA' : 'HLEDÍ'}</span>
        <img class="item-card__img" src="${hooks.headThumb(p.id)}" alt="">
        <span class="item-card__name">${esc(p.name)}</span>
      </button>`;
  }).join('');
  return `
    <div class="wardrobe">
      <h3 class="wardrobe__heading">Barva skafandru</h3>
      <div class="wardrobe__swatches" role="group" aria-label="Barva skafandru">${swatches}</div>
      <h3 class="wardrobe__heading">Na helmu</h3>
      <div class="facility__grid">${cards('top')}</div>
      <h3 class="wardrobe__heading">Na hledí</h3>
      <div class="facility__grid">${cards('face')}</div>
    </div>`;
}

function wardrobeDetailHtml() {
  const look = profile.look;
  const top = propById(look.top), face = propById(look.face);
  const spec = (k, v) => `<div class="spec"><span class="spec__label">${esc(k)}</span><span class="spec__value">${esc(v)}</span></div>`;
  return `
    <div class="detail__head">
      <div class="detail__heading">
        <p class="detail__eyebrow">Šatna</p>
        <h3 class="detail__title">${esc(profile.name)}</h3>
      </div>
    </div>
    <div class="wardrobe__stage" id="wardrobe-stage"></div>
    <p class="wardrobe__hint">Táhni myší = otočit astronauta</p>
    <div class="detail__specs">
      ${spec('Barva', SUIT_COLORS[look.color].name)}
      ${spec('Na helmě', top.name)}
      ${spec('Na hledí', face.name)}
    </div>
    <p class="detail__desc">${esc(look.top !== 'none' ? top.desc : face.desc)}</p>
    <label class="field">
      <span class="field__label">Jméno ve hře</span>
      <input class="field__input" id="wardrobe-name" type="text" maxlength="16" value="${esc(profile.name)}" autocomplete="off">
    </label>
    <button class="button" type="button" data-random>Náhodný outfit</button>`;
}

function setLook(patch) {
  Object.assign(profile.look, patch);
  saveProfile();
  hooks.onLook(profile.look);
  render();
}

// ---------- vykreslení ----------

function render() {
  const tabs = tabsFor(view.id);
  if (!tabs.some(t => t[0] === view.tab)) view.tab = tabs[0][0];
  $('facility-title').textContent = view.id === 'garage' && view.ctx ? garageName(view.ctx) : TITLES[view.id];   // nabíječka: TITLES
  $('facility-money').textContent = money(game.s.money);
  $('facility-tabs').innerHTML = tabs.map(([key, label]) =>
    `<button class="tabs__tab${key === view.tab ? ' tabs__tab--active' : ''}" type="button" role="tab"
       aria-selected="${key === view.tab}" data-tab="${key}">${esc(label)}</button>`).join('');

  const summary = $('facility-summary');
  const sumText = summaryText();
  summary.hidden = sumText == null;
  if (sumText != null) summary.textContent = sumText;

  if (view.tab === 'wardrobe') {
    current = null;
    $('facility-grid').classList.add('facility__grid--plain');
    $('facility-grid').innerHTML = wardrobeHtml();
    $('facility-detail').innerHTML = wardrobeDetailHtml();
    hooks.wardrobe.mount($('wardrobe-stage'), profile.look);
    return;
  }
  hooks.wardrobe.unmount();
  if (view.tab === 'holo') {
    current = null;
    $('facility-grid').classList.add('facility__grid--plain');
    $('facility-grid').innerHTML = '<div class="holo" id="holo-stage"></div>';
    $('facility-detail').innerHTML = holoDetailHtml();
    hooks.holo.mount($('holo-stage'));
    return;
  }
  hooks.holo.unmount();
  if (view.tab === 'stats') {
    current = null;
    $('facility-grid').classList.add('facility__grid--plain');
    $('facility-grid').innerHTML = statsHtml();
    $('facility-detail').innerHTML = holoDetailHtml();
    return;
  }
  $('facility-grid').classList.remove('facility__grid--plain');

  const items = tabs.find(t => t[0] === view.tab)[2]();
  if (!items.some(it => it.key === view.sel)) view.sel = (view.tab === 'tree' && game.s.research.current?.id) || items[0]?.key || null;
  $('facility-grid').classList.toggle('facility__grid--plain', view.tab === 'tree');
  if (view.tab === 'tree') $('facility-grid').innerHTML = treeHtml(items);
  else $('facility-grid').innerHTML = items.length
    ? items.map(it => `
      <button class="item-card${it.key === view.sel ? ' item-card--selected' : ''}" type="button" data-sel="${it.key}">
        <span class="item-card__chip item-card__chip--${it.chip[1]}">${esc(it.chip[0])}</span>
        <img class="item-card__img" src="${it.thumb()}" alt="">
        <span class="item-card__name">${esc(it.name)}</span>
      </button>`).join('')
    : `<p class="facility__empty">${view.tab === 'fleet' ? 'Flotila je zatím prázdná. Vozidla koupíš na záložce Vozidla.' : 'Zatím tu nic není. Nástroje koupíš v Obchodě s nástroji, vozidla v Garáži.'}</p>`;

  const it = items.find(x => x.key === view.sel);
  $('facility-detail').innerHTML = it ? detailHtml(it) : '';
  current = it;
}

let current = null;

function detailHtml(it) {
  const d = it.detail;
  const stats = d.stats.map(([k, v]) =>
    `<div class="spec"><span class="spec__label">${esc(k)}</span><span class="spec__value">${esc(v)}</span></div>`).join('');
  const ups = (d.upgrades || []).map((u, i) => `
    <div class="upgrade">
      <div class="upgrade__head">
        <span class="upgrade__name">${esc(u.name)}</span>
        <span class="upgrade__pips" aria-label="úroveň ${u.lv} z ${u.max}">${
          Array.from({ length: u.max }, (_, k) => `<span class="upgrade__pip${k < u.lv ? ' upgrade__pip--on' : ''}"></span>`).join('')}</span>
      </div>
      <span class="upgrade__effect">${esc(u.effect)}</span>
      <button class="upgrade__button" type="button" data-up="${i}" ${busy || u.cost === null || u.locked || game.s.money < u.cost ? 'disabled' : ''}>
        ${u.locked ? `🔒 ${esc(u.locked)}` : u.cost === null ? 'MAX' : `Vylepšit · ${money(u.cost)}`}
      </button>
    </div>`).join('');
  const label = busy ? 'Čekám na schválení hostitelem…' : d.action?.label;
  const action = d.action
    ? `<button class="detail__action" type="button" data-action ${busy || d.action.disabled ? 'disabled' : ''}>${esc(label)}</button>`
    : '';
  const a2 = d.action2;
  const action2 = a2
    ? `<button class="detail__action detail__action--secondary${a2.danger ? ' detail__action--danger' : ''}${a2.armed ? ' detail__action--armed' : ''}" type="button" data-action2 ${busy || a2.disabled ? 'disabled' : ''}>${esc(a2.label)}</button>`
    : '';
  const shared = isClient() && (d.action || d.upgrades) ? '<p class="detail__note">Peníze jsou společné pro celý svět – nákup schvaluje hostitel.</p>' : '';
  return `
    <div class="detail__head">
      <div class="detail__heading">
        <p class="detail__eyebrow">${esc(d.eyebrow)}</p>
        <h3 class="detail__title">${esc(d.title)}</h3>
      </div>
      <img class="detail__img" src="${it.thumb()}" alt="">
    </div>
    <p class="detail__desc">${esc(d.desc)}</p>
    <div class="detail__specs">${stats}</div>
    ${ups ? `<div class="detail__upgrades">${ups}</div>` : ''}
    ${action}
    ${action2}
    ${shared}`;
}

// ---------- ovládání ----------

function finish(result) {
  if (result === 'close') { closeFacility(); return; }
  if (result === 'stay') { render(); return; }
  if (result && typeof result.then === 'function') {
    busy = true;
    render();
    result.then(ok => {
      busy = false;
      if (ok) hooks.onChange();
      else hooks.onDenied?.();
      if (facilityOpen()) render();
    });
    return;
  }
  if (result) hooks.onChange();
  render();
}

export function initFacility(renderThumb, h) {
  thumb = renderThumb;
  hooks = h;
  const root = $('facility');
  root.addEventListener('click', e => {
    const t = e.target.closest('[data-tab],[data-sel],[data-up],[data-action],[data-action2],[data-color],[data-prop],[data-random]');
    if (!t) return;
    if (!t.hasAttribute('data-action2')) sellArmed = null;      // potvrzení prodeje platí jen pro další klik
    if (t.dataset.tab) { view.tab = t.dataset.tab; view.sel = null; render(); return; }
    if (t.dataset.sel) { view.sel = t.dataset.sel; render(); return; }
    if (t.dataset.color !== undefined) { setLook({ color: Number(t.dataset.color) }); return; }
    if (t.dataset.prop) { const p = propById(t.dataset.prop); setLook({ [p.slot]: p.id }); return; }
    if (t.hasAttribute('data-random')) {
      const pick = a => a[Math.floor(Math.random() * a.length)];
      setLook({
        color: Math.floor(Math.random() * SUIT_COLORS.length),
        top: pick(HELMET_PROPS.filter(p => p.slot === 'top')).id,
        face: pick(HELMET_PROPS.filter(p => p.slot === 'face')).id,
      });
      return;
    }
    if (busy) return;
    if (t.dataset.up !== undefined) finish(current.detail.upgrades[Number(t.dataset.up)].run());
    else if (t.hasAttribute('data-action')) finish(current.detail.action.run?.());
    else if (t.hasAttribute('data-action2')) finish(current.detail.action2.run?.());
  });
  root.addEventListener('change', e => {
    if (e.target.id !== 'wardrobe-name') return;
    const name = sanitizeName(e.target.value);
    if (!name) { e.target.value = profile.name; return; }
    profile.name = name;
    saveProfile();
    hooks.onLook(profile.look);
    render();
  });
  $('facility-close').addEventListener('click', closeFacility);
  $('facility-backdrop').addEventListener('click', closeFacility);
  // E nebo Esc zavře okno (E, které okno otevřelo, se ignoruje; v textovém poli se E píše)
  addEventListener('keydown', e => {
    if (!facilityOpen() || performance.now() - openedAt < 250) return;
    if (e.target.matches?.('input, textarea')) { if (e.key === 'Escape') e.target.blur(); return; }
    if (e.key === 'Escape' || e.key.toLowerCase() === 'e') closeFacility();
  });
}

let openedAt = 0;

export const facilityOpen = () => !$('facility').hidden;

export function openFacility(id, ctx = null) {
  view.id = id;
  view.ctx = ctx;
  view.tab = null;
  view.sel = null;
  render();
  openedAt = performance.now();
  $('facility').hidden = false;
  hooks.onOpen();
  $('facility-close').focus();
}

export function closeFacility() {
  if ($('facility').hidden) return;
  $('facility').hidden = true;
  hooks.wardrobe.unmount();
  hooks.holo.unmount();
  hooks.onClose();
}

// Obnoví obsah (peníze se mění, když pracují roboti nebo ostatní hráči).
export function refreshFacility() {
  if (!facilityOpen()) return;
  $('facility-money').textContent = money(game.s.money);
  if (view.tab === 'fleet') $('facility-summary').textContent = fleetSummary();
  if ((view.id === 'charger' || view.id === 'swapper' || view.id === 'sinter') && performance.now() - holoAt > 1000) { holoAt = performance.now(); $('facility-summary').textContent = netSummary(); if (view.id === 'sinter' && !busy) render(); }
  if (view.id === 'research' && performance.now() - holoAt > 1000) {       // průběh výzkumu a stav sítě
    holoAt = performance.now();
    const sig = JSON.stringify(game.s.research) + Math.round((live.get(view.ctx)?.f ?? 0) * 20);
    if (view.tab === 'tree') {
      $('facility-summary').textContent = summaryText();
      const pr = researchProgress();
      const fill = $('facility-grid').querySelector('[data-fill]');
      if (fill && pr) fill.style.width = `${Math.round(pr.k * 100)}%`;
    }
    // změna stavu (hotovo, další z fronty, peníze) → překreslit celé okno; jinak jen průběh
    const stateSig = sig.replace(/"progress":[\d.]+/, '') + game.s.money;
    if (stateSig !== researchSig) { researchSig = stateSig; if (!busy) render(); }
    return;
  }
  if ((view.tab === 'holo' || view.tab === 'stats') && performance.now() - holoAt > 1500) {   // počty se mění, jak se uklízí
    holoAt = performance.now();
    $('facility-detail').innerHTML = holoDetailHtml();
    if (view.tab === 'stats') $('facility-grid').innerHTML = statsHtml();
  }
}
let holoAt = 0;
let researchSig = '';
