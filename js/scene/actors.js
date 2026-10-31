// Všechno, co se ve scéně hýbe nebo patří k základně: astronaut, vozidla, budovy,
// stanice s roboty, UFO drony, hologram při umisťování stanice, kruh nástroje a obrys hexu.
import { MOON } from '../config.js';
import { DRONE } from '../catalog.js';
import { game } from '../state.js';
import { activeEquipment } from '../equipment.js';
import { activeBody, vehicleBody, pusherOffset, ragdollState, riding } from '../player.js';
import { placing } from '../interact.js';
import { carriedStation } from '../hotbar.js';
import { hexArea } from '../robots.js';
import { BUILDINGS } from '../base.js';
import { grid, dirToCell } from '../planet/hexgrid.js';
import { norm, cross, anyTangent, madd } from '../planet/vec.js';
import { heightAt } from '../planet/height.js';
import { createAstronaut } from './astronaut.js';
import { buildBot, buildDrone } from './models.js';
import { buildVehicle } from './vehicles.js';
import { buildDepot, buildWorkshop, buildToolshop, buildGarage, buildStation, buildSilo, buildBasePad } from './buildings.js';
import { createBelts } from './belts.js';

const THREE = window.THREE;
const R = MOON.radius;

const _x = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(), _f = new THREE.Vector3();

// Natočí objekt: lokální +y = up, lokální +z = forward (forward se srovná do tečné roviny).
function orient(obj, up, forward) {
  _z.copy(forward).addScaledVector(up, -forward.dot(up));
  if (_z.lengthSq() < 1e-8) return;
  _z.normalize();
  _x.crossVectors(up, _z).normalize();
  _m.makeBasis(_x, up, _z);
  obj.quaternion.setFromRotationMatrix(_m);
}

// Bod na povrchu nad směrem d (pole [x,y,z]).
function surface(d, out, lift = 0) {
  return out.set(d[0], d[1], d[2]).multiplyScalar(R + heightAt(d) + lift);
}

// Normála terénu v bodě p (vozidla se naklánějí podle svahu).
function terrainNormal(p, size, out) {
  const e1 = anyTangent(p), e2 = cross(p, e1);
  const sample = (a, b) => {
    const d = norm(madd(madd(p, e1, a / R), e2, b / R));
    return surface(d, new THREE.Vector3());
  };
  const px = sample(size, 0), nx = sample(-size, 0), pz = sample(0, size), nz = sample(0, -size);
  _a.subVectors(px, nx);
  _b.subVectors(pz, nz);
  out.crossVectors(_b, _a).normalize();
  if (out.dot(_up.set(p[0], p[1], p[2])) < 0) out.negate();
  return out;
}

// Smyčka čar po povrchu (kruh nástroje, obrys hexu).
function surfaceLoop(scene, count, color, opacity) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const line = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
  line.frustumCulled = false;
  scene.add(line);
  return { line, geo };
}

// Obrysy více hexů (oblast robota při umisťování).
function hexOutlines(scene, color) {
  const STEPS = 6, MAX = 19 * 6 * STEPS;
  const pos = new Float32Array(MAX * 6);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
  lines.frustumCulled = false;
  scene.add(lines);
  let last = '';
  return {
    lines,
    set(cells) {
      const key = cells.join(',');
      if (key === last) return;
      last = key;
      const TD = grid.triDir, CT = grid.cellTris;
      let v = 0;
      const put = (x, y, z) => {
        const d = norm([x, y, z]);
        surface(d, _a, 0.25);
        pos[v++] = _a.x; pos[v++] = _a.y; pos[v++] = _a.z;
      };
      for (const c of cells) {
        const k = grid.cellTriCount[c];
        for (let m = 0; m < k && v < pos.length; m++) {
          const a = CT[c * 6 + m] * 3, b = CT[c * 6 + (m + 1) % k] * 3;
          for (let s = 0; s < STEPS; s++) {
            const t0 = s / STEPS, t1 = (s + 1) / STEPS;
            put(TD[a] + (TD[b] - TD[a]) * t0, TD[a + 1] + (TD[b + 1] - TD[a + 1]) * t0, TD[a + 2] + (TD[b + 2] - TD[a + 2]) * t0);
            put(TD[a] + (TD[b] - TD[a]) * t1, TD[a + 1] + (TD[b + 1] - TD[a + 1]) * t1, TD[a + 2] + (TD[b + 2] - TD[a + 2]) * t1);
          }
        }
      }
      geo.setDrawRange(0, v / 3);
      geo.attributes.position.needsUpdate = true;
    },
  };
}

// opts.vehicleOverride(i) → { p, r, f, speed } pro vozidlo, které řídí jiný hráč (multiplayer), jinak null.
export function createActors(scene, shadowsOn, look, opts = {}) {
  const vehicleOverride = opts.vehicleOverride || (() => null);
  // ---------- stíny ----------
  // Objekty vrhají a přijímají stíny ze stínové mapy Slunce; „falešné“ kulaté stíny pod
  // roboty a astronautem se ukazují jen tehdy, když jsou skutečné stíny vypnuté.
  const prepared = [];
  function prepare(root) {
    prepared.push(root);
    root.traverse(o => {
      if (!o.isMesh) return;
      if (o.userData.blob) { o.visible = !shadowsOn; return; }
      const m = o.material;
      if (m && (m.transparent || m.isMeshBasicMaterial)) return;
      o.castShadow = true;
      o.receiveShadow = true;
    });
    return root;
  }
  function setShadows(on) {
    shadowsOn = on;
    for (const root of prepared) root.traverse(o => { if (o.userData.blob) o.visible = !on; });
  }

  // ---------- základna ----------
  const pad = buildBasePad();
  pad.receiveShadow = true;
  scene.add(pad);
  const views = {
    depot: buildDepot(),
    workshop: buildWorkshop(),
    toolshop: buildToolshop(),
    garage: buildGarage(),
  };
  for (const b of BUILDINGS) {
    const v = views[b.id];
    surface(b.dir, v.root.position);
    _up.set(...b.dir);
    orient(v.root, _up, _f.set(...b.facing));
    scene.add(prepare(v.root));
  }

  // ---------- astronaut ----------
  const astro = createAstronaut(look);
  scene.add(prepare(astro.root));
  const face = new THREE.Vector3(...game.s.f);

  // ---------- kruh nástroje a obrys hexu ----------
  const RING_N = 40;
  const ring = surfaceLoop(scene, RING_N, 0xf2b33d, 0.9);
  const HEX_STEPS = 8;
  const hexLine = surfaceLoop(scene, 6 * HEX_STEPS, 0xffd27a, 0.85);
  let lastHex = -1;

  function updateRing(center, radius) {
    ring.line.visible = !!center && radius > 0;
    if (!ring.line.visible) return;
    const e1 = anyTangent(center), e2 = cross(center, e1);
    const pos = ring.geo.attributes.position;
    for (let i = 0; i < RING_N; i++) {
      const a = i / RING_N * Math.PI * 2;
      const d = norm(madd(madd(center, e1, Math.cos(a) * radius / R), e2, Math.sin(a) * radius / R));
      surface(d, _a, 0.12);
      pos.setXYZ(i, _a.x, _a.y, _a.z);
    }
    pos.needsUpdate = true;
  }

  function updateHexLine(cell) {
    if (cell === lastHex) return;
    lastHex = cell;
    const k = grid.cellTriCount[cell], TD = grid.triDir, CT = grid.cellTris;
    const pos = hexLine.geo.attributes.position;
    let i = 0;
    for (let m = 0; m < k; m++) {
      const a = CT[cell * 6 + m] * 3, b = CT[cell * 6 + (m + 1) % k] * 3;
      for (let s = 0; s < HEX_STEPS; s++) {
        const t = s / HEX_STEPS;
        const d = norm([TD[a] + (TD[b] - TD[a]) * t, TD[a + 1] + (TD[b + 1] - TD[a + 1]) * t, TD[a + 2] + (TD[b + 2] - TD[a + 2]) * t]);
        surface(d, _a, 0.18);
        pos.setXYZ(i++, _a.x, _a.y, _a.z);
      }
    }
    hexLine.geo.setDrawRange(0, i);
    pos.needsUpdate = true;
  }

  // ---------- vozidla ----------
  const vehicleViews = [];

  function syncVehicles(dt, viewRange) {
    const list = game.s.vehicles;
    // po prodeji vozidla se indexy posunou → model, který k indexu nepatří, se postaví znovu
    for (let i = 0; i < Math.max(list.length, vehicleViews.length); i++) {
      const v = list[i], old = vehicleViews[i];
      if (old && (!v || old.uid !== (v.uid || '') || old.type !== v.type)) {
        scene.remove(old.root);
        const k = prepared.indexOf(old.root);
        if (k >= 0) prepared.splice(k, 1);
        vehicleViews[i] = null;
      }
      if (v && !vehicleViews[i]) {
        const view = buildVehicle(v.type);
        view.normal = new THREE.Vector3();
        view.spin = 0;
        view.uid = v.uid || '';
        view.type = v.type;
        scene.add(prepare(view.root));
        vehicleViews[i] = view;
      }
    }
    vehicleViews.length = list.length;
    list.forEach((v, i) => {
      const view = vehicleViews[i];
      const remote = vehicleOverride(i);
      const b = remote ? null : vehicleBody(i);
      const p = remote ? remote.p : b.p, r = remote ? remote.r : b.r;
      view.root.position.set(p[0] * r, p[1] * r, p[2] * r);
      view.root.visible = view.root.position.distanceTo(astro.root.position) < viewRange + 20;
      view.remoteDriven = !!remote;
      if (!view.root.visible) return;
      // naklonění podle svahu (ve vzduchu drží poslední sklon)
      if (remote || b.grounded) terrainNormal(p, Math.max(0.8, view.radius * 0.7), view.normal);
      else if (view.normal.lengthSq() === 0) view.normal.set(...p);
      orient(view.root, view.normal, _f.set(...(remote ? remote.f : v.f)));
      // kola a kartáče
      const speed = remote ? remote.speed : Math.hypot(...b.v);
      const driving = game.s.driving === i || !!remote;
      view.spin += speed * dt / view.wheelR;
      for (const w of view.wheels) w.rotation.x = view.spin;
      const sweeping = driving && (remote ? speed > 0.2 : b.grounded);
      for (const br of view.brushes) br.rotation.y += (sweeping ? 9 : 0) * dt * (br.position.x < 0 ? 1 : -1);
    });
  }

  // ---------- stanice a roboti ----------
  const stationViews = [];
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0x5fb8d9, transparent: true, opacity: 0.45, depthWrite: false });
  const ghost = buildStation(ghostMat);
  ghost.root.visible = false;
  scene.add(ghost.root);
  const areaLines = hexOutlines(scene, 0x5fb8d9);
  areaLines.lines.visible = false;

  function syncStations(dt, viewRange) {
    const list = game.s.stations;
    while (stationViews.length < list.length) {
      const station = buildStation();
      const bot = buildBot();
      scene.add(prepare(station.root), prepare(bot.root));
      stationViews.push({ station, bot, placed: false, hex: -1 });
    }
    const k = 1 - Math.exp(-dt * 10);
    list.forEach((st, i) => {
      const v = stationViews[i], rb = st.robot, p = v.bot.root.position;
      if (v.hex !== st.hex) {                         // nová nebo přesunutá stanice
        v.hex = st.hex;
        v.placed = false;
        const home = [grid.dirs[st.hex * 3], grid.dirs[st.hex * 3 + 1], grid.dirs[st.hex * 3 + 2]];
        surface(home, v.station.root.position);
        orient(v.station.root, _up.set(...home), _f.set(...anyTangent(home)));
      }
      surface(rb.p, _a);
      if (!v.placed) { p.copy(_a); v.placed = true; } else p.lerp(_a, k);
      const carried = carriedStation(i);              // hráč ji právě nese (v hotbaru)
      const near = !carried && p.distanceTo(astro.root.position) < viewRange;
      v.bot.root.visible = near;
      v.station.root.visible = near;
      if (!near) return;
      _b.copy(p).normalize();
      p.copy(_b).multiplyScalar(R + heightAt([_b.x, _b.y, _b.z]));
      orient(v.bot.root, _b, _a.set(rb.t[0], rb.t[1], rb.t[2]).sub(_b));
      v.bot.brush.rotation.y += (rb.mode === 'work' ? 14 : 0) * dt;
    });
  }

  // ---------- UFO drony ----------
  const droneViews = [];

  function syncDrones(dt, time, viewRange) {
    const list = game.s.drones || [];
    while (droneViews.length < list.length) {
      const view = buildDrone();
      scene.add(prepare(view.root));
      droneViews.push({ view, placed: false });
    }
    const k = 1 - Math.exp(-dt * 6);
    droneViews.forEach((v, i) => {
      const dr = list[i];
      if (!dr) { v.view.root.visible = false; return; }
      const p = v.view.root.position;
      const bob = Math.sin(time * 2.1 + i * 1.7) * 0.18;
      surface(dr.p, _a, DRONE.alt + bob);
      if (!v.placed) { p.copy(_a); v.placed = true; } else p.lerp(_a, k);
      v.view.root.visible = p.distanceTo(astro.root.position) < viewRange + 30;
      if (!v.view.root.visible) return;
      _b.copy(p).normalize();
      orient(v.view.root, _b, _f.set(dr.t[0], dr.t[1], dr.t[2]).sub(_b));
      v.view.body.rotation.y += dt * (dr.mode === 'work' ? 3 : 1.2);
      const working = dr.mode === 'work';
      v.view.beam.visible = working;
      if (working) v.view.beam.scale.set(1, DRONE.alt + bob, 1);
      v.view.lights.forEach((l, n) => { l.visible = (Math.floor(time * 4) + n) % 3 !== 0; });
    });
  }

  // ---------- depa a pásy ----------
  const depotViews = [];
  const siloGhost = buildSilo(ghostMat);
  siloGhost.root.visible = false;
  scene.add(siloGhost.root);
  const belts = createBelts(scene);

  function syncDepots(viewRange) {
    const list = game.s.depots;
    while (depotViews.length < list.length) {
      const view = buildSilo();
      scene.add(prepare(view.root));
      depotViews.push({ view, hex: -1 });
    }
    list.forEach((d, i) => {
      const v = depotViews[i];
      if (v.hex !== d.hex) {
        v.hex = d.hex;
        const home = [grid.dirs[d.hex * 3], grid.dirs[d.hex * 3 + 1], grid.dirs[d.hex * 3 + 2]];
        surface(home, v.view.root.position);
        // násypka čelem k základně
        orient(v.view.root, _up.set(...home), _f.set(-home[0], -home[1], 1 - home[2]));
      }
      v.view.root.visible = v.view.root.position.distanceTo(astro.root.position) < viewRange + 20;
    });
    for (let i = list.length; i < depotViews.length; i++) depotViews[i].view.root.visible = false;
  }

  function updatePlacement() {
    const depot = placing.active && placing.kind === 'depot';
    ghost.root.visible = placing.active && !depot;
    siloGhost.root.visible = depot;
    areaLines.lines.visible = placing.active && !depot;
    if (!placing.active || !placing.point) return;
    const hex = dirToCell(placing.point);
    const home = [grid.dirs[hex * 3], grid.dirs[hex * 3 + 1], grid.dirs[hex * 3 + 2]];
    const g = depot ? siloGhost : ghost;
    surface(home, g.root.position);
    orient(g.root, _up.set(...home), _f.set(...anyTangent(home)));
    ghostMat.color.setHex(placing.valid ? 0x5fb8d9 : 0xe0654c);
    if (depot) return;
    areaLines.lines.material.color.setHex(placing.valid ? 0x5fb8d9 : 0xe0654c);
    areaLines.set(hexArea(hex));
  }

  // ---------- snímek ----------
  let lastTool = null;

  function update(dt, time, fx, viewRange) {
    const s = game.s;
    views.garage.setBuilt(s.garage);
    syncVehicles(dt, viewRange);
    syncStations(dt, viewRange);
    syncDrones(dt, time, viewRange);
    syncDepots(viewRange);
    belts.update(time, viewRange, astro.root.position);
    updatePlacement();

    const eq = activeEquipment();
    const driving = s.driving >= 0;
    const kind = driving ? eq.base.kind : 'walk';
    const pushing = kind === 'push';
    const seated = driving && !pushing;

    const rag = ragdollState();
    const ride = riding();
    if (rag) {
      astro.applyRagdoll(rag);                       // ragdoll po srážce s vozidlem
    } else if (ride && passengerTransform(ride.i, ride.seat, astro.root)) {
      // cestující sedí v přepravníku
    } else if (seated) {
      // astronaut sedí ve vozidle
      const view = vehicleViews[s.driving];
      view.root.updateMatrixWorld();
      astro.root.position.copy(view.seat).add(_a.set(0, -astro.hipHeight, 0));
      view.root.localToWorld(astro.root.position);
      astro.root.quaternion.copy(view.root.quaternion);
    } else if (pushing) {
      // astronaut jde za vozíkem
      const behind = norm(madd(s.p, s.f, pusherOffset() / R));
      surface(behind, astro.root.position);
      orient(astro.root, _up.set(...behind), _f.set(...s.f));
      face.set(...s.f);
    } else {
      const b = activeBody();
      astro.root.position.set(b.p[0] * b.r, b.p[1] * b.r, b.p[2] * b.r);
      _up.set(...s.p);
      const target = fx.moving && fx.face ? _a.set(...fx.face) : _a.set(...s.f);
      face.lerp(target, 1 - Math.exp(-dt * (fx.airborne ? 2 : 10)));
      face.addScaledVector(_up, -face.dot(_up));
      if (face.lengthSq() < 1e-6) face.set(...s.f);
      face.normalize();
      orient(astro.root, _up, face);
    }

    if (!rag && astro.ragdolling) astro.endRagdoll();
    const sits = seated || !!ride;
    astro.update(dt, time, {
      moving: fx.moving && !sits, speed: fx.speed, swept: fx.swept && !driving,
      airborne: fx.airborne && !driving, alt: driving ? 0 : fx.alt, vel: fx.vr,
      landed: fx.landedAnim && !driving, seated: sits, pushing,
    });
    fx.landedAnim = false;
    astro.blob.visible = !shadowsOn && !sits && !rag;
    astro.setJetpack(s.jetpack ? (performance.now() - fx.jet < 700 ? 2 : 1) : 0);

    lastTool = fx.tool;
    if (!driving) astro.setToolSize(ride ? 0 : eq.stats.width / 2);
    updateRing(fx.tool, eq.stats.width / 2);
    updateHexLine(dirToCell(s.p));
  }

  // Sedadlo vozidla i ve světě (pro astronauty jiných hráčů, kteří řídí).
  function seatTransform(i, obj) {
    const view = vehicleViews[i];
    if (!view) return false;
    if (!view.seat) {                                 // ruční vozík: astronaut jde za ním
      view.root.updateMatrixWorld();
      obj.position.set(0, 0, -1.1);
      view.root.localToWorld(obj.position);
      obj.quaternion.copy(view.root.quaternion);
      return 'push';
    }
    view.root.updateMatrixWorld();
    obj.position.copy(view.seat).add(_a.set(0, -astro.hipHeight, 0));
    view.root.localToWorld(obj.position);
    obj.quaternion.copy(view.root.quaternion);
    return 'seat';
  }

  // Sedadlo cestujícího seat v přepravníku i (pro mě i pro astronauty ostatních hráčů).
  function passengerTransform(i, seat, obj) {
    const view = vehicleViews[i];
    const at = view?.passengers?.[seat];
    if (!at) return false;
    view.root.updateMatrixWorld();
    obj.position.copy(at).add(_a.set(0, -astro.hipHeight, 0));
    view.root.localToWorld(obj.position);
    obj.quaternion.copy(view.root.quaternion);
    return true;
  }

  return {
    update,
    fadeOccluders: belts.fade,
    seatTransform,
    passengerTransform,
    vehicleRadius: i => vehicleViews[i]?.radius ?? 1,
    vehicleWorld: i => vehicleViews[i]?.root.position,
    ragdollPose: astro.ragdollPose,
    setLook: astro.setLook,
    // kam míří kamera: na vozidlo, nebo na astronauta
    focusPosition: () => {
      const i = game.s.driving >= 0 ? game.s.driving : riding()?.i ?? -1;
      return i >= 0 ? vehicleViews[i]?.root.position || astro.root.position : astro.root.position;
    },
    feetPosition: () => surface(game.s.p, new THREE.Vector3()),
    toolTip: () => (game.s.driving >= 0 && lastTool ? surface(lastTool, new THREE.Vector3(), 0.3) : astro.toolTip()),
    setLamp: astro.setLamp,
    lampIntensity: astro.lampIntensity,
    lampPosition: astro.lampPosition,
    setShadows,
  };
}
