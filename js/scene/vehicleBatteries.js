// Výměnné baterie na vozidlech (07, fáze B): baterie leží v kolébce vozidla pořád (uzel „baterie“ modelu),
// modrý pás = nabitá, červený = vybitá. Všechna vozidla dohromady kreslí pár InstancedMesh na každou barvu
// (díly modelu baterie z registru), takže počet vykreslení nezávisí na počtu vozidel.
// Použití za snímek: begin() → add(root, battery, 'full' | 'empty') pro každé viditelné vozidlo → end().
import { geometryFor } from '../assets/models.js';

const THREE = window.THREE;
const CAP = 64;                                        // nejvíc baterií jedné barvy naráz
const ONE = new THREE.Vector3(1, 1, 1);
const _l = new THREE.Matrix4(), _m = new THREE.Matrix4();

export function createVehicleBatteries(scene) {
  const sets = { full: null, empty: null };
  const n = { full: 0, empty: 0 };

  function build(kind) {
    const parts = geometryFor(`swap-battery-${kind}`);  // null, dokud se model nenačte
    if (!parts) return null;
    return parts.map(p => {
      const m = new THREE.InstancedMesh(p.geometry, p.material, CAP);
      m.count = 0;
      m.frustumCulled = false;                           // instance jsou po celé planetě
      m.receiveShadow = p.kind === 'solid';
      m.userData.dbg = 'vehicle';
      scene.add(m);
      return m;
    });
  }

  return {
    begin() { n.full = n.empty = 0; },
    // root = kořen vozidla (matice aktuální), battery = { p, q } uzlu baterie v souřadnicích vozidla
    add(root, battery, kind) {
      const set = sets[kind] || (sets[kind] = build(kind));
      if (!set || n[kind] >= CAP) return;
      _l.compose(battery.p, battery.q, ONE);
      _m.multiplyMatrices(root.matrix, _l);
      for (const mesh of set) mesh.setMatrixAt(n[kind], _m);
      n[kind]++;
    },
    end() {
      for (const kind of ['full', 'empty']) {
        if (!sets[kind]) continue;
        for (const mesh of sets[kind]) { mesh.count = n[kind]; mesh.instanceMatrix.needsUpdate = true; }
      }
    },
  };
}
