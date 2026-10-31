// Budovy základny: výkup prachu, dílna, obchod s nástroji, garáž (staveniště / hotová),
// stanice robota a betonová plocha základny. Model: „nahoru“ = +y, vchod směrem +z.
import { MOON, DEPOT, BASE } from '../config.js';

const THREE = window.THREE;
const R = MOON.radius;
let M = null;

function materials() {
  if (M) return M;
  M = {
    wall:    new THREE.MeshLambertMaterial({ color: 0xe6e3da }),
    shade:   new THREE.MeshLambertMaterial({ color: 0xbdb9ae }),
    dark:    new THREE.MeshLambertMaterial({ color: 0x2d313b }),
    roof:    new THREE.MeshLambertMaterial({ color: 0x5a5f6b }),
    orange:  new THREE.MeshLambertMaterial({ color: 0xe8742a, emissive: 0x2a1004 }),
    hivis:   new THREE.MeshLambertMaterial({ color: 0xf2b33d, emissive: 0x3d2800 }),
    window:  new THREE.MeshLambertMaterial({ color: 0xffd58a, emissive: 0x6a4410 }),
    pad:     new THREE.MeshLambertMaterial({ color: 0xa9aaae }),
    beacon:  new THREE.MeshBasicMaterial({ color: 0x5fb8d9 }),
    green:   new THREE.MeshBasicMaterial({ color: 0x9fd39b }),
    beam:    new THREE.MeshBasicMaterial({
      color: 0x5fb8d9, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false,
    }),
    zone:    new THREE.MeshBasicMaterial({ color: 0x5fb8d9, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    plan:    new THREE.LineBasicMaterial({ color: 0x5fb8d9, transparent: true, opacity: 0.8 }),
  };
  return M;
}

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

function cyl(rt, rb, h, mat, x = 0, y = 0, z = 0, seg = 16) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  return m;
}

// Výstražný pruh (oranžovo-tmavé šikmé pruhy) jako textura.
let stripeTex = null;
function stripes() {
  if (stripeTex) return stripeTex;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 16;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#2d313b';
  ctx.fillRect(0, 0, 128, 16);
  ctx.fillStyle = '#e8742a';
  for (let x = -16; x < 128; x += 16) {
    ctx.beginPath();
    ctx.moveTo(x, 16); ctx.lineTo(x + 8, 16); ctx.lineTo(x + 16, 0); ctx.lineTo(x + 8, 0);
    ctx.fill();
  }
  stripeTex = new THREE.CanvasTexture(c);
  stripeTex.wrapS = THREE.RepeatWrapping;
  return stripeTex;
}

function hazard(w, h, x, y, z) {
  const t = stripes().clone();
  t.needsUpdate = true;
  t.repeat.set(w / 2, 1);
  return box(w, h, 0.05, new THREE.MeshBasicMaterial({ map: t }), x, y, z);
}

// Cedule s nápisem (svítí, aby šla přečíst i v noci).
function sign(text, w, h) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = Math.round(512 * h / w);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1b1e26';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#f2b33d';
  ctx.fillRect(0, c.height - 10, c.width, 10);
  ctx.fillStyle = '#e4e2da';
  ctx.font = `600 ${Math.round(c.height * 0.55)}px "Chakra Petch", "Arial Narrow", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, c.width / 2, c.height * 0.46);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c) }));
  return mesh;
}

// ---------- budovy ----------

export function buildDepot() {
  const m = materials();
  const root = new THREE.Group();
  root.add(
    cyl(1.1, 1.25, 0.9, m.wall, 0, 0.45, 0),
    cyl(1.17, 1.17, 0.08, m.hivis, 0, 0.72, 0),
    box(0.55, 0.62, 0.12, m.dark, 0, 0.31, 1.18),
    cyl(0.03, 0.03, 0.9, m.dark, 0, 2.3, 0, 6),
  );
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), m.wall);
  dome.position.y = 0.9;
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), m.beacon);
  beacon.position.y = 2.82;
  const beam = cyl(0.3, 0.3, 300, m.beam, 0, 152, 0, 8);
  const zoneGeo = new THREE.RingGeometry(DEPOT.r - 0.15, DEPOT.r, 48);
  zoneGeo.rotateX(-Math.PI / 2);
  const zone = new THREE.Mesh(zoneGeo, m.zone);
  zone.position.y = 0.1;
  const label = sign('VÝKUP PRACHU', 2.4, 0.5);
  label.position.set(0, 1.55, 1.05);
  label.rotation.x = -0.35;
  root.add(dome, beacon, beam, zone, label);
  return { root, beacon };
}

export function buildWorkshop() {
  const m = materials();
  const root = new THREE.Group();
  root.add(
    box(9, 4.2, 7, m.wall, 0, 2.1, 0),
    box(9.2, 0.35, 7.2, m.roof, 0, 4.35, 0),
    box(9.02, 0.5, 7.02, m.shade, 0, 0.25, 0),
    box(4.2, 3.2, 0.08, m.dark, 0, 1.6, 3.52),             // vrata
    box(0.12, 4.2, 0.12, m.orange, -4.5, 2.1, 3.5),
    box(0.12, 4.2, 0.12, m.orange, 4.5, 2.1, 3.5),
    box(1.6, 0.8, 0.05, m.window, -3.0, 2.6, 3.52),
    box(1.6, 0.8, 0.05, m.window, 3.0, 2.6, 3.52),
    hazard(4.2, 0.3, 0, 3.35, 3.54),
  );
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.8, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2.6), m.wall);
  dish.position.set(2.8, 4.9, -1.5);
  dish.rotation.x = 0.6;
  const label = sign('DÍLNA', 3.2, 0.7);
  label.position.set(0, 3.85, 3.56);
  root.add(dish, label);
  return { root };
}

export function buildToolshop() {
  const m = materials();
  const root = new THREE.Group();
  root.add(
    box(7, 3.6, 6, m.wall, 0, 1.8, 0),
    box(7.2, 0.3, 6.2, m.roof, 0, 3.75, 0),
    box(7.02, 0.5, 6.02, m.shade, 0, 0.25, 0),
    box(5.4, 1.6, 0.05, m.window, 0, 1.6, 3.02),           // výloha
    box(1.4, 2.4, 0.06, m.dark, 2.0, 1.2, 3.04),            // dveře
  );
  const awning = box(7.2, 0.08, 1.8, m.orange, 0, 3.0, 3.8);
  awning.rotation.x = 0.28;
  const label = sign('NÁSTROJE', 3.4, 0.7);
  label.position.set(0, 3.3, 3.06);
  for (let i = 0; i < 4; i++) {
    const post = cyl(0.04, 0.04, 1.6, m.dark, -2.4 + i * 1.6, 1.6, 2.98, 6);   // „nástroje“ ve výloze
    root.add(post);
  }
  root.add(awning, label);
  return { root };
}

// Hotová garáž: hangár s obloukovou střechou.
function garageBuilt() {
  const m = materials();
  const g = new THREE.Group();
  // půlválec (osa podél hloubky garáže z, oblouk nahoru); dřív byl otočený obloukem dolů pod zem
  const shellMat = m.wall.clone();
  shellMat.side = THREE.DoubleSide;                   // i zevnitř (kamera za vraty)
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 10, 20, 1, false, -Math.PI / 2, Math.PI), shellMat);
  shell.rotation.x = -Math.PI / 2;
  shell.scale.set(1, 1, 0.75);                        // místní z = výška oblouku po otočení
  g.add(shell);
  const front = new THREE.Mesh(new THREE.CircleGeometry(6, 20, 0, Math.PI), m.shade);
  front.position.set(0, 0, 5.01);
  front.scale.set(1, 0.75, 1);
  g.add(front,
    box(7.5, 3.8, 0.1, m.dark, 0, 1.9, 5.06),
    hazard(7.5, 0.3, 0, 3.95, 5.09),
    box(12.2, 0.3, 10.2, m.shade, 0, 0.15, 0),
  );
  const label = sign('GARÁŽ', 3.2, 0.7);
  label.position.set(0, 4.45, 5.1);
  g.add(label);
  return g;
}

// Staveniště: deska, sloupky, modrý „plán“ budovy.
function garageSite() {
  const m = materials();
  const g = new THREE.Group();
  g.add(box(12, 0.25, 10, m.pad, 0, 0.12, 0));
  for (const [x, z] of [[-6, -5], [6, -5], [-6, 5], [6, 5]]) {
    g.add(box(0.25, 1.4, 0.25, m.hivis, x, 0.7, z));
  }
  const plan = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(12, 4.5, 10)), m.plan);
  plan.position.y = 2.25;
  const label = sign('STAVENIŠTĚ · GARÁŽ', 4.2, 0.6);
  label.position.set(0, 1.5, 5.15);
  g.add(plan, label);
  return g;
}

export function buildGarage() {
  const root = new THREE.Group();
  const site = garageSite();
  const built = garageBuilt();
  root.add(site, built);
  return {
    root,
    setBuilt(on) {
      site.visible = !on;
      built.visible = on;
    },
  };
}

// Stanice robota: podložka, dok se světlem, solární panel.
export function buildStation(ghostMaterial = null) {
  const m = materials();
  const mat = mm => ghostMaterial || mm;
  const root = new THREE.Group();
  root.add(
    cyl(1.3, 1.4, 0.18, mat(m.pad), 0, 0.09, 0, 20),
    cyl(1.32, 1.32, 0.05, mat(m.hivis), 0, 0.2, 0, 20),
    box(0.5, 1.3, 0.4, mat(m.wall), 0, 0.85, -0.7),
    box(0.3, 0.12, 0.05, mat(m.green), 0, 1.25, -0.48),
    cyl(0.02, 0.02, 0.8, mat(m.dark), 0.15, 1.9, -0.7, 4),
  );
  const panel = box(1.2, 0.04, 0.7, mat(m.dark), 0, 1.6, -0.95);
  panel.rotation.x = -0.5;
  root.add(panel);
  return { root };
}

// Depo na prach: silo s násypkou, nahoře hlava pásu, kolem vysýpací zóna.
export function buildSilo(ghostMaterial = null) {
  const m = materials();
  const mat = mm => ghostMaterial || mm;
  const root = new THREE.Group();
  root.add(
    cyl(2.3, 2.5, 0.25, mat(m.pad), 0, 0.12, 0, 24),
    cyl(1.5, 1.5, 4.2, mat(m.wall), 0, 2.45, 0, 20),
    cyl(1.53, 1.53, 0.18, mat(m.hivis), 0, 1.3, 0, 20),
    cyl(1.53, 1.53, 0.18, mat(m.hivis), 0, 3.6, 0, 20),
    cyl(0.2, 1.5, 1.1, mat(m.shade), 0, 5.1, 0, 20),
    box(1.1, 0.7, 1.1, mat(m.roof), 0, 6.0, 0),                 // hlava pásu
    box(1.0, 0.9, 1.4, mat(m.dark), 0, 0.7, 1.75),               // násypka
  );
  for (const [x, z] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) root.add(box(0.18, 1.0, 0.18, mat(m.dark), x, 0.5, z));
  if (!ghostMaterial) {
    const zoneGeo = new THREE.RingGeometry(4.35, 4.5, 48);
    zoneGeo.rotateX(-Math.PI / 2);
    const zone = new THREE.Mesh(zoneGeo, new THREE.MeshBasicMaterial({ color: 0xb48cf0, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
    zone.position.y = 0.12;
    const label = sign('DEPO', 2.0, 0.5);
    label.position.set(0, 2.5, 1.56);
    root.add(zone, label);
  }
  return { root };
}

// Betonová plocha základny – kulový vrchlík, aby kopírovala zakřivení Měsíce.
export function buildBasePad() {
  const ang = BASE.clean / R;
  const geo = new THREE.SphereGeometry(R + 0.04, 72, 6, 0, Math.PI * 2, 0, ang);
  const mesh = new THREE.Mesh(geo, materials().pad);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...BASE.dir));
  return mesh;
}
