// Rekvizity na helmu astronauta (šatna v Dílně). Souřadnice v prostoru hlavy:
// střed helmy (0, 0.17, 0.01), poloměr 0.175 → temeno ≈ y 0.345, hledí vpředu ≈ z 0.19.
// Každá rekvizita vrací { root, update(dt, time) } – některé se hýbou (vrtulka, tykadla, svatozář).

const THREE = window.THREE;
const TOP = 0.335;

const lam = (color, emissive = 0) => new THREE.MeshLambertMaterial({ color, emissive });
function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

const BUILD = {
  horns() {
    const g = new THREE.Group();
    const red = lam(0xc8281e, 0x300806);
    for (const s of [-1, 1]) {
      const base = mesh(new THREE.ConeGeometry(0.045, 0.12, 8), red, 0.1 * s, TOP - 0.03, 0.03);
      base.rotation.z = -0.55 * s;
      const tip = mesh(new THREE.ConeGeometry(0.028, 0.09, 8), red, 0.035 * s, 0.085, 0);
      tip.rotation.z = 0.6 * s;
      base.add(tip);
      g.add(base);
    }
    return { root: g };
  },

  mohawk() {
    const g = new THREE.Group();
    const cols = [0xff3fa4, 0x7cff4f, 0x3fd4ff];
    for (let i = 0; i < 7; i++) {
      const a = -0.95 + i * 0.32;                         // podél temene zepředu dozadu
      const spike = mesh(new THREE.ConeGeometry(0.03, 0.14 - Math.abs(i - 3) * 0.012, 6), lam(cols[i % 3], 0x101010));
      spike.position.set(0, 0.17 + Math.cos(a) * 0.175, 0.01 + Math.sin(a) * 0.175);
      spike.rotation.x = a;
      spike.translateY(0.06);
      g.add(spike);
    }
    return { root: g };
  },

  cowboy() {
    const g = new THREE.Group();
    const brown = lam(0x8a5a2c), band = lam(0x2d1d10);
    const brim = mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.018, 24), brown, 0, TOP - 0.02, 0);
    brim.scale.set(1, 1, 0.85);
    const crown = mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.15, 16), brown, 0, TOP + 0.06, 0);
    const dent = mesh(new THREE.BoxGeometry(0.03, 0.03, 0.2), band, 0, TOP + 0.13, 0);
    const ribbon = mesh(new THREE.CylinderGeometry(0.161, 0.161, 0.03, 16), band, 0, TOP + 0.005, 0);
    g.add(brim, crown, dent, ribbon);
    g.rotation.x = -0.12;
    return { root: g };
  },

  tophat() {
    const g = new THREE.Group();
    const black = lam(0x18181c), red = lam(0xb0202a);
    g.add(
      mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.016, 24), black, 0, TOP - 0.01, 0),
      mesh(new THREE.CylinderGeometry(0.135, 0.13, 0.3, 20), black, 0, TOP + 0.15, 0),
      mesh(new THREE.CylinderGeometry(0.137, 0.137, 0.04, 20), red, 0, TOP + 0.03, 0),
    );
    g.rotation.z = 0.12;
    return { root: g };
  },

  crown() {
    const g = new THREE.Group();
    const gold = new THREE.MeshPhongMaterial({ color: 0xf2c440, emissive: 0x3a2a00, specular: 0xfff0b0, shininess: 70 });
    const ring = mesh(new THREE.CylinderGeometry(0.12, 0.125, 0.07, 20, 1, true), gold, 0, TOP + 0.02, 0);
    ring.material.side = THREE.DoubleSide;
    g.add(ring);
    const gems = [0xd9283d, 0x2b6fd9, 0x3fbf5a];
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2;
      g.add(mesh(new THREE.ConeGeometry(0.03, 0.07, 6), gold, Math.sin(a) * 0.12, TOP + 0.09, Math.cos(a) * 0.12));
      g.add(mesh(new THREE.SphereGeometry(0.016, 8, 6), new THREE.MeshBasicMaterial({ color: gems[i % 3] }),
        Math.sin(a) * 0.126, TOP + 0.02, Math.cos(a) * 0.126));
    }
    return { root: g };
  },

  propeller() {
    const g = new THREE.Group();
    const segCols = [0xd9283d, 0xf2c440, 0x2b6fd9, 0x3fbf5a];
    for (let i = 0; i < 4; i++) {
      const cap = mesh(new THREE.SphereGeometry(0.182, 12, 6, i * Math.PI / 2, Math.PI / 2, 0, Math.PI / 2.6), lam(segCols[i]), 0, 0.17, 0.01);
      g.add(cap);
    }
    const stem = mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.07, 6), lam(0x2d313b), 0, TOP + 0.04, 0.01);
    const rotor = new THREE.Group();
    rotor.position.set(0, TOP + 0.08, 0.01);
    rotor.add(mesh(new THREE.BoxGeometry(0.3, 0.008, 0.05), lam(0xf2c440)));
    rotor.add(mesh(new THREE.SphereGeometry(0.018, 8, 6), lam(0xd9283d)));
    g.add(stem, rotor);
    return { root: g, update: (dt) => { rotor.rotation.y += dt * 9; } };
  },

  antennae() {
    const g = new THREE.Group();
    const green = lam(0x7cff4f, 0x1a4010);
    const stalks = [];
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(0.07 * s, TOP - 0.01, 0.02);
      pivot.rotation.z = -0.35 * s;
      const stalk = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.22, 5), lam(0x2d313b), 0, 0.11, 0);
      const ball = mesh(new THREE.SphereGeometry(0.035, 10, 8), green, 0, 0.23, 0);
      pivot.add(stalk, ball);
      g.add(pivot);
      stalks.push({ pivot, s });
    }
    return {
      root: g,
      update: (dt, time) => {
        for (const { pivot, s } of stalks) {
          pivot.rotation.z = -0.35 * s + Math.sin(time * 3.1 + s) * 0.18;
          pivot.rotation.x = Math.sin(time * 2.3 + s * 2) * 0.12;
        }
      },
    };
  },

  catears() {
    const g = new THREE.Group();
    const outer = lam(0x2d313b), inner = lam(0xf29bb8);
    for (const s of [-1, 1]) {
      const ear = mesh(new THREE.ConeGeometry(0.06, 0.11, 3), outer, 0.095 * s, TOP + 0.01, 0.0);
      ear.rotation.z = -0.4 * s;
      ear.rotation.y = Math.PI / 6;
      const pink = mesh(new THREE.ConeGeometry(0.035, 0.07, 3), inner, 0, -0.005, 0.02);
      ear.add(pink);
      g.add(ear);
    }
    return { root: g };
  },

  halo() {
    const g = new THREE.Group();
    const ring = mesh(new THREE.TorusGeometry(0.14, 0.017, 8, 28), new THREE.MeshBasicMaterial({ color: 0xffe27a }), 0, TOP + 0.12, 0);
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    return { root: g, update: (dt, time) => { ring.position.y = TOP + 0.12 + Math.sin(time * 2) * 0.02; ring.rotation.z += dt * 0.6; } };
  },

  chef() {
    const g = new THREE.Group();
    const white = lam(0xf7f5ef);
    g.add(mesh(new THREE.CylinderGeometry(0.14, 0.15, 0.13, 16), white, 0, TOP + 0.03, 0));
    const puff = mesh(new THREE.SphereGeometry(0.19, 14, 10), white, 0, TOP + 0.17, 0);
    puff.scale.set(1, 0.65, 1);
    g.add(puff);
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2;
      g.add(mesh(new THREE.SphereGeometry(0.08, 8, 6), white, Math.sin(a) * 0.12, TOP + 0.17, Math.cos(a) * 0.12));
    }
    return { root: g };
  },

  duck() {
    const g = new THREE.Group();
    const yellow = lam(0xffd23a, 0x302000), orange = lam(0xf07a1a), black = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const body = mesh(new THREE.SphereGeometry(0.1, 14, 10), yellow, 0, TOP + 0.05, -0.01);
    body.scale.set(1, 0.75, 1.25);
    const head = mesh(new THREE.SphereGeometry(0.065, 12, 10), yellow, 0, TOP + 0.15, 0.06);
    const beak = mesh(new THREE.BoxGeometry(0.06, 0.02, 0.06), orange, 0, TOP + 0.14, 0.13);
    const tail = mesh(new THREE.ConeGeometry(0.035, 0.07, 6), yellow, 0, TOP + 0.09, -0.13);
    tail.rotation.x = -1.1;
    g.add(body, head, beak, tail,
      mesh(new THREE.SphereGeometry(0.012, 6, 4), black, 0.035, TOP + 0.17, 0.11),
      mesh(new THREE.SphereGeometry(0.012, 6, 4), black, -0.035, TOP + 0.17, 0.11));
    return { root: g, update: (dt, time) => { g.rotation.z = Math.sin(time * 1.7) * 0.08; } };
  },

  cone() {
    const g = new THREE.Group();
    const orange = lam(0xf06a1a, 0x301000), white = lam(0xf7f5ef);
    g.add(
      mesh(new THREE.BoxGeometry(0.24, 0.025, 0.24), orange, 0, TOP - 0.005, 0),
      mesh(new THREE.ConeGeometry(0.11, 0.34, 16), orange, 0, TOP + 0.17, 0),
      mesh(new THREE.CylinderGeometry(0.066, 0.083, 0.06, 16), white, 0, TOP + 0.15, 0),
      mesh(new THREE.CylinderGeometry(0.035, 0.048, 0.04, 16), white, 0, TOP + 0.25, 0),
    );
    g.rotation.z = -0.15;
    return { root: g };
  },

  // ----- na hledí -----

  moustache() {
    const g = new THREE.Group();
    const brown = lam(0x3a2414);
    for (const s of [-1, 1]) {
      const half = mesh(new THREE.SphereGeometry(0.05, 10, 8), brown, 0.042 * s, 0.1, 0.178);
      half.scale.set(1.2, 0.42, 0.45);
      half.rotation.z = 0.35 * s;
      const curl = mesh(new THREE.SphereGeometry(0.02, 8, 6), brown, 0.098 * s, 0.118, 0.165);
      g.add(half, curl);
    }
    return { root: g };
  },

  glasses() {
    const g = new THREE.Group();
    const black = lam(0x111114), skin = lam(0xf0a98a), brow = lam(0x2a1a10);
    for (const s of [-1, 1]) {
      const rim = mesh(new THREE.TorusGeometry(0.038, 0.007, 6, 18), black, 0.05 * s, 0.19, 0.188);
      const eyebrow = mesh(new THREE.BoxGeometry(0.07, 0.02, 0.02), brow, 0.05 * s, 0.24, 0.178);
      eyebrow.rotation.z = -0.15 * s;
      g.add(rim, eyebrow);
    }
    const nose = mesh(new THREE.SphereGeometry(0.035, 10, 8), skin, 0, 0.15, 0.205);
    nose.scale.set(0.8, 1, 1.2);
    g.add(nose, mesh(new THREE.BoxGeometry(0.03, 0.008, 0.008), black, 0, 0.195, 0.19));
    return { root: g };
  },

  whiskers() {
    const g = new THREE.Group();
    const white = lam(0xf7f5ef);
    g.add(mesh(new THREE.SphereGeometry(0.018, 8, 6), lam(0xf29bb8), 0, 0.14, 0.19));
    for (const s of [-1, 1]) {
      for (let k = -1; k <= 1; k++) {
        const w = mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.14, 4), white, 0.09 * s, 0.13 + k * 0.012, 0.17);
        w.rotation.z = Math.PI / 2 + k * 0.18 * s;
        g.add(w);
      }
    }
    return { root: g };
  },
};

export function buildProp(id) {
  const make = BUILD[id];
  if (!make) return null;
  const p = make();
  p.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { root: p.root, update: p.update || null };
}
