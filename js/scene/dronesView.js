// Dronport a drony ve scéně (3.1, D-14, A-11, O-23). Logika letu je v dronport.js.
// Dronport = model připojený k výměníku (attachDronport v makeView). Drony: na palubě se drží místa přistání,
// za letu podle letu (m.p, m.h, m.f). Výměna 4 s: hák A sjede pro vybitou baterii na střeše, hák B spustí nabitou.
// Plameny trysek všech dronů = jeden InstancedMesh (O-23). Nad vozidlem čekajícím na dron kroužek s odpočtem (D-14).
import { MOON } from '../config.js';
import { STRUCTURES, localToDir } from '../structures.js';
import { heightAt } from '../planet/height.js';
import { instantiate, merge } from '../assets/models.js';
import { MODELS } from '../assets/registry.js';
import { allMissions, dronportOf, DRONE, droneStatus, droneVehicle, vehicleRoof } from '../dronport.js';
import { hostNow } from '../energy.js';
import { game } from '../state.js';

const THREE = window.THREE;
const R = MOON.radius;
const D = () => STRUCTURES.swapper.dronport;
export const DRONPORT_MODELS = ['dronport', 'drone-battery', 'swapper-hook', 'swap-battery-full', 'swap-battery-empty'];

// ---------- dronport na výměníku ----------
const legMat = new THREE.MeshLambertMaterial({ color: 0x6c6a66 });
const LIGHT = { ready: 0x7fd38a, charging: 0x5fb8d9, out: 0xffffff, off: 0x1e2226 };
// root = výměník (počátek modelu ve výšce top nad poloměrem). Vrací { lights } pro stavová světla.
export function attachDronport(root, b, top) {
  const dp = dronportOf(b);
  if (!dp) return null;
  const inst = instantiate('dronport');
  const at = D().at;
  inst.root.position.set(at[0], at[1], at[2]);
  for (const m of inst.groups.pad2 || []) m.visible = dp.n >= 2;           // 2. místo se ukáže až s 2. dronem
  for (const g of ['stav1', 'stav2']) for (const m of inst.groups[g] || []) m.visible = false;   // lampu kreslí hra (níž)
  root.add(inst.root);
  // stavová světla (stav_1, stav_2): sloupek z modelu + svítidlo s vlastní barvou podle stavu dronu
  const lights = D().lights.map(([x, y, z], k) => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.6, 0.3), legMat);
    post.position.set(at[0] + x, at[1] + y - 0.42, at[2] + z);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.24, 0.36), new THREE.MeshBasicMaterial({ color: LIGHT.off }));
    m.position.set(at[0] + x, at[1] + y, at[2] + z);
    post.visible = m.visible = k < dp.n;
    root.add(post, m);
    return m;
  });
  // sloupy do terénu: modul stojí mimo desku výměníku, terén pod ním může být níž
  const [xs, zs] = D().solid, geos = [];
  for (const x of xs) for (const z of zs) {
    const len = top - heightAt(localToDir(b.p, b.yaw, x, z)) + 0.3;
    if (len < 0.35) continue;
    geos.push(new THREE.BoxGeometry(0.8, len, 0.8).toNonIndexed().translate(x, -len / 2 + 0.05, z));
  }
  if (geos.length) root.add(new THREE.Mesh(merge(geos), legMat));
  return { lights };
}

// ---------- drony ----------
const P = () => MODELS['drone-battery'].points;
const HOOK_Y = 0.84, FRAME_Y = 0.12, HANG = HOOK_Y - FRAME_Y;              // baterie visí 0,72 m pod hákem (jako u jeřábu)
const cableMat = new THREE.MeshLambertMaterial({ color: 0x2b2b2e });
const cableGeo = new THREE.CylinderGeometry(0.03, 0.03, 1, 6).translate(0, -0.5, 0);
const labelTex = new Map();
function labelTexture(n) {
  if (labelTex.has(n)) return labelTex.get(n);
  const c = document.createElement('canvas');
  c.width = 128; c.height = 40;
  const g = c.getContext('2d');
  g.fillStyle = '#1d2024'; g.fillRect(0, 0, 128, 40);
  g.fillStyle = '#f0e6d2'; g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(`DRON ${n}`, 64, 21);
  const t = new THREE.CanvasTexture(c);
  labelTex.set(n, t);
  return t;
}

function makeDrone(n, prepare) {
  const body = instantiate('drone-battery').root;
  const root = new THREE.Group();
  root.userData.dbg = 'vehicle';                          // ladicí výpis F3 (debug.js)
  root.add(body);
  const pts = P();
  const hooks = [pts.hookA, pts.hookB].map(([x, y, z]) => {
    const h = instantiate('swapper-hook').root;
    h.position.set(x, y, z);
    const cab = new THREE.Mesh(cableGeo, cableMat);
    cab.position.set(x, y + 0.2, z);
    cab.visible = false;
    root.add(h, cab);
    return { h, cab, x, z };
  });
  const bat = {
    full: instantiate('swap-battery-full').root,
    empty: instantiate('swap-battery-empty').root,
  };
  root.add(bat.full, bat.empty);
  // číslo dronu na štítcích po stranách (cislo_L, cislo_P)
  for (const [[x, y, z], side] of [[pts.labelL, -1], [pts.labelR, 1]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.17), new THREE.MeshBasicMaterial({ map: labelTexture(n) }));
    m.geometry.rotateY(side * Math.PI / 2);
    m.position.set(x + side * 0.012, y, z);
    root.add(m);
  }
  prepare?.(root);
  return { root, hooks, bat };
}

// Póza háků a baterií (místní souřadnice dronu). carry: 'full' (nese nabitou v B) | 'empty' (vybitá v A).
function rest(d, carry, slide = 0, slideWhich = null) {
  for (const k of d.hooks) { k.h.position.set(k.x, HOOK_Y, k.z); k.h.rotation.y = 0; k.cab.position.x = k.x; k.cab.position.z = k.z; k.cab.visible = false; }
  d.bat.full.rotation.y = d.bat.empty.rotation.y = 0;
  const pts = P();
  d.bat.full.visible = carry === 'full';
  d.bat.empty.visible = carry === 'empty';
  d.bat.full.position.set(pts.frameB[0] + (slideWhich === 'full' ? slide : 0), FRAME_Y, pts.frameB[2]);
  d.bat.empty.position.set(pts.frameA[0] + (slideWhich === 'empty' ? slide : 0), FRAME_Y, pts.frameA[2]);
}
function hookTo(k, y) {
  k.h.position.y = y;
  k.cab.visible = y < HOOK_Y - 0.05;
  k.cab.position.y = HOOK_Y + 0.2;
  k.cab.scale.y = Math.max(0.05, HOOK_Y + 0.2 - (y + 0.18));
}
const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
const seg = (t, a, b) => (t - a) / (b - a);
// Výměna (t 0–1): A dolů → vybitá nahoru do rámu A → B s nabitou dolů → B nahoru prázdný. Střecha je 3 m pod dronem.
// Hák ve výšce y mezi rámem dronu (nahoře) a kolébkou vozidla (dole = low). Dron visí středem nad baterií vozidla
// (07, fáze B), proto hák cestou dolů sjede pod střed a otočí se o 90°: baterie leží delší stranou podél vozidla.
function reach(k, y, low) {
  const u = (y - low) / (HOOK_Y - low), s = Math.max(0, Math.min(1, (u - 0.25) / 0.6));
  const at = { x: k.x * s, z: k.z * s, yaw: (1 - s) * Math.PI / 2 };
  hookTo(k, y);
  k.h.position.x = k.cab.position.x = at.x;
  k.h.position.z = k.cab.position.z = at.z;
  k.h.rotation.y = at.yaw;
  return at;
}
function swapPose(d, t) {
  const [A, B] = d.hooks;
  const roof = -DRONE.above, low = roof + HANG;         // roof = spodek baterie v kolébce (DRONE.above pod dronem)
  const put = (bat, x, y, z, yaw) => { bat.visible = true; bat.position.set(x, y, z); bat.rotation.y = yaw; };
  // hák A + vybitá baterie
  const yA = t < 0.2 ? lerp(HOOK_Y, low, seg(t, 0, 0.2)) : t < 0.25 ? low : lerp(low, HOOK_Y, seg(t, 0.25, 0.45));
  const a = reach(A, yA, low);
  if (t < 0.25) put(d.bat.empty, 0, roof, 0, Math.PI / 2);
  else put(d.bat.empty, a.x, yA - HANG, a.z, a.yaw);
  // hák B + nabitá baterie
  const yB = t < 0.5 ? HOOK_Y : t < 0.72 ? lerp(HOOK_Y, low, seg(t, 0.5, 0.72)) : lerp(low, HOOK_Y, seg(t, 0.76, 0.95));
  const b = reach(B, yB, low);
  if (t < 0.72) put(d.bat.full, b.x, yB - HANG, b.z, b.yaw);
  else put(d.bat.full, 0, roof, 0, Math.PI / 2);
}

const _up = new THREE.Vector3(), _f = new THREE.Vector3(), _x = new THREE.Vector3(), _m = new THREE.Matrix4(), _l = new THREE.Matrix4();
function placeWorld(obj, p, h, f) {
  _up.set(p[0], p[1], p[2]);
  _f.set(f[0], f[1], f[2]);
  _x.crossVectors(_up, _f);
  _m.makeBasis(_x, _up, _f);
  obj.quaternion.setFromRotationMatrix(_m);
  obj.position.copy(_up).multiplyScalar(R + h);
}

export function createDronesView(scene, views, prepare) {
  const drones = new Map();                 // `${id}:${k}` → dron
  // plameny trysek (O-23): jeden InstancedMesh, 4 na dron
  const FL_MAX = 64;
  const flameGeo = new THREE.ConeGeometry(0.2, 1.1, 10, 1, true).rotateX(Math.PI).translate(0, -0.55, 0);
  const flames = new THREE.InstancedMesh(flameGeo, new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }), FL_MAX);
  flames.frustumCulled = false;
  flames.count = 0;
  scene.add(flames);
  const _fm = new THREE.Matrix4(), _s = new THREE.Vector3(), _q = new THREE.Quaternion(), _p = new THREE.Vector3();
  // kroužek s odpočtem nad vozidlem čekajícím na dron
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.8, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x5fb8d9, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  ring.visible = false;
  scene.add(ring);
  const tagCanvas = document.createElement('canvas');
  tagCanvas.width = 384; tagCanvas.height = 64;
  const tagTex = new THREE.CanvasTexture(tagCanvas);
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tagTex, transparent: true, depthTest: false }));
  tag.scale.set(6, 1, 1);
  tag.renderOrder = 6;
  tag.visible = false;
  scene.add(tag);
  let tagText = '';

  function update(dt, focus) {
    const now = hostNow();
    const missions = new Map(allMissions().map(x => [`${x.b.id}:${x.k}`, x]));
    const seen = new Set();
    let nf = 0;
    const thrust = (d, power) => {
      d.root.updateMatrixWorld(true);
      for (const [x, y, z] of P().thrusters) {
        if (nf >= FL_MAX) return;
        _p.set(x, y, z).applyMatrix4(d.root.matrixWorld);
        d.root.getWorldQuaternion(_q);
        _s.set(1, power * (0.85 + 0.15 * Math.sin(now / 37 + x * 3 + z)), 1);
        flames.setMatrixAt(nf++, _fm.compose(_p, _q, _s));
      }
    };
    for (const v of views.values()) {
      const b = v.b, dp = dronportOf(b);
      if (!dp || v.dying || !v.dport) continue;
      for (let k = 0; k < dp.n; k++) {
        const key = `${b.id}:${k}`;
        seen.add(key);
        let d = drones.get(key);
        if (!d) { d = makeDrone(k + 1, prepare); drones.set(key, d); scene.add(d.root); }
        const x = missions.get(key), m = x?.m;
        const st = dp.dr[k]?.st || 'ready';
        // stavové světlo místa: zelená připravený · modrá pulzující nabíjí · bílá na cestě
        const light = v.dport.lights[k];
        if (light) {
          const col = m || st === 'out' ? LIGHT.out : st === 'charging' ? LIGHT.charging : LIGHT.ready;
          light.material.color.setHex(col);
          if (st === 'charging' && !m) light.material.color.multiplyScalar(0.55 + 0.45 * Math.sin(performance.now() / 260 + k));
        }
        const parked = !m || m.ph === 'load' || m.ph === 'unload';
        if (parked) {
          // na palubě: místo přistání v souřadnicích výměníku (výměník mimo dohled → nic nepočítat, 11. 11.)
          d.root.visible = v.root.visible;
          if (!d.root.visible) continue;
          const [px, py, pz] = D().pads[k], at = D().at;
          v.root.updateMatrix();
          _l.makeTranslation(at[0] + px, at[1] + py, at[2] + pz);
          _m.multiplyMatrices(v.root.matrix, _l);
          _m.decompose(d.root.position, d.root.quaternion, d.root.scale);
          const t = m ? (now - m.at) / 1000 / (m.ph === 'load' ? DRONE.load : DRONE.unload) : 1;
          // baterie přijede po palubě od výměníku (load) / odjede k němu (unload)
          if (m?.ph === 'load') rest(d, 'full', lerp(-4, 0, t), 'full');
          else if (m?.ph === 'unload') rest(d, m.carry, lerp(0, -4, t), m.carry);
          else rest(d, null);
          if (m?.ph === 'unload' && t >= 1) { d.bat.full.visible = d.bat.empty.visible = false; }
          continue;
        }
        placeWorld(d.root, m.p, m.h, m.f);
        d.root.visible = d.root.position.distanceTo(focus) < 900;
        if (m.ph === 'swap') swapPose(d, Math.min(1, (now - m.at) / 1000 / DRONE.swap));
        else rest(d, m.carry);
        if (d.root.visible) thrust(d, m.ph === 'up' ? 1.3 : m.ph === 'down' ? 0.7 : m.ph === 'swap' || m.ph === 'hover' ? 0.8 : 1);
      }
    }
    for (const [key, d] of drones) if (!seen.has(key)) { scene.remove(d.root); drones.delete(key); }
    flames.count = nf;
    flames.instanceMatrix.needsUpdate = true;
    // kroužek a odpočet nad řízeným vozidlem
    const s = game.s, st = s.driving >= 0 ? droneStatus(s.driving) : null;
    const lv = st ? droneVehicle(s.driving) : null;
    const show = !!(st && lv && st.m.carry === 'full' && !['ret', 'down', 'unload'].includes(st.m.ph));
    ring.visible = tag.visible = show;
    if (show) {
      const top = heightAt(lv.p) + vehicleRoof(s.vehicles[s.driving]?.type) + 1.2;
      placeWorld(ring, lv.p, top, s.vehicles[s.driving].f);
      ring.rotateY(performance.now() / 900);
      ring.material.opacity = 0.55 + 0.3 * Math.sin(performance.now() / 300);
      placeWorld(tag, lv.p, top + DRONE.above + 3.2, s.vehicles[s.driving].f);   // nad dronem, ať ho nezakrývá
      tag.quaternion.identity();
      tag.scale.set(6, 1, 1);
      const text = st.text;
      if (text !== tagText) {
        tagText = text;
        const g = tagCanvas.getContext('2d');
        g.clearRect(0, 0, 384, 64);
        g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.lineWidth = 6; g.strokeStyle = 'rgba(10,14,18,0.85)'; g.strokeText(text, 192, 33);
        g.fillStyle = '#cfefff'; g.fillText(text, 192, 33);
        tagTex.needsUpdate = true;
      }
    }
  }
  return { update };
}
