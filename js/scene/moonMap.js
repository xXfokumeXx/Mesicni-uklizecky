// Mapa celého Měsíce (klávesa M): zjednodušený glóbus se stejnou texturou prachu jako terén,
// takže jsou vidět vyčištěné pásy i hotové hexy. Tažením myši (prstem) nebo WSAD / šipkami se glóbus
// otáčí, kolečkem, +/− nebo Q/E přibližuje. Glóbus se postaví až při prvním otevření (~25 000 vrcholů).
import { MOON, BASE, DUST, PLANET } from '../config.js';
import { FACES } from '../planet/icosa.js';
import { heightAt } from '../planet/height.js';
import { dirToCell, cellDir } from '../planet/hexgrid.js';
import { atlasUv, hexes } from '../planet/dustmap.js';
import { FLAT_WINDOW } from '../planet/sunwindow.js';
import { game } from '../state.js';
import { beltPath } from '../depots.js';
import { ROCKET_SITE } from '../rocket.js';
import { createTerrainMaterial } from './terrainMaterial.js';

const THREE = window.THREE;
const R = MOON.radius;
const N = 48;                                   // dílků na hranu stěny ikosaedru (~5,5 m)
const MIN_DIST = R * 1.35, MAX_DIST = R * 5, START_DIST = R * 3.1;
const CLEAN = PLANET.clean, DONE = PLANET.done;

// opts.onPick(clientX, clientY) = klik (bez tažení) do mapy → hráč tam vyrazí.
export function createMoonMap(scene, camera, canvas, dustTexture, opts = {}) {
  let globe = null, vertCell = null, colors = null, colorAttr = null;
  const { material, uniforms } = createTerrainMaterial(dustTexture, 255 / DUST.max, null);
  uniforms.ambient.value.setHex(PLANET.earth ? 0x3a4560 : 0x5a4038);   // noční strana trochu světlejší, ať je mapa čitelná

  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  // značky: hráč (oranžová), základna (modrá), stanice robotů (zelená)
  const pinGeo = new THREE.SphereGeometry(1, 12, 8);
  const mk = color => new THREE.Mesh(pinGeo, new THREE.MeshBasicMaterial({ color }));
  const playerPin = mk(0xff8a3d), basePin = mk(0x5fb8d9);
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.1, 32), new THREE.MeshBasicMaterial({
    color: 0xff8a3d, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false,
  }));
  const rocketPin = mk(0xffffff);                // raketa domů na odvrácené straně (bílá)
  group.add(playerPin, basePin, ring, rocketPin);
  const stationMat = new THREE.MeshBasicMaterial({ color: 0x7fd38a });
  let stationPins = [];
  // cíl cesty (klik do mapy), depa (fialová) a jejich pásy
  const targetPin = mk(0xe0654c);
  targetPin.visible = false;
  group.add(targetPin);
  let target = null;
  const depotMat = new THREE.MeshBasicMaterial({ color: 0xb48cf0 });
  const beltMat = new THREE.LineBasicMaterial({ color: 0xb48cf0 });
  let depotPins = [], beltLines = [], depotKey = '';
  // UFO drony (azurové, létají)
  const droneMat = new THREE.MeshBasicMaterial({ color: 0x6ff0e0 });
  const dronePins = [];

  function buildGlobe() {
    const perFace = (N + 1) * (N + 2) / 2;
    const vc = perFace * 20;
    const pos = new Float32Array(vc * 3), uv = new Float32Array(vc * 2), sun = new Float32Array(vc * 2);
    colors = new Uint8Array(vc * 3);
    vertCell = new Int32Array(vc);
    const idx = new Uint32Array(20 * N * N * 3);
    const tmp = [0, 0];
    let v = 0, ii = 0;
    for (let f = 0; f < 20; f++) {
      const P = FACES[f];
      const first = v;
      const row = [];                             // index prvního vrcholu v řádku j
      for (let j = 0; j <= N; j++) {
        row.push(v - first);
        for (let i = 0; i <= N - j; i++) {
          const s = i / N, t = j / N;
          const x = P.A[0] + P.e1[0] * s + P.e2[0] * t, y = P.A[1] + P.e1[1] * s + P.e2[1] * t, z = P.A[2] + P.e1[2] * s + P.e2[2] * t;
          const l = Math.hypot(x, y, z);
          const d = [x / l, y / l, z / l];
          const r = R + heightAt(d);
          pos[v * 3] = d[0] * r; pos[v * 3 + 1] = d[1] * r; pos[v * 3 + 2] = d[2] * r;
          atlasUv(f, s, t, tmp);
          uv[v * 2] = tmp[0]; uv[v * 2 + 1] = tmp[1];
          sun[v * 2] = FLAT_WINDOW[0]; sun[v * 2 + 1] = FLAT_WINDOW[1];
          vertCell[v] = dirToCell(d);
          v++;
        }
      }
      const at = (i, j) => first + row[j] + i;
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N - j; i++) {
          idx[ii++] = at(i, j); idx[ii++] = at(i + 1, j); idx[ii++] = at(i, j + 1);
          if (i + j < N - 1) { idx[ii++] = at(i + 1, j); idx[ii++] = at(i + 1, j + 1); idx[ii++] = at(i, j + 1); }
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('sunWin', new THREE.BufferAttribute(sun, 2));
    colorAttr = new THREE.BufferAttribute(colors, 3, true);
    geo.setAttribute('color', colorAttr);
    geo.setIndex(new THREE.BufferAttribute(idx.subarray(0, ii), 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    globe = new THREE.Mesh(geo, material);
    group.add(globe);
  }

  // hotové hexy namodralé (jako na terénu)
  function recolor() {
    for (let i = 0; i < vertCell.length; i++) {
      const c = hexes.done[vertCell[i]] ? DONE : CLEAN;
      colors[i * 3] = c[0]; colors[i * 3 + 1] = c[1]; colors[i * 3 + 2] = c[2];
    }
    colorAttr.needsUpdate = true;
  }

  function placeStations() {
    for (const p of stationPins) group.remove(p);
    stationPins = game.s.stations.map(st => {
      const pin = new THREE.Mesh(pinGeo, stationMat);
      pin.userData.dir = cellDir(st.hex);
      group.add(pin);
      return pin;
    });
  }

  function placeDepots() {
    const key = game.s.depots.map(d => `${d.hex}${d.belt ? `b${d.to ?? -1}` : ''}`).join(',');
    if (key === depotKey) return;
    depotKey = key;
    for (const o of [...depotPins, ...beltLines]) group.remove(o);
    beltLines.forEach(l => l.geometry.dispose());
    depotPins = game.s.depots.map(d => {
      const pin = new THREE.Mesh(pinGeo, depotMat);
      pin.userData.dir = cellDir(d.hex);
      group.add(pin);
      return pin;
    });
    beltLines = game.s.depots.filter(d => d.belt).map(d => {
      const pts = beltPath(d.hex, d.to ?? -1).points.map(p => {
        const r = R + heightAt(p) + 1.5;
        return new THREE.Vector3(p[0] * r, p[1] * r, p[2] * r);
      });
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), beltMat);
      group.add(line);
      return line;
    });
  }

  // ---------- kamera ----------

  const quat = new THREE.Quaternion(), qa = new THREE.Quaternion();
  const axisX = new THREE.Vector3(1, 0, 0), axisY = new THREE.Vector3(0, 1, 0);
  const basis = new THREE.Matrix4();
  let dist = START_DIST, targetDist = START_DIST, active = false, recolorTimer = 0;

  function open(p, f) {
    if (!globe) buildGlobe();
    recolor();
    placeStations();
    placeDepots();
    // pohled shora na hráče, „nahoru“ na obrazovce = kam se hráč dívá
    const z = new THREE.Vector3(...p), y = new THREE.Vector3(...f);
    const x = new THREE.Vector3().crossVectors(y, z);
    basis.makeBasis(x, y, z);
    quat.setFromRotationMatrix(basis);
    dist = R + 60;
    targetDist = START_DIST;
    group.visible = true;
    active = true;
  }

  function close() {
    group.visible = false;
    active = false;
    keys.clear();
  }

  function rotate(dx, dy) {
    const k = 0.0045 * Math.min(1, (dist - R) / (START_DIST - R) + 0.15);   // přiblížený = jemnější
    qa.setFromAxisAngle(axisY, -dx * k);
    quat.multiply(qa);
    qa.setFromAxisAngle(axisX, -dy * k);
    quat.multiply(qa);
    quat.normalize();
  }

  function zoom(factor) {
    targetDist = Math.max(MIN_DIST, Math.min(MAX_DIST, R + (targetDist - R) * factor));
  }

  // ovládání klávesnicí (jen když je mapa otevřená): WSAD / šipky = otáčení, +/− a Q/E = přiblížení.
  // Klávesy podle polohy (e.code), takže fungují i s českou klávesnicí.
  const KEY_MOVE = {
    KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1],
    KeyA: [1, 0], ArrowLeft: [1, 0], KeyD: [-1, 0], ArrowRight: [-1, 0],
  };
  const KEY_ZOOM = { KeyE: -1, Equal: -1, NumpadAdd: -1, PageUp: -1, KeyQ: 1, Minus: 1, Slash: 1, NumpadSubtract: 1, PageDown: 1 };
  const keys = new Set();
  addEventListener('keydown', e => {
    if (!active || e.target.matches?.('input, textarea')) return;
    if (KEY_MOVE[e.code] || KEY_ZOOM[e.code]) { keys.add(e.code); e.preventDefault(); }
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  function keyControl(dt) {
    let dx = 0, dy = 0, dz = 0;
    for (const k of keys) {
      if (KEY_MOVE[k]) { dx += KEY_MOVE[k][0]; dy += KEY_MOVE[k][1]; }
      if (KEY_ZOOM[k]) dz += KEY_ZOOM[k];
    }
    const px = 520 * dt;                                // jako tažení myší rychlostí ~520 px/s
    if (dx || dy) rotate(Math.sign(dx) * px, Math.sign(dy) * px);
    if (dz) zoom(Math.exp(Math.sign(dz) * 1.4 * dt));
  }

  // ovládání myší / prstem (jen když je mapa otevřená): tažení = otáčení, klik = cíl cesty
  let dragging = false, lx = 0, ly = 0, sx = 0, sy = 0, moved = 0;
  canvas.addEventListener('pointerdown', e => {
    if (!active) return;
    dragging = true;
    lx = sx = e.clientX; ly = sy = e.clientY;
    moved = 0;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!active || !dragging) return;
    rotate(e.clientX - lx, e.clientY - ly);
    lx = e.clientX; ly = e.clientY;
    moved = Math.max(moved, Math.hypot(e.clientX - sx, e.clientY - sy));
  });
  canvas.addEventListener('pointerup', e => {
    if (active && dragging && moved < 6 && e.button === 0) opts.onPick?.(e.clientX, e.clientY);
    dragging = false;
  });
  canvas.addEventListener('pointercancel', () => { dragging = false; });

  function setTarget(d) {
    target = d || null;
    targetPin.visible = !!target;
  }

  const tmpV = new THREE.Vector3();
  function placePin(pin, d, size, lift) {
    const r = R + heightAt(d) + lift;
    pin.position.set(d[0] * r, d[1] * r, d[2] * r);
    pin.scale.setScalar(size);
  }

  function update(dt, playerPos) {
    if (!active) return;
    keyControl(dt);
    dist += (targetDist - dist) * (1 - Math.exp(-dt * 6));
    camera.position.set(0, 0, dist).applyQuaternion(quat);
    camera.quaternion.copy(quat);

    // velikost značek podle vzdálenosti kamery (na obrazovce stále stejně velké)
    const size = (dist - R) * 0.012 + 0.6;
    const pd = tmpV.copy(playerPos).normalize().toArray();
    placePin(playerPin, pd, size, size);
    ring.position.copy(playerPin.position);
    ring.lookAt(0, 0, 0);
    ring.scale.setScalar(size * (1 + 0.25 * Math.sin(performance.now() / 260)));
    placePin(basePin, BASE.dir, size * 1.1, size);
    placePin(rocketPin, ROCKET_SITE.dir, size * 1.1, size * 1.5);
    for (const pin of stationPins) placePin(pin, pin.userData.dir, size * 0.8, size * 0.8);
    for (const pin of depotPins) placePin(pin, pin.userData.dir, size * 0.9, size * 0.9);
    if (target) placePin(targetPin, target, size * 0.9, size * 0.9);
    const drones = game.s.drones || [];
    while (dronePins.length < drones.length) { const pin = new THREE.Mesh(pinGeo, droneMat); group.add(pin); dronePins.push(pin); }
    dronePins.forEach((pin, i) => {
      pin.visible = i < drones.length;
      if (pin.visible) placePin(pin, drones[i].p, size * 0.75, size * 2.2);
    });

    recolorTimer -= dt;
    if (recolorTimer <= 0) { recolorTimer = 1; recolor(); placeDepots(); }   // roboti mezitím dočistili hexy
  }

  return { open, close, update, rotate, zoom, setTarget, uniforms, get active() { return active; }, get distance() { return dist; } };
}
