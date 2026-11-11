// Jediný vstup k modelům pro zbytek hry (A-02, A-04):
//   await preloadModels(ids)  – stáhne a připraví GLB (po jednom za snímek, ať se hra nezasekne)
//   instantiate(id, …args)    – nová instance: { root, anchors, points, nodes, empties, extras, size, effects, … } (builder vrací svůj view objekt)
//   geometryFor(id)           – sloučené geometrie + materiály pro InstancedMesh (O-03)
//   isReady(id)
// Příprava GLB: materiály → MeshLambertMaterial (barvy převedené do sRGB, renderer hry je lineární),
// díly se sloučí podle druhu: 1 pevný (barvy do vrcholů), 1 svítící (MeshBasic), textury zvlášť → 2–5 vykreslení místo 7–36.
// Záře a paprsky (userData.efekty) jsou jedna geometrie s billboard shaderem na model (1–2 vykreslení navíc).
import { MODELS } from './registry.js';
import { buildEffects } from './effects.js';
import { prepareCharacter } from './character.js';

const THREE = window.THREE;
const prepared = new Map();        // id → { parts: [{ geometry, material, kind }], anchors, size, center, effects }
const loading = new Map();         // id → Promise
let loader = null;

const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));

export const isReady = id => prepared.has(id) || (!!MODELS[id]?.builder && !MODELS[id]?.character);

// Postava z GLB převedená na kostru + paletu (character.js, 3.1) – null, když se ještě nenačetla nebo selhala.
export const characterData = id => prepared.get(id)?.character || null;

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
    loader.load(def.src, async gltf => {
      // postava: k modelu i klipy animací z JSON (A-12); když se nenačtou, zůstanou klipy z modelu
      let extra = null;
      if (def.character && def.clips) {
        try { extra = await (await fetch(def.clips, { cache: 'no-cache' })).json(); } catch (e) { console.warn(`[models] ${id}: klipy ${def.clips} se nenačetly`, e); }
      }
      try { resolve(def.character ? { id, character: prepareCharacter(gltf, extra) } : prepare(id, def, gltf)); } catch (e) { console.warn(`[models] ${id}: chyba přípravy`, e); resolve(fallback(id)); }
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
  // Pohyblivé uzly (registry `nodes`, 3.1): díly pod uzlem se nesloučí s trupem, dostanou vlastní skupinu 'node:<jméno>'
  // a otočný bod v poloze uzlu (instantiate → inst.nodes[jméno] = Group, kterou jde otáčet / posouvat).
  // Vnořené uzly (ruka Kondoru: rameno → předloktí → kleště) se zavěsí pod rodičovský uzel (pivotParents).
  const pivots = {}, pivotParents = {};
  const nodeOf = o => { for (let x = o; x && x !== scene; x = x.parent) if (def.nodes?.includes(x.name)) return x; return null; };
  if (def.nodes) scene.traverse(o => {
    if (!def.nodes.includes(o.name)) return;
    pivots[o.name] = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
    const up = o.parent ? nodeOf(o.parent) : null;
    if (up) pivotParents[o.name] = up.name;
  });
  scene.traverse(o => {
    if (!o.isMesh) return;
    const src = o.material;
    const node = def.nodes ? nodeOf(o) : null;
    let whole = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    whole.applyMatrix4(o.matrixWorld);
    if (!whole.attributes.normal) whole.computeVertexNormals();
    const color = srgb(src.color);
    const emissive = src.emissive ? srgb(src.emissive) : new THREE.Color(0, 0, 0);
    const lit = emissive.r + emissive.g + emissive.b > 0.05;
    for (const [grp, g] of node ? [[`node:${node.name}`, whole]] : def.groups ? splitByBoxes(whole, def.groups) : [['', whole]]) {
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
  // paprsek zadaný uzlem (skener Kolibříku, A-11) kreslí hra sama – efekty umí jen paprsek od–do
  let list = (ud.efekty || []).filter(e => e.typ !== 'paprsek' || (Array.isArray(e.od) && Array.isArray(e.do))).filter(e => !hide.some(h => e.pozice && Math.hypot(e.pozice[0] - h[0], e.pozice[1] - h[1], e.pozice[2] - h[2]) < 0.35));
  // paprsky mířící k zemi prodloužit (model se ve hře zvedá výš, např. kotva vedení)
  if (def.stretchBeams) list = list.map(e => (e.typ === 'paprsek' && e.do && e.do[1] <= 0.01 ? { ...e, do: [e.do[0], e.do[1] - def.stretchBeams, e.do[2]], polomer_do: e.polomer_do * 1.6 } : e));
  const effects = buildEffects(list, def);
  // Prázdné uzly modelu (sedadlo, baterie, závěs… u vozidel z GLB): název → { p, q } v souřadnicích modelu.
  // extras = userData kořenového uzlu (vozidla tam mají radius, poloměr kol…), jinak scény.
  const empties = {};
  scene.traverse(o => {
    if (o === scene || o.isMesh || !o.name || o.children.length) return;
    empties[o.name] = { p: new THREE.Vector3().setFromMatrixPosition(o.matrixWorld), q: o.getWorldQuaternion(new THREE.Quaternion()) };
  });
  const rootUd = scene.children.length === 1 ? scene.children[0].userData : null;
  const extras = rootUd && Object.keys(rootUd).length ? rootUd : ud;
  return { id, parts, anchors, points: def.points || {}, pivots, pivotParents, empties, extras, size, center, effects, triangles: parts.reduce((n, p) => n + p.geometry.attributes.position.count / 3, 0) };
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
  if (def.builder) {                 // model v kódu, nebo postava z GLB (character: builder si data vezme přes characterData)
    const view = def.builder(...args);
    view.root.userData.model = id;
    return view;
  }
  let m = prepared.get(id);
  if (!m) { console.warn(`[models] ${id} není načtený (preloadModels), dočasně krabice`); loadOne(id); m = fallback(id); }
  const root = new THREE.Group();
  root.userData.model = id;
  const groups = {}, nodes = {};
  for (const p of m.parts) {
    const mesh = new THREE.Mesh(p.geometry, p.material);
    mesh.userData.part = p.kind;
    if (p.group) { mesh.userData.group = p.group; (groups[p.group] ||= []).push(mesh); }
    if (p.kind === 'glow' || p.kind === 'clear') mesh.userData.noShadow = true;
    const nodeName = p.group?.startsWith('node:') ? p.group.slice(5) : null;
    if (nodeName && m.pivots?.[nodeName]) {                    // pohyblivý uzel: otočný bod v poloze uzlu
      mesh.position.copy(m.pivots[nodeName]).negate();
      pivotOf(nodeName).add(mesh);
    } else root.add(mesh);
  }
  // pivoty bez vlastních dílů (kvůli rodičovství) a zavěšení pod rodiče: poloha = rozdíl poloh uzlů
  function pivotOf(name) {
    if (nodes[name]) return nodes[name];
    const g = nodes[name] = new THREE.Group();
    const par = m.pivotParents?.[name];
    if (par && m.pivots[par]) { g.position.copy(m.pivots[name]).sub(m.pivots[par]); pivotOf(par).add(g); }
    else { g.position.copy(m.pivots[name]); root.add(g); }
    g.userData.rest = g.position.clone();
    return g;
  }
  for (const name of Object.keys(m.pivots || {})) pivotOf(name);
  if (m.effects) root.add(m.effects.clone());
  return {
    root, id, groups, nodes,
    anchors: m.anchors.map(a => a.clone()),
    points: m.points,
    empties: m.empties || {},          // sdílené, jen pro čtení
    extras: m.extras || {},
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
