// Raketa na odvrácené straně (~36 m) na betonové rampě s věží, vedle lunární modul a vlajka.
// Model: „nahoru“ = +y. Start: odpočet ROCKET.countdown s, pak zrychluje vzhůru s plamenem,
// po ROCKET.back s stojí raketa zase na rampě.
import { MOON } from '../config.js';
import { ROCKET, ROCKET_SITE, siteDir, launchSeconds, rocketReady } from '../rocket.js';
import { heightAt } from '../planet/height.js';

const THREE = window.THREE;
const R = MOON.radius;

const lam = (color, emissive = 0) => new THREE.MeshLambertMaterial({ color, emissive });
function cyl(rt, rb, h, mat, y, seg = 24) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.y = y;
  return m;
}
function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

function textTexture(lines, w, h, bg, fg) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(w * 0.62)}px "Chakra Petch", "Arial Narrow", sans-serif`;
  lines.forEach((ch, i) => ctx.fillText(ch, w / 2, (i + 0.5) * h / lines.length));
  return new THREE.CanvasTexture(c);
}

function czechFlag() {
  const c = document.createElement('canvas');
  c.width = 192; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 192, 64);
  ctx.fillStyle = '#d7141a'; ctx.fillRect(0, 64, 192, 64);
  ctx.fillStyle = '#11457e';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(96, 64); ctx.lineTo(0, 128); ctx.fill();
  return new THREE.CanvasTexture(c);
}

function buildRocket(M) {
  const g = new THREE.Group();
  // 1. stupeň s pěti motory a křidélky
  g.add(cyl(2.2, 2.2, 14, M.white, 8));
  g.add(cyl(2.24, 2.24, 1.2, M.black, 3.2));
  g.add(cyl(2.24, 2.24, 0.8, M.black, 12.6));
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2 + Math.PI / 4;
    const fin = box(0.25, 4.2, 2.4, M.red, Math.cos(a) * 2.9, 2.6, Math.sin(a) * 2.9);
    fin.rotation.y = -a;
    g.add(fin);
  }
  const bells = [[0, 0], [1.1, 0], [-1.1, 0], [0, 1.1], [0, -1.1]];
  for (const [x, z] of bells) {
    const b = cyl(0.32, 0.62, 1.2, M.metal, 0.4, 14);
    b.position.x = x; b.position.z = z;
    g.add(b);
  }
  // nápis podél trupu
  const label = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 10.5),
    new THREE.MeshLambertMaterial({ map: textTexture([...'ZAMETAČKY'], 64, 640, '#f4f2ec', '#1b1e26') }));
  label.position.set(0, 8.4, 2.21);
  g.add(label);
  // mezistupeň, 2. a 3. stupeň, kabina a záchranná věžička
  g.add(cyl(2.0, 2.2, 1.2, M.black, 15.6));
  g.add(cyl(2.0, 2.0, 8.5, M.white, 20.45));
  g.add(cyl(2.02, 2.02, 0.6, M.black, 22.5));
  g.add(cyl(1.6, 2.0, 1.0, M.white, 25.2));
  g.add(cyl(1.6, 1.6, 4.0, M.white, 27.7));
  g.add(cyl(0.45, 1.6, 3.2, M.silver, 31.3));
  g.add(cyl(0.08, 0.08, 3.2, M.red, 34.5, 6));
  const tip = cyl(0, 0.3, 0.8, M.red, 36.4, 10);
  g.add(tip);
  for (let k = 0; k < 6; k++) {                     // okénka kabiny
    const a = k / 6 * Math.PI * 2;
    const w = box(0.4, 0.4, 0.08, M.glass, Math.sin(a) * 1.15, 31.2, Math.cos(a) * 1.15);
    w.rotation.y = a;
    w.rotation.x = -0.4;
    g.add(w);
  }
  // plamen (při startu)
  const flame = new THREE.Group();
  const outer = new THREE.Mesh(new THREE.ConeGeometry(1.9, 14, 18, 1, true), M.flame);
  outer.rotation.x = Math.PI;
  outer.position.y = -7;
  const inner = new THREE.Mesh(new THREE.ConeGeometry(1.0, 7, 14, 1, true), M.flameCore);
  inner.rotation.x = Math.PI;
  inner.position.y = -3.5;
  flame.add(outer, inner);
  flame.visible = false;
  g.add(flame);
  return { group: g, flame };
}

function buildTower(M, h) {
  const g = new THREE.Group();
  const s = 1.4;
  for (const [x, z] of [[-s, -s], [s, -s], [s, s], [-s, s]]) g.add(box(0.22, h, 0.22, M.tower, x, h / 2, z));
  for (let y = 2; y < h; y += 3) {
    g.add(box(2 * s, 0.16, 0.16, M.tower, 0, y, -s), box(2 * s, 0.16, 0.16, M.tower, 0, y, s));
    g.add(box(0.16, 0.16, 2 * s, M.tower, -s, y, 0), box(0.16, 0.16, 2 * s, M.tower, s, y, 0));
  }
  // přístupová ramena k raketě
  for (const y of [14, 27]) g.add(box(0.5, 0.35, 3.4, M.hivis, 0, y, s + 1.7));
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), M.beacon);
  beacon.position.y = h + 0.4;
  g.add(beacon);
  return { group: g, beacon };
}

function buildLander(M) {
  const g = new THREE.Group();
  const descent = cyl(1.7, 1.7, 1.5, M.gold, 1.9, 8);
  g.add(descent);
  for (let k = 0; k < 4; k++) {                     // nohy s talířky
    const a = k * Math.PI / 2 + Math.PI / 4;
    const leg = cyl(0.07, 0.07, 2.6, M.silver, 1.2, 6);
    leg.position.set(Math.cos(a) * 2.0, 1.25, Math.sin(a) * 2.0);
    leg.rotation.set(Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45);
    const pad = cyl(0.42, 0.42, 0.08, M.silver, 0.05, 12);
    pad.position.x = Math.cos(a) * 2.55; pad.position.z = Math.sin(a) * 2.55;
    g.add(leg, pad);
  }
  const ascent = cyl(1.15, 1.3, 1.6, M.silver, 3.45, 6);
  g.add(ascent);
  g.add(box(0.7, 0.5, 0.1, M.glass, 0, 3.7, 1.15));
  g.add(cyl(0.05, 0.05, 1.3, M.metal, 4.8, 6));
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2.4), M.silver);
  dish.position.set(0, 5.4, 0);
  dish.rotation.x = 0.6;
  g.add(dish);
  for (let k = 0; k < 5; k++) g.add(box(0.5, 0.06, 0.06, M.silver, 0, 0.5 + k * 0.32, 1.85));   // žebřík
  return g;
}

function buildFlag(M) {
  const g = new THREE.Group();
  g.add(cyl(0.05, 0.05, 3.4, M.silver, 1.7, 8));
  const bar = cyl(0.03, 0.03, 1.9, M.silver, 3.3, 6);
  bar.rotation.z = Math.PI / 2;
  bar.position.x = 0.95;
  g.add(bar);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.25, 8, 1),
    new THREE.MeshLambertMaterial({ map: czechFlag(), side: THREE.DoubleSide }));
  const pos = cloth.geometry.attributes.position;          // trochu zvlněná (drátem vyztužená) látka
  for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin((pos.getX(i) + 0.95) * 3.2) * 0.08);
  cloth.geometry.computeVertexNormals();
  cloth.position.set(0.97, 2.65, 0);
  g.add(cloth);
  return g;
}

// prepare(root) = nastavení stínů (actors.js), orient(obj, up, forward), surface(dir, out, lift).
export function createRocketSite(scene, prepare, orient, surface) {
  const M = {
    white: lam(0xf4f2ec), black: lam(0x22252c), red: lam(0xd9533d, 0x200802), metal: lam(0x4a4f5c),
    silver: lam(0xb9bcc4), gold: lam(0xe0a83a, 0x3a2400), tower: lam(0xc0512a), hivis: lam(0xf2b33d, 0x3d2800),
    glass: lam(0x1d3550, 0x0a1a2a), concrete: lam(0x9a9a9e),
    beacon: new THREE.MeshBasicMaterial({ color: 0xff4040 }),
    flame: new THREE.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }),
    flameCore: new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
  };
  const up = new THREE.Vector3(), fwd = new THREE.Vector3();
  const D = ROCKET_SITE.dir;

  // rampa: horní plocha nad nejvyšším bodem terénu pod ní, nohy až dolů
  let hi = -Infinity, lo = Infinity;
  for (let k = 0; k < 16; k++) {
    const a = k / 16 * Math.PI * 2;
    for (const r of [0, ROCKET.pad * 0.5, ROCKET.pad]) {
      const h = heightAt(siteDir(Math.cos(a) * r, Math.sin(a) * r));
      hi = Math.max(hi, h); lo = Math.min(lo, h);
    }
  }
  const root = new THREE.Group();
  root.position.set(D[0], D[1], D[2]).multiplyScalar(R + hi + 0.5);
  orient(root, up.set(D[0], D[1], D[2]), fwd.set(...ROCKET_SITE.north));
  const legH = hi - lo + 1.5;
  const pad = cyl(ROCKET.pad, ROCKET.pad, 0.8, M.concrete, -0.1, 8);
  root.add(pad);
  for (let k = 0; k < 8; k++) {
    const a = k / 8 * Math.PI * 2;
    const leg = cyl(0.45, 0.6, legH, M.concrete, -legH / 2, 8);
    leg.position.x = Math.cos(a) * (ROCKET.pad - 0.8); leg.position.z = Math.sin(a) * (ROCKET.pad - 0.8);
    root.add(leg);
  }
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.0, 40), new THREE.MeshBasicMaterial({ color: 0xf2b33d, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.32;
  root.add(ring);
  const tower = buildTower(M, 33);
  tower.group.position.set(0, 0.3, -5.2);
  root.add(tower.group);
  const rocket = buildRocket(M);
  rocket.group.position.y = 0.3;
  root.add(rocket.group);
  scene.add(prepare(root));

  const lander = buildLander(M);
  const ld = siteDir(17, 5);
  surface(ld, lander.position);
  orient(lander, up.set(...ld), fwd.set(...ROCKET_SITE.east));
  scene.add(prepare(lander));
  const flag = buildFlag(M);
  const fd = siteDir(9, -8);
  surface(fd, flag.position);
  orient(flag, up.set(...fd), fwd.set(...ROCKET_SITE.north));
  scene.add(prepare(flag));

  const parts = [root, lander, flag];
  const sitePos = root.position.clone();
  return {
    // focus = kam míří kamera (THREE.Vector3); raketu je vidět zdaleka (vyčnívá nad obzor)
    update(time, focus) {
      const near = focus.distanceTo(sitePos) < 420;
      const t = launchSeconds();
      for (const p of parts) p.visible = near;
      root.visible = near || t > ROCKET.countdown;
      tower.beacon.visible = (Math.floor(time * 2) % 2 === 0) || rocketReady();
      ring.material.color.setHex(rocketReady() ? 0x7fd38a : 0xf2b33d);
      if (t < 0) {
        rocket.group.position.y = 0.3;
        rocket.flame.visible = false;
        rocket.group.visible = true;
        return;
      }
      const fly = Math.max(0, t - ROCKET.countdown);
      rocket.group.position.y = 0.3 + 2.5 * fly * fly;          // zrychlení 5 m/s²
      rocket.group.visible = rocket.group.position.y < 6000;
      rocket.flame.visible = t > ROCKET.countdown - 1;
      const f = 0.8 + 0.25 * Math.sin(time * 40) + Math.min(1.2, fly * 0.3);
      rocket.flame.scale.set(1, f, 1);
    },
    position: sitePos,
    // střed rakety ve světě (pro kameru při odletu)
    rocketPosition(out) {
      root.updateMatrixWorld();
      return rocket.group.localToWorld(out.set(0, 16, 0));
    },
  };
}
