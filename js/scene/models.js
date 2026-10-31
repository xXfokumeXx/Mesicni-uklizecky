// Low-poly model robota zametače (astronaut: astronaut.js, vozidla: vehicles.js, budovy: buildings.js).
// Všechny modely mají „nahoru“ = +y a „dopředu“ = +z.
const THREE = window.THREE;
let M = null;

// Materiály se tvoří až při prvním použití (THREE musí být načtené).
function materials() {
  if (M) return M;
  M = {
    dark:    new THREE.MeshLambertMaterial({ color: 0x343944 }),
    hivis:   new THREE.MeshLambertMaterial({ color: 0xf2b33d, emissive: 0x3d2800 }),
    bristle: new THREE.MeshLambertMaterial({ color: 0x5fb8d9 }),
    bot:     new THREE.MeshLambertMaterial({ color: 0xc9d1c4 }),
    botLamp: new THREE.MeshBasicMaterial({ color: 0x9fd39b }),
    depot:   new THREE.MeshLambertMaterial({ color: 0xd8d4c8 }),
    beacon:  new THREE.MeshBasicMaterial({ color: 0x5fb8d9 }),
    beam:    new THREE.MeshBasicMaterial({
      color: 0x5fb8d9, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false,
    }),
    zone:    new THREE.MeshBasicMaterial({ color: 0x5fb8d9, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    shadow:  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
  };
  return M;
}

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

function blobShadow(r) {
  const geo = new THREE.CircleGeometry(r, 16);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, materials().shadow);
  m.position.y = 0.05;
  m.userData.blob = true;               // „falešný“ stín, když jsou skutečné stíny vypnuté
  return m;
}

export function buildBot() {
  const m = materials();
  const root = new THREE.Group();
  root.add(box(0.62, 0.3, 0.72, m.bot, 0, 0.3, 0), box(0.5, 0.08, 0.5, m.dark, 0, 0.49, -0.05));

  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), m.botLamp);
  lamp.position.set(0, 0.6, 0.15);
  root.add(lamp);

  const wheelGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.08, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const [x, z] of [[-0.34, 0.24], [0.34, 0.24], [-0.34, -0.24], [0.34, -0.24]]) {
    const wheel = new THREE.Mesh(wheelGeo, m.dark);
    wheel.position.set(x, 0.12, z);
    root.add(wheel);
  }

  const brush = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 12), m.bristle);
  brush.position.set(0, 0.04, 0.42);
  root.add(brush, blobShadow(0.55));
  return { root, brush, placed: false };
}
