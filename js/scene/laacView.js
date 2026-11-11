// LAAC ve scéně (3.1, D-16, A-10, O-22). Logika a polohy dílů jsou v laac.js.
// Věž = laac.glb v měřítku hexu (radar se otáčí 6× za minutu, maják bliká), plošiny = laac-plocha.glb na sousedních
// hexech (natočené přívodem k věži, měřítko podle vzdálenosti středů). Stav plošiny: kruh na ploše – bílý volno,
// modrý pulz nabíjí, zelený nabito, oranžový bez energie. Kabel ze sloupku k letounu, který se nabíjí.
import { MOON } from '../config.js';
import { axes, partTopHeight, STRUCTURES } from '../structures.js';
import { instantiate } from '../assets/models.js';
import { laacParts } from '../laac.js';
import { live } from '../energy.js';
import { game } from '../state.js';

const THREE = window.THREE;
const R = MOON.radius;
export const LAAC_MODELS = ['laac', 'laac-pad'];
const COL = { free: 0xe8eef2, charging: 0x5fb8d9, full: 0x7fd38a, short: 0xe0a04c };
const CHARGE_POINT = [2.554, 1.85, -4.424];                 // nabijeci_bod plošiny (měřítko 1)
const cableMat = new THREE.MeshLambertMaterial({ color: 0x2b2b2e });
const cableGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 6).translate(0, 0.5, 0).rotateX(Math.PI / 2);   // délka 1 podél +Z

const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4(), _inv = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();

// Matice dílu ve světě: počátek modelu o padTop pod horní plochou desky dílu
export function partMatrix(part, out) {
  const ax = axes(part.p, part.yaw);
  const base = partTopHeight(part) - STRUCTURES.laac.padTop * part.scale;
  _y.set(...part.p); _x.set(...ax.X); _z.set(...ax.Z);
  out.makeBasis(_x, _y, _z);
  out.setPosition(_p.set(...part.p).multiplyScalar(R + base));
  return out.scale(_s.setScalar(part.scale));
}

// root = pohled věže (už posazený place()). Vrací { update(b, near) } pro animace a stav plošin.
export function attachLaac(root, b) {
  const parts = laacParts(b);
  root.updateMatrixWorld(true);
  _inv.copy(root.matrixWorld).invert();
  const put = (obj, part) => {
    partMatrix(part, _m).premultiply(_inv);
    _m.decompose(obj.position, obj.quaternion, obj.scale);
    root.add(obj);
  };
  // věž: root už stojí na středu hexu, posadí ji place() podle desky věže → jen měřítko (vnořená skupina)
  const tower = instantiate('laac');
  const tw = new THREE.Group();
  tw.scale.setScalar(parts[0].scale);
  tw.add(tower.root);
  root.add(tw);
  const radar = tower.nodes?.radar || null;
  // maják: malá koule na vrcholu stožáru (bliká), halo pulzuje přes efekty modelu
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff3b2a }));
  beacon.position.set(0, 38.45, 0);
  tw.add(beacon);
  // plošiny
  const pads = parts.filter(x => x.kind === 'pad').map(part => {
    const g = new THREE.Group();
    g.add(instantiate('laac-pad').root);
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.2, 3.55, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: COL.free, transparent: true, opacity: 0.85, depthWrite: false }));
    ring.position.y = 0.53;
    ring.renderOrder = 3;
    const cable = new THREE.Mesh(cableGeo, cableMat);
    cable.position.set(...CHARGE_POINT);
    cable.visible = false;
    g.add(ring, cable);
    put(g, part);
    return { part, g, ring, cable };
  });

  const _a = new THREE.Vector3(), _b = new THREE.Vector3();
  function update(b2, near) {
    const now = performance.now();
    if (radar) radar.rotation.y = (now / 10000) * Math.PI * 2;         // 6× za minutu
    beacon.visible = Math.floor(now / 750) % 2 === 0;                   // jednou za 1,5 s
    if (!near) return;
    const L = live.get(b2.id);
    pads.forEach((pd, k) => {
      const sl = L?.slots?.[k];
      const st = !L?.wired && sl?.state === 'charging' ? 'short' : sl?.state || 'free';
      pd.ring.material.color.setHex(COL[st] || COL.free);
      pd.ring.material.opacity = st === 'charging' ? 0.45 + 0.4 * Math.sin(now / 220) : 0.85;
      // kabel ze sloupku k letounu na plošině (nabíjí / nabito)
      const v = sl && sl.i >= 0 ? game.s.vehicles[sl.i] : null;
      pd.cable.visible = !!v && (st === 'charging' || st === 'full');
      if (pd.cable.visible) {
        pd.g.updateMatrixWorld(true);
        _b.set(v.p[0], v.p[1], v.p[2]).multiplyScalar(R + partTopHeight(pd.part) + 1.1);   // bok letounu
        pd.cable.getWorldPosition(_a);
        pd.cable.lookAt(_b);                                              // +Z (délka kabelu) k letounu, ve světě
        pd.cable.scale.set(1, 1, Math.max(0.1, _a.distanceTo(_b) / pd.part.scale));
      }
    });
  }
  return { update };
}
