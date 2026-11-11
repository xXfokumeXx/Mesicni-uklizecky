// Letouny ve scéně (3.1, D-17, A-11, O-23): GLB z registru (aircraft-<typ>) zabalený do „view“ vozidla, jaký čeká
// actors.js (seat, passengers, radius, wheels/brushes prázdné). Navíc view.air(dt, st): plameny trysek (dolů při letu,
// víc při stoupání), skener Kolibříku se otáčí, hladina prachu v nádrži Prachovky podle náplně, číslo plošiny na boku.
import { MODELS } from '../assets/registry.js';
import { instantiate } from '../assets/models.js';

const THREE = window.THREE;
const flameGeo = new THREE.ConeGeometry(0.22, 1.2, 10, 1, true).rotateX(Math.PI).translate(0, -0.6, 0);
const flameMat = new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false });
const beamMat = new THREE.MeshBasicMaterial({ color: 0x2ab0e3, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
const numTex = new Map();
function numberTexture(n) {
  if (numTex.has(n)) return numTex.get(n);
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#1d2024'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#f0e6d2'; g.font = 'bold 46px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(n), 32, 35);
  const t = new THREE.CanvasTexture(c);
  numTex.set(n, t);
  return t;
}

export function buildAircraft(type) {
  const id = `aircraft-${type}`;
  const def = MODELS[id];
  const inst = instantiate(id);
  const root = new THREE.Group();
  root.add(inst.root);
  const P = def.points || {};
  const v3 = a => new THREE.Vector3(a[0], a[1], a[2]);
  // plameny trysek dolů (D-17): kužel pod každou tryskou, délka podle tahu
  const flames = (P.thrusters || []).map(t => {
    const m = new THREE.Mesh(flameGeo, flameMat);
    m.position.copy(v3(t));
    m.visible = false;
    root.add(m);
    return m;
  });
  // zadní trysky Kolibříku (osa −Y uzlu míří dozadu → plamen po −Z)
  const rear = (P.rear || []).map(t => {
    const m = new THREE.Mesh(flameGeo, flameMat);
    m.position.copy(v3(t));
    m.rotation.x = -Math.PI / 2;
    m.visible = false;
    root.add(m);
    return m;
  });
  // číslo plošiny na štítcích (cislo_L, cislo_P)
  const labels = [];
  for (const [at, side] of [[P.labelL, -1], [P.labelR, 1]]) {
    if (!at) continue;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), new THREE.MeshBasicMaterial({ map: numberTexture(1) }));
    m.geometry.rotateY(side * Math.PI / 2);
    m.position.set(at[0] + side * 0.015, at[1], at[2]);
    root.add(m);
    labels.push(m);
  }
  let labelN = 1;
  // skener Kolibříku: modrý kužel do země při skenování
  const scanner = inst.nodes?.skener || null;
  // kužel se přidá až při prvním skenování – jinak by 30m kužel zvětšil obálku modelu (náhled, ikonka baterie)
  let beam = null;
  const makeBeam = () => {
    beam = new THREE.Mesh(new THREE.ConeGeometry(Math.tan(25 * Math.PI / 180) * 30, 30, 24, 1, true).translate(0, -15, 0), beamMat);
    beam.position.set(...P.beam);
    root.add(beam);
  };
  // Kondor: ruka (rameno → předloktí → kleště, rozložení kolem X), poklop (kolem Z), ukazatel nákladu (měřítko Z); Mula: buben
  const N = inst.nodes || {};
  const level = N.zasobnik_hladina || null;           // hladina prachu Prachovky (extras.hladina_y 1,62 → 2,25)
  const lv = P.level || [1.62, 2.25];

  function air(dt, st) {
    const now = performance.now();
    const power = st.flying ? (st.climb > 0.3 ? 1.35 : st.climb < -0.3 ? 0.6 : 0.9) : 0;
    for (const f of flames) {
      f.visible = power > 0;
      if (power > 0) f.scale.set(1, power * (0.85 + 0.15 * Math.sin(now / 41 + f.position.x * 5)), 1);
    }
    for (const f of rear) {
      const k = st.flying ? Math.min(1.4, 0.2 + st.speed / 15) : 0;
      f.visible = k > 0.25;
      if (f.visible) f.scale.set(1, k, 1);
    }
    if (scanner) scanner.rotation.y += (st.flying ? 3 : 0.4) * dt;
    if (st.scanning && !beam && scanner && P.beam) makeBeam();
    if (beam) beam.visible = !!st.scanning && Math.floor(now / 2000) % 2 === 0;   // pulz skenu jednou za 2 s
    if (level) level.position.y = lv[0] + (lv[1] - lv[0]) * Math.max(0, Math.min(1, st.fill || 0));
    if (N.ruka_rameno) {                                        // 0 = složená pod břichem, 1 = svisle dolů (L-67)
      const k = Math.max(0, Math.min(1, st.arm || 0)), e = k * k * (3 - 2 * k);
      N.ruka_rameno.rotation.x = -Math.PI / 2 * e;
      if (N.ruka_predlokti) N.ruka_predlokti.rotation.x = Math.PI * e;
      if (N.ruka_klesti) N.ruka_klesti.rotation.x = -Math.PI / 2 * e;
    }
    if (N.poklop) N.poklop.rotation.z += ((st.hatch ? -110 * Math.PI / 180 : 0) - N.poklop.rotation.z) * Math.min(1, dt * 3);
    if (N.naklad_ukazatel) N.naklad_ukazatel.scale.z = Math.max(0.02, Math.min(1, st.fill || 0));
    if (N.navijak_buben && st.winch) N.navijak_buben.rotation.x += dt * 6;
    if (st.number && st.number !== labelN) { labelN = st.number; for (const m of labels) m.material.map = numberTexture(labelN); }
  }

  root.userData.dbg = 'vehicle';                              // skupina pro ladicí výpis F3 (debug.js)
  return {
    root, wheels: [], brushes: [], pusher: false, wheelR: 1, kind: 'air',
    seat: P.seat ? v3(P.seat) : new THREE.Vector3(0, 1.7, 0.9),
    passengers: P.seat2 ? [v3(P.seat2)] : undefined,
    radius: def.radius || 3,
    headlight: new THREE.Vector3(0, 1.3, (P.nose || 2.4)),
    air,
  };
}
