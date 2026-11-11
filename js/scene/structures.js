// Stavby 3.0 ve scéně: model z registru, podstavec s nožkami (O-07), animace postavení / zboření (D-07),
// hologram při stavění a červené zvýraznění při bourání (D-08). Logika je v structures.js a build.js.
import { MOON } from '../config.js';
import { game } from '../state.js';
import { STRUCTURES, axes, localToDir, heightRange, flattens, terrainPatchFor } from '../structures.js';
import { build } from '../build.js';
import { heightAt, terrainVersion } from '../planet/height.js';
import { instantiate, isReady, preloadModels, groupParts, merge } from '../assets/models.js';
import { createEnergyView } from './energyView.js';
import { createSwapperCrane } from './swapperCrane.js';
import { createResearchHolo } from './researchHolo.js';
import { attachDronport, createDronesView, DRONPORT_MODELS } from './dronesView.js';
import { attachLaac, LAAC_MODELS, partMatrix } from './laacView.js';
import { ghostParts } from '../laac.js';

const THREE = window.THREE;
const R = MOON.radius;
const SHADOW_RANGE = 40;          // m – stavby vrhají stín jen v okolí (O-05)
const GROW = 0.6, FALL = 0.7;     // s – vyrůstání / rozpad

const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4();

// Posadí model: horní plocha desky = nejvyšší terén pod padem (+3 cm), počátek modelu o padTop níž.
// Vrací výšku počátku modelu (m nad poloměrem) – odtud vedou nožky dolů.
// Hologram (bez id) stavby, která srovná terén: rovnou do výšky budoucí plochy (průměr terénu pod deskou).
const ghostLevel = { key: '', level: 0 };
function place(obj, b, lift = 0) {
  const ax = axes(b.p, b.yaw);
  const def = STRUCTURES[b.type];
  let hi;
  if (!b.id && flattens(def)) {
    const key = `${b.type}|${b.p.join(',')}|${b.yaw}`;
    if (ghostLevel.key !== key) { ghostLevel.key = key; ghostLevel.level = terrainPatchFor(b.type, b.p, b.yaw).level; }
    hi = ghostLevel.level;
  } else hi = heightRange(b.p, b.yaw, def.pad)[1];
  const base = hi + 0.03 - (def.padTop || 0);
  obj.position.set(b.p[0], b.p[1], b.p[2]).multiplyScalar(R + base + lift);
  _y.set(b.p[0], b.p[1], b.p[2]);
  _z.set(ax.Z[0], ax.Z[1], ax.Z[2]);
  _x.set(ax.X[0], ax.X[1], ax.X[2]);
  _m.makeBasis(_x, _y, _z);
  obj.quaternion.setFromRotationMatrix(_m);
  return base;
}

// Nožky podstavce: po obvodu padu každých ~5 m, od spodku modelu dolů do terénu (+0,3 m do země).
const legMat = new THREE.MeshLambertMaterial({ color: 0x6c6a66 });
function buildLegs(b, top) {
  const pad = STRUCTURES[b.type].pad;
  const ax = axes(b.p, b.yaw);
  const pts = [];
  const along = (a, c, n) => Array.from({ length: n + 1 }, (_, i) => a + (c - a) * i / n);
  const nx = Math.max(1, Math.round((pad[1] - pad[0]) / 5)), nz = Math.max(1, Math.round((pad[3] - pad[2]) / 5));
  for (const x of along(pad[0] + 0.4, pad[1] - 0.4, nx)) { pts.push([x, pad[2] + 0.4], [x, pad[3] - 0.4]); }
  for (const z of along(pad[2] + 0.4, pad[3] - 0.4, nz).slice(1, -1)) { pts.push([pad[0] + 0.4, z], [pad[1] - 0.4, z]); }
  const geos = [];
  for (const [x, z] of pts) {
    const h = heightAt(localToDir(b.p, b.yaw, x, z, ax));
    const len = top - h + 0.3;
    if (len < 0.35) continue;                       // terén je skoro v úrovni podstavce → nožka není vidět
    const g = new THREE.BoxGeometry(0.32, len, 0.32).toNonIndexed();
    g.translate(x, -len / 2 + 0.05, z);
    geos.push(g);
  }
  if (!geos.length) return null;
  const mesh = new THREE.Mesh(merge(geos), legMat);
  mesh.userData.part = 'legs';
  return mesh;
}

const ease = t => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);   // mírný překmit na konci

export function createStructures(scene, { prepare, onDust }) {
  const views = new Map();        // id → { root, b, born, dying, shadowOn }
  let first = true;               // první synchronizace (načtení hry) bez animace
  const quiet = new Set();        // id staveb, které se jen přestavují (posun, rozšíření, nový terén) – bez animace
  let shadowsOn = true, shadowTimer = 0;
  const loading = new Set();

  // Klíč pohledu: poloha, otočení, sloty nabíječky, verze terénu – při změně se stavba posadí znovu. O-11: řetězec se
  // skládá jen při změně (porovnávají se čísla), ne každý snímek pro každou stavbu.
  const keyCache = new WeakMap();
  const viewKey = b => {
    const slots = b.type === 'charger' ? b.data?.slots || 1 : b.type === 'swapper' ? 100 + (b.data?.dp?.n | 0) : b.type === 'laac' ? 200 + (b.data?.pads || []).reduce((m, x) => m | (1 << x), 0) : 0, tv = terrainVersion();   // LAAC: plošiny   // výměník: dronport (3.1)
    const c = keyCache.get(b);
    if (c && c.p0 === b.p[0] && c.p1 === b.p[1] && c.p2 === b.p[2] && c.yaw === b.yaw && c.slots === slots && c.tv === tv) return c.key;
    const key = `${b.p.join(',')}|${b.yaw}|${slots || ''}|${tv}`;
    keyCache.set(b, { p0: b.p[0], p1: b.p[1], p2: b.p[2], yaw: b.yaw, slots, tv, key });
    return key;
  };
  const BUILD_PER_FRAME = 3;                                // O-12: chybějící stavby nejvýš 3 za snímek, nejbližší první

  function makeView(b) {
    const def = STRUCTURES[b.type];
    const need = [def.model, def.ground, def.plugs && 'power-plug', ...(b.type === 'swapper' ? ['swapper-bridge', 'swapper-hook', 'swap-battery-full', 'swap-battery-empty', ...(b.data?.dp?.n > 0 ? DRONPORT_MODELS : [])] : []), ...(b.type === 'laac' ? LAAC_MODELS : [])].filter(Boolean);
    if (!need.every(isReady)) {
      for (const m of need) if (!isReady(m) && !loading.has(m)) { loading.add(m); preloadModels([m]).then(() => loading.delete(m)); }
      return null;
    }
    const root = new THREE.Group();
    root.userData.dbg = 'building';
    root.userData.structure = b.id;
    let bob = null;
    if (def.hover) { bob = new THREE.Group(); root.add(bob); }                    // kotva se vznáší (README Kotva)
    if (def.instanced) {
      // opakovaná stavba (O-03): model kreslí společné InstancedMesh podle polohy root / bob (viz updatePools)
      pool(def.model);
      if (def.ground) pool(def.ground);
    } else if (b.type === 'laac') {
      // LAAC (3.1): věž v měřítku hexu a plošiny přidá attachLaac až po posazení (níže)
    } else {
      const inst = instantiate(def.model);
      (bob || root).add(inst.root);
      if (def.ground) root.add(instantiate(def.ground).root);                     // svítící kruhy pod kotvou zůstávají na zemi
      if (b.type === 'charger') chargerSlots(inst, root, b);
    }
    const crane = b.type === 'swapper' ? createSwapperCrane(root)               // jeřáb výměníku (D-04)
      : b.type === 'research' ? createResearchHolo(root, b) : null;             // hologram výzkumu (D-10)
    for (const [x, z] of def.plugs || []) {                                        // přípojka vedení (budovy bez vlastní kotvy)
      const plug = instantiate('power-plug').root;
      plug.position.set(x, def.padTop || 0, z);
      root.add(plug);
    }
    const top = place(root, b);
    const legs = buildLegs(b, top);
    if (legs) root.add(legs);
    const dport = b.type === 'swapper' ? attachDronport(root, b, top) : null;   // dronport u výměníku (3.1, D-14)
    const laacView = b.type === 'laac' ? attachLaac(root, b) : null;           // věž a plošiny LAAC (3.1, D-16)
    prepare(root);
    scene.add(root);
    return { root, b, bob, crane: crane || laacView, dport, phase: Math.random() * 6, key: viewKey(b), born: first ? -1 : performance.now(), dying: 0, shadowOn: true };
  }

  // ---------- instancované stavby (O-03) ----------
  // Jeden typ modelu = jedna sada InstancedMesh (díl modelu + záře / paprsky). 50 kotev = stejný počet vykreslení jako 1.
  const POOL_CAP = 256;
  const pools = new Map();               // id modelu → { meshes: [{ im, local }], ids: [] }
  function pool(model) {
    let p = pools.get(model);
    if (p) return p;
    const tpl = instantiate(model).root;
    tpl.updateMatrixWorld(true);
    p = { meshes: [], ids: [] };
    tpl.traverse(o => {
      if (!o.isMesh) return;
      const im = new THREE.InstancedMesh(o.geometry, o.material, POOL_CAP);
      im.count = 0;
      im.frustumCulled = false;
      im.userData.part = o.userData.part;
      im.userData.dbg = 'building';
      im.renderOrder = o.renderOrder;
      const m = o.material;
      im.castShadow = !!m.isMeshLambertMaterial && !m.transparent;
      im.receiveShadow = im.castShadow;
      scene.add(im);
      p.meshes.push({ im, local: o.matrixWorld.clone() });
    });
    pools.set(model, p);
    return p;
  }
  const _pm = new THREE.Matrix4();
  function updatePools() {
    for (const p of pools.values()) { p.n = 0; p.ids.length = 0; }
    for (const v of views.values()) {
      const def = STRUCTURES[v.b.type];
      if (!def?.instanced || !v.root.visible) continue;
      v.root.updateMatrixWorld(true);
      const put = (model, obj) => {
        const p = pools.get(model);
        if (!p || p.n >= POOL_CAP) return;
        for (const { im, local } of p.meshes) im.setMatrixAt(p.n, _pm.multiplyMatrices(obj.matrixWorld, local));
        p.ids[p.n] = v.b.id;
        p.n++;
      };
      put(def.model, v.bob || v.root);
      if (def.ground) put(def.ground, v.root);
    }
    for (const p of pools.values()) {
      for (const { im } of p.meshes) { im.count = p.n; im.instanceMatrix.needsUpdate = true; }
    }
  }

  // Nabíječka: 2. stojan jen se 2+ sloty, 3. a 4. slot = modul vlevo (deska + kopie stojanu) – L-05, rozhodnutí 4.
  const slabMat = new THREE.MeshLambertMaterial({ color: 0x9c968c });
  const bayMat = new THREE.MeshLambertMaterial({ color: 0x4e7f93 });
  function chargerSlots(inst, root, b) {
    const n = b.data?.slots || 1;
    for (const m of inst.groups.stand2 || []) m.visible = n >= 2;
    const def = STRUCTURES.charger;
    const stand = groupParts('charger', 'stand1');
    for (let k = 2; k < n; k++) {
      const [sx] = def.slots[k], [tx] = def.stands[k];
      const x0 = k === 2 ? -14.2 : -20.2, x1 = k === 2 ? -11.4 : -14.2;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.8, 9.5), slabMat);
      slab.position.set((x0 + x1) / 2, 0.1, 1.5);
      const bay = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.02, 5.4), bayMat);
      bay.position.set(sx, 0.51, 2.2);
      root.add(slab, bay);
      for (const p of stand) {
        const m = new THREE.Mesh(p.geometry, p.material);
        m.position.x = tx - def.stands[0][0];
        inst.root.add(m);
      }
    }
  }

  const energy = createEnergyView(scene, views);   // kabely, kontrolky, nabíjecí kabely (energyView.js)
  const dronesV = createDronesView(scene, views, prepare);   // drony dronportů (3.1)

  // ---------- hologram a zvýraznění ----------
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0x7fd38a, transparent: true, opacity: 0.38, depthWrite: false });
  let ghost = null, ghostType = null, padGhost = null;
  // bez testu hloubky: obal je vidět celý, i kde by ho jinak zakryl model stavby (4. 11.: cíl bourání byl skoro neviditelný)
  const redMat = new THREE.MeshBasicMaterial({ color: 0xff3b2a, transparent: true, opacity: 0.45, depthWrite: false, depthTest: false });
  let redGhost = null, redFor = null;

  function ghostOf(type, mat) {
    const def = STRUCTURES[type];
    if (!isReady(def.model)) { preloadModels([def.model]); return null; }
    const g = instantiate(def.model).root;
    g.traverse(o => { if (o.isMesh) { o.material = mat; o.castShadow = false; o.receiveShadow = false; o.renderOrder = 4; } });
    if (g.children.find(c => c.userData.effects)) g.remove(g.children.find(c => c.userData.effects));
    const holder = new THREE.Group();
    if (def.hover) g.position.y = def.hover;                 // hologram kotvy ve výšce, kde bude viset
    holder.add(g);
    scene.add(holder);
    return holder;
  }

  // obrys zabrané plochy (foot) po terénu
  const OUT_N = 160;
  const outGeo = new THREE.BufferGeometry();
  outGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(OUT_N * 3), 3));
  const outline = new THREE.LineLoop(outGeo, new THREE.LineBasicMaterial({ color: 0x7fd38a, transparent: true, opacity: 0.95 }));
  outline.frustumCulled = false;
  outline.visible = false;
  scene.add(outline);
  function drawOutline(type, p, yaw) {
    const f = STRUCTURES[type].foot;
    const ax = axes(p, yaw);
    const per = 2 * ((f[1] - f[0]) + (f[3] - f[2]));
    const pos = outGeo.attributes.position;
    for (let i = 0; i < OUT_N; i++) {
      let d = i / OUT_N * per, x, z;
      const w = f[1] - f[0], h = f[3] - f[2];
      if (d < w) { x = f[0] + d; z = f[2]; } else if ((d -= w) < h) { x = f[1]; z = f[2] + d; }
      else if ((d -= h) < w) { x = f[1] - d; z = f[3]; } else { d -= w; x = f[0]; z = f[3] - d; }
      const q = localToDir(p, yaw, x, z, ax);
      const r = R + heightAt(q) + 0.2;
      pos.setXYZ(i, q[0] * r, q[1] * r, q[2] * r);
    }
    pos.needsUpdate = true;
  }

  function updateBuildVisuals() {
    // hologram stavby
    const showGhost = build.mode === 'build' && build.type && build.p;
    if (showGhost && ghostType !== build.type) {
      if (ghost) scene.remove(ghost);
      ghost = ghostOf(build.type, ghostMat);
      ghostType = ghost ? build.type : null;
    }
    if (ghost) ghost.visible = !!showGhost;
    outline.visible = !!showGhost;
    // LAAC (3.1): věž v měřítku hexu + hologram první plošiny na sousedním hexu
    const lay = showGhost && build.type === 'laac' ? build.layout : null;
    if (lay && !padGhost && isReady('laac-pad')) {
      padGhost = instantiate('laac-pad').root;
      padGhost.traverse(o => { if (o.isMesh) { o.material = ghostMat; o.castShadow = false; o.receiveShadow = false; o.renderOrder = 4; } });
      if (padGhost.children.find(c => c.userData.effects)) padGhost.remove(padGhost.children.find(c => c.userData.effects));
      scene.add(padGhost);
    }
    else if (lay && !padGhost) preloadModels(['laac-pad']);
    if (padGhost) padGhost.visible = !!(lay && ghost);
    if (lay && padGhost) partMatrix(ghostParts(lay)[1], _m).decompose(padGhost.position, padGhost.quaternion, padGhost.scale);
    if (showGhost && ghost) {
      place(ghost, { type: build.type, p: build.p, yaw: build.yaw });
      ghost.scale.setScalar(lay ? lay.scale : 1);
      const col = build.valid ? 0x7fd38a : 0xe0654c;
      ghostMat.color.setHex(build.valid ? 0x5fb8d9 : 0xe0654c);
      outline.material.color.setHex(col);
      drawOutline(build.type, build.p, build.yaw);
    }
    // bourání: červený obal cílové stavby
    const target = build.mode === 'demolish' && build.target ? views.get(build.target) : null;
    if (target && redFor !== target.b.id) {
      if (redGhost) scene.remove(redGhost);
      redGhost = ghostOf(target.b.type, redMat);
      redFor = redGhost ? target.b.id : null;
      if (redGhost) { place(redGhost, target.b, 0.02); redGhost.scale.setScalar(1.01); }
    }
    if (redGhost) {
      redGhost.visible = !!target;
      redMat.opacity = 0.3 + 0.25 * build.hold + 0.1 * Math.sin(performance.now() / 90);
    }
  }

  function update(dt, viewRange, focus) {
    const list = game.s.buildings || [];
    const ids = new Set(list.map(b => b.id));
    const now = performance.now();
    const missing = [];
    for (const b of list) {
      let v = views.get(b.id);
      const key = viewKey(b);
      if (v && v.key !== key && !v.dying) { scene.remove(v.root); views.delete(b.id); v = null; quiet.add(b.id); }   // přesunutá / rozšířená / nový terén – bez animace
      else if (v?.bob) v.bob.position.y = (STRUCTURES[b.type].hover || 0) + Math.sin(now / 900 + v.phase) * 0.15;   // kotva se vznáší a pohupuje
      if (!v) { missing.push(b); continue; }
      v.b = b;
    }
    // O-12: po načtení / připojení se stavby staví postupně (nejbližší první), načtení se 40+ stavbami nezamrzne
    if (missing.length > BUILD_PER_FRAME) {
      const d = b => (b.p[0] - focus.x / R) ** 2 + (b.p[1] - focus.y / R) ** 2 + (b.p[2] - focus.z / R) ** 2;
      missing.sort((a, b) => d(a) - d(b));
    }
    let built = 0;
    for (const b of missing) {
      if (built >= BUILD_PER_FRAME) break;
      const wasFirst = first;
      if (quiet.has(b.id)) first = true;                    // přestavba existující stavby: bez vyrůstání a prachu
      const v = makeView(b);
      first = wasFirst;
      if (!v) continue;
      quiet.delete(b.id);
      built++;
      views.set(b.id, v);
      v.b = b;
      if (v.born > 0) onDust?.(v.root.position.clone(), 26);
    }
    if (missing.length <= built) first = false;           // vše postavené → další stavby už s animací
    for (const [id, v] of views) {
      if (!ids.has(id) && !v.dying) { v.dying = now; onDust?.(v.root.position.clone(), 34); }
      if (v.dying) {
        const t = (now - v.dying) / 1000 / FALL;
        if (t >= 1) { scene.remove(v.root); views.delete(id); continue; }
        v.root.scale.set(1 + t * 0.15, Math.max(0.02, 1 - t * t), 1 + t * 0.15);   // rozpadne se a sesype
        continue;
      }
      if (v.born > 0) {
        const t = Math.min(1, (now - v.born) / 1000 / GROW);
        v.root.scale.setScalar(Math.max(0.001, ease(t)));
        if (t >= 1) { v.born = -1; v.root.scale.setScalar(1); }
      }
      // LAAC: vrchol 38m věže je vidět zpoza obzoru až ~230 m → kreslí se dál (~20 vykreslení, 11. 11.)
      v.root.visible = v.root.position.distanceTo(focus) < viewRange + (v.b.type === 'laac' ? 150 : 40);
      if (v.crane && v.root.visible) {                                         // animace jen do 60 m (A-06) / hologram do 120 m
        const d = v.root.position.distanceTo(focus);
        if (v.b.type === 'research') v.crane.update(now, d < 120);
        else if (v.b.type === 'laac') v.crane.update(v.b, d < 150);
        else v.crane.update(v.b, d < 60);
      }
    }
    // stíny jen v okolí (přepíná se jednou za sekundu)
    shadowTimer -= dt;
    if (shadowTimer <= 0) {
      shadowTimer = 1;
      for (const v of views.values()) {
        const on = shadowsOn && v.root.position.distanceTo(focus) < SHADOW_RANGE + 15;
        if (on === v.shadowOn) continue;
        v.shadowOn = on;
        v.root.traverse(o => { if (o.isMesh && o.material?.isMeshLambertMaterial) o.castShadow = on; });
      }
    }
    updatePools();
    updateBuildVisuals();
    energy.update(dt);
    dronesV.update(dt, focus);
  }

  // Stavba pod kurzorem (bourání): paprsek proti modelům – funguje i nad obzorem malého Měsíce. id nebo null.
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pick(clientX, clientY, camera, canvas) {
    const r = canvas.getBoundingClientRect();
    ndc.set((clientX - r.left) / r.width * 2 - 1, -(clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(ndc, camera);
    let best = null, bestD = Infinity;
    const solidHit = h => h.object.userData.part !== 'effect-glow' && h.object.userData.part !== 'effect-beam';
    for (const [id, v] of views) {
      if (v.dying || !v.root.visible || STRUCTURES[v.b.type]?.instanced) continue;
      const hit = ray.intersectObject(v.root, true).find(solidHit);
      if (hit && hit.distance < bestD) { bestD = hit.distance; best = id; }
    }
    // instancované stavby: instanceId → id stavby
    for (const p of pools.values()) {
      for (const { im } of p.meshes) {
        if (!im.count || !solidHit({ object: im })) continue;
        const hit = ray.intersectObject(im, false)[0];
        if (hit && hit.instanceId !== undefined && hit.distance < bestD && p.ids[hit.instanceId]) { bestD = hit.distance; best = p.ids[hit.instanceId]; }
      }
    }
    if (best && views.get(best)?.dying) return null;
    return best;
  }

  return {
    update,
    pick,
    pickCable: (x, y, camera, canvas) => energy.pickCable(x, y, camera, canvas),
    setShadows(on) { shadowsOn = on; for (const v of views.values()) v.shadowOn = !on; shadowTimer = 0; },
    preload: () => preloadModels([...new Set(Object.values(STRUCTURES).map(d => d.model))]),
  };
}
