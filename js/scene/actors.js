// Všechno, co se ve scéně hýbe nebo patří k základně: astronaut, vozidla, budovy,
// stanice s roboty, UFO drony, hologram při umisťování stanice, kruh nástroje a obrys hexu.
import { MOON, BUYBACK } from '../config.js';
import { DRONE, batteryCap } from '../catalog.js';
import { game } from '../state.js';
import { activeEquipment } from '../equipment.js';
import { activeBody, vehicleBody, pusherOffset, ragdollState, riding, toolPoint } from '../player.js';
import { placing } from '../interact.js';
import { carriedStation } from '../hotbar.js';
import { hexArea } from '../robots.js';
import { BUILDINGS, BUYBACK_ZONES, building } from '../base.js';
import { grid, dirToCell } from '../planet/hexgrid.js';
import { norm, cross, anyTangent, madd, angleBetween } from '../planet/vec.js';
import { heightAt } from '../planet/height.js';
import { instantiate } from '../assets/models.js';
import { createBeltsView } from './beltsView.js';
import { createHoloGlobe } from './hologram.js';
import { createRocketSite } from './rocket.js';
import { createStructures } from './structures.js';
import { createClickMarker } from './clickMarker.js';
import { createBasePlaza } from './basePlaza.js';
import { build } from '../build.js';

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
    structures?.setShadows(on);
    for (const root of prepared) root.traverse(o => { if (o.userData.blob) o.visible = !on; });
  }

  // ---------- základna ----------
  // (3.0: bez šedého kruhu základny – čisté jsou jen hexy pod budovami, base.js baseCleanCells)
  const views = {
    depot: instantiate('building-buyback'),
    workshop: instantiate('building-workshop'),
    toolshop: instantiate('building-toolshop'),
  };
  for (const b of BUILDINGS) {
    const v = views[b.id];
    surface(b.dir, v.root.position);
    _up.set(...b.dir);
    orient(v.root, _up, _f.set(...b.facing));
    v.root.userData.dbg = 'building';              // skupina pro ladicí výpis F3 (debug.js)
    scene.add(prepare(v.root));
  }
  // hologram planety nad střechou Výkupu (stejná data jako velký hologram v okně Výkupu)
  const holo = createHoloGlobe();
  holo.root.position.y = 8.6;
  holo.root.scale.setScalar(1.35);
  views.depot.root.add(holo.root);
  // světelný sloup nad Výkupem – orientační bod z dálky (jako dřív u kopule)
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 300, 8, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x5fb8d9, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
  beam.position.y = 157;
  beam.userData.noShadow = true;
  views.depot.root.add(beam);
  // 3 vysýpací zóny pod rameny pásů (base.js BUYBACK_ZONES): plochý pruh 0,3 m po terénu (čáry WebGL tloušťku neumí),
  // kus uvnitř budovy se nekreslí
  {
    const N = 64, W = 0.3, pts = [], hub = building('depot').dir;
    const ring = (k, z, t1, t2, r) => {
      const a = k / N * Math.PI * 2;
      return norm(madd(madd(z.dir, t1, Math.cos(a) * r / R), t2, Math.sin(a) * r / R));
    };
    const put = d => { surface(d, _a, 0.1); pts.push(_a.x, _a.y, _a.z); };
    for (const z of BUYBACK_ZONES) {
      const t1 = anyTangent(z.dir), t2 = cross(z.dir, t1);
      for (let k = 0; k < N; k++) {
        const o0 = ring(k, z, t1, t2, BUYBACK.r), o1 = ring(k + 1, z, t1, t2, BUYBACK.r);
        if (Math.min(angleBetween(o0, hub), angleBetween(o1, hub)) * R < 5.3) continue;   // uvnitř šestiúhelníku Výkupu
        const i0 = ring(k, z, t1, t2, BUYBACK.r - W), i1 = ring(k + 1, z, t1, t2, BUYBACK.r - W);
        for (const d of [i0, o0, o1, i0, o1, i1]) put(d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const band = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x7fd3ff, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    band.frustumCulled = false;
    band.userData.noShadow = true;
    scene.add(band);
  }

  // náměstí, cesty, osvětlení, směrovka, stavební zóna a přistávací plocha (D-12)
  const plaza = createBasePlaza(scene);

  // raketa s lunárním modulem a vlajkou na odvrácené straně
  const rocket = createRocketSite(scene, prepare, orient, surface);

  // stavby 3.0 (kladivo) a ukazatel místa kliknutí
  const structures = createStructures(scene, { prepare, onDust: opts.onDust });
  const marker = createClickMarker(scene);
  let lastHits = 0;

  // ---------- astronaut ----------
  const astro = instantiate('astronaut', look);
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

  // Ikonka baterie nad vozidlem, ve kterém nesedím (do 45 m): 0–5 dílků, barva podle nabití, blesk při nabíjení.
  const battTex = new Map();
  function battTexture(n, charging) {
    const key = `${n}${charging ? 'c' : ''}`;
    if (battTex.has(key)) return battTex.get(key);
    const cv = document.createElement('canvas'); cv.width = 96; cv.height = 48;
    const x = cv.getContext('2d');
    x.fillStyle = 'rgba(18,20,26,0.78)'; x.beginPath(); x.roundRect(2, 6, 84, 36, 8); x.fill();
    x.strokeStyle = n === 0 ? '#e0654c' : '#e4e2da'; x.lineWidth = 4; x.beginPath(); x.roundRect(6, 10, 72, 28, 5); x.stroke();
    x.fillStyle = x.strokeStyle; x.fillRect(80, 18, 6, 12);
    const col = n >= 3 ? '#7fd38a' : n >= 2 ? '#f2b33d' : '#e8742a';
    for (let i = 0; i < 5; i++) { x.fillStyle = i < n ? col : 'rgba(255,255,255,0.08)'; x.fillRect(11 + i * 13.2, 15, 10.5, 18); }
    if (charging) {
      x.fillStyle = '#ffffff'; x.strokeStyle = 'rgba(0,0,0,0.8)'; x.lineWidth = 2;
      x.beginPath(); x.moveTo(46, 8); x.lineTo(34, 27); x.lineTo(42, 27); x.lineTo(38, 42); x.lineTo(52, 21); x.lineTo(44, 21); x.closePath(); x.stroke(); x.fill();
    }
    const t = new THREE.CanvasTexture(cv);
    battTex.set(key, t);
    return t;
  }
  function updateBatteryIcon(view, v, i, dist) {
    const cap = batteryCap(v);
    const show = cap > 0 && game.s.driving !== i && dist < 45 && view.root.visible;
    if (!view.batt) {
      if (!show) return;
      view.batt = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
      view.batt.scale.set(1.5, 0.75, 1);
      view.batt.renderOrder = 6;
      view.battSeen = { charge: v.charge, at: performance.now(), up: false };
      scene.add(view.batt);
    }
    view.batt.visible = show;
    if (!show) return;
    const now = performance.now();
    if (now - view.battSeen.at > 800) { view.battSeen.up = v.charge > view.battSeen.charge + 0.05; view.battSeen.charge = v.charge; view.battSeen.at = now; }
    const k = Math.max(0, v.charge || 0) / cap;
    const n = k <= 0 ? 0 : Math.max(1, Math.ceil(k * 5 - 1e-6));
    const tex = battTexture(n, view.battSeen.up && k < 1);
    if (view.batt.material.map !== tex) { view.batt.material.map = tex; view.batt.material.needsUpdate = true; }
    view.batt.position.copy(view.root.position).addScaledVector(_up.copy(view.root.position).normalize(), view.battHeight ?? 2.6);
  }

  function syncVehicles(dt, viewRange) {
    const list = game.s.vehicles;
    // po prodeji vozidla se indexy posunou → model, který k indexu nepatří, se postaví znovu
    for (let i = 0; i < Math.max(list.length, vehicleViews.length); i++) {
      const v = list[i], old = vehicleViews[i];
      if (old && (!v || old.uid !== (v.uid || '') || old.type !== v.type)) {
        scene.remove(old.root);
        if (old.batt) scene.remove(old.batt);
        const k = prepared.indexOf(old.root);
        if (k >= 0) prepared.splice(k, 1);
        vehicleViews[i] = null;
      }
      if (v && !vehicleViews[i]) {
        const view = instantiate(`vehicle-${v.type}`);
        view.normal = new THREE.Vector3();
        view.spin = 0;
        view.uid = v.uid || '';
        view.type = v.type;
        view.battHeight = new THREE.Box3().setFromObject(view.root).max.y + 0.9;   // ikonka baterie nad střechou
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
      const dist = view.root.position.distanceTo(astro.root.position);
      view.root.visible = dist < viewRange + 20;
      view.remoteDriven = !!remote;
      updateBatteryIcon(view, v, i, dist);
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
  const ghost = instantiate('station', ghostMat);
  ghost.root.visible = false;
  scene.add(ghost.root);
  const areaLines = hexOutlines(scene, 0x5fb8d9);
  areaLines.lines.visible = false;

  function syncStations(dt, viewRange) {
    const list = game.s.stations;
    while (stationViews.length < list.length) {
      const station = instantiate('station');
      const bot = instantiate('robot');
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
      const view = instantiate('drone');
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

  // ---------- pásy, náklad a zásuvky (3.0, logistics.js) ----------
  const belts = createBeltsView(scene);

  function updatePlacement() {
    ghost.root.visible = placing.active;
    areaLines.lines.visible = placing.active;
    if (!placing.active || !placing.point) return;
    const hex = dirToCell(placing.point);
    const home = [grid.dirs[hex * 3], grid.dirs[hex * 3 + 1], grid.dirs[hex * 3 + 2]];
    surface(home, ghost.root.position);
    orient(ghost.root, _up.set(...home), _f.set(...anyTangent(home)));
    ghostMat.color.setHex(placing.valid ? 0x5fb8d9 : 0xe0654c);
    areaLines.lines.material.color.setHex(placing.valid ? 0x5fb8d9 : 0xe0654c);
    const mk = placing.kind === 'move' ? game.s.stations[placing.index]?.mk | 0 : Math.max(1, placing.index);
    areaLines.set(hexArea(hex, mk >= 2 ? 3 : 2));                 // Vysavač MK2 uklízí o prstenec dál
  }

  // ---------- snímek ----------
  let lastTool = null;

  function update(dt, time, fx, viewRange) {
    const s = game.s;
    syncVehicles(dt, viewRange);
    syncStations(dt, viewRange);
    syncDrones(dt, time, viewRange);
    belts.update(time, viewRange, astro.root.position);
    updatePlacement();
    structures.update(dt, viewRange, focusPoint());
    holo.root.visible = views.depot.root.position.distanceTo(astro.root.position) < 90;
    if (holo.root.visible) {
      holo.spin.rotation.y = time * 0.25;
      holo.update(time);
    }
    rocket.update(time, focusPoint());

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

    const tp = toolPoint();                          // poloha nástroje v tomto snímku (zametání samo je 10× za s)
    lastTool = tp;
    if (!driving) astro.setToolSize(ride ? 0 : eq.stats.width / 2);
    astro.setHammer(game.hammer && !driving && !ride && !rag);
    if (build.hits !== lastHits) { lastHits = build.hits; astro.hammerSwing(); }
    updateRing(tp, eq.stats.width / 2);
    updateHexLine(dirToCell(s.p));
  }

  function focusPoint() {
    const i = game.s.driving >= 0 ? game.s.driving : riding()?.i ?? -1;
    return i >= 0 ? vehicleViews[i]?.root.position || astro.root.position : astro.root.position;
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
    // ukazatel kliknutí (D-09): target = cíl myší, vehicle = { radius, nose } při jízdě
    updateMarker: (dt, target, vehicle, miss, clicks) => marker.update(dt, target, vehicle, miss, clicks),
    preloadStructures: () => structures.preload(),
    pickStructure: (x, y, camera, canvas) => structures.pick(x, y, camera, canvas),
    pickCable: (x, y, camera, canvas) => structures.pickCable(x, y, camera, canvas),
    fadeOccluders: belts.fade,
    seatTransform,
    passengerTransform,
    vehicleRadius: i => vehicleViews[i]?.radius ?? 1,
    vehicleWorld: i => vehicleViews[i]?.root.position,
    ragdollPose: astro.ragdollPose,
    setLook: astro.setLook,
    // kam míří kamera: na vozidlo, nebo na astronauta
    focusPosition: focusPoint,
    rocketPosition: rocket.rocketPosition,
    rocketSite: rocket.position,
    feetPosition: () => surface(game.s.p, new THREE.Vector3()),
    toolTip: () => (game.s.driving >= 0 && lastTool ? surface(lastTool, new THREE.Vector3(), 0.3) : astro.toolTip()),
    setLamp: astro.setLamp,
    setBaseDark: k => plaza.update(k),                       // tma u základny: lampy a obrubníky (D-12)
    lampIntensity: astro.lampIntensity,
    lampPosition: astro.lampPosition,
    lampDirection: astro.lampDirection,
    // Světlomety vozidla i: střed světel a směr jízdy ve světě (false = vozidlo bez světel, např. ruční vozík).
    vehicleHeadlight(i, pos, dir) {
      const view = vehicleViews[i];
      if (!view?.headlight || !view.root.visible) return false;
      view.root.updateMatrixWorld();
      dir.set(0, 0, 1).transformDirection(view.root.matrixWorld);
      // zdroj kousek před světlomety, aby karoserie nezastínila vlastní kužel (stíny světel)
      pos.copy(view.headlight).applyMatrix4(view.root.matrixWorld).addScaledVector(dir, 0.7);
      return true;
    },
    setShadows,
  };
}
