// Kameny ve scéně: jeden InstancedMesh na díl každého typu kamene (5 typů ≈ 5 vykreslení). Instance se přepočítají,
// jen když se hráč posune o 6 m, změní se dohled nebo se kámen rozbije / schová – ne každý snímek.
import { MOON } from '../config.js';
import { settings } from '../settings.js';
import { instantiate } from '../assets/models.js';
import { rocks, ROCK_TYPES, rocksNear, rockDist, rockBase, rockVersion, takeRockEvents } from '../rocks.js';
import { terrainVersion } from '../planet/height.js';
import { anyTangent, cross } from '../planet/vec.js';

const R = MOON.radius;
const CAP = 900;                         // instancí na typ (dohled 130 m ≈ 550 kamenů celkem)
const MOVE = 6;                          // přepočet po posunu o 6 m

export function createRocksView(scene, { onDust } = {}) {
  const THREE = window.THREE;
  const pools = ROCK_TYPES.map(() => null);
  function pool(t) {
    if (pools[t]) return pools[t];
    const tpl = instantiate(ROCK_TYPES[t].model);
    if (tpl.failed) return null;
    tpl.root.updateMatrixWorld(true);
    const meshes = [];
    tpl.root.traverse(o => {
      if (!o.isMesh) return;
      const im = new THREE.InstancedMesh(o.geometry, o.material, CAP);
      im.count = 0;
      im.frustumCulled = false;
      im.userData.dbg = 'rock';
      scene.add(im);
      meshes.push({ im, local: o.matrixWorld.clone() });
    });
    pools[t] = { meshes, n: 0 };
    return pools[t];
  }

  const last = new THREE.Vector3(1e9, 0, 0);
  let lastVer = -1, lastDist = -1, lastTv = -1;
  const _m = new THREE.Matrix4(), _w = new THREE.Matrix4();
  const X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3(), P = new THREE.Vector3();
  const fdir = [0, 0, 0];

  function rebuild(focus, dist) {
    for (let t = 0; t < pools.length; t++) { const p = pool(t); if (p) p.n = 0; }
    rocksNear(fdir, dist, i => {
      if (rocks.off[i] || rockDist(i, fdir) > dist) return;
      const p = pools[rocks.type[i]];
      if (!p || p.n >= CAP) return;
      const c = [rocks.dir[i * 3], rocks.dir[i * 3 + 1], rocks.dir[i * 3 + 2]];
      const e1 = anyTangent(c), e2 = cross(c, e1), a = rocks.yaw[i], ca = Math.cos(a), sa = Math.sin(a), s = rocks.scale[i];
      Y.set(c[0], c[1], c[2]);
      X.set(e1[0] * ca + e2[0] * sa, e1[1] * ca + e2[1] * sa, e1[2] * ca + e2[2] * sa);
      Z.crossVectors(X, Y);
      const r = R + rockBase(i);
      _m.makeBasis(X, Y, Z).scale(P.set(s, s, s)).setPosition(Y.x * r, Y.y * r, Y.z * r);
      for (const { im, local } of p.meshes) im.setMatrixAt(p.n, _w.multiplyMatrices(_m, local));
      p.n++;
    });
    for (const p of pools) {
      if (!p) continue;
      for (const { im } of p.meshes) { im.count = p.n; im.instanceMatrix.needsUpdate = true; }
    }
  }

  return {
    update(focus) {
      if (!rocks.n) return;
      for (const i of takeRockEvents()) {                 // rozbitý kámen: obláček prachu
        const c = [rocks.dir[i * 3], rocks.dir[i * 3 + 1], rocks.dir[i * 3 + 2]];
        const pos = new THREE.Vector3(c[0], c[1], c[2]).multiplyScalar(R + rockBase(i) + 0.4);
        if (pos.distanceTo(focus) < 80) onDust?.(pos, ROCK_TYPES[rocks.type[i]].big ? 40 : 16);
      }
      const dist = Math.min(130, settings.view * 0.4);
      const ver = rockVersion(), tv = terrainVersion();
      if (ver === lastVer && dist === lastDist && tv === lastTv && last.distanceTo(focus) < MOVE) return;
      lastVer = ver; lastDist = dist; lastTv = tv;
      last.copy(focus);
      const l = focus.length() || 1;
      fdir[0] = focus.x / l; fdir[1] = focus.y / l; fdir[2] = focus.z / l;
      rebuild(focus, dist + MOVE);
    },
  };
}
