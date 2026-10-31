// Hráč: chůze a jízda s fyzikou (gravitace do středu Měsíce), zametání a výkup prachu.
import {
  MOON, DEPOT, PRICE_PER_KG, HEX_BONUS, JUMP_SPEED, UNITS_PER_KG,
} from './config.js';
import { game } from './state.js';
import { activeEquipment, walkSpeed } from './equipment.js';
import { createBody, stepBody, jumpBody, altitude } from './physics.js';
import { sweepCapsule } from './planet/dustmap.js';
import { createRagdoll, stepRagdoll, ragdollPoints, encodeRagdoll, RG } from './ragdoll.js';
import { cross, madd, norm, tangentTo, angleBetween, rotateAround, dot } from './planet/vec.js';

const R = MOON.radius;
const TOOL_AHEAD = 0.95;                 // nástroj nese astronaut ~1 m před sebou
const PUSH_GAP = 1.1;                    // u ručního vozíku jde astronaut za ním
const SWEEP_ALT = 0.5;                   // zametá se i při malém odskoku (do 0,5 m nad zemí)
// přilnavost a tlumiče (physics.js): astronaut se z hrbolu odlepí jen výjimečně, vozidla ještě méně
const WALK_BODY = [0.8, 6];
const VEHICLE_BODY = [0.5, 8];
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
};

let body = null;                         // těleso astronauta
let rag = null;                          // ragdoll po srážce (null = hráč ovládá postavu)
let ragPts = null;

// Tahy nástrojem/vozidlem pro multiplayer: { seq, p, w, pw, cont } (posledních 32).
export const strokes = { seq: 0, list: [] };
const vehicleBodies = new Map();         // index vozidla → těleso
let prevTool = null;
let vehicleSpeed = 0;                    // aktuální rychlost řízeného vozidla (m/s, se znaménkem)

export function initPlayer() {
  body = walkerBody(game.s.p);
  rag = null;
  ragPts = null;
  vehicleBodies.clear();
  prevTool = null;
  vehicleSpeed = 0;
  playerFx.face = game.s.f;
}

export function vehicleBody(i) {
  const v = game.s.vehicles[i];
  let b = vehicleBodies.get(i);
  if (!b || v.moved) {
    b = createBody(v.p, ...VEHICLE_BODY);
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
  if (game.s.driving >= 0 || rag) return;
  jumpBody(body, JUMP_SPEED);
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

  stepBody(body, dt, want);
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
  const max = eq.stats.speed;

  let throttle = 0;
  const m = input.move();
  if (m) {
    input.target = null;
    throttle = m.fwd;
  } else if (input.target) {
    // klik = jeď tam: natoč se k cíli a přidej plyn
    const dist = angleBetween(s.p, input.target) * R;
    if (dist < 1.5) {
      if (!input.pointerDown) input.target = null;
    } else {
      const to = tangentTo(s.p, input.target);
      const side = dot(to, playerRight());
      rotateHeading(-Math.max(-1, Math.min(1, side * 3)) * dt * 1.6);
      throttle = dot(to, s.f) > 0.3 ? Math.min(1, dist / 8) : 0.2;
    }
  }

  const target = throttle * max * (throttle < 0 ? 0.5 : 1);
  const accel = (Math.abs(target) > Math.abs(vehicleSpeed) ? 3.5 : 6) * dt;   // brzdí rychleji, než zrychluje
  vehicleSpeed += Math.max(-accel, Math.min(accel, target - vehicleSpeed));

  stepBody(b, dt, s.f.map(c => c * vehicleSpeed), 0);   // vozidlo ve vzduchu neřídí
  if (!b.grounded) vehicleSpeed = dot(b.v, s.f);
  s.p = b.p;
  s.f = tangentTo(s.p, s.f);
  v.p = b.p;
  v.f = s.f;

  // astronaut jede s vozidlem
  body.p = b.p;
  body.r = b.r;
  body.vr = 0;
  body.grounded = true;
  playerFx.moving = Math.abs(vehicleSpeed) > 0.2;
  playerFx.speed = Math.abs(vehicleSpeed);
  playerFx.face = s.f;
}

// ---------- srážka s vozidlem → ragdoll ----------

export const ragdollState = () => ragPts;
export const ragdollEncoded = () => (rag ? encodeRagdoll(rag) : null);
export const currentVehicleSpeed = () => vehicleSpeed;
export const isRagdoll = () => !!rag;

// pose = body ragdollu z aktuální pózy modelu, vel = rychlost odhození, spin = rotace (rad/s).
export function knockOut(pose, vel, spin) {
  if (rag || game.s.driving >= 0) return false;
  rag = createRagdoll(pose, vel, spin);
  ragPts = ragdollPoints(rag);
  prevTool = null;
  return true;
}

// Vozidla v pohybu: [{ pos: [x,y,z], radius, vel: [x,y,z], speed }]. Při zásahu vrátí true.
export function checkVehicleHits(movers, posePoints) {
  if (rag || game.s.driving >= 0) return false;
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
  const landed = stepRagdoll(rag, dt);
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

export function movePlayer(input, dt) {
  if (rag) { flyRagdoll(dt); return; }
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
  s.driving = i;
  const v = s.vehicles[i];
  s.p = v.p;
  s.f = v.f;
  vehicleSpeed = 0;
  prevTool = null;
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
export function collect() {
  const s = game.s;
  if (rag) { playerFx.swept = 0; playerFx.bonus = 0; playerFx.completed = []; playerFx.tool = null; return 0; }
  const eq = activeEquipment();
  const b = activeBody();
  playerFx.swept = 0;
  playerFx.bonus = 0;
  playerFx.completed = [];

  const width = eq.stats.width;
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
      playerFx.bonus = r.completed.length * HEX_BONUS;
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

  // výkup: stačí vstoupit / vjet do zóny uprostřed základny
  const item = eq.item;
  if (item.load > 0 && b.grounded && angleBetween(s.p, DEPOT.dir) * R < DEPOT.r) {
    const earned = item.load * PRICE_PER_KG;
    s.money += earned;
    item.load = 0;
    return earned;
  }
  return 0;
}

// Kde stojí astronaut, když tlačí ruční vozík (za vozíkem).
export function pusherOffset() {
  return -PUSH_GAP;
}
