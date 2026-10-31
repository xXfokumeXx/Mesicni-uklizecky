// Stav hry. Prach se nosí v nástroji nebo ve vozidle, ne v astronautovi.
// game.s = vše, co se ukládá (v multiplayeru u klienta jen jeho osobní část + kopie sdíleného světa).
import { MOON, BASE } from './config.js';
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
    title,
    money: 0,
    p: SPAWN,                                     // pozice (jednotkový vektor)
    f: tangentTo(SPAWN, SPAWN_FACING),            // směr pohledu / jízdy (tečný vektor)
    warp: 0,                                      // posun času (klávesa T)
    tools: { toothbrush: newToolState() },        // vlastněné nástroje
    tool: 'toothbrush',                           // nástroj v ruce
    boots: 0,                                     // úroveň měsíčních bot (0–3)
    garage: false,                                // postavená garáž
    vehicles: [],                                 // { type, spot, p, f, load, lv: { width, speed } }
    driving: -1,                                  // index vozidla, ve kterém sedíš
    stations: [],                                 // { hex, robot }
    won: false,
    playMs: 0,                                    // odehraný čas (pro seznam uložených her)
    last: Date.now(),
  };
  game.dust = dust;
}

// Čas hry: hodiny počítače (+ v multiplayeru posun na hodiny hostitele) + zrychlení klávesou T.
// Díky tomu mají všichni hráči stejnou denní dobu.
export const gameTime = () => Date.now() + game.clockOffset + (game.s.warp || 0);

export const hexPct        = () => hexes.total ? hexes.doneCount / hexes.total * 100 : 0;
export const currentHexPct = () => hexProgress(dirToCell(game.s.p));
export const baseDistance  = () => angleBetween(game.s.p, BASE.dir) * R;
