// Záře a paprsky z GLB (gltf.scene.userData.efekty). Nejsou to geometrie modelu, hra je kreslí sama:
//   zare    { pozice, velikost, barva, pruhlednost } → aditivní billboard (všechny záře modelu = 1 vykreslení)
//   paprsek { od, do, polomer_od, polomer_do, barva, pruhlednost } → aditivní kužel, slábne ke konci (všechny = 1 vykreslení)
// Barvy jsou sRGB 0–1 (renderer hry je lineární, takže se použijí přímo).
const THREE = window.THREE;

let glowMat = null, beamMat = null;

function materials() {
  if (glowMat) return;
  glowMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute vec2 corner; attribute float size; attribute vec4 tint;
      varying vec2 vC; varying vec4 vT;
      void main() {
        vC = corner; vT = tint;
        #ifdef USE_INSTANCING
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);   // instancované stavby (O-03)
        #else
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        #endif
        mv.xy += corner * size * 0.5;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec2 vC; varying vec4 vT;
      void main() {
        float d = length(vC);
        if (d > 1.0) discard;
        float a = pow(1.0 - d, 1.6);
        gl_FragColor = vec4(vT.rgb * a * vT.a, 1.0);
      }`,
  });
  beamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `
      attribute vec4 tint; attribute float along;
      varying vec4 vT; varying float vA;
      void main() {
        vT = tint; vA = along;
        #ifdef USE_INSTANCING
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        #else
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #endif
      }`,
    fragmentShader: `
      varying vec4 vT; varying float vA;
      void main() { gl_FragColor = vec4(vT.rgb * vT.a * (1.0 - vA * 0.85), 1.0); }`,
  });
}

export function buildEffects(list, def = {}) {
  if (!list || !list.length) return null;
  materials();
  const glows = list.filter(e => e.typ === 'zare');
  const beams = list.filter(e => e.typ === 'paprsek');
  const group = new THREE.Group();
  group.userData.effects = true;
  if (glows.length) group.add(glowMesh(glows));
  if (beams.length) group.add(beamMesh(beams));
  group.children.forEach(m => { m.renderOrder = 5; m.frustumCulled = true; });
  return group;
}

function glowMesh(list) {
  const n = list.length;
  const pos = new Float32Array(n * 12), corner = new Float32Array(n * 8), size = new Float32Array(n * 4), tint = new Float32Array(n * 16);
  const idx = [];
  const C = [-1, -1, 1, -1, 1, 1, -1, 1];
  list.forEach((e, i) => {
    for (let k = 0; k < 4; k++) {
      pos.set(e.pozice, (i * 4 + k) * 3);
      corner[(i * 4 + k) * 2] = C[k * 2]; corner[(i * 4 + k) * 2 + 1] = C[k * 2 + 1];
      size[i * 4 + k] = e.velikost;
      tint.set([...e.barva, e.pruhlednost], (i * 4 + k) * 4);
    }
    const b = i * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('corner', new THREE.BufferAttribute(corner, 2));
  g.setAttribute('size', new THREE.BufferAttribute(size, 1));
  g.setAttribute('tint', new THREE.BufferAttribute(tint, 4));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.boundingSphere.radius += Math.max(...list.map(e => e.velikost));
  const m = new THREE.Mesh(g, glowMat);
  m.userData.part = 'effect-glow';
  return m;
}

const SEG = 10;
function beamMesh(list) {
  const pos = [], tint = [], along = [], idx = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), dir = new THREE.Vector3(), u = new THREE.Vector3(), v = new THREE.Vector3(), p = new THREE.Vector3();
  for (const e of list) {
    a.set(...e.od); b.set(...e.do);
    dir.subVectors(b, a).normalize();
    u.set(Math.abs(dir.y) < 0.9 ? 0 : 1, Math.abs(dir.y) < 0.9 ? 1 : 0, 0).cross(dir).normalize();
    v.crossVectors(dir, u);
    const base = pos.length / 3;
    for (let end = 0; end < 2; end++) {
      const c = end ? b : a, r = end ? e.polomer_do : e.polomer_od;
      for (let s = 0; s < SEG; s++) {
        const t = s / SEG * Math.PI * 2;
        p.copy(c).addScaledVector(u, Math.cos(t) * r).addScaledVector(v, Math.sin(t) * r);
        pos.push(p.x, p.y, p.z);
        tint.push(...e.barva, e.pruhlednost);
        along.push(end);
      }
    }
    for (let s = 0; s < SEG; s++) {
      const s1 = (s + 1) % SEG;
      idx.push(base + s, base + s1, base + SEG + s1, base + s, base + SEG + s1, base + SEG + s);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('tint', new THREE.Float32BufferAttribute(tint, 4));
  g.setAttribute('along', new THREE.Float32BufferAttribute(along, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, beamMat);
  m.userData.part = 'effect-beam';
  return m;
}
