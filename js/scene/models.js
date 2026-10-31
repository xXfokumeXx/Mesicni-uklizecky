// Low-poly modely robota zametače, UFO dronu, jetpacku a opasku (astronaut: astronaut.js, vozidla: vehicles.js, budovy: buildings.js).
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
    ufoGlass: new THREE.MeshPhongMaterial({ color: 0x6ff0e0, emissive: 0x0d3a36, specular: 0xffffff, shininess: 90, transparent: true, opacity: 0.8 }),
    hivisLamp: new THREE.MeshBasicMaterial({ color: 0xf2b33d }),
    flame:   new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
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

// UFO dron: talíř s kopulí, světly po obvodu a sacím paprskem dolů (beam = viditelný při čištění).
export function buildDrone() {
  const m = materials();
  const root = new THREE.Group();
  const body = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 0.55, 0.32, 20), m.bot);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.08, 20), m.dark);
  rim.position.y = 0.12;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), m.ufoGlass);
  dome.position.y = 0.16;
  body.add(disc, rim, dome);
  const lights = [];
  for (let k = 0; k < 8; k++) {
    const a = k / 8 * Math.PI * 2;
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), k % 2 ? m.botLamp : m.hivisLamp);
    l.position.set(Math.cos(a) * 1.1, 0.04, Math.sin(a) * 1.1);
    body.add(l);
    lights.push(l);
  }
  const beamGeo = new THREE.CylinderGeometry(0.35, 1.1, 1, 16, 1, true);
  beamGeo.translate(0, -0.5, 0);
  const beam = new THREE.Mesh(beamGeo, m.beam);
  beam.position.y = -0.1;
  root.add(body, beam, blobShadow(0.9));
  return { root, body, beam, lights };
}

// Jetpack (náhled v Dílně a na zádech astronauta): dvě nádrže, trysky a plamen (flame).
export function buildJetpack() {
  const m = materials();
  const root = new THREE.Group();
  root.add(box(0.42, 0.5, 0.12, m.dark, 0, 0, 0));
  const flame = new THREE.Group();
  for (const x of [-0.13, 0.13]) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.55, 10), m.hivis);
    tank.position.set(x, 0.02, -0.1);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.1, 10), m.dark);
    nozzle.position.set(x, -0.3, -0.1);
    const fire = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.45, 8), m.flame);
    fire.rotation.x = Math.PI;
    fire.position.set(x, -0.58, -0.1);
    flame.add(fire);
    root.add(tank, nozzle);
  }
  flame.visible = false;
  root.add(flame);
  root.userData.flame = flame;
  return root;
}

// Opasek na nářadí (náhled v Dílně): pásek s kapsami, víc kapes s vyšší úrovní.
export function buildBelt(level = 0) {
  const m = materials();
  const root = new THREE.Group();
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 6, 24), m.dark);
  strap.rotation.x = Math.PI / 2;
  root.add(strap, box(0.16, 0.14, 0.06, m.hivis, 0, 0, 0.44));
  for (let k = 0; k < level + 1; k++) {
    const a = (k - level / 2) * 0.9 + Math.PI;
    const pouch = box(0.2, 0.24, 0.12, m.bot, Math.sin(a) * 0.44, -0.04, Math.cos(a) * 0.44);
    pouch.rotation.y = a;
    root.add(pouch);
  }
  return root;
}
