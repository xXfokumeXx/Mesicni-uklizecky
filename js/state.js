// Stav hry. Prach se nosí v nástroji nebo ve vozidle, ne v astronautovi.
// game.s = vše, co se ukládá (v multiplayeru u klienta jen jeho osobní část + kopie sdíleného světa).
import { MOON, BASE, PRICE_PER_KG, HEX_BONUS, PLANET } from './config.js';
import { MARKET, HEXUP, batteryCap } from './catalog.js';
import { hexes, hexProgress } from './planet/dustmap.js';
import { dirToCell } from './planet/hexgrid.js';
import { angleBetween, tangentTo } from './planet/vec.js';
import { SPAWN, SPAWN_FACING } from './base.js';
import { FIREBASE_DEV } from './firebase-config.js';

const R = MOON.radius;
const DEV_START_MONEY = 10000;                    // jen na localhost (FIREBASE_DEV), ostrá hra začíná s $0

// net.mode: 'sp' = jeden hráč, 'host' = hostitel světa, 'client' = připojený hráč
export const game = { s: null, dust: null, slot: null, mode: 'sp', clockOffset: 0, started: 0 };

export const newToolState = () => ({ load: 0, lv: { width: 0, hopper: 0, power: 0 } });

// Vyžaduje hotovou hexovou mřížku a čerstvě vygenerovanou mapu prachu (world.js → prepareMoon).
export function newGame(title = 'Nová směna', dust = game.dust) {
  game.s = {
    v: SAVE_VERSION,
    planet: PLANET.id,                            // 'moon' / 'mars' (config.js PLANETS)
    title,
    money: FIREBASE_DEV ? DEV_START_MONEY : 0,    // lokální test (localhost) začíná s penězi na první vozidlo
    p: SPAWN,                                     // pozice (jednotkový vektor)
    f: tangentTo(SPAWN, SPAWN_FACING),            // směr pohledu / jízdy (tečný vektor)
    warp: 0,                                      // posun času (klávesa T)
    tools: { toothbrush: newToolState() },        // vlastněné nástroje
    tool: 'toothbrush',                           // nástroj v ruce
    boots: 0,                                     // úroveň měsíčních bot (0–3)
    belt: 0,                                      // úroveň opasku (0–2) → políčka hotbaru
    jetpack: 0,                                   // 1 = koupený jetpack
    hotbar: ['toothbrush'],                       // políčka hotbaru: id nástroje, { kit } nebo null (hotbar.js)
    sel: 0,                                       // vybrané políčko hotbaru
    garage: false,                                // (v2) postavená garáž – ve v3 jsou garáže stavby v buildings
    buildings: [],                                // stavby 3.0 { id, type, p, yaw, lv, paid, data } (structures.js)
    gfree: false,                                 // (nepoužívá se od 4. 11. – první garáž už není zdarma; zůstává kvůli síti / uložení)
    hammer: 0,                                    // 1 = koupené kladivo (osobní, Dílna; v hotbaru jako 'hammer')
    cables: [],                                   // kabely vedení [[id stavby, id stavby], …] (energy.js)
    research: { done: [], current: null, queue: [] },   // výzkum (fáze 4)
    bricks: 0,                                    // zásoba cihel (fáze 3)
    brickMode: 'sell',                            // cihly z pásu ve Výkupu: 'sell' ($80) / 'store' (do zásoby)
    belts: [],                                    // pásy 3.0 { id, from, to, pts, len, goods, items, paid } (logistics.js)
    vehicles: [],                                 // { uid, type, garage (id stavby), spot (místo v ní), p, f, load, charge (⚡), lv }
    driving: -1,                                  // index vozidla, ve kterém sedíš
    stations: [],                                 // { hex, robot }
    drones: [],                                   // UFO drony { p, t, hex, k, load, mode } (drones.js)
    depots: [],                                   // (v2) { hex, store, belt, to, transit } – při načtení se převedou na stavby depo (logistics.js)
    market: 0,                                    // úroveň burzy ve Výkupu (0–5) → cena prachu
    hexup: 0,                                     // úroveň prémie za hex ve Výkupu (0–5)
    pstats: {},                                   // klíč hráče → { n, kg, e, sp } (sesbíráno / vyděláno / utraceno)
    won: false,
    playMs: 0,                                    // odehraný čas (pro seznam uložených her)
    last: Date.now(),
  };
  game.dust = dust;
}

export const newUid = () => Math.random().toString(36).slice(2, 8).padEnd(6, '0');

// ---------- verze uložené hry (F-04) ----------
// SAVE_VERSION = verze, kterou tahle hra ukládá. MIGRATE[v](s) převede stav z verze v na v + 1.
// Další verze se přidá jednou funkcí: MIGRATE[3] = s => { … }. Novější uložení (s.v > SAVE_VERSION) se neotevře.
export const SAVE_VERSION = 3;                   // 3 = verze 3.0 (stavby, kladivo; převod v structures.js MIGRATE[2])
export const MIGRATE = {};

export const saveVersion = s => Number(s?.v) || 2;
export const canLoadVersion = s => saveVersion(s) >= 2 && saveVersion(s) <= SAVE_VERSION;

// Převod starší uložené hry na aktuální verzi + doplnění chybějících polí. Vrací false u novější verze.
export function migrateState(s) {
  if (!canLoadVersion(s)) return false;
  for (let v = saveVersion(s); v < SAVE_VERSION; v++) {
    MIGRATE[v]?.(s);
    s.v = v + 1;
  }
  s.v = SAVE_VERSION;
  upgradeState(s);
  return true;
}

// Doplní pole, která starší uložené hry nemají (hra z předchozí verze se načte beze ztrát).
export function upgradeState(s = game.s) {
  s.planet = s.planet === 'mars' ? 'mars' : 'moon';
  delete s.go;                                    // nedokončený odlet raketou se neobnovuje
  if (!Array.isArray(s.depots)) s.depots = [];
  if (!Array.isArray(s.drones)) s.drones = [];
  if (!Array.isArray(s.buildings)) s.buildings = [];
  s.gfree = !!s.gfree;
  s.hammer = s.hammer ? 1 : 0;
  if (!Array.isArray(s.cables)) s.cables = [];
  if (!s.research || !Array.isArray(s.research.done)) s.research = { done: [], current: null, queue: [] };
  if (!Array.isArray(s.research.queue)) s.research.queue = [];
  if (s.research.current && typeof s.research.current.id !== 'string') s.research.current = null;
  if (s.drones.length && !s.research.done.includes('droneUfo')) s.research.done.push('droneUfo');   // L-32: kdo dron má, má výzkum hotový
  for (const st of s.stations || []) st.mk = Math.max(1, Math.min(2, st.mk | 0));                     // vysavač MK1 / MK2 (L-31); starý robot → MK1
  s.bricks = Math.max(0, s.bricks | 0);
  for (const b of s.buildings) if (!b.data || typeof b.data !== 'object') b.data = {};
  if (!s.pstats || typeof s.pstats !== 'object') s.pstats = {};
  for (const d of s.depots) {
    d.store = Number(d.store) || 0;
    d.belt = !!d.belt;
    if (!Number.isInteger(d.to)) d.to = -1;
    if (!Array.isArray(d.transit)) d.transit = [];
  }
  for (const v of s.vehicles) {
    if (!v.uid) v.uid = newUid();
    v.lv.boost = v.lv.boost | 0;
    v.lv.hopper = v.lv.hopper | 0;
    v.lv.battery = v.lv.battery | 0;
    v.lv.solar = v.lv.solar | 0;
    v.lv.cruise = v.lv.cruise | 0;
    v.lv.edge = v.lv.edge | 0;
    if (!Number.isFinite(v.charge)) v.charge = batteryCap(v);   // nové / převedené vozidlo je plně nabité (L-01)
    v.charge = Math.max(0, Math.min(batteryCap(v), v.charge));
  }
  s.belt = Math.min(2, Math.max(0, s.belt | 0));
  s.jetpack = s.jetpack ? 1 : 0;
  if (!Array.isArray(s.hotbar)) s.hotbar = [s.tool || 'toothbrush'];
  s.sel = s.sel | 0;
  s.market = Math.min(MARKET.max, Math.max(0, s.market | 0));
  s.hexup = Math.min(HEXUP.max, Math.max(0, s.hexup | 0));
  if (!Array.isArray(s.belts)) s.belts = [];
  for (const bl of s.belts) { bl.items = Array.isArray(bl.items) ? bl.items.filter(Number.isFinite) : []; bl.wait = 0; }
  s.brickMode = s.brickMode === 'store' ? 'store' : 'sell';
  for (const f of UPGRADES) f(s);                 // doplnění z dalších modulů (logistics.js: převod dep v2)
}
// Funkce (s) => void, které upgradeState zavolá na konci (moduly si je přidají samy, bez kruhových importů).
export const UPGRADES = [];

// Výkupní cena prachu ($/kg) podle burzy ve Výkupu.
export const dustPrice = () => PRICE_PER_KG * (1 + MARKET.step * (game.s?.market | 0));
// Prémie za dočištěný hex ($) podle vylepšení ve Výkupu.
export const hexBonus = () => Math.round(HEX_BONUS * (1 + HEXUP.step * (game.s?.hexup | 0)));

// Osobní část stavu (vybavení, poloha) – patří hráči, ne světu. Ve stavu světa v cloudu je osobní část
// posledního hostitele; kdo svět převezme, ji nahradí svou (net.js loadPersonal) nebo začne s výchozí.
export const PERSONAL_KEYS = ['p', 'f', 'tools', 'tool', 'boots', 'belt', 'jetpack', 'hammer', 'hotbar', 'sel'];
export const pickPersonal = s => Object.fromEntries(PERSONAL_KEYS.map(k => [k, s[k]]));
export function putPersonal(s, data) {
  for (const k of PERSONAL_KEYS) if (data?.[k] !== undefined) s[k] = data[k];
  s.driving = -1;
}
export function resetPersonal(s) {
  putPersonal(s, {
    p: SPAWN, f: tangentTo(SPAWN, SPAWN_FACING), tools: { toothbrush: newToolState() }, tool: 'toothbrush',
    boots: 0, belt: 0, jetpack: 0, hammer: 0, hotbar: ['toothbrush'], sel: 0,
  });
}

// Statistiky hráče: kg = nasbíraný prach, e = vydělané peníze, sp = utracené peníze.
export function addStat(key, name, field, amount) {
  if (!key || !(amount > 0)) return;
  const ps = game.s.pstats || (game.s.pstats = {});
  const st = ps[key] || (ps[key] = { n: name || 'Astronaut', kg: 0, e: 0, sp: 0 });
  if (name) st.n = name;
  st[field] = (st[field] || 0) + amount;
}

// Čas hry: hodiny počítače (+ v multiplayeru posun na hodiny hostitele) + zrychlení klávesou T.
// Díky tomu mají všichni hráči stejnou denní dobu.
export const gameTime = () => Date.now() + game.clockOffset + (game.s.warp || 0);

export const hexPct        = () => hexes.total ? hexes.doneCount / hexes.total * 100 : 0;
export const currentHexPct = () => hexProgress(dirToCell(game.s.p));
export const baseDistance  = () => angleBetween(game.s.p, BASE.dir) * R;
