// Hráč: chůze a jízda s fyzikou (gravitace do středu Měsíce), zametání a výkup prachu.
import {
  MOON, JUMP_SPEED, UNITS_PER_KG,
} from './config.js';
import { JETPACK, BOOST, VEHICLE_BODY, vehicleById, VEHICLE_BATTERY, EMERGENCY_SPEED, batteryCap } from './catalog.js';
import { game, dustPrice, hexBonus } from './state.js';
import { activeEquipment, walkSpeed } from './equipment.js';
import { createBody, stepBody, jumpBody, altitude } from './physics.js';
import { sweepCapsule } from './planet/dustmap.js';
import { heightAt } from './planet/height.js';
import { depotAt, depotRoom } from './logistics.js';
import { pushOut, structureById } from './structures.js';
import { roofCover } from './solarRoof.js';
import { rockHit, rockPush, rockHeight, breakRock, rockBlockedNote, ROCK_TYPES, ROCK_BREAKERS, rocks } from './rocks.js';
import { autopilotDrive, autopilotOff } from './autopilot.js';
import { inBuyback } from './base.js';
import { createRagdoll, stepRagdoll, ragdollPoints, encodeRagdollStart, RAG_STEP, RG } from './ragdoll.js';
import { cross, madd, norm, tangentTo, angleBetween, rotateAround, dot } from './planet/vec.js';

const R = MOON.radius;
const TOOL_AHEAD = 0.95;                 // nástroj nese astronaut ~1 m před sebou
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
let ragPts = null;

// Tahy nástrojem/vozidlem pro multiplayer: { seq, p, w, pw, cont } (posledních 32).
export const strokes = { seq: 0, list: [] };
const vehicleBodies = new Map();         // index vozidla → těleso
let prevTool = null;
let vehicleSpeed = 0;                    // aktuální rychlost řízeného vozidla (m/s, se znaménkem)
let jetReady = true;                     // jetpack je nabitý (nabije se dopadem na zem)
let boostLeft = BOOST.duration;          // zbývající boost vozidla (s)
let ride = null;                         // cestující v přepravníku: { i, seat, uid }

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
  s.f = tangentTo(s.p, rotateAround(s.f, s.p, angle));
}

export function tryJump() {
  if (game.s.driving >= 0 || rag || ride) return;
  jumpBody(body, JUMP_SPEED);
}

// Jetpack: ve vzduchu vystřelí astronauta ve směru kamery (look = [x,y,z] směr pohledu),
// nejméně o JETPACK.lift stupňů nad obzor. Vrací true, když vystřelil.
export function tryJet(look) {
  const s = game.s;
  if (!s.jetpack || !jetReady || s.driving >= 0 || rag || ride || body.grounded) return false;
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
    dir = s.f.map(c => c * m.fwd);
  } else if (input.target) {
    const dist = angleBetween(s.p, input.target) * R;
    if (dist < 0.2) {
      if (!input.pointerDown) input.target = null;
    } else {
      dir = tangentTo(s.p, input.target);
      want = dir.map(c => c * Math.min(speed, dist * 4));
    }
  }
  if (dir && m) want = norm(dir).map(c => c * speed);

  if (body.grounded) body.jet = false;
  stepBody(body, dt, want, body.jet ? 0.12 : undefined);   // po výstřelu jetpackem se ve vzduchu skoro neřídí
  blockByStructures(body, 0.45);
  blockByRocks(body, 0.45);                       // pěšky jen střední kameny (malé se překročí)
  if (body.grounded) { body.jet = false; jetReady = true; }
  s.p = body.p;
  s.f = tangentTo(s.p, s.f);
  const sp = Math.hypot(body.v[0], body.v[1], body.v[2]);
  playerFx.moving = body.grounded ? sp > 0.2 : false;
  playerFx.speed = sp;
  playerFx.face = sp > 0.2 ? norm(body.v) : s.f;
}

function drive(input, dt) {
  const s = game.s;
  const v = s.vehicles[s.driving];
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
    if (d > m.radius * 0.8 + 0.5) continue;
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
    // vstát: astronaut se postaví tam, kde leží pánev, čelem tam, kam míří hlava
    const head = ragPts[RG.head];
    const toHead = tangentTo(s.p, [head[0] - pel[0], head[1] - pel[1], head[2] - pel[2]]);
    if (Number.isFinite(toHead[0])) s.f = toHead;
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
  playerFx.airborne = !b.grounded;
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
  const v = s.vehicles[i];
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
  const b = vehicleBody(i);
  b.v = [0, 0, 0];
  vehicleSpeed = 0;
  s.driving = -1;
  autopilotOff();
  // vystoupíš vedle vozidla (vpravo)
  const side = norm(cross(v.f, v.p));
  const out = norm(madd(v.p, side, 2.2 / R));
  body = walkerBody(out);
  s.p = out;
  s.f = tangentTo(out, v.f);
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
    const onGround = b.grounded || altitude(b) < SWEEP_ALT;
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
  if (!b.grounded) return 0;
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
  const id = depotAt(s.p);
  const room = id ? depotRoom(structureById(id)) - (playerFx.pendingDeposit?.[id] || 0) : 0;
  if (id && room >= 0.1) {
    const kg = Math.min(total, room);
    const k = kg / total;
    playerFx.deposit = { id, kg };
    for (const it of loads) it.load = Math.max(0, (it.load || 0) * (1 - k));
  }
  return 0;
}

// Kde stojí astronaut, když tlačí ruční vozík (za vozíkem).
export function pusherOffset() {
  return -PUSH_GAP;
}
