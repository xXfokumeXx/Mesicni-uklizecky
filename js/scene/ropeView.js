// Lano Muly ve scéně (3.1, D-17, O-24): trubice 6 cm přes body lana (12 bodů × 6 stran), přepočet vrcholů každý
// snímek bez nové alokace; na konci žlutý hák. Vlastní lano = body simulace (carry.js), lana ostatních hráčů =
// prověšená křivka mezi hákem a střechou neseného vozidla (O-26: lano se po síti neposílá).
const THREE = window.THREE;
const SIDES = 6, MAX_PTS = 16, RAD = 0.06, MAX_ROPES = 4;

function makeRope(scene) {
  const pos = new Float32Array(MAX_PTS * SIDES * 3);
  const idx = [];
  for (let k = 0; k < MAX_PTS - 1; k++) for (let s = 0; s < SIDES; s++) {
    const a = k * SIDES + s, b = k * SIDES + (s + 1) % SIDES, c = a + SIDES, d = b + SIDES;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x2b2b2e, side: THREE.DoubleSide }));
  mesh.frustumCulled = false;
  mesh.visible = false;
  const hook = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.45, 0.35), new THREE.MeshLambertMaterial({ color: 0xf0c020 }));
  hook.visible = false;
  scene.add(mesh, hook);
  return { mesh, hook, pos, g };
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _t = new THREE.Vector3(), _n = new THREE.Vector3(), _m = new THREE.Vector3();
function fill(rope, pts, taut) {
  const n = Math.min(MAX_PTS, pts.length);
  const P = rope.pos;
  for (let k = 0; k < MAX_PTS; k++) {
    const p = pts[Math.min(k, n - 1)];
    const q = pts[Math.min(n - 1, Math.max(1, k + 1))], o = pts[Math.max(0, Math.min(k, n - 2))];
    _t.set(q[0] - o[0], q[1] - o[1], q[2] - o[2]).normalize();
    _n.set(p[0], p[1], p[2]).normalize().cross(_t);
    if (_n.lengthSq() < 1e-8) _n.set(1, 0, 0);
    _n.normalize();
    _m.crossVectors(_t, _n);
    for (let s = 0; s < SIDES; s++) {
      const ang = s / SIDES * Math.PI * 2, c = Math.cos(ang) * RAD, si = Math.sin(ang) * RAD;
      const i = (k * SIDES + s) * 3;
      P[i] = p[0] + _n.x * c + _m.x * si;
      P[i + 1] = p[1] + _n.y * c + _m.y * si;
      P[i + 2] = p[2] + _n.z * c + _m.z * si;
    }
  }
  rope.g.attributes.position.needsUpdate = true;
  rope.g.computeVertexNormals();
  rope.g.setDrawRange(0, (n - 1) * SIDES * 6);
  rope.mesh.material.color.setHex(taut ? 0x56565c : 0x2b2b2e);   // napnuté lano mírně zesvětlá (D-17)
  rope.mesh.visible = true;
  const e = pts[n - 1];
  rope.hook.position.set(e[0], e[1], e[2]);
  rope.hook.lookAt(0, 0, 0);
  rope.hook.visible = true;
}

// Prověšená křivka mezi hákem a koncem (12 bodů), sag = průhyb uprostřed (m), dolů = ke středu Měsíce
export function sagCurve(a, b, sag) {
  const out = [];
  for (let k = 0; k < 12; k++) {
    const t = k / 11, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t;
    const l = Math.hypot(x, y, z), d = sag * 4 * t * (1 - t) / l;
    out.push([x - x * d, y - y * d, z - z * d]);
  }
  return out;
}

export function createRopeView(scene) {
  const ropes = Array.from({ length: MAX_ROPES }, () => makeRope(scene));
  // list = [{ pts: [[x,y,z]…], taut }]
  function update(list) {
    ropes.forEach((r, k) => {
      const it = list[k];
      if (!it || it.pts.length < 2) { r.mesh.visible = r.hook.visible = false; return; }
      fill(r, it.pts, it.taut);
    });
  }
  return { update };
}
