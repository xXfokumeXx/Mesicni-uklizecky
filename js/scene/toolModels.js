// Modely ručních nástrojů pro náhledy v obchodě (astronaut drží zjednodušenou verzi).
// Model: násada podél +y, hlava nástroje dole, šířka podél x.

const THREE = window.THREE;
let M = null;

function materials() {
  if (M) return M;
  M = {
    dark:   new THREE.MeshLambertMaterial({ color: 0x2d313b }),
    white:  new THREE.MeshLambertMaterial({ color: 0xeceae3 }),
    orange: new THREE.MeshLambertMaterial({ color: 0xe8742a, emissive: 0x2a1004 }),
    hivis:  new THREE.MeshLambertMaterial({ color: 0xf2b33d, emissive: 0x3d2800 }),
    blue:   new THREE.MeshLambertMaterial({ color: 0x5fb8d9 }),
  };
  return M;
}

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

function handle(len, mat) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, len, 8), mat);
  m.position.y = len / 2 + 0.1;
  return m;
}

const BUILD = {
  toothbrush: m => [handle(1.0, m.white), box(0.3, 0.08, 0.12, m.blue, 0, 0.08, 0), box(0.26, 0.08, 0.1, m.white, 0, 0.0, 0)],
  handbrush:  m => [handle(1.0, m.dark), box(0.6, 0.1, 0.16, m.hivis, 0, 0.1, 0), box(0.56, 0.1, 0.13, m.orange, 0, 0.0, 0)],
  broom:      m => [handle(1.2, m.dark), box(1.0, 0.14, 0.18, m.white, 0, 0.12, 0), box(1.0, 0.16, 0.12, m.orange, 0, -0.02, 0)],
  handvac:    m => {
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.6, 12), m.white);
    can.position.set(0, 0.9, -0.1);
    return [handle(1.0, m.dark), can, box(1.4, 0.1, 0.22, m.dark, 0, 0.06, 0), box(1.42, 0.05, 0.24, m.hivis, 0, 0.13, 0)];
  },
  squeegee:   m => [handle(1.3, m.dark), box(2.0, 0.16, 0.14, m.hivis, 0, 0.12, 0), box(2.0, 0.08, 0.06, m.dark, 0, 0.0, 0.0)],
};

export function buildToolModel(id) {
  const g = new THREE.Group();
  g.add(...BUILD[id](materials()));
  g.rotation.x = -0.35;
  return g;
}

// Měsíční boty pro náhled v Dílně; vyšší úroveň = výraznější podrážka a pružiny / trysky.
export function buildBootsModel(lv) {
  const m = materials();
  const g = new THREE.Group();
  for (const x of [-0.17, 0.17]) {
    const boot = new THREE.Group();
    boot.add(box(0.2, 0.34, 0.22, m.white, 0, 0.3, -0.03), box(0.22, 0.12, 0.38, m.white, 0, 0.12, 0.05));
    boot.add(box(0.24, 0.05 + lv * 0.02, 0.4, lv ? m.orange : m.dark, 0, 0.04 - lv * 0.01, 0.05));
    boot.add(box(0.21, 0.04, 0.23, m.blue, 0, 0.43, -0.03));
    if (lv >= 2) {
      for (const z of [-0.06, 0.16]) {
        const spring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.015, 6, 12), m.hivis);
        spring.rotation.x = Math.PI / 2;
        spring.position.set(0, -0.03, z);
        boot.add(spring);
      }
    }
    if (lv >= 3) {
      const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.16, 10), m.dark);
      jet.rotation.x = Math.PI / 2;
      jet.position.set(0, 0.22, -0.2);
      boot.add(jet);
    }
    boot.position.x = x;
    g.add(boot);
  }
  g.rotation.y = 0.6;
  g.position.y = -0.2;
  return g;
}
