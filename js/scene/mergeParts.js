// Slučování dílů modelu v kódu do méně vykreslení (O-13, O-02).
// Díly visící na stejném kloubu se spojí do jedné geometrie s barvou a emisí ve vrcholech a sdíleným materiálem
// (MeshLambertMaterial + atribut emissiveColor). Klouby (skupiny) zůstávají, takže animace i ragdoll fungují beze změny.
// Barvy se dají přepočítat (šatna mění barvu skafandru): refresh() znovu přečte barvy z původních materiálů.
const THREE = window.THREE;

let shared = null;
// Sdílený materiál: Lambert s barvou ve vrcholech + emise ve vrcholech (Lambert v r128 počítá světlo ve vertex shaderu).
export function vertexColorMaterial() {
  if (shared) return shared;
  shared = new THREE.MeshLambertMaterial({ vertexColors: true });
  shared.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 emissiveColor;\nvarying vec3 vEmissiveColor;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEmissiveColor = emissiveColor;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vEmissiveColor;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vEmissiveColor;');
  };
  shared.customProgramCacheKey = () => 'ms-vertex-emissive';
  return shared;
}

// Lze díl sloučit? (jen neprůhledný Lambert; hledí (Phong), stín a průhledné díly zůstávají samostatně)
const mergeable = m => m.isMesh && !m.userData.blob && !m.userData.keep && m.material?.isMeshLambertMaterial && !m.material.transparent && !m.material.map;

// joints: skupiny, které se animují. Každý díl patří nejbližšímu předkovi ze seznamu.
// Vrací { refresh(), count } – refresh() přepočítá barvy vrcholů z původních materiálů (po změně barvy).
export function mergeJoints(joints, root = joints[0]) {
  const set = new Set(joints);
  const owner = new Map();                        // díl → kloub
  root.updateMatrixWorld(true);
  for (const j of joints) {
    j.traverse(o => {
      if (o === j || !mergeable(o)) return;
      let p = o.parent;
      while (p && !set.has(p)) p = p.parent;
      if (p === j) owner.set(o, j);
    });
  }
  const groups = new Map();
  for (const [m, j] of owner) { if (!groups.has(j)) groups.set(j, []); groups.get(j).push(m); }
  const merged = [];
  for (const [j, meshes] of groups) merged.push(bake(j, meshes));
  return {
    count: merged.length,
    refresh() { for (const m of merged) m.refresh(); },
  };
}

// Celý objekt (např. statická rekvizita) do jednoho dílu. Vrací { refresh }.
export function mergeObject(obj) {
  obj.updateMatrixWorld(true);
  const meshes = [];
  obj.traverse(o => { if (o !== obj && mergeable(o)) meshes.push(o); });
  return meshes.length > 1 ? bake(obj, meshes) : { refresh() {} };
}

// Snímek celého modelu v aktuální póze do 1 dílu (+ samostatné díly s jiným materiálem, např. hledí) – pro vzdálené LOD.
// filter(o) rozhoduje, které díly vzít (např. bez nástroje). Vrací Group v souřadnicích `root`.
export function snapshot(root, filter = () => true) {
  root.updateMatrixWorld(true);
  _inv.copy(root.matrixWorld).invert();
  const lit = [], others = new Map();
  root.traverse(o => {
    if (!o.isMesh || !filter(o) || o.userData.blob || o.material?.transparent) return;
    let p = o, shown = true;
    while (p && p !== root) { if (!p.visible) { shown = false; break; } p = p.parent; }
    if (!shown) return;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(_m.multiplyMatrices(_inv, o.matrixWorld));
    if (o.material === shared || o.material?.isMeshLambertMaterial) {
      const n = g.attributes.position.count;
      if (!g.attributes.color || !g.attributes.emissiveColor) {
        const c = o.material.color, e = o.material.emissive || { r: 0, g: 0, b: 0 };
        const col = new Float32Array(n * 3), emi = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { col.set([c.r, c.g, c.b], i * 3); emi.set([e.r, e.g, e.b], i * 3); }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        g.setAttribute('emissiveColor', new THREE.BufferAttribute(emi, 3));
      }
      lit.push(g);
    } else {
      if (!others.has(o.material)) others.set(o.material, []);
      others.get(o.material).push(g);
    }
  });
  const group = new THREE.Group();
  const join = (geos, names) => {
    const out = new THREE.BufferGeometry();
    for (const a of names) {
      const item = geos[0].attributes[a].itemSize;
      const arr = new Float32Array(geos.reduce((n, g) => n + g.attributes[a].count, 0) * item);
      let off = 0;
      for (const g of geos) { arr.set(g.attributes[a].array, off); off += g.attributes[a].array.length; g.dispose(); }
      out.setAttribute(a, new THREE.BufferAttribute(arr, item));
    }
    out.computeBoundingSphere();
    return out;
  };
  if (lit.length) group.add(new THREE.Mesh(join(lit, ['position', 'normal', 'color', 'emissiveColor']), vertexColorMaterial()));
  for (const [mat, geos] of others) group.add(new THREE.Mesh(join(geos, ['position', 'normal']), mat));
  return group;
}

const _inv = new THREE.Matrix4(), _m = new THREE.Matrix4();

function bake(joint, meshes) {
  _inv.copy(joint.matrixWorld).invert();
  const geos = [], ranges = [];
  let count = 0;
  for (const m of meshes) {
    let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    g.applyMatrix4(_m.multiplyMatrices(_inv, m.matrixWorld));
    const n = g.attributes.position.count;
    ranges.push({ mat: m.material, start: count, n });
    count += n;
    geos.push(g);
  }
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3);
  let off = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, off);
    nor.set(g.attributes.normal.array, off);
    off += g.attributes.position.count * 3;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  const col = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
  const emi = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
  geo.setAttribute('color', col);
  geo.setAttribute('emissiveColor', emi);
  geo.computeBoundingSphere();

  // odebrat původní díly (jejich děti, které se neslučovaly, se přesunou na kloub)
  for (const m of meshes) {
    for (const c of [...m.children]) if (!meshes.includes(c)) { joint.attach(c); }
    m.parent.remove(m);
  }
  const mesh = new THREE.Mesh(geo, vertexColorMaterial());
  mesh.userData.merged = true;
  joint.add(mesh);

  function refresh() {
    for (const r of ranges) {
      const c = r.mat.color, e = r.mat.emissive || { r: 0, g: 0, b: 0 };
      for (let i = r.start; i < r.start + r.n; i++) {
        col.setXYZ(i, c.r, c.g, c.b);
        emi.setXYZ(i, e.r, e.g, e.b);
      }
    }
    col.needsUpdate = emi.needsUpdate = true;
  }
  refresh();
  return { mesh, refresh };
}
