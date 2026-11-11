// Lunar Prachocuc 5000 (07, fáze D): traktor se sběrným ramenem za sebou. Dva módy:
//   jízda – ramena svisle nahoru, plná rychlost, nezametá
//   sběr  – ramena vodorovně do stran, rychlost −35 %, zametá pás přes celé rameno za traktorem
// Přepnutí (F) trvá ARM.time s; zametá se, až když jsou ramena úplně dole (armT = 1).
// Stav ve vozidle: v.mod = 'jizda' | 'sber', v.armT = 0 (nahoře) … 1 (dole), v.lv.rameno = 0–3 (záběr), v.lv.privez = 0–3.
import { MOON } from './config.js';
import { game } from './state.js';
import { vehicleById, batteryPoint } from './catalog.js';
import { pushOut, localToDir, STRUCTURES, SWAP } from './structures.js';
import { rockHit } from './rocks.js';
import { norm, madd, cross, angleBetween, tangentTo, dot } from './planet/vec.js';

const R = MOON.radius;
export const ARM = {
  z: -2.95,        // osa ramene za středem traktoru (uzel „zametani“ modelu)
  time: 1.5,       // s na sklopení / zvednutí
  sweepR: 0.45,    // poloviční tloušťka zameteného pásu (m)
  passes: 4,       // rameno přejede každé místo jen jednou → sebere tolikrát víc než jeden průchod kruhu
  probe: 0.3,      // poloměr kolize bodů na rameni (m)
};

// Přívěs (07, fáze E): kinematický, bez fyziky. Oj je spojená v bodě „tazne“ traktoru (hitch m za středem), bod náprav
// se táhne za ním ve vzdálenosti L (délka oje podle velikosti přívěsu = lv.privez). Stav: v.tr = úhel přívěsu vůči traktoru (rad).
export const TRAILER = {
  hitch: -3.35,                   // uzel „tazne“ modelu traktoru
  hitchY: 0.56,
  L: [2.55, 2.95, 3.25, 3.6],     // od oje ke středu náprav (extras.oj_m přívěsů 1–4)
  max: Math.PI / 3,               // největší zalomení 60° (ověřeno na modelech: přívěs se nedotkne svislých ramen)
  r: 1.6,                         // poloměr přívěsu jako překážky pro ostatní
};
const trailerLen = v => TRAILER.L[Math.min(3, v?.lv?.privez | 0)];

// Střed náprav přívěsu na zemi (jednotkový vektor) pro traktor v p s čelem f a úhlem v.tr.
export function trailerPoint(v, p = v.p, f = v.f) {
  const side = cross(p, f), tr = v.tr || 0, L = trailerLen(v);
  const h = madd(p, f, TRAILER.hitch / R);
  return norm(madd(madd(h, f, -Math.cos(tr) * L / R), side, -Math.sin(tr) * L / R));
}

// Krok přívěsu po pohybu traktoru z (p0, f0) do (v.p, v.f): bod náprav zůstane, kde byl, a přitáhne se na délku oje.
// Při couvání se zalomení tlumí k nule, aby se souprava nezasekla.
const lastPose = new Map();     // uid → { p, f } traktoru po minulem kroku (otaceni se deje i mimo drive, proto ne p0 / f0 z nej)
export function stepTrailer(v, dt, speed) {
  const prev = lastPose.get(v.uid);
  lastPose.set(v.uid, { p: v.p.slice(), f: v.f.slice() });
  if (!prev || angleBetween(prev.p, v.p) * R > 5) return;                 // prvni krok / vozidlo se premistilo (privolani)
  const a = trailerPoint(v, prev.p, prev.f);
  const h = norm(madd(v.p, v.f, TRAILER.hitch / R));
  const to = tangentTo(h, [h[0] - a[0], h[1] - a[1], h[2] - a[2]]);       // od náprav k tažnému bodu
  let tr = Math.atan2(dot(to, cross(v.p, v.f)), dot(to, v.f));
  if (!isFinite(tr)) tr = v.tr || 0;
  if (speed < -0.05) tr *= Math.exp(-dt * 2.5);
  v.tr = Math.max(-TRAILER.max, Math.min(TRAILER.max, tr));
}

export const hasArm = v => !!vehicleById(v?.type)?.arm;
export const armDown = v => hasArm(v) && (v.armT || 0) >= 1;
export const armMode = v => (v?.mod === 'sber' ? 'sber' : 'jizda');

// Konce ramene na zemi (jednotkové vektory): [levý, pravý] pro vozidlo v p s čelem f a záběrem width.
export function armEnds(p, f, width) {
  const c = norm(madd(p, f, ARM.z / R));
  const right = cross(p, f);
  return [norm(madd(c, right, -width / 2 / R)), norm(madd(c, right, width / 2 / R))];
}

// Narazilo by vodorovné rameno do stavby nebo kamene? (body po ~1 m přes celé rameno)
export function armBlocked(p, f, width) {
  const c = norm(madd(p, f, ARM.z / R));
  const right = cross(p, f);
  const n = Math.max(2, Math.ceil(width));
  for (let k = 0; k <= n; k++) {
    const x = -width / 2 + width * k / n;
    if (Math.abs(x) < 1.2) continue;                       // střed je za traktorem – hlídá ho kolize vozidla
    const q = norm(madd(c, right, x / R));
    if (pushOut(q, ARM.probe) || rockHit(q, ARM.probe, true) >= 0) return true;      // jen velké kameny, malé rameno přejede
  }
  return false;
}

// F: přepne mód. Vrací text pro hráče.
export function toggleArm(v, width) {
  if (!hasArm(v)) return '';
  if (armMode(v) === 'sber') { v.mod = 'jizda'; return 'Jízda – ramena nahoru'; }
  if (armBlocked(v.p, v.f, width)) return 'Tady ramena nerozložíš – překáží stavba nebo kámen';
  v.mod = 'sber';
  return `Sběr – ramena dolů · ${String(width).replace('.', ',')} m`;
}

// Krok sklápění (volá řidič každý snímek).
export function stepArm(v, dt) {
  const want = armMode(v) === 'sber' ? 1 : 0;
  const t = v.armT ?? want;
  v.armT = want > t ? Math.min(1, t + dt / ARM.time) : want < t ? Math.max(0, t - dt / ARM.time) : t;
}

// Hlášky (main.js je vypíše): rameno narazilo, výměník s rameny dole.
let note = null, noteAt = 0;
export function takeArmNote() { const n = note; note = null; return n; }
function say(text, gap) {
  const now = performance.now();
  if (now - noteAt < gap) return;
  noteAt = now;
  note = text;
}
export const armHitNote = () => say('Rameno narazilo – zvedni ramena (F)', 3000);

// Řidič stojí s Prachocucem ve výměníku s rameny dole → hláška (výměna se nespustí, energy.js vehicleOnBay).
export function swapArmHint(v) {
  if (!hasArm(v) || !((v.armT || 0) > 0)) return;
  const bp = batteryPoint(v.type);
  const at = bp ? norm(madd(v.p, v.f, bp.z / R)) : v.p;
  for (const b of game.s.buildings) {
    if (b.type !== 'swapper') continue;
    const [x, z] = STRUCTURES.swapper.bay;
    if (angleBetween(at, localToDir(b.p, b.yaw, x, z)) * R < SWAP.bayR) { say('Zvedni ramena (F) – výměník vymění baterii jen s rameny nahoře', 6000); return; }
  }
}
