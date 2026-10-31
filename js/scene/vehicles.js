// Low-poly vozidla (bílá karoserie, oranžové rotační kartáče – styl úklidové techniky).
// Model: „nahoru“ = +y, „dopředu“ = +z, kola na y = 0.
// Vrací { root, brushes[], wheels[], seat: Vector3 | null, pusher: boolean, radius, passengers?: Vector3[],
//   headlight?: Vector3 (střed světlometů, odtud svítí reflektor – scene/lights.js) }.

const THREE = window.THREE;
let M = null;

function materials() {
  if (M) return M;
  M = {
    body:   new THREE.MeshLambertMaterial({ color: 0xeceae3 }),
    shade:  new THREE.MeshLambertMaterial({ color: 0xc9c6bd }),
    dark:   new THREE.MeshLambertMaterial({ color: 0x2d313b }),
    tyre:   new THREE.MeshLambertMaterial({ color: 0x1f2228 }),
    hub:    new THREE.MeshLambertMaterial({ color: 0x9aa0a8 }),
    orange: new THREE.MeshLambertMaterial({ color: 0xe8742a, emissive: 0x2a1004 }),
    hivis:  new THREE.MeshLambertMaterial({ color: 0xf2b33d, emissive: 0x3d2800 }),
    glass:  new THREE.MeshPhongMaterial({ color: 0x1d2a38, specular: 0x8fb3d9, shininess: 80 }),
    cabin:  new THREE.MeshPhongMaterial({ color: 0x8fb3d9, specular: 0xffffff, shininess: 80, transparent: true, opacity: 0.28, depthWrite: false }),
    light:  new THREE.MeshBasicMaterial({ color: 0xfff1c4 }),
  };
  return M;
}

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

function cyl(rt, rb, h, mat, x = 0, y = 0, z = 0, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  return m;
}

function wheel(r, w, x, z) {
  const g = new THREE.Group();
  const tyre = cyl(r, r, w, materials().tyre, 0, 0, 0, 14);
  tyre.rotation.z = Math.PI / 2;
  const hub = cyl(r * 0.55, r * 0.55, w + 0.02, materials().hub, 0, 0, 0, 10);
  hub.rotation.z = Math.PI / 2;
  g.add(tyre, hub);
  g.position.set(x, r, z);
  return g;
}

// Rotační kartáč: disk se štětinami (oranžový), otáčí se kolem svislé osy.
function brush(r, x, z) {
  const g = new THREE.Group();
  g.add(cyl(r * 0.35, r * 0.35, 0.12, materials().dark, 0, 0.1, 0, 8));
  const bristles = cyl(r, r * 1.08, 0.08, materials().orange, 0, 0.04, 0, 16);
  g.add(bristles);
  // pár „chomáčů“, ať je vidět rotace
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2;
    g.add(box(0.05, 0.06, r * 0.6, materials().hivis, Math.cos(a) * r * 0.6, 0.09, Math.sin(a) * r * 0.6));
    g.children[g.children.length - 1].rotation.y = -a;
  }
  g.position.set(x, 0.02, z);
  return g;
}

function pushSweeper() {
  const m = materials();
  const root = new THREE.Group();
  root.add(
    box(0.95, 0.32, 1.05, m.shade, 0, 0.33, 0.05),
    box(0.85, 0.42, 0.8, m.body, 0, 0.66, 0.0),
    box(0.6, 0.06, 0.5, m.dark, 0, 0.9, 0.05),
    box(0.9, 0.1, 0.12, m.orange, 0, 0.5, 0.55),
  );
  // rukojeť
  for (const x of [-0.3, 0.3]) {
    const bar = cyl(0.025, 0.025, 0.9, m.dark, x, 0.95, -0.6, 6);
    bar.rotation.x = -0.75;
    root.add(bar);
  }
  root.add(box(0.7, 0.05, 0.05, m.orange, 0, 1.28, -0.92));
  const wheels = [wheel(0.14, 0.08, -0.45, 0.35), wheel(0.14, 0.08, 0.45, 0.35), wheel(0.17, 0.1, -0.45, -0.35), wheel(0.17, 0.1, 0.45, -0.35)];
  const brushes = [brush(0.3, -0.5, 0.6), brush(0.3, 0.5, 0.6)];
  root.add(...wheels, ...brushes);
  return { root, wheels, brushes, seat: null, pusher: true, radius: 0.9, wheelR: 0.15 };
}

function rideOn() {
  const m = materials();
  const root = new THREE.Group();
  root.add(
    box(1.3, 0.5, 2.0, m.body, 0, 0.55, 0),
    box(1.2, 0.55, 0.7, m.body, 0, 1.0, 0.6),             // kapota
    box(1.0, 0.08, 0.6, m.dark, 0, 1.3, 0.6),
    box(0.6, 0.12, 0.55, m.dark, 0, 0.95, -0.35),          // sedák
    box(0.6, 0.6, 0.12, m.dark, 0, 1.25, -0.62),           // opěradlo
    box(1.32, 0.1, 2.02, m.orange, 0, 0.36, 0),
    box(0.25, 0.08, 0.06, m.light, -0.4, 0.95, 0.97),
    box(0.25, 0.08, 0.06, m.light, 0.4, 0.95, 0.97),
    box(0.9, 0.5, 0.5, m.shade, 0, 0.75, -0.95),           // zásobník
  );
  const column = cyl(0.03, 0.03, 0.55, m.dark, 0, 1.25, 0.15, 6);
  column.rotation.x = -0.5;
  const wheelRing = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 6, 16), m.dark);
  wheelRing.position.set(0, 1.5, 0.02);
  wheelRing.rotation.x = -1.1;
  root.add(column, wheelRing);
  const wheels = [wheel(0.24, 0.16, -0.68, 0.65), wheel(0.24, 0.16, 0.68, 0.65), wheel(0.28, 0.2, -0.68, -0.6), wheel(0.28, 0.2, 0.68, -0.6)];
  const brushes = [brush(0.38, -0.72, 1.15), brush(0.38, 0.72, 1.15)];
  root.add(...wheels, ...brushes);
  return { root, wheels, brushes, seat: new THREE.Vector3(0, 0.62, -0.38), pusher: false, radius: 1.3, wheelR: 0.26, headlight: new THREE.Vector3(0, 0.95, 1.02) };
}

function lunarSweeper() {
  const m = materials();
  const root = new THREE.Group();
  root.add(
    box(2.1, 0.9, 4.4, m.shade, 0, 0.95, 0),               // podvozek
    box(2.1, 1.7, 1.5, m.body, 0, 1.95, 1.4),              // kabina
    box(1.9, 0.75, 0.06, m.glass, 0, 2.25, 2.16),          // čelní sklo
    box(0.06, 0.6, 1.0, m.glass, -1.06, 2.25, 1.4),
    box(0.06, 0.6, 1.0, m.glass, 1.06, 2.25, 1.4),
    box(2.12, 0.12, 4.42, m.orange, 0, 0.62, 0),
    box(0.35, 0.12, 0.06, m.light, -0.75, 1.45, 2.16),
    box(0.35, 0.12, 0.06, m.light, 0.75, 1.45, 2.16),
    box(0.5, 0.12, 0.2, m.hivis, 0, 2.85, 1.4),            // maják
  );
  const tank = cyl(0.95, 0.95, 2.6, m.body, 0, 2.15, -0.75, 16);
  tank.rotation.x = Math.PI / 2;
  const tankCap = cyl(0.97, 0.97, 0.12, m.dark, 0, 2.15, -2.0, 16);
  tankCap.rotation.x = Math.PI / 2;
  root.add(tank, tankCap);
  const wheels = [wheel(0.48, 0.32, -1.05, 1.3), wheel(0.48, 0.32, 1.05, 1.3), wheel(0.48, 0.32, -1.05, -1.3), wheel(0.48, 0.32, 1.05, -1.3)];
  const brushes = [brush(0.5, -1.15, 2.45), brush(0.5, 1.15, 2.45), brush(0.42, -0.5, 2.3), brush(0.42, 0.5, 2.3)];
  root.add(...wheels, ...brushes);
  return { root, wheels, brushes, seat: new THREE.Vector3(-0.45, 1.05, 1.3), pusher: false, radius: 2.6, wheelR: 0.48, headlight: new THREE.Vector3(0, 1.45, 2.22) };
}

function megaRover() {
  const m = materials();
  const root = new THREE.Group();
  root.add(
    box(3.0, 1.3, 4.6, m.body, 0, 1.55, -0.2),
    box(3.02, 0.14, 4.62, m.orange, 0, 0.95, -0.2),
    box(1.6, 1.0, 1.4, m.body, 0, 2.7, -1.6),              // kabina
    box(1.4, 0.55, 0.06, m.glass, 0, 2.85, -0.88),
    box(5.2, 0.55, 1.0, m.shade, 0, 0.42, 2.9),            // sací hlava
    box(5.0, 0.12, 0.9, m.dark, 0, 0.1, 2.9),
    box(5.22, 0.1, 0.12, m.hivis, 0, 0.72, 3.38),
    box(0.4, 0.14, 0.1, m.light, -1.0, 1.8, 2.12),
    box(0.4, 0.14, 0.1, m.light, 1.0, 1.8, 2.12),
  );
  for (const x of [-0.8, 0.8]) {
    const t = cyl(0.55, 0.55, 2.6, m.shade, x, 2.5, 0.6, 14);
    t.rotation.x = Math.PI / 2;
    root.add(t);
  }
  const hose = cyl(0.25, 0.25, 1.4, m.dark, 0, 1.2, 2.25, 10);
  hose.rotation.x = 0.9;
  root.add(hose);
  const wheels = [];
  for (const z of [1.3, -0.2, -1.7]) wheels.push(wheel(0.7, 0.45, -1.7, z), wheel(0.7, 0.45, 1.7, z));
  root.add(...wheels);
  return { root, wheels, brushes: [], seat: new THREE.Vector3(0, 2.05, -1.55), pusher: false, radius: 3.6, wheelR: 0.7, headlight: new THREE.Vector3(0, 1.8, 2.2) };
}

// Přepravník posádky: prosklená kabina, aby byli vidět řidič i cestující (5 sedadel vzadu a vedle řidiče).
function crewTransport() {
  const m = materials();
  const root = new THREE.Group();
  root.add(
    box(2.0, 0.9, 4.3, m.orange, 0, 0.95, 0),
    box(2.0, 0.12, 4.3, m.body, 0, 2.26, 0),               // střecha
    box(1.98, 0.8, 4.26, m.cabin, 0, 1.8, 0),              // okna kolem dokola
    box(1.6, 0.1, 2.8, m.dark, 0, 2.37, -0.3),             // střešní nosič
    box(1.0, 0.25, 0.9, m.shade, 0.2, 2.55, -0.8),
    box(0.3, 0.12, 0.06, m.light, -0.65, 1.15, 2.16),
    box(0.3, 0.12, 0.06, m.light, 0.65, 1.15, 2.16),
  );
  for (const x of [-0.95, 0.95]) for (const z of [-2.1, 0, 2.1]) root.add(box(0.1, 0.8, 0.1, m.body, x, 1.8, z));
  const wheels = [wheel(0.4, 0.3, -0.98, 1.35), wheel(0.4, 0.3, 0.98, 1.35), wheel(0.4, 0.3, -0.98, -1.35), wheel(0.4, 0.3, 0.98, -1.35)];
  root.add(...wheels);
  const at = (x, z) => new THREE.Vector3(x, 0.85, z);
  return {
    root, wheels, brushes: [], seat: at(-0.45, 1.3), pusher: false, radius: 2.4, wheelR: 0.4, headlight: new THREE.Vector3(0, 1.15, 2.22),
    passengers: [at(0.45, 1.3), at(-0.45, 0.1), at(0.45, 0.1), at(-0.45, -1.1), at(0.45, -1.1)],
  };
}

const BUILDERS = { push: pushSweeper, rideon: rideOn, lunar: lunarSweeper, mega: megaRover, crew: crewTransport };

export function buildVehicle(type) {
  return BUILDERS[type]();
}
