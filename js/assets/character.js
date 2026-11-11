// Převod postavy z GLB na „tuhou kostru + paletu“ (O-20, 3.1). Jednou při načtení:
//  1. kloubové uzly modelu (panev, trup, hlava, paze_*, predlokti_*, ruka_*, tryska_*, stehno_*, holen_*) → kosti
//     se stejnými názvy (klipy chuze / klid na ně míří podle názvu a fungují beze změny),
//  2. všechny díly → jedna geometrie pro SkinnedMesh, každý vrchol patří 100 % kosti svého dílu,
//  3. místo 19 materiálů má každý vrchol atribut `slot` (číslo materiálu) – barvu a záři bere shader z palety
//     (vzhled hráče = jiná paleta, jeden materiál na hráče se sdíleným shaderem),
//  4. skrývání dílů (číro, fousky, anténa) = jiný index geometrie (sdílené atributy), takže i stín sedí.
// Výsledek: astronaut = 1 vykreslení (+ nástroj, rekvizita) místo 41.

const THREE = window.THREE;

// Pořadí materiálů = číslo slotu v paletě (nezávislé na pořadí v souboru).
export const SLOT_NAMES = ['lem', 'doplnek', 'svetlo', 'oblek', 'panel-cerveny', 'oblek-stin', 'jetpack', 'jetpack-kov', 'antena-svetlo',
  'helma', 'stit', 'fousky', 'cumak', 'cyro-2', 'cyro-3', 'cyro-4', 'cyro-5', 'cyro-6', 'podrazka'];
export const SLOT = Object.fromEntries(SLOT_NAMES.map((n, i) => [n, i]));
export const SLOT_COUNT = SLOT_NAMES.length;

// Kosti v pořadí podle hierarchie modelu (rodič vždy před dětmi).
export const JOINTS = ['panev', 'trup', 'hlava', 'tryska_L', 'tryska_P', 'paze_L', 'predlokti_L', 'ruka_L', 'paze_P', 'predlokti_P', 'ruka_P',
  'stehno_L', 'holen_L', 'stehno_P', 'holen_P'];

const srgb = c => (c ? c.clone().convertLinearToSRGB() : new THREE.Color(1, 1, 1));   // renderer hry je lineární (jako models.js)

export function prepareCharacter(gltf, extraClips = null) {
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const byName = new Map();
  scene.traverse(o => { if (JOINTS.includes(o.name) && !byName.has(o.name)) byName.set(o.name, o); });
  const missing = JOINTS.filter(n => !byName.has(n));
  if (missing.length) throw new Error(`v modelu chybí uzly ${missing.join(', ')}`);

  // kosti: místní poloha a natočení každého kloubu (rodič = nejbližší kloubový předek)
  const jointOf = o => { for (let p = o; p; p = p.parent) if (JOINTS.includes(p.name)) return p.name; return null; };
  const bones = JOINTS.map(name => {
    const o = byName.get(name);
    const parentName = jointOf(o.parent);
    return { name, parent: parentName ? JOINTS.indexOf(parentName) : -1, p: o.position.toArray(), q: o.quaternion.toArray(), world: o.getWorldPosition(new THREE.Vector3()).toArray() };
  });

  // paleta modelu (výchozí oblečení)
  const base = SLOT_NAMES.map(() => new THREE.Color(1, 1, 1)), emis = SLOT_NAMES.map(() => new THREE.Color(0, 0, 0));
  const pos = [], nor = [], idx = [], slot = [];
  scene.traverse(o => {
    if (!o.isMesh) return;
    const joint = jointOf(o);
    const s = SLOT[o.material?.name];
    if (joint == null || s == null) { console.warn('[character] díl mimo kloub nebo neznámý materiál', o.name, o.material?.name); return; }
    base[s] = srgb(o.material.color);
    emis[s] = o.material.emissive ? srgb(o.material.emissive) : new THREE.Color(0, 0, 0);
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);                       // klidová póza ve světě = vazba kostí (bind pose)
    if (!g.attributes.normal) g.computeVertexNormals();
    const bi = JOINTS.indexOf(joint);
    const P = g.attributes.position, N = g.attributes.normal;
    for (let i = 0; i < P.count; i++) {
      pos.push(P.getX(i), P.getY(i), P.getZ(i));
      nor.push(N.getX(i), N.getY(i), N.getZ(i));
      idx.push(bi);
      slot.push(s);
    }
  });
  const n = pos.length / 3;
  const skinIndex = new Uint16Array(n * 4), skinWeight = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { skinIndex[i * 4] = idx[i]; skinWeight[i * 4] = 1; }
  const attrs = {
    position: new THREE.BufferAttribute(new Float32Array(pos), 3),
    normal: new THREE.BufferAttribute(new Float32Array(nor), 3),
    skinIndex: new THREE.BufferAttribute(skinIndex, 4),
    skinWeight: new THREE.BufferAttribute(skinWeight, 4),
    slot: new THREE.BufferAttribute(new Float32Array(slot), 1),
  };
  const slotOfTri = new Uint8Array(n / 3);
  for (let t = 0; t < n / 3; t++) slotOfTri[t] = slot[t * 3];

  // Geometrie podle masky skrytých slotů (bit = slot) – sdílené atributy, jen jiný index. Cache.
  const variants = new Map();
  function geometryFor(mask = 0) {
    if (variants.has(mask)) return variants.get(mask);
    const g = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(attrs)) g.setAttribute(k, a);
    const keep = [];
    for (let t = 0; t < slotOfTri.length; t++) if (!(mask & (1 << slotOfTri[t]))) keep.push(t * 3, t * 3 + 1, t * 3 + 2);
    g.setIndex(keep);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    variants.set(mask, g);
    return g;
  }

  // Jen hlava (bez kostry) – náhledy rekvizit v šatně.
  function headGeometry(mask = 0) {
    const hi = JOINTS.indexOf('hlava');
    const keep = [];
    for (let t = 0; t < slotOfTri.length; t++) if (idx[t * 3] === hi && !(mask & (1 << slotOfTri[t]))) keep.push(t);
    const g = new THREE.BufferGeometry();
    const sel = (a, item) => { const out = new Float32Array(keep.length * 3 * item); keep.forEach((t, j) => { for (let k = 0; k < 3 * item; k++) out[j * 3 * item + k] = a.array[t * 3 * item + k]; }); return new THREE.BufferAttribute(out, item); };
    g.setAttribute('position', sel(attrs.position, 3));
    g.setAttribute('normal', sel(attrs.normal, 3));
    g.setAttribute('slot', sel(attrs.slot, 1));
    const hw = bones[hi].world;
    g.translate(-hw[0], -hw[1], -hw[2]);                 // počátek = kloub hlavy (jako kost)
    return g;
  }

  const clips = [...(gltf.animations || []), ...(extraClips ? clipsFromJson(extraClips, bones) : [])];
  const meta = Object.fromEntries((extraClips?.klipy || []).map(k => [k.nazev, { krok: k.krok, vrstva: k.vrstva || 'cele', smycka: k.smycka !== false }]));
  return {
    bones, clips, clipMeta: meta, base, emis, geometryFor, headGeometry, triangles: n / 3,
    joint: name => bones[JOINTS.indexOf(name)],
  };
}

// Klipy z assets/anim/astronaut-klipy.json (A-12): rotace = Euler XYZ ve stupních vůči klidové póze kosti,
// posun (jen panev) = metry ke klidové poloze. Výsledek = THREE.AnimationClip se stopami <kost>.quaternion / .position.
export function clipsFromJson(json, bones) {
  const D = Math.PI / 180;
  const byName = Object.fromEntries(bones.map(b => [b.name, b]));
  const q = new THREE.Quaternion(), e = new THREE.Euler(), rest = new THREE.Quaternion();
  const out = [];
  for (const k of json?.klipy || []) {
    const tracks = [];
    for (const st of k.stopy || []) {
      const b = byName[st.uzel];
      if (!b || !Array.isArray(st.casy) || st.casy.length !== st.hodnoty?.length) { console.warn('[klipy] špatná stopa', k.nazev, st.uzel); continue; }
      if (st.typ === 'posun') {
        const v = st.hodnoty.flatMap(h => [b.p[0] + h[0], b.p[1] + h[1], b.p[2] + h[2]]);
        tracks.push(new THREE.VectorKeyframeTrack(`${b.name}.position`, st.casy, v));
      } else {
        rest.fromArray(b.q);
        const v = st.hodnoty.flatMap(h => q.setFromEuler(e.set(h[0] * D, h[1] * D, h[2] * D)).premultiply(rest).toArray());
        tracks.push(new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, st.casy, v));
      }
    }
    out.push(new THREE.AnimationClip(k.nazev, k.delka, tracks));
  }
  return out;
}

// Materiál s paletou: Lambert, barva a záře podle atributu slot z uniformů palette / emis (O-20).
// skinned = false pro náhled hlavy (bez kostry). Vrací { material, palette, emissive } (pole THREE.Color k přepsání).
export function paletteMaterial(skinned = true) {
  const palette = SLOT_NAMES.map(() => new THREE.Color(1, 1, 1));
  const emissive = SLOT_NAMES.map(() => new THREE.Color(0, 0, 0));
  const material = new THREE.MeshLambertMaterial({ skinning: skinned });
  material.onBeforeCompile = sh => {
    sh.uniforms.palette = { value: palette };
    sh.uniforms.emis = { value: emissive };
    sh.vertexShader = 'attribute float slot;\nuniform vec3 palette[19];\nuniform vec3 emis[19];\nvarying vec3 vPal;\nvarying vec3 vEmi;\n'
      + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  int si = int(slot + 0.5);\n  vPal = palette[si];\n  vEmi = emis[si];');
    sh.fragmentShader = 'varying vec3 vPal;\nvarying vec3 vEmi;\n'
      + sh.fragmentShader
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( vPal, opacity );')
        .replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = vEmi;');
  };
  material.customProgramCacheKey = () => (skinned ? 'astro-palette-skin' : 'astro-palette');
  return { material, palette, emissive };
}
