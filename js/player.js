// Hráč: chůze a jízda s fyzikou (gravitace do středu Měsíce), zametání a výkup prachu.
import {
  MOON, JUMP_SPEED, UNITS_PER_KG,
} from './config.js';
import { JETPACK, BOOST, VEHICLE_BODY, vehicleById, VEHICLE_BATTERY, EMERGENCY_SPEED, batteryCap, isAirType } from './catalog.js';
import { AIR, airFloor, towerPush, landSite } from './flight.js';
import { carryTick, setCarryHooks, dropCarry, carrying, setAirHeading, noteHook } from './carry.js';
import { game, dustPrice, hexBonus } from './state.js';
import { activeEquipment, walkSpeed } from './equipment.js';
import { createBody, stepBody, jumpBody, altitude, heightAt as groundAt } from './physics.js';   // groundAt = terén i desky staveb
import { sweepCapsule } from './planet/dustmap.js';
import { heightAt } from './planet/height.js';
import { depotAt, depotRoom, dumpZoneAt, dumpRate, DUMP } from './logistics.js';
import { pushOut, structureById } from './structures.js';
import { roofCover } from './solarRoof.js';
import { rockHit, rockPush, rockHeight, breakRock, rockBlockedNote, ROCK_TYPES, ROCK_BREAKERS, rocks } from './rocks.js';
import { autopilotDrive, autopilotOff } from './autopilot.js';
import { inBuyback } from './base.js';
import { createRagdoll, stepRagdoll, ragdollPoints, encodeRagdollStart, RAG_STEP, RG } from './ragdoll.js';
import { cross, madd, norm, tangentTo, angleBetween, rotateAround, dot } from './planet/vec.js';

const R = MOON.radius;
const TOOL_AHEAD = 0.95;
const BODY_R = 0.32;                     // kolize astronauta pěšky (3.1, AST-03: kapsle 0,32 m bez fousků a číra)
const HIT_R = 0.45;                      // zásah vozidlem – válec kolem astronauta (AST-03)                 // nástroj nese astronaut ~1 m před sebou
const PUSH_GAP = 1.1;                    // u ručního vozíku jde astronaut za ním
const SWEEP_ALT = 0.5;                   // zametá se i při malém odskoku (do 0,5 m nad zemí)
// přilnavost a tlumiče (physics.js): astronaut se z hrbolu odlepí jen výjimečně, vozidla podle katalogu
const WALK_BODY = [0.8, 6];
const TURN_RATE = 1.6;                   // rad/s – nejrychlejší zatáčení vozidla při jízdě myší
const STEER_DEADZONE = Math.sin(3 * Math.PI / 180);   // pod 3° odchylky se nezatáčí (žádné cukání na rovince)
const walkerBody = p => createBody(p, ...WALK_BODY);

// Informace pro animace a efekty.
export const playerFx = {
  moving: false,
  speed: 0,
  face: null,          // kam je astronaut / vozidlo natočené (tečný vektor)
  tool: null,          // kde zametá nástroj (jednotkový vektor)
  swept: 0,
  bonus: 0,
  completed: [],
  airborne: false,
  alt: 0,              // výška nad terénem
  vr: 0,               // svislá rychlost
  landed: 0,           // rychlost dopadu (jednorázově, pro efekty)
  landedAnim: false,
  deposit: null,       // { i, kg }: náklad právě vysypaný do depa i
  jet: 0,              // čas posledního výstřelu jetpackem (performance.now), 0 = nic
  boosting: false,     // vozidlo právě jede s boostem
};

let body = null;                         // těleso astronauta
let rag = null;                          // ragdoll po srážce (null = hráč ovládá postavu)
let getUpUntil = 0;                      // 3.1 (AST-09): po ragdollu klip vstávání – do té doby bez ovládání
export const GETUP_MS = 1400;
export const isGettingUp = () => performance.now() < getUpUntil;
const NO_INPUT = { move: () => null, turn: () => 0, target: null, pointerDown: false, boost: false };
let ragPts = null;

// Tahy nástrojem/vozidlem pro multiplayer: { seq, p, w, pw, cont } (posledních 32).
export const strokes = { seq: 0, list: [] };
const vehicleBodies = new Map();         // index vozidla → těleso
let prevTool = null;
let vehicleSpeed = 0;                    // aktuální rychlost řízeného vozidla (m/s, se znaménkem)
let jetReady = true;                     // jetpack je nabitý (nabije se dopadem na zem)
let boostLeft = BOOST.duration;          // zbývající boost vozidla (s)
let ride = null;                         // cestující v přepravníku: { i, seat, uid }
// Směr postavy po chůzi myší (klik / držení): s.f (= kamera) se při ní nemění, aby se cíl na obrazovce neutíkal.
// Postava ale hledí ve směru chůze – první klávesa A/D/W/S (i šipky, tlačítka otáčení kamery) převezme
// tento směr do s.f, takže otáčení a chůze pokračují z toho, kam postava opravdu míří (null = shodné s s.f).
let walkFace = null;

function adoptWalkFace() {
  if (!walkFace) return;
  const s = game.s;
  const f = tangentTo(s.p, walkFace);
  walkFace = null;
  if (Math.hypot(f[0], f[1], f[2]) > 1e-6) s.f = f;
}

// Kam se dívá postava pěšky (stojí-li): směr poslední chůze myší, jinak s.f.
export const walkFacing = () => (walkFace && game.s.driving < 0 && !ride ? tangentTo(game.s.p, walkFace) : game.s.f);

export function initPlayer() {
  body = walkerBody(game.s.p);
  rag = null;
  ragPts = null;
  vehicleBodies.clear();
  prevTool = null;
  vehicleSpeed = 0;
  ride = null;
  playerFx.face = game.s.f;
}

export function vehicleBody(i) {
  const v = game.s.vehicles[i];
  let b = vehicleBodies.get(i);
  if (!b || v.moved) {
    b = createBody(v.p, ...(vehicleById(v.type)?.body || VEHICLE_BODY));
    vehicleBodies.set(i, b);
    v.moved = false;
  }
  return b;
}

export const activeBody = () => (game.s.driving >= 0 ? vehicleBody(game.s.driving) : body);
export const playerRight = () => norm(cross(game.s.f, game.s.p));

// Otočí směr pohledu / jízdy kolem „svislé“ osy; kladný úhel = doleva.
export function rotateHeading(angle) {
  const s = game.s;
  if (s.driving < 0) adoptWalkFace();             // pěšky otáčet od směru, kam postava míří (i po chůzi myší)
  s.f = tangentTo(s.p, rotateAround(s.f, s.p, angle));
}

export function tryJump() {
  if (game.s.driving >= 0 || rag || ride || isGettingUp()) return;
  jumpBody(body, JUMP_SPEED);
}

// Jetpack: ve vzduchu vystřelí astronauta ve směru kamery (look = [x,y,z] směr pohledu),
// nejméně o JETPACK.lift stupňů nad obzor. Vrací true, když vystřelil.
export function tryJet(look) {
  const s = game.s;
  if (!s.jetpack || !jetReady || s.driving >= 0 || rag || ride || body.grounded || isGettingUp()) return false;
  const up = body.p;
  let flat = tangentTo(up, look);
  if (!Number.isFinite(flat[0]) || Math.hypot(...flat) < 1e-6) flat = s.f;
  const lv = dot(look, up) / Math.hypot(...look);
  const ang = Math.max(Math.asin(Math.max(-1, Math.min(1, lv))), JETPACK.lift * Math.PI / 180);
  const v = JETPACK.speed;
  body.v = flat.map(c => c * Math.cos(ang) * v);
  body.vr = Math.sin(ang) * v;
  body.jumped = true;                        // ve vzduchu plná měsíční lehkost (physics.js)
  body.jet = true;
  jetReady = false;
  s.f = flat;
  playerFx.jet = performance.now();
  return true;
}
export const jetCharged = () => jetReady;

// ---------- cestující v přepravníku ----------

export const riding = () => ride;

// Nastoupí do vozidla i na sedadlo cestujícího seat (řídí ho někdo jiný, nebo nikdo).
export function boardVehicle(i, seat) {
  const v = game.s.vehicles[i];
  if (!v || game.s.driving >= 0 || rag) return false;
  ride = { i, seat, uid: v.uid || '' };
  prevTool = null;
  return true;
}

export function leaveRide() {
  if (!ride) return;
  const s = game.s;
  const v = s.vehicles[ride.i];
  const p = v ? v.p : s.p, f = v ? v.f : s.f;
  const side = norm(cross(f, p));
  const out = norm(madd(p, side, (ride.seat % 2 ? 2.4 : -2.4) / R));   // vystoupí na svou stranu
  ride = null;
  body = walkerBody(out);
  s.p = out;
  s.f = tangentTo(out, f);
}

// Po prodeji / přečíslování vozidel: najít přepravník podle uid, zmizel-li, vystoupit.
export function remapRide() {
  if (!ride) return;
  const i = game.s.vehicles.findIndex(v => (v.uid || '') === ride.uid);
  if (i < 0) leaveRide();
  else ride.i = i;
}

// Cestující jede s vozidlem: p, r = poloha vozidla (od řidiče nebo zaparkovaného).
export function followRide(p, r) {
  const s = game.s;
  s.p = p;
  s.f = tangentTo(p, s.f);
  body.p = p;
  body.r = r;
  body.g = r;
  body.vr = 0;
  body.v = [0, 0, 0];
  body.grounded = true;
}

// ---------- pohyb ----------

function walk(input, dt) {
  const s = game.s;
  let want = null;                                // null = stát (na zemi) / letět dál (ve vzduchu)
  let dir = null;
  const speed = walkSpeed();                       // měsíční boty zrychlují chůzi
  const m = input.move();
  if (m) {
    input.target = null;
    adoptWalkFace();                              // W/S po chůzi myší = dopředu tam, kam postava hledí
    dir = s.f.map(c => c * m.fwd);
  } else if (input.target) {
    const dist = angleBetween(s.p, input.target) * R;
    if (dist < 0.2) {
      if (!input.pointerDown) input.target = null;
    } else {
      dir = tangentTo(s.p, input.target);
      walkFace = dir;
      want = dir.map(c => c * Math.min(speed, dist * 4));
    }
  }
  if (dir && m) want = norm(dir).map(c => c * speed);

  if (body.grounded) body.jet = false;
  stepBody(body, dt, want, body.jet ? 0.12 : undefined);   // po výstřelu jetpackem se ve vzduchu skoro neřídí
  blockByStructures(body, BODY_R);
  blockByRocks(body, BODY_R);                     // pěšky jen střední kameny (malé se překročí)
  if (body.grounded) { body.jet = false; jetReady = true; }
  s.p = body.p;
  s.f = tangentTo(s.p, s.f);
  const sp = Math.hypot(body.v[0], body.v[1], body.v[2]);
  playerFx.moving = body.grounded ? sp > 0.2 : false;
  playerFx.speed = sp;
  playerFx.face = sp > 0.2 ? norm(body.v) : walkFacing();
}

// ---------- létání (3.1, L-66) ----------
// v.air = { mode: 'ground' | 'fly' | 'land', alt: cílová výška nad terénem, to / top: místo a výška přistání }.
// Letoun drží výšku nad terénem pod sebou a 10 a 20 m před sebou, nad stavbami střecha + 3 m, od věže LAAC odstup.
// W/S plyn, A/D otáčení (main.js), mezerník / Shift výška, klik = let k místu, E = přistát (interact.js → landAircraft).
export const isFlying = () => { const v = game.s.vehicles[game.s.driving]; return !!v && isAirType(v.type) && v.air?.mode !== 'ground'; };
export const airMode = () => game.s.vehicles[game.s.driving]?.air?.mode || null;
export const airAltitude = () => { const v = game.s.vehicles[game.s.driving]; return v?.air ? Math.max(0, altitude(vehicleBody(game.s.driving))) : 0; };
// E ve vzduchu: přistát (na vlastní plošinu do 30 m, jinak na místě). Vrací hlášku, když to nejde, jinak null.
export function landAircraft() {
  const s = game.s, v = s.vehicles[s.driving];
  if (!v?.air || v.air.mode !== 'fly') return null;
  if (carrying()) return 'Nejdřív polož nebo odhákni vozidlo';
  const site = landSite(v, vehicleBody(s.driving).p);
  if (site.reason) return site.reason;
  v.air.mode = 'land';
  v.air.to = site.to;
  v.air.top = site.top;
  input0.target = null;
  return null;
}
const input0 = { target: null };
// Poloha letounu pro převoz (interact.js): { p, r, f } nebo null
export function airPose() {
  const s = game.s;
  if (s.driving < 0 || !isAirType(s.vehicles[s.driving]?.type)) return null;
  const b = vehicleBody(s.driving);
  return { p: b.p, r: b.r, f: s.f };
}
let carryCap = null, carryLoad = false, airDrift = [0, 0, 0];   // převoz (3.1, L-67): z minulého snímku
function fly(input, dt) {
  const s = game.s;
  const v = s.vehicles[s.driving];
  const b = vehicleBody(s.driving);
  const eq = activeEquipment();
  const A = v.air ||= { mode: 'ground', alt: AIR.start };
  input0.target = input.target;
  const cap = batteryCap(v);
  const empty = cap > 0 && !(v.charge > 0);
  const ground = groundAt(b.p);
  let h = b.r - R;                                                     // výška nad poloměrem
  const alt = h - ground;
  const m = input.move();
  // vzlet: mezerník, plyn nebo klik
  if (A.mode === 'ground' && (input.jump || (m && m.fwd > 0) || input.target)) { A.mode = 'fly'; A.alt = Math.max(AIR.min, A.alt || AIR.start); }
  const sweeper = eq.stats.width > 0;
  const minAlt = sweeper ? AIR.sweepAlt : AIR.min;
  if (A.mode === 'fly') {
    A.alt = Math.max(minAlt, Math.min(AIR.max, (A.alt || AIR.start) + ((input.jump ? 1 : 0) - (input.boost ? 1 : 0)) * AIR.climb * dt));
    if (empty) A.alt = Math.min(A.alt, AIR.emergencyAlt);            // nouzový režim: nízko a pomalu (L-66)
  }
  const sweeping = sweeper && A.mode === 'fly' && alt <= AIR.sweepAlt + 0.5 && v.load < eq.stats.hopper;
  const base = vehicleById(v.type);
  const laden = carryLoad || (base.carry === 'arm' && (v.load || 0) > 1);           // s vozidlem / nákladem pomaleji (L-65)
  const ladenMax = laden && base.loadSpeed ? base.loadSpeed * eq.stats.speed / base.speed : Infinity;
  const max = Math.min(ladenMax, empty ? AIR.emergencySpeed : sweeping && eq.stats.sweepSpeed ? eq.stats.sweepSpeed : eq.stats.speed);

  // vodorovně: plyn / klik jako u vozidel, přistání = přiblížení k místu
  let target = 0;
  if (A.mode === 'fly') {
    if (m) { input.target = null; target = m.fwd * max * (m.fwd < 0 ? 0.4 : 1); }
    else if (input.target) {
      const dist = angleBetween(b.p, input.target) * R;
      if (dist < 2) { if (!input.pointerDown) input.target = null; }
      else {
        const to = tangentTo(b.p, input.target);
        const side = dot(to, playerRight()), ahead = dot(to, s.f);
        const steer = ahead <= 0.3 ? Math.sign(side || 1) : Math.max(-1, Math.min(1, side * 3));   // cíl za zády = plný rejd
        rotateHeading(-steer * dt * TURN_RATE * 1.4);
        target = ahead > 0.3 ? Math.min(max, dist / 1.5) : 0;
      }
    }
  }
  if (A.mode === 'land') {
    const d = angleBetween(b.p, A.to) * R;
    if (d > 0.15) {                                                     // přiblížení nad místo přistání
      const dir = tangentTo(b.p, A.to);
      const step = Math.min(d, Math.min(AIR.approach, Math.max(1, d)) * dt);
      b.p = norm(madd(b.p, dir, step / R));
    }
    vehicleSpeed *= Math.max(0, 1 - dt * 3);
  } else {
    const k = Math.abs(target) > Math.abs(vehicleSpeed) ? AIR.accel : Math.max(AIR.accel, max / AIR.stop);
    vehicleSpeed += Math.max(-k * dt, Math.min(k * dt, target - vehicleSpeed));
    if (A.mode === 'ground') vehicleSpeed = 0;
    b.p = norm(madd(b.p, s.f, vehicleSpeed * dt / R));
  }
  // Mula cítí náklad: tah lana mírně posouvá letoun (drift po povrchu, tlumený)
  if (carryLoad && A.mode !== 'ground') b.p = norm(madd(b.p, airDrift, dt / R));
  b.p = towerPush(b.p);

  // svisle: cílová výška nad terénem pod sebou a před sebou, nad stavbami střecha + 3 m
  const g2 = groundAt(b.p);
  let goal;
  if (A.mode === 'ground') goal = g2;
  else if (A.mode === 'land') {
    const d = angleBetween(b.p, A.to) * R;
    goal = d > 0.4 ? Math.max(h, A.top + 1) : A.top;                    // nad místem dolů
  } else {
    // výš (nad 3 m) hledí 10 a 20 m dopředu a stoupá s předstihem; nízko (zametání) jen 2 a 4 m před nos, ať drží terén
    const fw = vehicleSpeed > 1 ? s.f : null;
    const [n1, n2] = A.alt > 3 ? [10, 20] : [2, 4];
    const ahead = fw ? Math.max(heightAt(norm(madd(b.p, fw, n1 / R))), heightAt(norm(madd(b.p, fw, n2 / R)))) : g2;
    goal = Math.max(g2, ahead - (A.alt > 3 ? 0 : 0.2)) + A.alt;
    const floor = Math.max(airFloor(b.p), fw ? airFloor(norm(madd(b.p, fw, 8 / R))) : -Infinity);
    if (floor > goal) goal = floor;
  }
  const rate = A.mode === 'land' ? AIR.landSpeed : AIR.vRate;
  const vr = Math.max(-rate, Math.min(rate, (goal - h) * 2.5));
  h = Math.max(g2, h + vr * dt);
  if (A.mode === 'land' && h - A.top < 0.05 && angleBetween(b.p, A.to) * R < 0.4) {   // dosedl
    A.mode = 'ground';
    h = Math.max(g2, A.top);
    vehicleSpeed = 0;
    A.to = null;
  }
  b.r = R + h;
  b.vr = vr;
  b.v = s.f.map(c => c * vehicleSpeed);
  b.grounded = A.mode === 'ground';
  s.p = b.p;
  s.f = tangentTo(s.p, s.f);
  v.p = b.p;
  v.f = s.f;
  // převoz vozidla (Mula lano / Kondor ruka): krok simulace u pilota
  const air = { p: b.p, r: b.r, f: s.f };
  setAirHeading(s.f);
  noteHook(air);
  const cr = carryTick(dt, v, air, !!input.keys?.e);
  carryCap = cr?.cap ?? null;
  carryLoad = !!cr?.load;
  if (cr?.pull) {
    const t = tangentTo(b.p, cr.pull), k = Math.hypot(...cr.pull);
    airDrift = madd(airDrift.map(c => c * Math.max(0, 1 - dt * 2)), Number.isFinite(t[0]) ? t : [0, 0, 0], k * dt);   // rychle tlumený drift
  } else airDrift = [0, 0, 0];

  // spotřeba: vznášení + let podle rychlosti + zametání; na zemi nic
  if (cap > 0 && A.mode !== 'ground') {
    const B = VEHICLE_BATTERY[v.type];
    const P = (B.hover || 0) + ((B.drive || 0) - (B.hover || 0)) * Math.min(1, Math.abs(vehicleSpeed) / Math.max(1, eq.stats.speed)) + (sweeping ? B.sweep || 0 : 0) + (laden ? B.load || 0 : 0);
    v.charge = Math.max(0, (v.charge || 0) - P * dt);
  }
  playerFx.flying = A.mode !== 'ground';
  playerFx.airClimb = vr;
  body.p = b.p;
  body.r = b.r;
  body.vr = 0;
  body.grounded = true;
  playerFx.moving = Math.abs(vehicleSpeed) > 0.2;
  playerFx.speed = Math.abs(vehicleSpeed);
  playerFx.face = s.f;
}
function drive(input, dt) {
  const s = game.s;
  const v = s.vehicles[s.driving];
  if (isAirType(v?.type)) { fly(input, dt); return; }
  const b = vehicleBody(s.driving);
  const eq = activeEquipment();
  // boost (Shift): skokové zrychlení, dokud zbývá; nabíjí se, když se nepoužívá
  // baterie (L-01, L-02): při 0 % nouzový režim – 15 % rychlosti, nezametá, bez boostu
  const cap = batteryCap(v);
  const empty = cap > 0 && !(v.charge > 0);
  // autopilot (L-40, L-41): místo plynu a jízdy myší dá cílovou rychlost a otáčení
  const ap = autopilotDrive(dt, input, {
    max: eq.stats.speed * (empty ? EMERGENCY_SPEED : 1), speed: vehicleSpeed, front: eq.base.front || 0, width: eq.stats.width,
    empty, full: eq.stats.hopper > 0 && v.load >= eq.stats.hopper - 0.01, manual: input.turn() !== 0,
  });
  const boost = eq.stats.boost || 1;
  const boosting = !ap && boost > 1 && input.boost && boostLeft > 0 && b.grounded && !empty;
  boostLeft = boosting ? Math.max(0, boostLeft - dt) : Math.min(BOOST.duration, boostLeft + dt * BOOST.duration / BOOST.recharge);
  playerFx.boosting = boosting;
  const max = eq.stats.speed * (boosting ? boost : 1) * (empty ? EMERGENCY_SPEED : 1);

  let throttle = 0;
  const m = ap ? null : input.move();
  if (ap) {
    if (ap.turn) rotateHeading(ap.turn * dt);
  } else if (m) {
    input.target = null;
    throttle = m.fwd;
  } else if (input.target) {
    // klik = jeď tam: natoč se k cíli a přidej plyn. Vzdálenost se měří od přední hrany vozidla.
    const front = eq.base.front || 0;
    const nose = front > 0 ? norm(madd(s.p, s.f, front / R)) : s.p;
    const dist = angleBetween(nose, input.target) * R;
    const reach = Math.max(1.5, Math.max(front, 1) * 0.8);
    if (dist < reach) {
      if (!input.pointerDown) input.target = null;
    } else {
      const to = tangentTo(s.p, input.target);
      const side = dot(to, playerRight());
      const ahead = dot(to, s.f);
      const center = angleBetween(s.p, input.target) * R;
      const turnR = Math.max(2, Math.abs(vehicleSpeed) / TURN_RATE);
      const steer = ahead > 0 && Math.abs(side) < STEER_DEADZONE ? 0 : Math.max(-1, Math.min(1, side * 3));
      if (ahead <= 0.3 && center < turnR * 1.2 + front) {
        // cíl stranou / za vozidlem uvnitř otáčecího kruhu: nekroužit, zastavit a otočit se na místě plným rejdem
        rotateHeading(-Math.sign(side || 1) * dt * TURN_RATE);
        throttle = 0;
      } else {
        rotateHeading(-steer * dt * TURN_RATE);
        throttle = ahead > 0.3 ? Math.min(1, dist / 8) : 0.2;
      }
    }
  }

  if (boosting && throttle === 0 && !input.target) throttle = 1;  // boost jede vpřed i bez plynu
  const target = ap ? Math.max(-max, Math.min(max, ap.speed)) : throttle * max * (throttle < 0 ? 0.5 : 1);
  if (boosting && target > vehicleSpeed) vehicleSpeed = target;     // skokově, ne postupně
  const accel = (Math.abs(target) > Math.abs(vehicleSpeed) ? 3.5 : 6) * dt;   // brzdí rychleji, než zrychluje
  vehicleSpeed += Math.max(-accel, Math.min(accel, target - vehicleSpeed));

  stepBody(b, dt, s.f.map(c => c * vehicleSpeed), 0);   // vozidlo ve vzduchu neřídí
  const bodyR = Math.max(1, (eq.base.front || 1) * 0.9);
  if (blockByStructures(b, bodyR)) vehicleSpeed *= 0.5;
  // kameny: Měsíční zametací vůz a Mega rover je nárazem rozbijí, ostatní vozidla se o ně zastaví (s hláškou)
  if (b.grounded) {
    const k = rockHit(b.p, bodyR);
    if (k >= 0) {
      if (ROCK_BREAKERS.has(v.type)) {                        // i opřené o kámen (jinak by se z nuly nerozjelo)
        breakRock(k);
        vehicleSpeed *= ROCK_TYPES[rocks.type[k]].big ? 0.6 : 0.85;
      } else {
        pushFrom(b, rockPush(k, b.p, bodyR));
        if (Math.abs(vehicleSpeed) > 0.3) rockBlockedNote();
        vehicleSpeed *= 0.3;
      }
    }
  }
  if (!b.grounded) vehicleSpeed = dot(b.v, s.f);
  s.p = b.p;
  s.f = tangentTo(s.p, s.f);
  v.p = b.p;
  v.f = s.f;

  // spotřeba: P = jízda × (0,3 + 0,7 × |v| / vmax) + zametání; stojící vozidlo nespotřebovává nic
  if (cap > 0 && Math.abs(vehicleSpeed) > 0.2) {
    const B = VEHICLE_BATTERY[v.type];
    const P = B.drive * (0.3 + 0.7 * Math.min(1, Math.abs(vehicleSpeed) / eq.stats.speed)) + (playerFx.swept > 0 ? B.sweep : 0);
    v.charge = Math.max(0, (v.charge || 0) - P * (1 - roofCover(v)) * dt);   // solární střecha pokryje část spotřeby (L-04)
  }

  // astronaut jede s vozidlem
  body.p = b.p;
  body.r = b.r;
  body.vr = 0;
  body.grounded = true;
  playerFx.moving = Math.abs(vehicleSpeed) > 0.2;
  playerFx.speed = Math.abs(vehicleSpeed);
  playerFx.face = s.f;
}

// Stavby jsou pro hráče a vozidla pevná překážka (jen pevné části, betonová plocha je průjezdná – O-07).
// Vrací true, když těleso narazilo.
function blockByStructures(b, radius) {
  const hit = pushOut(b.p, radius);
  if (!hit) return false;
  pushFrom(b, hit);
  return true;
}
function pushFrom(b, hit) {
  b.p = hit.p;
  const into = dot(b.v, hit.n);
  if (into < 0) b.v = madd(b.v, hit.n, -into);        // složka rychlosti do zdi zmizí
}
// Astronaut pěšky: o střední kámen se zastaví, s jetpackem nad ním přeletí.
function blockByRocks(b, radius) {
  const k = rockHit(b.p, radius, true);
  if (k < 0 || altitude(b) > rockHeight(k)) return;
  pushFrom(b, rockPush(k, b.p, radius));
}

// ---------- srážka s vozidlem → ragdoll ----------

export const ragdollState = () => ragPts;
// Pro ostatní hráče: začátek letu (jednou) a 4× za sekundu poloha pánve – zbytek si spočítají sami (ragdoll.js).
let ragStart = null, ragSeq = 0;
export const ragdollNet = () => {
  if (!rag) return { g: null, gc: null };
  const slot = Math.floor(rag.time * 4);
  if (rag.fixSlot !== slot) {
    rag.fixSlot = slot;
    rag.fix = [Math.round(rag.time * 100), Math.round(rag.pos[0] * 100), Math.round(rag.pos[1] * 100), Math.round(rag.pos[2] * 100)];
  }
  return { g: ragStart, gc: rag.fix };
};
export const currentVehicleSpeed = () => vehicleSpeed;
export const boostCharge = () => boostLeft / BOOST.duration;
export const isRagdoll = () => !!rag;

// pose = body ragdollu z aktuální pózy modelu, vel = rychlost odhození, spin = rotace (rad/s).
export function knockOut(pose, vel, spin) {
  if (rag || game.s.driving >= 0) return false;
  rag = createRagdoll(pose, vel, spin);
  rag.acc = 0;
  ragPts = ragdollPoints(rag);
  ragStart = encodeRagdollStart(++ragSeq, Date.now() + game.clockOffset, pose, vel, spin);
  prevTool = null;
  return true;
}

// Vozidla v pohybu: [{ pos: [x,y,z], radius, vel: [x,y,z], speed }]. Při zásahu vrátí true.
export function checkVehicleHits(movers, posePoints) {
  if (rag || game.s.driving >= 0 || ride) return false;
  const b = body;
  const me = [b.p[0] * b.r, b.p[1] * b.r, b.p[2] * b.r];
  for (const m of movers) {
    if (m.speed < 1.8) continue;
    const d = Math.hypot(me[0] - m.pos[0], me[1] - m.pos[1], me[2] - m.pos[2]);
    if (d > m.radius * 0.8 + HIT_R) continue;
    const up = b.p;
    const lift = 2.2 + m.speed * 0.55;
    const k = 1.25;
    const vel = [m.vel[0] * k + up[0] * lift, m.vel[1] * k + up[1] * lift, m.vel[2] * k + up[2] * lift];
    const side = norm(cross(m.vel, up));
    const w = 2 + Math.random() * 3;
    const spin = [side[0] * w + (Math.random() - 0.5) * 2, side[1] * w + (Math.random() - 0.5) * 2, side[2] * w + (Math.random() - 0.5) * 2];
    return knockOut(posePoints(), vel, spin);
  }
  return false;
}

function flyRagdoll(dt) {
  const s = game.s;
  // pevný krok (stejně jako u ostatních hráčů, kteří let počítají sami)
  let landed = 0;
  rag.acc += Math.min(dt, 0.25);
  while (rag.acc >= RAG_STEP && !rag.done) {
    landed = Math.max(landed, stepRagdoll(rag, RAG_STEP));
    rag.acc -= RAG_STEP;
  }
  ragPts = ragdollPoints(rag);
  const pel = ragPts[RG.pelvis];
  s.p = norm(pel);
  s.f = tangentTo(s.p, s.f);
  playerFx.moving = false;
  playerFx.speed = 0;
  playerFx.airborne = true;
  playerFx.alt = 0;
  if (landed) playerFx.landed = Math.min(3, landed * 0.6);
  if (rag.done) {
    // vstát: astronaut se postaví tam, kde leží pánev. Na břiše čelem tam, kam míří hlava, na zádech tam, kde
    // má nohy (3.1: klipy vstavani_bricho / vstavani_zada začínají v této póze – scene/astronaut.js endRagdoll)
    const head = ragPts[RG.head];
    const toHead = tangentTo(s.p, [head[0] - pel[0], head[1] - pel[1], head[2] - pel[2]]);
    const onBack = Math.hypot(...ragPts[RG.pack]) < Math.hypot(...ragPts[RG.chest]);
    if (Number.isFinite(toHead[0])) s.f = onBack ? toHead.map(c => -c) : toHead;
    getUpUntil = performance.now() + GETUP_MS;
    walkFace = null;                               // směr chůze myší z doby před srážkou neplatí
    body = walkerBody(s.p);
    rag = null;
    ragPts = null;
    playerFx.airborne = false;
    playerFx.landedAnim = true;
  }
}

// Výška nad terénem (m) – i v letu po srážce (ragdoll).
export function currentAltitude() {
  if (rag && ragPts) {
    const pel = ragPts[RG.pelvis];
    const l = Math.hypot(pel[0], pel[1], pel[2]);
    return l - (R + heightAt([pel[0] / l, pel[1] / l, pel[2] / l]));
  }
  return body ? altitude(body) : 0;
}

export function movePlayer(input, dt) {
  if (rag) { flyRagdoll(dt); return; }
  if (isGettingUp() && game.s.driving < 0) input = NO_INPUT;    // vstává po ragdollu (klip 1,4 s)
  if (ride) {
    playerFx.moving = false;
    playerFx.speed = 0;
    playerFx.face = game.s.f;
    playerFx.airborne = false;
    playerFx.alt = 0;
    playerFx.vr = 0;
    return;
  }
  if (game.s.driving >= 0) drive(input, dt);
  else walk(input, dt);
  const b = activeBody();
  const flyingNow = game.s.driving >= 0 && isAirType(game.s.vehicles[game.s.driving]?.type);
  if (!flyingNow) playerFx.flying = false;
  playerFx.airborne = !b.grounded && !flyingNow;                       // v letounu astronaut sedí (žádný klip skoku)
  playerFx.alt = Math.max(0, altitude(b));
  playerFx.vr = b.vr;
  if (b.landed > 0.8) {
    playerFx.landed = b.landed;
    playerFx.landedAnim = true;
  }
}

// ---------- nastupování ----------

export function enterVehicle(i) {
  const s = game.s;
  if (ride) return;
  s.driving = i;
  walkFace = null;
  const v = s.vehicles[i];
  if (isAirType(v.type)) v.air = { mode: 'fly', alt: AIR.start };      // po nástupu letoun vzlétne na 6 m (L-66)
  s.p = v.p;
  s.f = v.f;
  vehicleSpeed = 0;
  prevTool = null;
  autopilotOff();
}

export function exitVehicle() {
  const s = game.s;
  const i = s.driving;
  if (i < 0) return;
  const v = s.vehicles[i];
  if (isAirType(v.type)) dropCarry();                // nesené vozidlo se položí pod letoun (3.1)
  const b = vehicleBody(i);
  b.v = [0, 0, 0];
  vehicleSpeed = 0;
  s.driving = -1;
  autopilotOff();
  // vystoupíš vedle vozidla (vpravo)
  const side = norm(cross(v.f, v.p));
  const out = norm(madd(v.p, side, (isAirType(v.type) ? 3.8 : 2.2) / R));   // z letounu vedle trupu (3.1)
  body = walkerBody(out);
  s.p = out;
  s.f = tangentTo(out, v.f);
  walkFace = null;
  prevTool = null;
}

// ---------- práce: zametání a výkup ----------

// Vrací výdělek z výkupu, pokud se právě vykupovalo.
// Kde právě je hlava nástroje / sání vozidla (stejný vzorec jako v collect()). Pro kruh nástroje ve scéně,
// který se kreslí každý snímek – zametání samo běží v pracovním ticku 10× za s, takže by kruh jinak poskakoval.
export function toolPoint() {
  if (rag || ride) return null;
  const s = game.s;
  const eq = activeEquipment();
  if (!(eq.stats.width > 0)) return null;
  const ahead = eq.kind === 'vehicle' ? eq.base.front : TOOL_AHEAD;
  const face = tangentTo(s.p, eq.kind === 'vehicle' ? s.f : (playerFx.face || s.f));
  return norm(madd(s.p, face, ahead / R));
}

export function collect() {
  const s = game.s;
  playerFx.deposit = null;
  if (rag || ride) { playerFx.swept = 0; playerFx.bonus = 0; playerFx.completed = []; playerFx.tool = null; return 0; }
  const eq = activeEquipment();
  const b = activeBody();
  playerFx.swept = 0;
  playerFx.bonus = 0;
  playerFx.completed = [];

  const flat = eq.kind === 'vehicle' && batteryCap(eq.item) > 0 && !(eq.item.charge > 0);   // vybitá baterie = nezametá
  const width = flat ? 0 : eq.stats.width;
  if (width > 0) {
    const ahead = eq.kind === 'vehicle' ? eq.base.front : TOOL_AHEAD;
    const face = tangentTo(s.p, eq.kind === 'vehicle' ? s.f : (playerFx.face || s.f));
    const tool = norm(madd(s.p, face, ahead / R));
    playerFx.tool = tool;

    const item = eq.item;
    const airV = eq.kind === 'vehicle' && eq.base.kind === 'air';
    const onGround = airV ? altitude(b) <= AIR.sweepAlt + 0.5 : b.grounded || altitude(b) < SWEEP_ALT;   // Prachovka zametá v 1,5 m (3.1)
    if (onGround && item.load < eq.stats.hopper) {
      const limit = Math.ceil((eq.stats.hopper - item.load) * UNITS_PER_KG);
      const r = sweepCapsule(prevTool || tool, tool, width / 2, eq.stats.power, limit);
      item.load = Math.min(eq.stats.hopper, item.load + r.got / UNITS_PER_KG);
      playerFx.swept = r.got;
      playerFx.completed = r.completed;
      playerFx.bonus = r.completed.length * hexBonus();
      s.money += playerFx.bonus;
      const last = strokes.list[strokes.list.length - 1];
      if (r.got > 0 || (last && last.seq === strokes.seq && angleBetween(last.p, tool) * R > 0.05)) {   // tah pro ostatní hráče
        strokes.seq++;
        strokes.list.push({ seq: strokes.seq, p: tool, w: width, pw: eq.stats.power, cont: !!prevTool });
        if (strokes.list.length > 32) strokes.list.shift();
      }
    }
    prevTool = onGround ? tool : null;
  } else {
    playerFx.tool = null;
    prevTool = null;
  }

  // výkup: stačí vstoupit / vjet do zóny uprostřed základny. Vysype se náklad v ruce (vozidlo / nástroj)
  // i všech ostatních nástrojů v hotbaru.
  if (!b.grounded && !(eq.base.kind === 'air' && altitude(b) <= AIR.sellAlt)) return 0;   // letoun vysype i ve visu do 10 m (L-65)
  const loads = [eq.item];
  for (const id of s.hotbar || []) {
    const t = typeof id === 'string' ? s.tools[id] : null;
    if (t && !loads.includes(t)) loads.push(t);
  }
  const total = loads.reduce((a, it) => a + (it.load || 0), 0);
  if (!(total > 0)) return 0;
  if (inBuyback(s.p)) {
    const earned = total * dustPrice();
    s.money += earned;
    for (const it of loads) it.load = 0;
    return earned;
  }
  // depo (L-20): náklad se vysype do skladu – jen kolik se vejde, peníze přinese pás (zpracuje main.js)
  const id = s.driving >= 0 ? null : depotAt(s.p);           // 3.1: vozidlo vysypává do depa jen výsypkou (unloadToDepot)
  const room = id ? depotRoom(structureById(id)) - (playerFx.pendingDeposit?.[id] || 0) : 0;
  if (id && room >= 0.1) {
    const kg = Math.min(total, room);
    const k = kg / total;
    playerFx.deposit = { id, kg };
    for (const it of loads) it.load = Math.max(0, (it.load || 0) * (1 - k));
  }
  return 0;
}

// Výsypka depa (L-63, 3.1): řízené vozidlo se zásobníkem, které stojí pod výsypkou (pod 0,5 m/s déle než 0,5 s),
// do ní vysype náklad rychlostí dumpRate() (100 / 200 / 400 kg/s). playerFx.dump = { id, state: dump | wait | empty | full,
// rate, kg } (empty = vozidlo nemá co vysypat, full = depo je plné; kg = vysypáno v tomto ticku).
// Volá main.js work() 10× za s; připsání do skladu (hostitel) / hlášení hostiteli (klient, dk) dělá main.js.
let dumpStill = 0;
export function unloadToDepot(dt) {
  const s = game.s;
  playerFx.dump = null;
  if (s.driving < 0 || rag || ride) { dumpStill = 0; return; }
  const eq = activeEquipment();
  if (!(eq.stats.hopper > 0)) return;
  const b = dumpZoneAt(activeBody().p);
  if (!b) { dumpStill = 0; return; }
  dumpStill = playerFx.speed < DUMP.maxSpeed ? dumpStill + dt : 0;
  const v = eq.item, rate = dumpRate();
  const room = depotRoom(b) - (playerFx.pendingDeposit?.[b.id] || 0), load = v.load || 0;
  const state = load < 0.05 ? 'empty' : room < 0.1 ? 'full' : dumpStill < DUMP.still ? 'wait' : 'dump';
  playerFx.dump = { id: b.id, state, rate, kg: 0 };
  if (state !== 'dump') return;
  const kg = Math.min(rate * dt, load, room);
  v.load = load - kg;
  playerFx.dump.kg = kg;
}

// Kondor (3.1, L-63/L-67): visí 6–14 m nad silem depa (do 3 m od středu) a stojí → náklad se plní ze skladu rychlostí
// výsypky (100 / 200 / 400 kg/s). playerFx.silo = { id, state: load | wait | low | high | full | empty, rate, kg }.
// Odečtení ze skladu dělá main.js (hostitel takeFromDepot, klient hlásí hostiteli).
const SILO_TOP = 6;
let siloStill = 0;
export function loadFromSilo(dt) {
  const s = game.s;
  playerFx.silo = null;
  const v = s.driving >= 0 ? s.vehicles[s.driving] : null;
  if (!v || vehicleById(v.type)?.carry !== 'arm' || v.air?.mode !== 'fly' || rag) { siloStill = 0; return; }
  const b = activeBody();
  const dep = (s.buildings || []).find(d => d.type === 'depot' && angleBetween(d.p, b.p) * R < 3);
  if (!dep) { siloStill = 0; return; }
  const above = altitude(b) - SILO_TOP;
  const eq = activeEquipment(), rate = dumpRate();
  siloStill = playerFx.speed < DUMP.maxSpeed ? siloStill + dt : 0;
  const room = eq.stats.hopper - (v.load || 0), store = (dep.data.store || 0) - (playerFx.pendingTake?.[dep.id] || 0);
  const state = above < 6 ? 'low' : above > 14 ? 'high' : room < 0.5 ? 'full' : store < 0.5 ? 'empty' : siloStill < DUMP.still ? 'wait' : 'load';
  playerFx.silo = { id: dep.id, state, rate, kg: 0 };
  if (state !== 'load') return;
  const kg = Math.min(rate * dt, room, store);
  v.load = (v.load || 0) + kg;
  playerFx.silo.kg = kg;
}

// Kde stojí astronaut, když tlačí ruční vozík (za vozíkem).
export function pusherOffset() {
  return -PUSH_GAP;
}

setCarryHooks({ body: i => (game.s.vehicles[i] ? vehicleBody(i) : null) });   // převoz zapisuje polohu do tělesa neseného vozidla
