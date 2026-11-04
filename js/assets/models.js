// Jediný vstup k modelům pro zbytek hry (A-02, A-04):
//   await preloadModels(ids)  – stáhne a připraví GLB (po jednom za snímek, ať se hra nezasekne)
//   instantiate(id, …args)    – nová instance: { root, anchors, points, size, effects, … } (builder vrací svůj view objekt)
//   geometryFor(id)           – sloučené geometrie + materiály pro InstancedMesh (O-03)
//   isReady(id)
// Příprava GLB: materiály → MeshLambertMaterial (barvy převedené do sRGB, renderer hry je lineární),
// díly se sloučí podle druhu: 1 pevný (barvy do vrcholů), 1 svítící (MeshBasic), textury zvlášť → 2–5 vykreslení místo 7–36.
// Záře a paprsky (userData.efekty) jsou jedna geometrie s billboard shaderem na model (1–2 vykreslení navíc).
import { MODELS } from './registry.js';
import { buildEffects } from './effects.js';

const THREE = window.THREE;
const prepared = new Map();        // id → { parts: [{ geometry, material, kind }], anchors, size, center, effects }
const loading = new Map();         // id → Promise
let loader = null;

const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));

export const isReady = id => prepared.has(id) || !!MODELS[id]?.builder;

export async function preloadModels(ids = Object.keys(MODELS)) {
  const glb = ids.filter(id => MODELS[id]?.src && !prepared.has(id));
  for (const id of glb) {
    await loadOne(id);
    await nextFrame();             // zpracování nejvýš jednoho modelu za snímek (O-15)
  }
}

function loadOne(id) {
  if (prepared.has(id)) return Promise.resolve(prepared.get(id));
  if (loading.has(id)) return loading.get(id);
  const def = MODELS[id];
  if (!loader) loader = THREE.GLTFLoader ? new THREE.GLTFLoader() : null;
  const p = new Promise(resolve => {
    if (!loader) { console.warn('[models] chybí THREE.GLTFLoader (vendor/GLTFLoader.js)'); resolve(fallback(id)); return; }
    loader.load(def.src, gltf => {
      try { resolve(prepare(id, def, gltf)); } catch (e) { console.warn(`[models] ${id}: chyba přípravy`, e); resolve(fallback(id)); }
    }, undefined, e => { console.warn(`[models] ${id}: nepodařilo se načíst ${def.src}`, e); resolve(fallback(id)); });
  }).then(m => { prepared.set(id, m); loading.delete(id); return m; });
  loading.set(id, p);
  return p;
}

// ---------- příprava GLB ----------

const _c = new THREE.Color();

function prepare(id, def, gltf) {
  const scene = gltf.scene;
  if (def.scale) scene.scale.setScalar(def.scale);
  if (def.rotateY) scene.rotation.y = def.rotateY;
  if (def.offset) scene.position.set(...def.offset);
  scene.updateMatrixWorld(true);

  // Skupiny (registry `groups`: název → krabice [x0,x1,y0,y1,z0,z1]): trojúhelníky uvnitř krabice tvoří vlastní díly,
  // které jde ve hře zvlášť schovat nebo zkopírovat (např. druhý stojan nabíječky). '' = zbytek modelu.
  const buckets = new Map();
  const bucket = grp => {
    if (!buckets.has(grp)) buckets.set(grp, { solid: [], glow: [], textured: new Map(), clear: [] });
    return buckets.get(grp);
  };
  scene.traverse(o => {
    if (!o.isMesh) return;
    const src = o.material;
    let whole = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    whole.applyMatrix4(o.matrixWorld);
    if (!whole.attributes.normal) whole.computeVertexNormals();
    const color = srgb(src.color);
    const emissive = src.emissive ? srgb(src.emissive) : new THREE.Color(0, 0, 0);
    const lit = emissive.r + emissive.g + emissive.b > 0.05;
    for (const [grp, g] of def.groups ? splitByBoxes(whole, def.groups) : [['', whole]]) {
      const b = bucket(grp);
      if (src.map) {
        // textura (solární články, výstražné pruhy, cedule): vlastní materiál, sdílený pro stejný obrázek
        const key = src.map.image?.src || src.map.uuid;
        if (!b.textured.has(key)) b.textured.set(key, { src, geos: [] });
        b.textured.get(key).geos.push(g);
      } else if (lit) {
        b.glow.push(paint(g, emissive.r + emissive.g + emissive.b > color.r + color.g + color.b ? emissive : color.clone().add(emissive)));
      } else if (src.transparent && src.opacity < 0.99) {
        b.clear.push({ g: paint(g, color), opacity: src.opacity });
      } else {
        b.solid.push(paint(g, color));
      }
    }
  });

  const parts = [];
  const solidMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const texMats = new Map();
  for (const [group, { solid, glow, textured, clear }] of buckets) {
    if (solid.length) parts.push({ kind: 'solid', group, geometry: merge(solid), material: solidMat });
    if (glow.length) parts.push({ kind: 'glow', group, geometry: merge(glow), material: glowMat });
    for (const [key, { src, geos }] of textured) {
      const lit = src.emissive && src.emissive.r + src.emissive.g + src.emissive.b > 0.05;
      if (!texMats.has(key)) {
        const map = src.map;
        map.encoding = THREE.LinearEncoding;            // renderer hry je lineární → textura se nedekóduje (vypadá jako v náhledu)
        texMats.set(key, lit
          ? new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide, transparent: src.transparent, alphaTest: src.alphaTest || 0 })
          : new THREE.MeshLambertMaterial({ map, color: srgb(src.color), side: THREE.DoubleSide, transparent: src.transparent, alphaTest: src.alphaTest || 0 }));
      }
      parts.push({ kind: lit ? 'glow' : 'textured', group, geometry: merge(geos.map(g => { g.deleteAttribute('color'); return g; })), material: texMats.get(key) });
    }
    for (const { g, opacity } of clear) {
      parts.push({ kind: 'clear', group, geometry: merge([g]), material: new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }) });
    }
  }

  const box = new THREE.Box3();
  for (const p of parts) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox); p.geometry.computeBoundingSphere(); }
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const ud = scene.userData || {};
  const anchors = (def.anchors || ud.kotevni_body || []).map(a => new THREE.Vector3(...a));
  // efekty, které hra nahrazuje vlastními (např. kontrolky stojanů nabíječky – barva podle stavu)
  const hide = def.hideEffects || [];
  let list = (ud.efekty || []).filter(e => !hide.some(h => e.pozice && Math.hypot(e.pozice[0] - h[0], e.pozice[1] - h[1], e.pozice[2] - h[2]) < 0.35));
  // paprsky mířící k zemi prodloužit (model se ve hře zvedá výš, např. kotva vedení)
  if (def.stretchBeams) list = list.map(e => (e.typ === 'paprsek' && e.do && e.do[1] <= 0.01 ? { ...e, do: [e.do[0], e.do[1] - def.stretchBeams, e.do[2]], polomer_do: e.polomer_do * 1.6 } : e));
  const effects = buildEffects(list, def);
  return { id, parts, anchors, points: def.points || {}, size, center, effects, triangles: parts.reduce((n, p) => n + p.geometry.attributes.position.count / 3, 0) };
}

// Rozdělí neindexovanou geometrii podle krabic: [[skupina, geometrie], …] (trojúhelník patří krabici, ve které je jeho těžiště).
function splitByBoxes(g, groups) {
  const pos = g.attributes.position;
  const names = Object.keys(groups);
  const tri = pos.count / 3;
  const which = new Int16Array(tri).fill(-1);
  for (let t = 0; t < tri; t++) {
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 3; k++) { x += pos.getX(t * 3 + k); y += pos.getY(t * 3 + k); z += pos.getZ(t * 3 + k); }
    x /= 3; y /= 3; z /= 3;
    for (let n = 0; n < names.length; n++) {
      const b = groups[names[n]];
      if (x >= b[0] && x <= b[1] && y >= b[2] && y <= b[3] && z >= b[4] && z <= b[5]) { which[t] = n; break; }
    }
  }
  const out = [];
  for (let n = -1; n < names.length; n++) {
    const tris = [];
    for (let t = 0; t < tri; t++) if (which[t] === n) tris.push(t);
    if (!tris.length) continue;
    if (tris.length === tri) return [[n < 0 ? '' : names[n], g]];
    const sub = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(g.attributes)) {
      const item = attr.itemSize;
      const arr = new Float32Array(tris.length * 3 * item);
      tris.forEach((t, i) => { for (let k = 0; k < 3; k++) for (let c = 0; c < item; c++) arr[(i * 3 + k) * item + c] = component(attr, t * 3 + k, c); });
      sub.setAttribute(name, new THREE.BufferAttribute(arr, item));
    }
    out.push([n < 0 ? '' : names[n], sub]);
  }
  return out;
}

function srgb(c) {
  return c ? _c.copy(c).convertLinearToSRGB().clone() : new THREE.Color(1, 1, 1);
}

// Barva dílu do vrcholů (díky tomu jde celý model jedním materiálem).
function paint(g, color) {
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = color.r; col[i * 3 + 1] = color.g; col[i * 3 + 2] = color.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// Vlastní slučování geometrií (three r128 z CDN nemá BufferGeometryUtils): neindexované, atributy position/normal/color/uv.
export function merge(geos) {
  const names = ['position', 'normal', 'color', 'uv'].filter(a => geos.every(g => g.attributes[a]));
  const out = new THREE.BufferGeometry();
  for (const a of names) {
    const item = geos[0].attributes[a].itemSize;
    const total = geos.reduce((n, g) => n + g.attributes[a].count, 0);
    const arr = new Float32Array(total * item);
    let off = 0;
    for (const g of geos) {
      const src = g.attributes[a];
      for (let i = 0; i < src.count; i++) for (let k = 0; k < item; k++) arr[off + i * item + k] = component(src, i, k);
      off += src.count * item;
    }
    out.setAttribute(a, new THREE.BufferAttribute(arr, item));
  }
  return out;
}

// Složka vrcholu i (funguje i pro prokládané a normalizované/kvantizované atributy).
const GET = ['getX', 'getY', 'getZ', 'getW'];
function component(attr, i, k) {
  const v = attr[GET[k]](i);
  if (!attr.normalized) return v;
  const arr = attr.array || attr.data?.array;
  if (arr instanceof Int8Array) return Math.max(v / 127, -1);
  if (arr instanceof Uint8Array) return v / 255;
  if (arr instanceof Int16Array) return Math.max(v / 32767, -1);
  if (arr instanceof Uint16Array) return v / 65535;
  return v;
}

// Při selhání načtení: krabice ve velikosti 2 × 2 × 2 m, hra nespadne (A-04).
function fallback(id) {
  const geometry = new THREE.BoxGeometry(2, 2, 2).translate(0, 1, 0);
  return {
    id, parts: [{ kind: 'solid', geometry, material: new THREE.MeshLambertMaterial({ color: 0xff00ff }) }],
    anchors: [new THREE.Vector3(0, 2, 0)], points: MODELS[id]?.points || {}, size: new THREE.Vector3(2, 2, 2), center: new THREE.Vector3(0, 1, 0),
    effects: null, triangles: 12, failed: true,
  };
}

// ---------- instance ----------

export function instantiate(id, ...args) {
  const def = MODELS[id];
  if (!def) throw new Error(`[models] neznámý model: ${id}`);
  if (def.builder) {
    const view = def.builder(...args);
    view.root.userData.model = id;
    return view;
  }
  let m = prepared.get(id);
  if (!m) { console.warn(`[models] ${id} není načtený (preloadModels), dočasně krabice`); loadOne(id); m = fallback(id); }
  const root = new THREE.Group();
  root.userData.model = id;
  const groups = {};
  for (const p of m.parts) {
    const mesh = new THREE.Mesh(p.geometry, p.material);
    mesh.userData.part = p.kind;
    if (p.group) { mesh.userData.group = p.group; (groups[p.group] ||= []).push(mesh); }
    if (p.kind === 'glow' || p.kind === 'clear') mesh.userData.noShadow = true;
    root.add(mesh);
  }
  if (m.effects) root.add(m.effects.clone());
  return {
    root, id, groups,
    anchors: m.anchors.map(a => a.clone()),
    points: m.points,
    size: m.size.clone(),
    center: m.center.clone(),
    effects: root.children.find(c => c.userData.effects) || null,
    failed: !!m.failed,
  };
}

// Díly jedné skupiny modelu (sdílené geometrie) – kopie se z nich staví v kódu (moduly nabíječky…).
export function groupParts(id, group) {
  return prepared.get(id)?.parts.filter(p => p.group === group) || [];
}

// Pro InstancedMesh: [{ geometry, material, kind }] (sdílené, neměnit).
export function geometryFor(id) {
  const m = prepared.get(id);
  return m ? m.parts : null;
}

// Přehled pro inventuru / ladění (A-05): počty trojúhelníků a vykreslení po sloučení.
export function modelInfo(id) {
  const m = prepared.get(id);
  return m && { id, triangles: m.triangles, draws: m.parts.length + (m.effects ? m.effects.children.length : 0), size: m.size.toArray().map(v => +v.toFixed(2)), anchors: m.anchors.length, failed: !!m.failed };
}
