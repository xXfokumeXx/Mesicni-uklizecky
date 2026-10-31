// Vybavení: nástroje a vozidla – parametry, nákup, výběr a vylepšení.
// Každý nástroj i vozidlo má vlastní zásobník na prach (load v kg).
import {
  TOOLS, TOOL_UPGRADES, VEHICLE_UPGRADES, VEHICLES, GARAGE_PRICE, STATION, BOOTS, SELL_REFUND,
  toolById, vehicleById, upgradeCost,
} from './catalog.js';
import { game, newToolState, newUid } from './state.js';
import { parkingSpot } from './base.js';
import { WALK_SPEED, MAX_VEHICLES } from './config.js';
import { tangentTo } from './planet/vec.js';

// ---------- parametry ----------

export function toolStats(id) {
  const base = toolById(id);
  const lv = game.s.tools[id]?.lv || { width: 0, hopper: 0, power: 0 };
  return {
    width: base.width * (1 + TOOL_UPGRADES.width.step * lv.width),
    hopper: base.hopper * (1 + TOOL_UPGRADES.hopper.step * lv.hopper),
    power: base.power + TOOL_UPGRADES.power.step * lv.power,
  };
}

export function vehicleStats(v) {
  const base = vehicleById(v.type);
  return {
    width: base.width * (1 + VEHICLE_UPGRADES.width.step * v.lv.width),
    speed: base.speed * (1 + VEHICLE_UPGRADES.speed.step * v.lv.speed),
    hopper: base.hopper,
    power: base.power,
  };
}

// Co právě používáš: nástroj v ruce, nebo vozidlo.
export function activeEquipment() {
  const s = game.s;
  if (s.driving >= 0) {
    const v = s.vehicles[s.driving];
    const base = vehicleById(v.type);
    return { kind: 'vehicle', item: v, base, stats: vehicleStats(v), name: base.name };
  }
  const base = toolById(s.tool);
  return { kind: 'tool', item: s.tools[s.tool], base, stats: toolStats(s.tool), name: base.name };
}

// ---------- nástroje ----------

export const ownsTool = id => !!game.s.tools[id];

export function buyTool(id) {
  const t = toolById(id);
  if (ownsTool(id) || game.s.money < t.price) return false;
  game.s.money -= t.price;
  game.s.tools[id] = newToolState();
  game.s.tool = id;
  return true;
}

export function equipTool(id) {
  if (!ownsTool(id) || game.s.driving >= 0) return false;
  game.s.tool = id;
  return true;
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

// ---------- garáž a vozidla ----------

export function buildGarage() {
  if (game.s.garage || game.s.money < GARAGE_PRICE) return false;
  game.s.money -= GARAGE_PRICE;
  game.s.garage = true;
  return true;
}

export const ownedVehicle = type => game.s.vehicles.findIndex(v => v.type === type);
export const vehicleCount = type => game.s.vehicles.filter(v => v.type === type).length;
export const fleetFull = () => game.s.vehicles.length >= MAX_VEHICLES;

// První volné parkovací místo (po prodeji vozidla zůstane v řadě mezera).
function freeSpot() {
  const used = new Set(game.s.vehicles.map((v, i) => v.spot ?? i));
  for (let k = 0; k < MAX_VEHICLES; k++) if (!used.has(k)) return k;
  return game.s.vehicles.length;
}

// Flotila: stejný typ jde koupit víckrát (každé vozidlo má své parkovací místo).
export function buyVehicle(type) {
  const base = vehicleById(type);
  if (!base || !game.s.garage || fleetFull() || game.s.money < base.price) return false;
  game.s.money -= base.price;
  const k = freeSpot();
  const spot = parkingSpot(k);
  game.s.vehicles.push({ uid: newUid(), type, spot: k, p: spot.dir, f: tangentTo(spot.dir, spot.facing), load: 0, lv: { width: 0, speed: 0 } });
  return true;
}

// Kolik se vrátí za prodej: 75 % ceny vozidla a všech zaplacených vylepšení.
export function vehicleSellValue(i) {
  const v = game.s.vehicles[i];
  if (!v) return 0;
  const base = vehicleById(v.type);
  let paid = base.price;
  for (const key in VEHICLE_UPGRADES) {
    for (let lv = 0; lv < (v.lv[key] | 0); lv++) paid += upgradeCost(base.price, lv, 0.25);
  }
  return Math.round(paid * SELL_REFUND);
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

// Přivolá vozidlo zpátky na jeho místo u garáže (když v něm nikdo nesedí).
export function callBackVehicle(i) {
  const v = game.s.vehicles[i];
  if (!v || game.s.driving === i) return false;
  const spot = parkingSpot(v.spot ?? i);
  v.p = spot.dir;
  v.f = tangentTo(spot.dir, spot.facing);
  v.moved = true;                                   // fyzika vozidla se znovu založí
  return true;
}

export function vehicleUpgradeCost(i, key) {
  const v = game.s.vehicles[i];
  const lv = v.lv[key];
  return lv >= VEHICLE_UPGRADES[key].max ? null : upgradeCost(vehicleById(v.type).price, lv, 0.25);
}

export function upgradeVehicle(i, key) {
  const c = vehicleUpgradeCost(i, key);
  if (c === null || game.s.money < c) return false;
  game.s.money -= c;
  game.s.vehicles[i].lv[key]++;
  return true;
}

// ---------- stanice robotů ----------

export const stationPrice = () => Math.round(STATION.price * STATION.priceMult ** game.s.stations.length);

export { TOOLS, VEHICLES };
