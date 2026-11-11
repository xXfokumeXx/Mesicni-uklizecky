// Převoz vozidel letouny (3.1, L-67, O-24): lano Muly (fyzika) a robotická ruka Kondoru (pevně). Bez three.js.
//
// Simuluje jen pilot (hráč, který letoun řídí). Stav letu je modulový (C), na letounu jen v.carry = { i, uid }
// (při načtení hry se vozidlo položí pod letoun – laac.js UPGRADES). Nesené vozidlo: carry.js mu každý snímek
// zapíše polohu (v.p, v.f, těleso r) a v.carriedUp (osa „nahoru“, actors.js podle ní natáčí model).
//
// Lano: 12 bodů Verletem ve světových souřadnicích (m), gravitace do středu Měsíce, krok 1/120 s (2 podkroky
// na snímek), 6 průchodů délky (lano se smí prověsit, nesmí se natáhnout). Tlumení kyvu vůči háku 0,6 % na krok
// (11. 11. na přání hráče: houpání odezní za pár sekund) + celkové 0,05 %. Poslední bod =
// vozidlo (střecha), 20× těžší než lano, koule podle velikosti vozidla dře o terén. Kyv 12 m ≈ 17 s.
import { game } from './state.js';
import { MOON, MOON_GRAVITY } from './config.js';
import { vehicleById, isAirType } from './catalog.js';
import { heightAt as groundAt } from './physics.js';
import { heightAt as terrainAt } from './planet/height.js';
import { angleBetween, norm, madd, tangentTo, dot, cross, anyTangent } from './planet/vec.js';

const R = MOON.radius;
export const CARRY = {
  arm: { reachH: 3, minUp: 4, maxUp: 8, unfold: 1.5, grip: [0, -3.6, 1.35], slope: Math.tan(20 * Math.PI / 180) },
  rope: { reachH: 4, minUp: 6, maxUp: 16, lower: 1.5, n: 12, len: 12, minLen: 8, maxLen: 20, sub: 2, iters: 6, damp: 0.0005, swing: 0.006,   // damp = celkové tlumení, swing = tlumení kyvu vůči háku (11. 11.: kyv odezní za ~4 s, náklad let nebrzdí)
   
    unhookAlt: 1, unhookSpeed: 1.5, holdRelease: 1, winch: [0, 0.9, 0], heavy: 20, pull: 0.5 },   // pull = tah lana na Mulu (11. 11.: méně, Mula s nákladem méně cuká)
};

// Napojení (player.js): těleso vozidla, výška střechy podle typu, kdo vozidlo řídí, položení (klient → hostitel)
let hooks = { body: null, roof: () => 1.8, taken: () => false, placed: () => {} };
export function setCarryHooks(h) { hooks = { ...hooks, ...h }; }

// ---------- vektory ve světě ----------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const len3 = a => Math.hypot(a[0], a[1], a[2]);
const world = (dir, r) => mul(dir, r);
// Bod v místních souřadnicích letounu (x vpravo… jako model: X = up × f, Y = up, Z = f) → svět
function local(air, [x, y, z]) {
  const up = air.p, f = air.f, X = cross(up, f);
  const o = world(air.p, air.r);
  return add(add(add(o, mul(X, x)), mul(up, y)), mul(f, z));
}

const C = { active: false };                         // let s nákladem (jen u pilota)
export const carrying = () => (C.active ? C : null);
export const carriedBy = i => { for (const v of game.s.vehicles) if (v.carry && v.carry.i === i) return true; return false; };

// Vozidlo, které jde nabrat: { i } nebo { reason }
function candidate(av, air) {
  const base = vehicleById(av.type), mode = base.carry;
  const P = mode === 'arm' ? CARRY.arm : CARRY.rope;
  let best = -1, bestD = Infinity, why = '';
  game.s.vehicles.forEach((v, i) => {
    if (v === av || isAirType(v.type) || hooks.taken(i) || carriedBy(i)) return;
    const d = angleBetween(v.p, air.p) * R;
    if (d > P.reachH + 6) return;
    const top = groundAt(v.p) + hooks.roof(v.type);
    const above = air.r - R - top;
    if (base.carryFits && !base.carryFits.includes(v.type)) { why ||= mode === 'rope' ? 'Mega rover je na lano moc těžký – unese ho jen Kondor' : 'Tohle vozidlo neunese'; return; }   // 11. 11.: hned nad ním, ať pilot nehledá výšku zbytečně
    if (d > P.reachH) { why ||= `Leť nad vozidlo (do ${P.reachH} m)`; return; }
    if (above < P.minUp) { why ||= `Vystoupej výš nad vozidlo (${P.minUp}–${P.maxUp} m)`; return; }
    if (above > P.maxUp) { why ||= `Klesni níž k vozidlu (${P.minUp}–${P.maxUp} m nad ním)`; return; }
    if (d < bestD) { bestD = d; best = i; }
  });
  return best >= 0 ? { i: best } : { reason: why };
}

// ---------- akce E (interact.js) ----------
// { label, run } nebo null (letoun bez převozu). run vrací hlášku (nejde) nebo null.
export function carryPrompt(av, air) {
  const base = vehicleById(av.type);
  if (!base?.carry || !air) return null;
  const name = i => vehicleById(game.s.vehicles[i]?.type)?.name || 'vozidlo';
  if (C.active && C.a === av) {
    if (C.phase === 'attach' || C.phase === 'grab') return { label: base.carry === 'arm' ? 'Rameno se rozkládá…' : 'Lano sjíždí…', run: null };
    if (C.phase === 'fall') return { label: 'Vozidlo padá…', run: null };
    if (base.carry === 'arm') return { label: `Položit: ${name(C.i)}`, run: () => release(air) };
    const ok = C.vehAlt <= CARRY.rope.unhookAlt && C.vehSpeed < CARRY.rope.unhookSpeed;
    return { label: ok ? `Odháknout: ${name(C.i)}` : `Polož vozidlo na zem (do 1 m, pomalu) · podrž E 1 s = nouzově uvolnit`, run: ok ? () => release(air) : null };
  }
  const c = candidate(av, air);
  if (c.i === undefined) return c.reason ? { label: c.reason, run: null, soft: true } : null;
  return { label: `${base.carry === 'arm' ? 'Uchopit' : 'Zaháknout'}: ${name(c.i)}`, run: () => attach(av, air, c.i) };
}

function attach(av, air, i) {
  const v = game.s.vehicles[i], base = vehicleById(av.type);
  const top = world(v.p, R + groundAt(v.p) + hooks.roof(v.type));
  Object.assign(C, { active: true, a: av, i, uid: v.uid, mode: base.carry, phase: base.carry === 'arm' ? 'grab' : 'attach', t: 0, hold: 0,
    up: v.p.slice(), f: v.f?.slice() || anyTangent(v.p), veh: top, vprev: top, vehAlt: 0, vehSpeed: 0, pts: null, prev: null, armK: 0, hookPrev: null });
  av.carry = { i, uid: v.uid };
  return null;
}

// Položení / odháknutí: vozidlo stojí na zemi pod nákladem
function release(air) {
  if (!C.active) return null;
  const v = game.s.vehicles[C.i];
  if (C.mode === 'arm') {
    const at = norm(C.veh);
    const t = anyTangent(at), u = cross(at, t);
    let lo = Infinity, hi = -Infinity;
    for (const [a, c] of [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2]]) { const h = terrainAt(norm(madd(madd(at, t, a / R), u, c / R))); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    if ((hi - lo) / 4 > CARRY.arm.slope) return 'Moc strmý svah na položení (víc než 20°) – popoleť jinam';
  }
  place(v, norm(C.veh));
  end();
  return null;
}
function place(v, dir) {
  if (!v) return;
  v.p = dir;
  v.f = tangentTo(dir, C.f || anyTangent(dir));
  delete v.carriedUp;
  v.moved = true;                                    // těleso se založí znovu na zemi
  hooks.placed(game.s.vehicles.indexOf(v));
}
function end() {
  if (C.a) delete C.a.carry;
  C.armOut = C.mode === 'arm' ? performance.now() : 0;   // rameno se složí (vizuál)
  C.active = false;
}
// Letoun přestal letět / pilot vystoupil / vozidlo zmizelo → položit pod letoun
export function dropCarry() {
  if (!C.active) return;
  const v = game.s.vehicles[C.i];
  if (v && v.uid === C.uid) place(v, norm(C.veh));
  end();
}

// ---------- krok (player.js fly, každý snímek) ----------
// air = { p: směr, r: poloměr, f: směr letu, vel: [3] m/s, keys }. Vrací { cap, pull: [3] m/s² } nebo null.
export function carryTick(dt, av, air, holdE) {
  if (!C.active || C.a !== av) return null;
  const v = game.s.vehicles[C.i];
  if (!v || v.uid !== C.uid) { end(); return null; }
  const base = vehicleById(av.type);
  C.t += dt;
  let pull = [0, 0, 0];
  if (C.mode === 'arm') {
    C.armK = Math.min(1, C.t / CARRY.arm.unfold);
    if (C.phase === 'grab' && C.armK >= 1) C.phase = 'hold';
    if (C.phase === 'hold') {
      const grip = local(air, CARRY.arm.grip);
      C.up = air.p.slice(); C.f = air.f.slice();
      C.veh = grip;
      writeVehicle(v, sub(grip, mul(air.p, hooks.roof(v.type))), air.p, air.f);
    }
  } else {
    const P = CARRY.rope;
    const hook = local(air, P.winch);
    const gl = av.lv?.special > 0 ? (av.ropeLen || P.len) : P.len;      // naviják (Speciální): délka kolečkem
    if (C.phase === 'attach') {                                          // lano sjíždí k vozidlu
      if (C.t >= P.lower) {
        C.phase = 'hold';
        const n = P.n, pts = [];
        for (let k = 0; k < n; k++) pts.push(add(hook, mul(sub(C.veh, hook), k / (n - 1))));
        C.pts = pts; C.prev = pts.map(p => p.slice());
      }
    }
    if (C.phase === 'hold' || C.phase === 'fall') pull = rope(dt, hook, gl, C.phase === 'fall', v);
    // nouzové uvolnění: podržet E 1 s
    C.hold = holdE && C.phase === 'hold' ? C.hold + dt : 0;
    if (C.hold >= P.holdRelease) { C.phase = 'fall'; C.hold = 0; }
    if (C.phase === 'fall' && C.vehAlt <= 0.05) { place(v, norm(C.veh)); end(); return null; }
  }
  const carryingNow = C.phase === 'hold' || C.phase === 'fall';
  return { cap: carryingNow && C.phase !== 'fall' && base.loadSpeed ? base.loadSpeed : null, pull, load: carryingNow && C.phase !== 'fall' };
}

// Lano: Verlet + délkové omezení; vrací tah na Mulu (m/s²)
function rope(dt, hook, L, free, v) {
  const P = CARRY.rope, n = P.n, seg = L / (n - 1);
  const h = Math.min(dt, 0.05) / P.sub;
  const roofH = hooks.roof(v.type);
  const pts = C.pts, prev = C.prev;
  let pull = [0, 0, 0];
  // posun háku za podkrok – tlumení kyvu měří rychlost bodů vůči háku (houpání se utlumí, let s hákem ne)
  const dh = C.hookPrev ? mul(sub(hook, C.hookPrev), 1 / P.sub) : [0, 0, 0];
  C.hookPrev = hook.slice();
  for (let s = 0; s < P.sub; s++) {
    pts[0] = hook.slice(); prev[0] = hook.slice();
    for (let k = 1; k < n; k++) {
      const p = pts[k], g = mul(norm(p), -MOON_GRAVITY * h * h);
      const raw = sub(p, prev[k]);
      const vel = free && k === n - 1 ? raw                                  // padající vozidlo bez tlumení
        : mul(add(dh, mul(sub(raw, dh), 1 - P.swing)), 1 - P.damp);
      prev[k] = p.slice();
      pts[k] = add(add(p, vel), g);
    }
    // náklad: kyvadlo – nejvýš L od háku (hák je proti vozidlu nekonečně těžký); tah = o kolik ho lano táhne
    if (!free) {
      const d = sub(pts[n - 1], hook), l = len3(d);
      if (l > L) {
        pts[n - 1] = add(hook, mul(d, L / l));
        const k = Math.min(1, (l - L) * 20 + 0.4) * P.pull / l;      // tah = největší v podkrocích (lano napnuté)
        if (k * l > len3(pull)) pull = mul(d, k);
      }
    }
    for (let it = 0; it < P.iters; it++) {
      for (let k = 0; k < n - 1; k++) {
        if (free && k === n - 2) continue;                              // utržené: vozidlo padá samo
        const a = pts[k], b = pts[k + 1], d = sub(b, a), l = len3(d);
        if (l <= seg || l < 1e-6) continue;                             // prověšené lano netlačí
        const wa = k === 0 ? 0 : 1, wb = k + 1 === n - 1 ? 0 : 1;       // konce (hák, náklad) drží, lano se dopočítá
        if (!(wa + wb)) continue;
        const corr = (l - seg) / l / (wa + wb);
        pts[k] = add(a, mul(d, corr * wa));
        pts[k + 1] = sub(b, mul(d, corr * wb));
      }
      // body lana nad terénem (jen nízko), vozidlo jako koule s třením
      for (let k = 1; k < n; k++) {
        const p = pts[k], r = len3(p), dir = mul(p, 1 / r);
        const ground = R + (k === n - 1 ? groundAt(dir) + roofH * 0.85 : terrainAt(dir) + 0.05);   // náklad: střecha nad zemí
        if (r < ground) {
          pts[k] = mul(dir, ground);
          if (k === n - 1) prev[k] = add(mul(prev[k], 0.7), mul(pts[k], 0.3));   // tření o terén
        }
      }
    }
  }
  // vozidlo = poslední bod (střecha); osa „nahoru“ k předchozímu bodu lana, natočení pomalu za letem
  const end3 = pts[n - 1];
  const toHook = norm(sub(pts[n - 2], end3));
  const upNow = norm(end3);
  const want = free ? upNow : norm(add(mul(upNow, 0.6), mul(toHook, 0.4)));
  C.up = norm(add(mul(C.up, 0.95), mul(want, 0.05)));
  C.f = tangentTo(norm(end3), add(mul(C.f, 0.98), mul(tangentTo(norm(end3), C.af || C.f), 0.02)));
  C.vehSpeed = len3(sub(end3, C.veh)) / Math.max(1e-3, dt);
  C.veh = end3.slice();
  const origin = sub(end3, mul(C.up, roofH));
  C.vehAlt = len3(origin) - R - groundAt(norm(origin));
  writeVehicle(v, origin, C.up, C.f);
  return pull;
}

// Zapíše polohu nesenému vozidlu (záznam + těleso, ať ho actors.js kreslí ve vzduchu)
function writeVehicle(v, origin, up, f) {
  const r = len3(origin), dir = mul(origin, 1 / r);
  v.p = dir;
  v.f = tangentTo(dir, f);
  v.carriedUp = up.slice();
  const b = hooks.body?.(game.s.vehicles.indexOf(v));
  if (b) { b.p = dir; b.r = r; b.grounded = false; b.v = [0, 0, 0]; b.vr = 0; }
}
export const setAirHeading = f => { if (C.active) C.af = f; };

// ---------- pro scénu a síť ----------
// Lano k vykreslení (svět): body nebo null; armK (0–1) rozložení ruky
export function ropePoints() {
  if (!C.active || C.mode !== 'rope') return null;
  if (C.phase === 'attach') {                                         // sjíždí: od háku dolů podle času
    const hook = C.hookNow || C.veh, k = Math.min(1, C.t / CARRY.rope.lower);
    return [hook, add(hook, mul(sub(C.veh, hook), k))];
  }
  return C.phase === 'fall' ? null : C.pts;
}
export function armPose(av) {
  if (C.active && C.a === av && C.mode === 'arm') return C.armK;
  if (C.armOut && av?.type === 'kondor') { const k = 1 - (performance.now() - C.armOut) / 1000 / CARRY.arm.unfold; if (k > 0) return k; C.armOut = 0; }
  return 0;
}
export function noteHook(air) { if (C.active && C.mode === 'rope') C.hookNow = local(air, CARRY.rope.winch); }
