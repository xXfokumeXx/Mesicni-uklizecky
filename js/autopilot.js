// Autopilot vozidel (fáze 5): Autocruise (L-40) a asistent hrany prachu (L-41, upraveno podle hráče 3. 11.).
// Běží jen u toho, kdo vozidlo řídí (jeho klient vozidlo stejně simuluje) – po síti nic navíc, ostatní vidí jen jízdu.
// autopilotDrive() vrací cílovou rychlost a otáčení; player.js drive() je použije místo plynu a jízdy myší.
//
// Asistent hrany funguje jako asistent jízdy v pruhu: žádná pevná oblast, žádné obraty ani hledání. 10× za s čte
// 2 řady vzorků prachové mapy (2 a 4 m před přední hranou, přes šířku sání + 30 % do stran), najde hranu
// prachu, kterou už hráč udělal (strana čista se pozná sama), a drží ji na vnitřním okraji sání s přesahem
// 10 % šířky (sledování bodu na hraně – pure pursuit, úhlová rychlost omezená jako u A/D). Rychlost drží Autocruise.
// Když hranu nevidí, jede rovně a chytí ji, jakmile se objeví. A/D dočasně přebije, S nebo E vypne.
import { MOON } from './config.js';
import { game } from './state.js';
import { VEHICLE_BATTERY } from './catalog.js';
import { probeDust } from './planet/dustmap.js';
import { pushOut } from './structures.js';
import { rockHit, ROCK_BREAKERS } from './rocks.js';
import { cross, norm } from './planet/vec.js';

const R = MOON.radius;
const TURN_MAX = 1.4;                          // rad/s – stejně jako A/D ve vozidle (main.js)
const LOOK = 6;                                // m – kontrola překážek před přední hranou (L-40)
const LAT = 13;                                // vzorků v řadě (2 řady)
const ROWS = [2, 4];                           // m před přední hranou
const SPREAD = 0.8;                            // řada sahá ± 0,8 šířky sání (sání + 30 % do stran)
const OVERLAP = 0.1;                           // přesah přes hranu (10 % šířky)
const SENSE_DT = 0.1, OBST_DT = 0.2;
const LOST_AFTER = 1;                          // s bez hrany → strana čista se pozná znovu

const ap = {
  mode: 0,             // 0 vypnuto, 1 autocruise, 2 asistent hrany
  set: 0.5,            // nastavená rychlost (podíl max. rychlosti, po 25 %)
  uid: null,           // vozidlo, ve kterém autopilot jede
  kw: true, ks: true,  // W / S byly minule dole (mění se na stisk, ne na držení)
  block: null,         // překážka před vozidlem: 'static' | 'dynamic' | null
  obstT: 0, senseT: 0,
  side: 0,             // strana čista vůči vozidlu: −1 vlevo, +1 vpravo, 0 neznámá
  aim: null,           // { y, L } – kam míří (příčná odchylka v m, vzdálenost bodu od středu vozidla)
  lost: 0,             // jak dlouho hranu nevidí (s)
  ref: 0,              // klouzavá úroveň prachu (pro práh 10 %)
  manual: false,
  fullWarned: false,
};
let note = null;                               // hláška pro toast (main.js si ji vyzvedne)
let movers = () => [];                         // ostatní vozidla a hráči: [{ p, dyn }] (main.js – multiplayer)

export const setAutopilotMovers = fn => { movers = fn; };
export const takeAutopilotNote = () => { const n = note; note = null; return n; };
export const autopilotMode = () => ap.mode;

function off(msg = null) {
  ap.mode = 0;
  ap.aim = null;
  ap.block = null;
  if (msg) note = msg;
}
export const autopilotOff = msg => { if (ap.mode) off(msg); };

// C: vypnuto → autocruise → asistent hrany (je-li koupený) → vypnuto. frac = současná rychlost / max. Vrací text pro toast.
export function toggleAutopilot(frac = 0) {
  const s = game.s;
  const v = s.vehicles[s.driving];
  if (!v) return null;
  if (!VEHICLE_BATTERY[v.type]) return 'Ruční vozík autocruise nemá – tlačíš ho sám.';
  if (!(v.lv?.cruise > 0)) return 'Autocruise si kup v Dílně → Vozidla (nejdřív ho vyzkoumej ve Výzkumném centru).';
  if (!(v.charge > 0)) return 'Baterie je vybitá – autopilot nejde zapnout.';
  if (ap.mode === 0) {
    ap.mode = 1;
    ap.uid = v.uid;
    ap.set = frac >= 0.2 ? Math.min(1, Math.ceil(frac * 4 - 0.05) / 4) : 0.5;
    ap.kw = ap.ks = true;
    ap.obstT = 0;
    return `Autocruise zapnutý – W / S mění rychlost po 25 %, A / D řídí, C = ${v.lv.edge > 0 ? 'asistent hrany prachu' : 'vypnout'}.`;
  }
  if (ap.mode === 1 && v.lv.edge > 0) {
    Object.assign(ap, { mode: 2, side: 0, aim: null, lost: 0, ref: 0, senseT: 0, manual: false, fullWarned: false });
    return 'Asistent hrany: najede na hranu prachu, kterou už máš, a drží ji uvnitř sání. A / D dočasně přebije, S nebo E vypne.';
  }
  off();
  return 'Autopilot vypnutý.';
}

// ---------- geometrie ----------

// Bod fwd m vpřed a lat m vpravo od p (tečné směry f, r) – zapíše do out.
function at(p, f, r, fwd, lat, out) {
  const a = fwd / R, b = lat / R;
  const x = p[0] + f[0] * a + r[0] * b, y = p[1] + f[1] * a + r[1] * b, z = p[2] + f[2] * a + r[2] * b;
  const l = Math.hypot(x, y, z);
  out[0] = x / l; out[1] = y / l; out[2] = z / l;
  return out;
}
const _q = [0, 0, 0], _probe = [0, 0, 0];

// ---------- čtení prachu před vozidlem ----------

const rowV = [new Float32Array(LAT), new Float32Array(LAT)];
const latX = (j, w) => (-SPREAD + 2 * SPREAD * j / (LAT - 1)) * w;
function sense(p, f, r, front, w) {
  let mx = 0;
  for (let k = 0; k < 2; k++) {
    for (let j = 0; j < LAT; j++) {
      const v = probeDust(at(p, f, r, front + ROWS[k], latX(j, w), _q), _probe)[0];
      rowV[k][j] = v;
      if (v > mx) mx = v;
    }
  }
  if (mx > ap.ref * 0.3) ap.ref = ap.ref ? ap.ref * 0.9 + mx * 0.1 : mx;   // jen skutečný prach, ne zbytky
}
const thresh = () => Math.max(0.5, ap.ref * 0.1);
const dirtyAt = (k, j) => rowV[k][j] > thresh();
// Hrana v řadě k při straně čista side: příčná poloha (m, + vpravo), nebo null (bez přechodu).
function edgeIn(k, side, w) {
  const first = side > 0 ? LAT - 1 : 0, step = side > 0 ? -1 : 1;
  if (dirtyAt(k, first)) return null;                       // prach i na straně čista: hrana není vidět
  for (let j = first + step; j >= 0 && j < LAT; j += step) {
    if (!dirtyAt(k, j)) continue;
    const nx = j + step;
    if (nx >= 0 && nx < LAT && !dirtyAt(k, nx)) continue;   // osamělý zbytek, ještě ne hrana
    return (latX(j, w) + latX(j - step, w)) / 2;
  }
  return null;                                              // před vozidlem je všude čisto
}
// Strana čista podle krajních vzorků obou řad (0 = nejde poznat).
function guessSide() {
  let l = 0, rr = 0;
  for (let k = 0; k < 2; k++) {
    if (!dirtyAt(k, 0)) l++;
    if (!dirtyAt(k, LAT - 1)) rr++;
  }
  if (l === 2 && rr === 0) return -1;
  if (rr === 2 && l === 0) return 1;
  return 0;
}

// ---------- překážky (L-40: do 6 m před vozidlem) ----------
// 11. 11. (rozhodl hráč): svah už překážka není – autopilot projede jakýkoli terén; zastaví jen stavba, kámen a vozidlo

let breaker = false;                                        // řízené vozidlo kameny rozbíjí (jede přes ně)
function obstacle(p, f, r, front, w) {
  for (let d = 1; d <= LOOK; d++) {
    const q = at(p, f, r, front + d, 0, _q);
    if (pushOut(q, Math.max(0.6, w / 2))) return 'static';
    if (!breaker && rockHit(q, Math.max(0.6, w / 2)) >= 0) return 'static';   // kámen, který toto vozidlo nerozbije
  }
  for (const m of movers()) {
    const dx = (m.p[0] - p[0]) * f[0] + (m.p[1] - p[1]) * f[1] + (m.p[2] - p[2]) * f[2];
    const dy = (m.p[0] - p[0]) * r[0] + (m.p[1] - p[1]) * r[1] + (m.p[2] - p[2]) * r[2];
    const ahead = dx * R - front;
    if (ahead > -1 && ahead < LOOK && Math.abs(dy * R) < w / 2 + 1.2) return m.dyn ? 'dynamic' : 'static';
  }
  return null;
}

// ---------- hlavní krok (každý snímek z player.js drive) ----------

// ctx: { max (m/s bez boostu), speed (m/s se znaménkem), front, width, empty, full, manual (A/D) }
export function autopilotDrive(dt, input, ctx) {
  if (!ap.mode) return null;
  const s = game.s;
  const v = s.vehicles[s.driving];
  if (!v || v.uid !== ap.uid) { off(); return null; }
  breaker = ROCK_BREAKERS.has(v.type);
  if (ctx.empty) { off('Baterie je vybitá – autopilot vypnutý, vozidlo jede v nouzovém režimu.'); return null; }
  if (input.target) { off('Autopilot vypnutý – řídíš myší.'); return null; }
  const k = input.keys;
  const w = !!(k.w || k.arrowup), sk = !!(k.s || k.arrowdown);
  const pressW = w && !ap.kw, pressS = sk && !ap.ks;
  ap.kw = w; ap.ks = sk;
  if (pressW) ap.set = Math.min(1, ap.set + 0.25);
  if (pressS) {
    if (ap.mode === 2 || ap.set <= 0.25) { off('Autopilot vypnutý.'); return null; }
    ap.set -= 0.25;
  }

  const p = s.p, f = s.f, r = norm(cross(f, p));
  const width = ctx.width || 2;
  ap.obstT -= dt;
  if (ap.obstT <= 0) { ap.obstT = OBST_DT; ap.block = obstacle(p, f, r, ctx.front, width); }
  const speed = ap.block ? 0 : ap.set * ctx.max;               // překážka: stát, po uvolnění se rozjede

  if (ap.mode === 1) return { speed, turn: 0 };                // A/D řídí main.js

  // ----- asistent hrany -----
  if (ctx.full && !ap.fullWarned) { ap.fullWarned = true; note = 'Zásobník plný – vysyp ho. Asistent hrany jede dál, ale už nezametá.'; }
  if (!ctx.full) ap.fullWarned = false;
  if (ctx.manual) {                                            // A/D dočasně přebije, pak hranu najde znovu
    ap.manual = true;
    ap.side = 0;
    ap.aim = null;
    return { speed, turn: 0 };
  }
  ap.manual = false;

  ap.senseT -= dt;
  if (ap.senseT <= 0) {
    ap.senseT = SENSE_DT;
    sense(p, f, r, ctx.front, width);
    if (!ap.side) ap.side = guessSide();
    ap.aim = null;
    if (ap.side) {
      const e4 = edgeIn(1, ap.side, width), e2 = edgeIn(0, ap.side, width);
      const keep = ap.side * (0.5 - OVERLAP) * width;         // kde má být hrana vůči středu sání
      if (e4 !== null) ap.aim = { y: e4 - keep, L: ctx.front + ROWS[1] };
      else if (e2 !== null) ap.aim = { y: e2 - keep, L: ctx.front + ROWS[0] };
    }
    ap.lost = ap.aim ? 0 : ap.lost + SENSE_DT;
    if (ap.lost >= LOST_AFTER) ap.side = 0;                   // hrana zmizela: poznat stranu znovu (třeba z druhé strany)
  }
  let turn = 0;
  if (ap.aim && speed > 0) {
    const wr = Math.max(1, Math.abs(ctx.speed)) * 2 * ap.aim.y / (ap.aim.L * ap.aim.L);
    turn = -Math.max(-TURN_MAX, Math.min(TURN_MAX, wr));       // y > 0 = hrana vpravo → zatočit doprava
  }
  return { speed, turn };
}

// Text do HUD („Autocruise · 75 %“), nebo null.
export function autopilotStatus() {
  if (!ap.mode) return null;
  const pct = `${Math.round(ap.set * 100)} %`;
  if (ap.mode === 1) return `Autocruise · ${pct}${ap.block ? ' · stojí (překážka)' : ''}`;
  const what = ap.block ? 'stojí (překážka)' : ap.manual ? 'řídíš ty' : ap.aim ? `drží hranu ${ap.side < 0 ? 'vlevo' : 'vpravo'}` : 'hledá hranu';
  return `Hrana · ${pct} · ${what}`;
}

// Pro testy a ladění z konzole.
export const autopilotDebug = () => ({ ...ap });
