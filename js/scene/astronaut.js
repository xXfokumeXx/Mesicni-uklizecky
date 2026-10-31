// Astronaut: low-poly model s kostrou a animacemi v měsíční gravitaci.
// Chůze = „klokaní“ poskakování jako u posádek Apolla (dlouhá fáze ve vzduchu, pomalé ruce),
// skok = pomalý odraz, schoulení ve vrcholu, roztažené ruce při pádu, měkký dopad do podřepu.
// Model: „nahoru“ = +y, „dopředu“ = +z, nohy na y = 0.
// Verze 2: barva skafandru a rekvizity na helmu (šatna), ragdoll po srážce s vozidlem.
import { JUMP_SPEED } from '../config.js';
import { SUIT_COLORS, DEFAULT_LOOK } from '../catalog.js';
import { RG, RG_COUNT } from '../ragdoll.js';
import { buildProp } from './props.js';
import { buildJetpack } from './models.js';

const THREE = window.THREE;

const HIP_Y = 0.94;          // výška kyčlí
const HOP_LENGTH = 1.5;      // m na jeden poskok
const HOP_HEIGHT = 0.17;     // m – výška poskoku při chůzi

function materials() {
  return {
    suit:   new THREE.MeshLambertMaterial({ color: 0xeceae3 }),
    joint:  new THREE.MeshLambertMaterial({ color: 0xc4c1b8 }),
    dark:   new THREE.MeshLambertMaterial({ color: 0x2d313b }),
    boot:   new THREE.MeshLambertMaterial({ color: 0x8d8b86 }),
    hivis:  new THREE.MeshLambertMaterial({ color: 0xf2b33d, emissive: 0x3d2800 }),
    blue:   new THREE.MeshLambertMaterial({ color: 0x5fb8d9, emissive: 0x0c2430 }),
    red:    new THREE.MeshLambertMaterial({ color: 0xd9533d, emissive: 0x2a0c08 }),
    visor:  new THREE.MeshPhongMaterial({ color: 0x8a6a22, specular: 0xffe7a0, shininess: 90, emissive: 0x150f04 }),
    shadow: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
  };
}

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

// Válec visící z kloubu dolů (délka len).
function segment(rTop, rBottom, len, mat, sides = 10) {
  const geo = new THREE.CylinderGeometry(rTop, rBottom, len, sides);
  geo.translate(0, -len / 2, 0);
  return new THREE.Mesh(geo, mat);
}

function buildLeg(M, side) {
  const hip = new THREE.Group();
  hip.position.set(0.11 * side, 0, 0);
  const thigh = segment(0.088, 0.078, 0.42, M.suit);
  const knee = new THREE.Group();
  knee.position.y = -0.42;
  const kneePad = mesh(new THREE.SphereGeometry(0.082, 10, 8), M.joint);
  const shin = segment(0.076, 0.07, 0.4, M.suit);
  const ankle = new THREE.Group();
  ankle.position.y = -0.4;
  const cuff = mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.06, 10), M.joint, 0, 0.01, 0);
  const boot = mesh(new THREE.BoxGeometry(0.15, 0.11, 0.27), M.boot, 0, -0.06, 0.04);
  const sole = mesh(new THREE.BoxGeometry(0.155, 0.03, 0.28), M.dark, 0, -0.115, 0.04);
  ankle.add(cuff, boot, sole);
  knee.add(kneePad, shin, ankle);
  hip.add(thigh, knee);
  return { hip, knee };
}

function buildArm(M, side) {
  const shoulder = new THREE.Group();
  shoulder.position.set(0.255 * side, 0.52, 0);
  const pad = mesh(new THREE.SphereGeometry(0.085, 10, 8), M.joint);
  const upper = segment(0.068, 0.062, 0.29, M.suit);
  const elbow = new THREE.Group();
  elbow.position.y = -0.29;
  const elbowPad = mesh(new THREE.SphereGeometry(0.064, 8, 6), M.joint);
  const fore = segment(0.06, 0.055, 0.26, M.suit);
  const cuff = mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.05, 10), M.hivis, 0, -0.26, 0);
  const glove = mesh(new THREE.BoxGeometry(0.085, 0.11, 0.07), M.dark, 0, -0.33, 0.01);
  elbow.add(elbowPad, fore, cuff, glove);
  shoulder.add(pad, upper, elbow);
  return { shoulder, elbow };
}

function buildTorso(M) {
  const torso = new THREE.Group();                 // kloub v kyčlích
  const pelvis = mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.18, 12), M.suit, 0, 0.02, 0);
  const belt = mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.05, 12), M.dark, 0, 0.12, 0);
  const body = mesh(new THREE.CylinderGeometry(0.24, 0.21, 0.44, 12), M.suit, 0, 0.34, 0);
  const stripe = mesh(new THREE.CylinderGeometry(0.243, 0.243, 0.06, 12), M.hivis, 0, 0.26, 0);
  const chest = mesh(new THREE.CylinderGeometry(0.26, 0.24, 0.12, 12), M.suit, 0, 0.53, 0);

  // ovládací panel na hrudi
  const panel = mesh(new THREE.BoxGeometry(0.22, 0.12, 0.06), M.dark, 0, 0.4, 0.22);
  const btn = new THREE.BoxGeometry(0.035, 0.035, 0.02);
  panel.add(mesh(btn, M.hivis, -0.06, 0.02, 0.035), mesh(btn, M.blue, 0, 0.02, 0.035), mesh(btn, M.red, 0.06, 0.02, 0.035));

  // batoh s podporou života
  const pack = mesh(new THREE.BoxGeometry(0.44, 0.52, 0.22), M.suit, 0, 0.36, -0.31);
  const packTop = mesh(new THREE.BoxGeometry(0.4, 0.1, 0.18), M.joint, 0, 0.66, -0.3);
  const packStripe = mesh(new THREE.BoxGeometry(0.445, 0.05, 0.225), M.hivis, 0, 0.2, -0.31);
  const antenna = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.35, 4), M.dark, 0.16, 0.86, -0.36);
  const antennaTip = mesh(new THREE.SphereGeometry(0.02, 6, 4), M.red, 0.16, 1.04, -0.36);

  // nášivka na rameni
  const patch = mesh(new THREE.BoxGeometry(0.02, 0.07, 0.09), M.blue, -0.245, 0.48, 0);

  torso.add(pelvis, belt, body, stripe, chest, panel, pack, packTop, packStripe, antenna, antennaTip, patch);
  return torso;
}

function buildHead(M) {
  const head = new THREE.Group();                  // kloub v krku
  head.position.y = 0.6;
  const ring = mesh(new THREE.TorusGeometry(0.13, 0.03, 6, 16), M.joint, 0, 0.02, 0);
  ring.rotation.x = Math.PI / 2;
  const helmet = mesh(new THREE.SphereGeometry(0.175, 16, 12), M.suit, 0, 0.17, 0.01);
  // zlaté hledí = přední výseč koule
  const visor = mesh(new THREE.SphereGeometry(0.18, 16, 10, Math.PI / 2 - 0.95, 1.9, 0.75, 1.05), M.visor, 0, 0.17, 0.01);
  const lampL = mesh(new THREE.BoxGeometry(0.04, 0.035, 0.06), M.dark, -0.16, 0.25, 0.06);
  const lampR = mesh(new THREE.BoxGeometry(0.04, 0.035, 0.06), M.dark, 0.16, 0.25, 0.06);
  const lampGlass = new THREE.BoxGeometry(0.03, 0.025, 0.01);
  lampL.add(mesh(lampGlass, M.hivis, 0, 0, 0.032));
  lampR.add(mesh(lampGlass, M.hivis, 0, 0, 0.032));
  head.add(ring, helmet, visor, lampL, lampR);
  return head;
}

// Barva kloubů = trochu tmavší odstín barvy skafandru.
function suitColors(M, idx) {
  const c = new THREE.Color(SUIT_COLORS[idx]?.hex ?? SUIT_COLORS[0].hex);
  M.suit.color.copy(c);
  const hsl = {};
  c.getHSL(hsl);
  M.joint.color.setHSL(hsl.h, hsl.s * 0.8, Math.max(0.12, hsl.l * 0.8));
}

function buildTool(M) {
  // Násada od rukou k zemi; hlava nástroje leží na zemi před astronautem.
  const tool = new THREE.Group();
  const handle = segment(0.022, 0.022, 1.13, M.dark, 6);
  handle.position.set(0, 0.12, 0.42);
  handle.rotation.x = Math.PI - 0.487;            // míří z rukou dolů a dopředu
  const head = new THREE.Group();
  head.position.set(0, -HIP_Y + 0.02, 0.95);
  head.add(
    mesh(new THREE.BoxGeometry(0.3, 0.07, 0.15), M.hivis, 0, 0.07, 0),
    mesh(new THREE.BoxGeometry(0.28, 0.04, 0.13), M.blue, 0, 0.02, 0),
  );
  tool.add(handle, head);
  return { tool, head };
}

export function createAstronaut(look = DEFAULT_LOOK) {
  const M = materials();
  const root = new THREE.Group();

  const hips = new THREE.Group();
  hips.position.y = HIP_Y;
  const torso = buildTorso(M);
  const head = buildHead(M);
  const armL = buildArm(M, -1), armR = buildArm(M, 1);
  torso.add(head, armL.shoulder, armR.shoulder);
  const legL = buildLeg(M, -1), legR = buildLeg(M, 1);
  const { tool, head: toolHead } = buildTool(M);
  hips.add(torso, legL.hip, legR.hip, tool);

  // čelovka: jen kotva na helmě (světlo je reflektor ze společné sady scene/lights.js, intenzitu řídí main.js)
  const lamp = new THREE.Object3D();
  lamp.position.set(0, 0.25, 0.12);
  head.add(lamp);
  let lampK = 0;

  const shadowGeo = new THREE.CircleGeometry(0.42, 18);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadow = mesh(shadowGeo, M.shadow, 0, 0.05, 0);

  root.add(hips, shadow);

  // ---------- vzhled (šatna) ----------
  let props = [];
  function setLook(l) {
    suitColors(M, l.color);
    for (const p of props) head.remove(p.root);
    props = [buildProp(l.top), buildProp(l.face)].filter(Boolean);
    for (const p of props) head.add(p.root);
  }
  setLook(look);

  // ---------- animace ----------
  let phase = 0, walkAmp = 0, airAmp = 0, landT = 0, sweepAmp = 0, seatAmp = 0;
  const cur = { bounce: 0, lean: 0, hipL: 0, hipR: 0, kneeL: 0, kneeR: 0, armX: -0.55, armZ: 0, elbow: -0.75, head: 0 };

  // st: { moving, speed, swept, airborne, alt, vel, landed, seated, pushing }
  function update(dt, time, st) {
    for (const p of props) p.update?.(dt, time);
    if (ragdolling) return;
    const ease = s => 1 - Math.exp(-dt * s);
    if (st.landed) landT = 1;
    landT = Math.max(0, landT - dt * 2.4);

    airAmp += ((st.airborne ? 1 : 0) - airAmp) * ease(7);
    seatAmp += ((st.seated ? 1 : 0) - seatAmp) * ease(8);
    walkAmp += ((st.moving && !st.airborne ? Math.min(1, st.speed / 4) : 0) - walkAmp) * ease(5);
    sweepAmp += ((st.swept && !st.airborne ? 1 : 0) - sweepAmp) * ease(6);
    if (!st.airborne) phase += st.speed * dt / HOP_LENGTH * Math.PI;

    const s = Math.sin(phase);
    const hop = Math.pow(Math.abs(s), 0.6);            // dlouhé „visení“ v horní fázi poskoku

    // chůze po Měsíci
    const walk = {
      bounce: hop * HOP_HEIGHT * walkAmp,
      lean: 0.2 * walkAmp,
      hipL: -s * 0.42 * walkAmp - 0.1 * walkAmp,
      hipR: s * 0.42 * walkAmp - 0.1 * walkAmp,
      kneeL: (0.2 + 0.6 * Math.max(0, Math.sin(phase + 0.9))) * walkAmp,
      kneeR: (0.2 + 0.6 * Math.max(0, -Math.sin(phase + 0.9))) * walkAmp,
      armX: -0.55 + Math.sin(phase * 0.5) * 0.1 * walkAmp,
      armZ: 0.06 * walkAmp,
      elbow: -0.75,
      head: -0.1 * walkAmp,
    };

    // klid: dýchání a rozhlížení
    const idle = 1 - walkAmp;
    walk.bounce += Math.sin(time * 1.7) * 0.006 * idle;
    walk.head += Math.sin(time * 0.37) * 0.04 * idle;

    // ve vzduchu: schoulení ve vrcholu, natažení nohou před dopadem, ruce do stran
    const tuck = 1 - Math.min(1, Math.abs(st.vel) / JUMP_SPEED);
    const falling = st.vel < 0 ? 1 : 0;
    const air = {
      bounce: 0,
      lean: 0.08 - 0.12 * (1 - falling),
      hipL: -0.25 - 0.6 * tuck + 0.1 * falling,
      hipR: -0.15 - 0.55 * tuck,
      kneeL: 0.3 + 1.1 * tuck - 0.3 * falling,
      kneeR: 0.4 + 1.0 * tuck - 0.3 * falling,
      armX: -0.9 + 0.3 * tuck,
      armZ: 0.35 + 0.35 * tuck * falling + 0.15 * tuck,
      elbow: -0.5,
      head: 0.1 * falling - 0.05,
    };

    // za volantem: sed, ruce na volantu
    const seat = {
      bounce: 0, lean: -0.08, hipL: -1.45, hipR: -1.45, kneeL: 1.5, kneeR: 1.5,
      armX: -0.95, armZ: 0.12, elbow: -0.55, head: 0.05,
    };
    // tlačení vozíku: ruce dopředu na madle, mírný předklon
    if (st.pushing) {
      walk.armX = -1.05;
      walk.elbow = -0.35;
      walk.lean += 0.12;
    }

    // dopad: měkký podřep, který se pomalu vyrovná
    const q = landT * landT * (3 - 2 * landT) * (1 - seatAmp);

    const k = ease(10);
    for (const key in cur) {
      const ground = walk[key] * (1 - airAmp) + air[key] * airAmp;
      const target = ground * (1 - seatAmp) + seat[key] * seatAmp;
      cur[key] += (target - cur[key]) * k;
    }

    hips.position.y = HIP_Y + cur.bounce - 0.17 * q;
    torso.rotation.x = cur.lean + 0.3 * q;
    torso.rotation.y = Math.sin(phase) * 0.06 * walkAmp;
    head.rotation.x = -cur.lean * 0.6 + cur.head - 0.15 * q;
    head.rotation.y = Math.sin(time * 0.29) * 0.3 * idle * (1 - airAmp);
    legL.hip.rotation.x = cur.hipL - 0.45 * q;
    legR.hip.rotation.x = cur.hipR - 0.45 * q;
    legL.knee.rotation.x = cur.kneeL + 0.95 * q;
    legR.knee.rotation.x = cur.kneeR + 0.95 * q;
    armL.shoulder.rotation.x = armR.shoulder.rotation.x = cur.armX - 0.2 * q;
    armL.shoulder.rotation.z = -cur.armZ;
    armR.shoulder.rotation.z = cur.armZ;
    armL.elbow.rotation.x = armR.elbow.rotation.x = cur.elbow;

    // zametání: nástroj kmitá do stran, ve vzduchu se drží u těla
    tool.rotation.y = Math.sin(time * 11) * 0.22 * sweepAmp;
    tool.rotation.x = -0.35 * airAmp;
    tool.visible = !st.seated && !st.pushing && !toolOff;
    shadow.visible = !st.seated;

    // stín se zmenšuje s výškou skoku
    const sh = 1 / (1 + st.alt * 0.5);
    shadow.scale.set(sh, 1, sh);
    shadow.position.y = 0.05 - st.alt;
  }

  // Šířka hlavy nástroje = šířka zametaného pásu (radius v m); 0 = v ruce není nástroj.
  let toolOff = false;
  function setToolSize(radius) {
    toolOff = !(radius > 0);
    const width = Math.max(0.3, radius * 2);
    toolHead.scale.set(width / 0.3, 1, width > 1 ? 1.5 : 1);
    toolHead.position.z = width > 1 ? 1.05 : 0.95;
  }

  const tip = new THREE.Vector3();

  // Jetpack na zádech (přes batoh): state 0 = není, 1 = na zádech, 2 = právě hoří.
  let jetpack = null;
  function setJetpack(state) {
    if (!state && !jetpack) return;
    if (!jetpack) {
      jetpack = buildJetpack();
      jetpack.position.set(0, 0.36, -0.48);
      torso.add(jetpack);
    }
    jetpack.visible = !!state;
    jetpack.userData.flame.visible = state === 2;
    if (state === 2) jetpack.userData.flame.scale.y = 0.8 + Math.random() * 0.5;
  }

  // ---------- ragdoll ----------
  // Body ragdollu odpovídají kloubům modelu (pánev = počátek skupiny hips).
  const LOCAL = [];                  // [skupina, lokální bod] pro každý bod ragdollu
  LOCAL[RG.pelvis] = [hips, [0, 0, 0]];
  LOCAL[RG.chest] = [torso, [0, 0.5, 0]];
  LOCAL[RG.head] = [head, [0, 0.17, 0]];
  LOCAL[RG.shL] = [armL.shoulder, [0, 0, 0]];
  LOCAL[RG.elL] = [armL.elbow, [0, 0, 0]];
  LOCAL[RG.haL] = [armL.elbow, [0, -0.32, 0]];
  LOCAL[RG.shR] = [armR.shoulder, [0, 0, 0]];
  LOCAL[RG.elR] = [armR.elbow, [0, 0, 0]];
  LOCAL[RG.haR] = [armR.elbow, [0, -0.32, 0]];
  LOCAL[RG.hipL] = [legL.hip, [0, 0, 0]];
  LOCAL[RG.knL] = [legL.knee, [0, 0, 0]];
  LOCAL[RG.ftL] = [legL.knee, [0, -0.46, 0.04]];
  LOCAL[RG.hipR] = [legR.hip, [0, 0, 0]];
  LOCAL[RG.knR] = [legR.knee, [0, 0, 0]];
  LOCAL[RG.ftR] = [legR.knee, [0, -0.46, 0.04]];

  // Aktuální póza jako body ragdollu ve světových souřadnicích.
  function ragdollPose() {
    root.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    return LOCAL.map(([grp, p]) => v.set(...p).applyMatrix4(grp.matrixWorld).toArray());
  }

  let ragdolling = false;
  const BONES = [hips, torso, head, armL.shoulder, armL.elbow, armR.shoulder, armR.elbow, legL.hip, legL.knee, legR.hip, legR.knee, tool];
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
  const _q = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _m = new THREE.Matrix4();
  const DOWN = new THREE.Vector3(0, -1, 0), UP = new THREE.Vector3(0, 1, 0);
  const P = pts => (i, out) => out.set(pts[i][0], pts[i][1], pts[i][2]);

  // Kost natočí tak, aby její „dolů“ (nebo nahoru) mířilo z bodu a do bodu b. parentQ = světová rotace rodiče.
  function aim(bone, parentQ, from, to, axis = DOWN) {
    _c.subVectors(to, from);
    if (_c.lengthSq() < 1e-8) return _q.copy(parentQ).multiply(bone.quaternion);
    _c.normalize().applyQuaternion(_qi.copy(parentQ).invert());
    bone.quaternion.setFromUnitVectors(axis, _c);
    return parentQ.clone().multiply(bone.quaternion);
  }

  // Nastaví model podle bodů ragdollu (pole [x,y,z] ve světě).
  function applyRagdoll(pts) {
    if (!pts || pts.length < RG_COUNT) return;
    ragdolling = true;
    tool.visible = false;
    shadow.visible = false;
    const g = P(pts);
    const pelvis = g(RG.pelvis, new THREE.Vector3()), chest = g(RG.chest, new THREE.Vector3());
    const up = new THREE.Vector3().subVectors(chest, pelvis).normalize();
    const right = g(RG.shR, new THREE.Vector3()).sub(g(RG.shL, _a)).add(g(RG.hipR, _b).sub(g(RG.hipL, _c)));
    right.addScaledVector(up, -right.dot(up)).normalize();
    const fwd = new THREE.Vector3().crossVectors(right, up);
    _m.makeBasis(right, up, fwd);
    const rootQ = new THREE.Quaternion().setFromRotationMatrix(_m);
    root.quaternion.copy(rootQ);
    root.position.copy(pelvis).addScaledVector(up, -HIP_Y);
    hips.position.set(0, HIP_Y, 0);
    hips.rotation.set(0, 0, 0);
    torso.rotation.set(0, 0, 0);
    const v = i => g(i, new THREE.Vector3());
    aim(head, rootQ, v(RG.chest), v(RG.head), UP);
    const shLq = aim(armL.shoulder, rootQ, v(RG.shL), v(RG.elL));
    aim(armL.elbow, shLq, v(RG.elL), v(RG.haL));
    const shRq = aim(armR.shoulder, rootQ, v(RG.shR), v(RG.elR));
    aim(armR.elbow, shRq, v(RG.elR), v(RG.haR));
    const hLq = aim(legL.hip, rootQ, v(RG.hipL), v(RG.knL));
    aim(legL.knee, hLq, v(RG.knL), v(RG.ftL));
    const hRq = aim(legR.hip, rootQ, v(RG.hipR), v(RG.knR));
    aim(legR.knee, hRq, v(RG.knR), v(RG.ftR));
  }

  // Konec ragdollu: klouby zpět do výchozí pózy (animace pak naváže podřepem po dopadu).
  function endRagdoll() {
    if (!ragdolling) return;
    ragdolling = false;
    for (const b of BONES) b.rotation.set(0, 0, 0);
    hips.position.set(0, HIP_Y, 0);
    landT = 1;
    for (const k in cur) cur[k] = 0;
    cur.armX = -0.55; cur.elbow = -0.75;
  }

  return {
    root,
    hipHeight: HIP_Y,
    update,
    head,
    setLook,
    ragdollPose,
    applyRagdoll,
    endRagdoll,
    get ragdolling() { return ragdolling; },
    setToolSize,
    setJetpack,
    setLamp: k => { lampK = k; },
    lampIntensity: () => lampK,
    lampPosition: out => lamp.getWorldPosition(out),
    // směr čelovky = kam se dívá helma (místní +z hlavy)
    lampDirection: out => out.set(0, 0, 1).transformDirection(lamp.matrixWorld),
    blob: shadow,
    toolTip: () => toolHead.getWorldPosition(tip),
  };
}

