// Nadzemní pásy z dep do Výkupu. Pás vede ve výšce SILO.beltHeight nad terénem (vyhlazeně, aby
// nekopíroval každý hrbol), takže pod ním projde astronaut i vozidla. Každých ~10 m je jeden kus
// pásu (jedna sloučená geometrie se sloupem); kus, který zakrývá výhled kamery na hráče, se
// pro tohoto hráče zprůhlední. Po pásu jedou hroudy prachu, když na něm nějaký prach je.
import { MOON } from '../config.js';
import { SILO } from '../catalog.js';
import { game } from '../state.js';
import { beltPath, beltLoad } from '../depots.js';
import { heightAt } from '../planet/height.js';

const THREE = window.THREE;
const R = MOON.radius;
const SECTION = 4;                  // úseků trasy (~2,5 m) v jednom kusu pásu
const HALF_W = 0.65;                // polovina šířky pásu (m)
const LUMP_GAP = 4;                 // rozestup hrud prachu na pásu (m)
const ZERO = new THREE.Vector3(0, 0, 0);

const COLORS = { deck: 0x2d313b, frame: 0x5a5f6b, rail: 0xf2b33d, post: 0x8d92a0 };

let mats = null;
function materials() {
  mats ||= {
    solid: new THREE.MeshLambertMaterial({ vertexColors: true }),
    faded: new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.16, depthWrite: false }),
    lump: new THREE.MeshLambertMaterial({ color: 0xc9b98a }),
  };
  return mats;
}

// Sloučí kvádry (každý s vlastní maticí a barvou) do jedné geometrie – jeden kus pásu = jedno kreslení.
function mergeBoxes(parts) {
  const pos = [], nor = [], col = [], idx = [];
  const c = new THREE.Color();
  for (const p of parts) {
    const g = new THREE.BoxGeometry(p.w, p.h, p.d);
    g.applyMatrix4(p.m);
    const base = pos.length / 3;
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    c.setHex(p.color);
    for (let i = 0; i < g.attributes.position.count; i++) col.push(c.r, c.g, c.b);
    for (const i of g.index.array) idx.push(base + i);
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

// Nejmenší vzdálenost dvou úseček (p1–q1, p2–q2), THREE.Vector3.
const _d1 = new THREE.Vector3(), _d2 = new THREE.Vector3(), _r = new THREE.Vector3();
const _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3();
function segmentDistance(p1, q1, p2, q2) {
  _d1.subVectors(q1, p1); _d2.subVectors(q2, p2); _r.subVectors(p1, p2);
  const a = _d1.dot(_d1), e = _d2.dot(_d2), f = _d2.dot(_r);
  const cc = _d1.dot(_r), b = _d1.dot(_d2);
  const den = a * e - b * b;
  let s = den > 1e-9 ? Math.min(1, Math.max(0, (b * f - cc * e) / den)) : 0;
  let t = (b * s + f) / e;
  if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -cc / a)); }
  else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - cc) / a)); }
  _c1.copy(p1).addScaledVector(_d1, s);
  _c2.copy(p2).addScaledVector(_d2, t);
  return _c1.distanceTo(_c2);
}

// Postaví pás pro depo: { group, sections: [{ mesh, a, b, center }], cargo, path… }.
function buildBelt(depot) {
  const M = materials();
  const path = beltPath(depot.hex).points;
  const n = path.length;
  // výška: nejvyšší terén v okolí ±2 bodů, pak průměr → pás nekopíruje každý hrbol
  const th = path.map(p => heightAt(p));
  const hi = th.map((_, i) => Math.max(...th.slice(Math.max(0, i - 2), i + 3)));
  const h = hi.map((_, i) => {
    const w = hi.slice(Math.max(0, i - 2), i + 3);
    return w.reduce((a, b) => a + b, 0) / w.length;
  });
  const P = path.map((p, i) => new THREE.Vector3(p[0], p[1], p[2]).multiplyScalar(R + h[i] + SILO.beltHeight));

  const group = new THREE.Group();
  const sections = [];
  const segQuat = [], cum = [0];
  const m = new THREE.Matrix4(), x = new THREE.Vector3(), y = new THREE.Vector3(), z = new THREE.Vector3();
  const center = new THREE.Vector3(), q = new THREE.Quaternion();

  for (let i = 0; i < n - 1; i++) {
    z.subVectors(P[i + 1], P[i]);
    cum.push(cum[i] + z.length());
    z.normalize();
    y.copy(P[i]).normalize();
    y.addScaledVector(z, -y.dot(z)).normalize();
    x.crossVectors(y, z);
    m.makeBasis(x, y, z);
    segQuat.push(new THREE.Quaternion().setFromRotationMatrix(m));
  }

  for (let k = 0; k < n - 1; k += SECTION) {
    const parts = [];
    const last = Math.min(k + SECTION, n - 1);
    for (let i = k; i < last; i++) {
      const L = P[i].distanceTo(P[i + 1]) + 0.04;
      center.addVectors(P[i], P[i + 1]).multiplyScalar(0.5);
      const at = (dx, dy) => {
        const mm = new THREE.Matrix4().makeRotationFromQuaternion(segQuat[i]);
        const off = new THREE.Vector3(dx, dy, 0).applyQuaternion(segQuat[i]);
        return mm.setPosition(center.clone().add(off));
      };
      parts.push(
        { w: HALF_W * 2, h: 0.14, d: L, m: at(0, 0), color: COLORS.deck },
        { w: HALF_W * 1.5, h: 0.3, d: L, m: at(0, -0.22), color: COLORS.frame },
        { w: 0.08, h: 0.32, d: L, m: at(-HALF_W, 0.16), color: COLORS.rail },
        { w: 0.08, h: 0.32, d: L, m: at(HALF_W, 0.16), color: COLORS.rail },
      );
    }
    // sloup od terénu k pásu na začátku kusu
    const up = path[k];
    const ground = R + th[k], top = R + h[k] + SILO.beltHeight - 0.35;
    if (top - ground > 0.5) {
      const mid = new THREE.Vector3(up[0], up[1], up[2]).multiplyScalar((ground + top) / 2);
      q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(up[0], up[1], up[2]));
      parts.push({ w: 0.28, h: top - ground, d: 0.28, m: new THREE.Matrix4().makeRotationFromQuaternion(q).setPosition(mid), color: COLORS.post });
    }
    const mesh = new THREE.Mesh(mergeBoxes(parts), M.solid);
    mesh.castShadow = true;
    group.add(mesh);
    sections.push({ mesh, a: P[k].clone(), b: P[last].clone(), center: P[Math.floor((k + last) / 2)].clone(), faded: false });
  }

  // násypka nad Výkupem na konci pásu
  const end = path[n - 1];
  q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(end[0], end[1], end[2]));
  const funnel = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 0.35, 1.2, 12), M.solid.clone());
  funnel.material.vertexColors = false;
  funnel.material.color.setHex(COLORS.frame);
  funnel.position.copy(P[n - 1]).addScaledVector(new THREE.Vector3(end[0], end[1], end[2]), -0.8);
  funnel.quaternion.copy(q);
  group.add(funnel);

  // hroudy prachu
  const length = cum[cum.length - 1];
  const count = Math.max(1, Math.floor(length / LUMP_GAP));
  const cargo = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, 0.3, 0.7), M.lump, count);
  cargo.frustumCulled = false;
  cargo.visible = false;
  group.add(cargo);

  return { hex: depot.hex, group, sections, cargo, P, cum, segQuat, length, count, near: false };
}

export function createBelts(scene) {
  let belts = [];
  let key = '';
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
  const _head = new THREE.Vector3();

  function rebuild() {
    for (const b of belts) {
      scene.remove(b.group);
      b.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    }
    belts = game.s.depots.filter(d => d.belt).map(d => {
      const b = buildBelt(d);
      b.depot = d;
      scene.add(b.group);
      return b;
    });
  }

  // Bod na pásu ve vzdálenosti s od depa → _p a index úseku.
  function along(b, s) {
    let lo = 0, hi = b.cum.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (b.cum[mid] <= s) lo = mid; else hi = mid; }
    const seg = Math.min(lo, b.P.length - 2);
    const t = (s - b.cum[seg]) / Math.max(1e-6, b.cum[seg + 1] - b.cum[seg]);
    _p.lerpVectors(b.P[seg], b.P[seg + 1], t);
    return seg;
  }

  function update(time, viewRange, playerPos) {
    const k = game.s.depots.map(d => `${d.hex}${d.belt ? 'b' : ''}`).join(',');
    if (k !== key) { key = k; rebuild(); }
    const range2 = (viewRange + 15) ** 2;
    for (const b of belts) {
      b.depot = game.s.depots.find(d => d.hex === b.hex) || b.depot;
      let near = false;
      for (const sec of b.sections) {
        sec.mesh.visible = sec.center.distanceToSquared(playerPos) < range2;
        near ||= sec.mesh.visible;
      }
      b.near = near;
      const moving = near && beltLoad(b.depot) > 0.5;
      b.cargo.visible = moving;
      if (!moving) continue;
      const shift = (time * SILO.beltSpeed) % LUMP_GAP;
      for (let i = 0; i < b.count; i++) {
        const seg = along(b, Math.min(b.length - 0.01, i * LUMP_GAP + shift));
        _p.addScaledVector(_head.copy(_p).normalize(), 0.24);
        const sec = b.sections[Math.floor(seg / SECTION)];
        _m.compose(_p, b.segQuat[seg], sec && (sec.faded || !sec.mesh.visible) ? ZERO : _s);   // na průhledném kusu hroudy schovat
        b.cargo.setMatrixAt(i, _m);
      }
      b.cargo.instanceMatrix.needsUpdate = true;
    }
  }

  // Kusy pásu mezi kamerou a hráčem se zprůhlední (jen u tohoto hráče).
  function fade(cameraPos, focusPos) {
    const M = materials();
    _head.copy(focusPos).normalize().multiplyScalar(1.6).add(focusPos);
    for (const b of belts) {
      if (!b.near) continue;
      for (const sec of b.sections) {
        if (!sec.mesh.visible) continue;
        const hide = segmentDistance(sec.a, sec.b, cameraPos, _head) < HALF_W + 1.2;
        if (hide !== sec.faded) {
          sec.faded = hide;
          sec.mesh.material = hide ? M.faded : M.solid;
          sec.mesh.castShadow = !hide;
        }
      }
    }
  }

  return { update, fade };
}
