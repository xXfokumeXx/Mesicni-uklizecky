// Vybavení: nástroje a vozidla – parametry, nákup, výběr a vylepšení.
// Každý nástroj i vozidlo má vlastní zásobník na prach (load v kg).
import {
  TOOLS, TOOL_UPGRADES, VEHICLE_UPGRADES, VEHICLES, GARAGE_PRICE, STATION, BOOTS, SELL_REFUND, TOOL_SELL, BELT, JETPACK,
  MARKET, HEXUP, POWER_LEVELS_31, toolById, vehicleById, upgradeCost, boostFactor, marketCost, hexupCost, batteryCap,
} from './catalog.js';
import { game, newToolState, newUid } from './state.js';
import { heldTool, heldKit, heldHammer, putTool, forgetTool, ensureHotbar, KIT_NAMES, HAMMER_ID } from './hotbar.js';
import { WALK_SPEED } from './config.js';
import { fleetFull, freeGarageSlot, homeSpot, HAMMER, hasResearch } from './structures.js';
import { tangentTo } from './planet/vec.js';
import { laac, freePad } from './laac.js';

// ---------- parametry ----------

export function toolStats(id) {
  const base = toolById(id);
  const lv = game.s.tools[id]?.lv || { width: 0, hopper: 0 };
  return {
    width: base.width * (1 + TOOL_UPGRADES.width.step * lv.width),
    hopper: base.hopper * (1 + TOOL_UPGRADES.hopper.step * lv.hopper),
    power: base.power,                              // L-71: síla jen z katalogu, nejde vylepšit
  };
}

export function vehicleStats(v) {
  const base = vehicleById(v.type);
  const sp = v.lv.special | 0;                       // letouny (3.1): Speciální = sací lišta Prachovky / dosah skeneru Kolibříku
  return {
    width: base.arm ? VEHICLE_UPGRADES.rameno.values[Math.min(3, v.lv.rameno | 0)]            // Prachocuc: záběr podle dílů ramene
      : base.width * (1 + VEHICLE_UPGRADES.width.step * (v.lv.width | 0)) * (base.kind === 'air' ? 1 + VEHICLE_UPGRADES.special.step * sp : 1),
    speed: base.speed * (1 + VEHICLE_UPGRADES.speed.step * (v.lv.speed | 0)) * (1 + VEHICLE_UPGRADES.motor.step * (v.lv.motor | 0)),
    scan: base.scan ? base.scan + 150 * sp : 0,
    sweepSpeed: base.sweepSpeed ? base.sweepSpeed * (1 + VEHICLE_UPGRADES.speed.step * (v.lv.speed | 0)) * (1 + VEHICLE_UPGRADES.motor.step * (v.lv.motor | 0)) : 0,
    hopper: base.arm ? VEHICLE_UPGRADES.privez.values[Math.min(3, v.lv.privez | 0)]            // Prachocuc: kapacita podle přívěsu
      : base.hopper * (1 + VEHICLE_UPGRADES.hopper.step * (v.lv.hopper | 0)) * (base.carry === 'arm' ? 1 + 0.5 * sp : 1),   // Kondor: náklad +50 % (3.1)
    rope: base.rope ? base.rope : 0,
    power: base.power,
    boost: boostFactor(v.lv.boost | 0),
  };
}

// Vylepšení jde koupit pro tento typ vozidla? (boost jen pro přepravník posádky)
export const upgradeFits = (type, key) => !VEHICLE_UPGRADES[key].only || VEHICLE_UPGRADES[key].only.includes(type);

const HANDS = { id: 'hands', name: 'Volné ruce', width: 0, hopper: 0, power: 0 };
const HAMMER_TOOL = { id: 'hammer', name: HAMMER.name, width: 0, hopper: 0, power: 0 };
const NO_STATS = { width: 0, hopper: 0, power: 0 };

// Co právě používáš: nástroj v ruce, nebo vozidlo.
export function activeEquipment() {
  const s = game.s;
  if (s.driving >= 0) {
    const v = s.vehicles[s.driving];
    const base = vehicleById(v.type);
    return { kind: 'vehicle', item: v, base, stats: vehicleStats(v), name: base.name };
  }
  if (heldHammer()) return { kind: 'tool', item: { load: 0 }, base: HAMMER_TOOL, stats: NO_STATS, name: HAMMER.name };   // kladivem se nezametá
  const id = heldTool();
  if (!id) {                                        // v ruce stavební sada nebo nic (hotbar.js)
    const kit = heldKit();
    return { kind: 'tool', item: { load: 0 }, base: HANDS, stats: NO_STATS, name: kit ? KIT_NAMES[kit.kit] : HANDS.name };
  }
  const base = toolById(id);
  return { kind: 'tool', item: s.tools[id], base, stats: toolStats(id), name: base.name };
}

// ---------- nástroje ----------

export const ownsTool = id => !!game.s.tools[id];

export function buyTool(id) {
  const t = toolById(id);
  if (ownsTool(id) || game.s.money < t.price) return false;
  game.s.money -= t.price;
  game.s.tools[id] = newToolState();
  putTool(id);
  return true;
}

export function equipTool(id) {
  if (!ownsTool(id) || game.s.driving >= 0) return false;
  putTool(id);
  return true;
}

// L-71 (3.1): vylepšení Síla zrušeno. Kolik vrátit za koupené úrovně (lv.power) nástrojů v tools.
export function powerRefund(tools) {
  let back = 0;
  for (const [id, it] of Object.entries(tools || {})) {
    const n = Math.min(POWER_LEVELS_31, Math.max(0, it?.lv?.power | 0));
    const t = toolById(id);
    if (t) for (let k = 0; k < n; k++) back += upgradeCost(t.price, k, 0.45);
  }
  return back;
}
// Smaže zbytky úrovní Síly (po vrácení peněz).
export function stripPower(tools) {
  for (const it of Object.values(tools || {})) if (it?.lv && 'power' in it.lv) delete it.lv.power;
}
// Strop vrácení pro jednoho hráče (všechny nástroje na plné Síle) – hostitel tím ověří žádost klienta.
export function powerRefundMax() {
  const all = {};
  for (const t of TOOLS) all[t.id] = { lv: { power: POWER_LEVELS_31 } };
  return powerRefund(all);
}

// Prodej v Obchodě: 30 % ceny nástroje a všech zaplacených vylepšení (lv = úrovně, výchozí = vlastní).
export function toolSellValue(id, lv = game.s.tools[id]?.lv) {
  const t = toolById(id);
  if (!t || !lv) return 0;
  let paid = t.price;
  for (const key in TOOL_UPGRADES) for (let k = 0; k < (lv[key] | 0); k++) paid += upgradeCost(t.price, k, 0.45);
  return Math.round(paid * TOOL_SELL);
}

// Nejvíc, kolik může prodej nástroje id vynést (plně vylepšený) – hostitel tím ověří žádost klienta.
export function toolSellMax(id) {
  const lv = {};
  for (const key in TOOL_UPGRADES) lv[key] = TOOL_UPGRADES[key].max;
  return toolSellValue(id, lv);
}

// Prodá nástroj (i s náplní zásobníku): peníze ×0,3, nástroj zmizí z hotbaru a jde koupit znovu.
export function sellTool(id) {
  if (!ownsTool(id)) return false;
  game.s.money += toolSellValue(id);
  return forgetTool(id);
}

export function toolUpgradeCost(id, key) {
  const lv = game.s.tools[id].lv[key];
  return lv >= TOOL_UPGRADES[key].max ? null : upgradeCost(toolById(id).price, lv, 0.45);
}

export function upgradeTool(id, key) {
  const c = toolUpgradeCost(id, key);
  if (c === null || game.s.money < c) return false;
  game.s.money -= c;
  game.s.tools[id].lv[key]++;
  return true;
}

// ---------- měsíční boty ----------

export const bootsLevel = () => game.s.boots || 0;
export const walkSpeed = (lv = bootsLevel()) => WALK_SPEED * BOOTS.levels[lv].speed;
export const bootsUpgradeCost = () => BOOTS.levels[bootsLevel() + 1]?.price ?? null;

export function upgradeBoots() {
  const c = bootsUpgradeCost();
  if (c === null || game.s.money < c) return false;
  game.s.money -= c;
  game.s.boots = bootsLevel() + 1;
  return true;
}

// ---------- burza ve Výkupu (sdílené vylepšení světa) ----------

export const marketLevel = () => Math.min(MARKET.max, game.s.market | 0);
export const marketUpgradeCost = () => marketCost(marketLevel());

export function upgradeMarket() {
  const c = marketUpgradeCost();
  if (c === null || game.s.money < c) return false;
  game.s.money -= c;
  game.s.market = marketLevel() + 1;
  return true;
}

export const hexupLevel = () => Math.min(HEXUP.max, game.s.hexup | 0);
export const hexupUpgradeCost = () => hexupCost(hexupLevel());

export function upgradeHexup() {
  const c = hexupUpgradeCost();
  if (c === null || game.s.money < c) return false;
  game.s.money -= c;
  game.s.hexup = hexupLevel() + 1;
  return true;
}

// ---------- opasek a jetpack ----------

export const beltLevel = () => game.s.belt || 0;
export const beltUpgradeCost = () => BELT.levels[beltLevel() + 1]?.price ?? null;

export function upgradeBelt() {
  const c = beltUpgradeCost();
  if (c === null || game.s.money < c) return false;
  game.s.money -= c;
  game.s.belt = beltLevel() + 1;
  ensureHotbar();
  return true;
}

export const ownsJetpack = () => !!game.s.jetpack;

export function buyJetpack() {
  if (ownsJetpack() || game.s.money < JETPACK.price) return false;
  game.s.money -= JETPACK.price;
  game.s.jetpack = 1;
  return true;
}

// ---------- garáž a vozidla ----------

// ---------- kladivo (L-10) ----------
// Kladivo zabírá políčko hotbaru jako nástroj; X / × ho zničí (s.hammer = 0) a znovu se koupí tady (Dílna).

export const ownsHammer = () => !!game.s.hammer;
// 11. 11. (přání hráče): kladivo jde koupit jen s volným políčkem v opasku – dřív zabralo políčko nástroje
// a nástroj z ruky „zmizel“ (musel se znovu dát do ruky v Obchodě).
export function hammerSlotFree() {
  ensureHotbar();
  return game.s.hotbar.includes(null);
}
export function buyHammer() {
  if (ownsHammer() || game.s.money < HAMMER.price || !hammerSlotFree()) return false;
  game.s.money -= HAMMER.price;
  game.s.hammer = 1;
  putTool(HAMMER_ID);                               // do volného políčka
  return true;
}

export const ownedVehicle = type => game.s.vehicles.findIndex(v => v.type === type);
export const vehicleCount = type => game.s.vehicles.filter(v => v.type === type).length;
export { fleetFull };

// Flotila: stejný typ jde koupit víckrát. Vozidlo dostane domovskou garáž gid (když má volné místo, jinak jinou).
export function buyVehicle(type, gid = null) {
  const base = vehicleById(type);
  const slot = base?.kind === 'air' ? airSlot(base) : freeGarageSlot(gid, base?.slots || 1);   // letoun: volná plošina LAAC (3.1)
  if (!base || !slot || (base.kind !== 'air' && fleetFull()) || game.s.money < base.price) return false;
  game.s.money -= base.price;
  const v = { uid: newUid(), type, garage: slot.garage, spot: slot.spot, load: 0, lv: { width: 0, speed: 0, boost: 0, hopper: 0, battery: 0, solar: 0, motor: 0, abatt: 0, special: 0, rameno: 0, privez: 0 } };
  v.charge = batteryCap(v);                                    // nové vozidlo je plně nabité (L-01)
  const h = homeSpot(v);
  v.p = h.dir;
  v.f = tangentTo(h.dir, h.facing);
  game.s.vehicles.push(v);
  return true;
}

// Letoun (3.1): výzkum, LAAC a volná plošina. { garage, spot } nebo null
function airSlot(base) {
  if (base.research && !hasResearch(base.research)) return null;
  const b = laac();
  const side = b ? freePad(b) : 0;
  return side ? { garage: b.id, spot: side } : null;
}

// Přeřadí vozidlo do jiné garáže (na volné místo). Vrací true / false.
export function rehomeVehicle(i, gid) {
  const v = game.s.vehicles[i];
  if (!v || v.garage === gid) return false;
  const slot = freeGarageSlot(gid, vehicleById(v.type)?.slots || 1);
  if (!slot || slot.garage !== gid) return false;
  v.garage = slot.garage;
  v.spot = slot.spot;
  return true;
}

// Kolik se vrátí za prodej: 75 % ceny vozidla a všech zaplacených vylepšení.
export function vehicleSellValue(i) {
  const v = game.s.vehicles[i];
  if (!v) return 0;
  const base = vehicleById(v.type);
  let paid = base.price;
  for (const key in VEHICLE_UPGRADES) {
    for (let lv = 0; lv < (v.lv[key] | 0); lv++) paid += VEHICLE_UPGRADES[key].prices?.[lv] ?? upgradeCost(base.price, lv, VEHICLE_UPGRADES[key].share || 0.25);
  }
  return Math.round(paid * (base.sell ?? SELL_REFUND));          // letouny 60 % (L-64)
}

// Prodá vozidlo (nesmí v něm nikdo sedět – to hlídá volající). Indexy dalších vozidel se posunou.
export function sellVehicle(i) {
  const s = game.s;
  const v = s.vehicles[i];
  if (!v || s.driving === i) return false;
  s.money += vehicleSellValue(i);
  s.vehicles.splice(i, 1);
  if (s.driving > i) s.driving--;
  for (const x of s.vehicles) x.moved = true;      // fyzika vozidel se znovu založí podle nových indexů
  return true;
}

// Přivolá vozidlo zpátky na jeho místo v domovské garáži (když v něm nikdo nesedí).
export function callBackVehicle(i) {
  const v = game.s.vehicles[i];
  if (!v || game.s.driving === i) return false;
  const spot = homeSpot(v);
  v.p = spot.dir;
  v.f = tangentTo(spot.dir, spot.facing);
  v.tr = 0;                                         // přívěs Prachocucu rovně za traktorem
  v.moved = true;                                   // fyzika vozidla se znovu založí
  return true;
}

// Zámek vylepšení podle výzkumu (L-03: Větší baterie úr. 3–4 až po „Baterie T3“) a podle jiného vylepšení
// (L-41: Sledování hrany až s Autocruise). Vrací text, nebo ''.
export function vehicleUpgradeLock(key, lv, veh = null) {
  const u = VEHICLE_UPGRADES[key];
  const r = u?.research;
  if (r && lv >= r.from && !hasResearch(r.id)) return 'chybí výzkum';
  if (u?.needs && veh && !(veh.lv?.[u.needs] > 0)) return `nejdřív ${VEHICLE_UPGRADES[u.needs].name}`;
  return '';
}

export function vehicleUpgradeCost(i, key) {
  const v = game.s.vehicles[i];
  if (!v || !VEHICLE_UPGRADES[key] || !upgradeFits(v.type, key)) return null;
  const lv = v.lv[key] | 0;
  if (vehicleUpgradeLock(key, lv, v)) return null;             // zamčeno výzkumem (i kontrola u hostitele)
  if (lv >= VEHICLE_UPGRADES[key].max) return null;
  return VEHICLE_UPGRADES[key].prices?.[lv] ?? upgradeCost(vehicleById(v.type).price, lv, VEHICLE_UPGRADES[key].share || 0.25);   // prices = pevné ceny (Prachocuc)
}

export function upgradeVehicle(i, key) {
  const c = vehicleUpgradeCost(i, key);
  if (c === null || game.s.money < c) return false;
  game.s.money -= c;
  game.s.vehicles[i].lv[key] = (game.s.vehicles[i].lv[key] | 0) + 1;
  return true;
}

// ---------- stanice robotů ----------

export const stationPrice = () => Math.round(STATION.price * STATION.priceMult ** game.s.stations.length);

export { TOOLS, VEHICLES };
