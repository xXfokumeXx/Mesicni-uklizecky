// Stav hry. Prach se nosí v nástroji nebo ve vozidle, ne v astronautovi.
// game.s = vše, co se ukládá (v multiplayeru u klienta jen jeho osobní část + kopie sdíleného světa).
import { MOON, BASE, PRICE_PER_KG, HEX_BONUS, PLANET } from './config.js';
import { MARKET, HEXUP } from './catalog.js';
import { hexes, hexProgress } from './planet/dustmap.js';
import { dirToCell } from './planet/hexgrid.js';
import { angleBetween, tangentTo } from './planet/vec.js';
import { SPAWN, SPAWN_FACING } from './base.js';

const R = MOON.radius;

// net.mode: 'sp' = jeden hráč, 'host' = hostitel světa, 'client' = připojený hráč
export const game = { s: null, dust: null, slot: null, mode: 'sp', clockOffset: 0, started: 0 };

export const newToolState = () => ({ load: 0, lv: { width: 0, hopper: 0, power: 0 } });

// Vyžaduje hotovou hexovou mřížku a čerstvě vygenerovanou mapu prachu (world.js → prepareMoon).
export function newGame(title = 'Nová směna', dust = game.dust) {
  game.s = {
    v: 2,
    planet: PLANET.id,                            // 'moon' / 'mars' (config.js PLANETS)
    title,
    money: 0,
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
    garage: false,                                // postavená garáž
    vehicles: [],                                 // { type, spot, p, f, load, lv: { width, speed } }
    driving: -1,                                  // index vozidla, ve kterém sedíš
    stations: [],                                 // { hex, robot }
    drones: [],                                   // UFO drony { p, t, hex, k, load, mode } (drones.js)
    depots: [],                                   // { hex, store, belt, to, transit: [[s, kg]] } (depots.js)
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

// Doplní pole, která starší uložené hry nemají (hra z předchozí verze se načte beze ztrát).
export function upgradeState(s = game.s) {
  s.planet = s.planet === 'mars' ? 'mars' : 'moon';
  delete s.go;                                    // nedokončený odlet raketou se neobnovuje
  if (!Array.isArray(s.depots)) s.depots = [];
  if (!Array.isArray(s.drones)) s.drones = [];
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
  }
  s.belt = Math.min(2, Math.max(0, s.belt | 0));
  s.jetpack = s.jetpack ? 1 : 0;
  if (!Array.isArray(s.hotbar)) s.hotbar = [s.tool || 'toothbrush'];
  s.sel = s.sel | 0;
  s.market = Math.min(MARKET.max, Math.max(0, s.market | 0));
  s.hexup = Math.min(HEXUP.max, Math.max(0, s.hexup | 0));
}

// Výkupní cena prachu ($/kg) podle burzy ve Výkupu.
export const dustPrice = () => PRICE_PER_KG * (1 + MARKET.step * (game.s?.market | 0));
// Prémie za dočištěný hex ($) podle vylepšení ve Výkupu.
export const hexBonus = () => Math.round(HEX_BONUS * (1 + HEXUP.step * (game.s?.hexup | 0)));

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
