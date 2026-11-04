// Vzhled logistiky 3.0 (D-05, D-06, O-04):
//   • pásy: rám + nožky (jedna sloučená geometrie), gumový pás s posunem pruhů v shaderu (žádné válečky)
//   • náklad: pytle prachu a cihly – dvě InstancedMesh, mezi kroky simulace se dopočítává poloha
//   • zásuvky (jen s kladivem v ruce): límec + šipka, vstup modrý, výstup oranžový, obsazená tmavší
//   • ucpaný pás: blikající oranžová LED na konci · depo: ukazatel naplnění, číselník, maják při plném
//   • slinovna: stavové světlo (zelená pracuje, žlutá čeká na prach, oranžová ucpaný výstup, červená bez energie)
//   • náhled pásu při stavění (modrý / zelený u zásuvky / červený)
import { MOON } from '../config.js';
import { game } from '../state.js';
import { STRUCTURES, padTopHeight, localToDir } from '../structures.js';
import { build, hammerActive } from '../build.js';
import { BELT, DEPOT, beltSamples, beltPointAt, beltPointInto, allSockets, socketFree, samplePath, liftSamples, tickPhase, beltSpeed } from '../logistics.js';
import { heightAt, terrainVersion } from '../planet/height.js';
import { settings } from '../settings.js';

const THREE = window.THREE;
const R = MOON.radius;
const ITEM_MAX = 2000, LED_MAX = 300, SOCK_MAX = 200;
const HALF_W = 0.5;
// šablona jednotkové krychle (středem v počátku) pro rychlé skládání rámu pásů
const BOX_T = new THREE.BoxGeometry(1, 1, 1);
const BOX_P = BOX_T.attributes.position.array, BOX_NR = BOX_T.attributes.normal.array, BOX_I = BOX_T.index.array, BOX_N = BOX_T.attributes.position.count;

// Kus pásu pro náhled v liště (registr 'belt-piece')
export function buildBeltPiece() {
  const g = new THREE.Group();
  const frame = new THREE.MeshLambertMaterial({ color: 0x5a5f6b }), deck = new THREE.MeshLambertMaterial({ color: 0x24262c });
  const add = (w, h, d, x, y, z, m) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); g.add(o); };
  add(1.0, 0.08, 3, 0, BELT.deck, 0, deck);
  add(0.08, 0.2, 3, -0.52, BELT.deck + 0.02, 0, frame);
  add(0.08, 0.2, 3, 0.52, BELT.deck + 0.02, 0, frame);
  for (const z of [-1.2, 1.2]) for (const x of [-0.45, 0.45]) add(0.08, BELT.deck, 0.08, x, BELT.deck / 2, z, frame);
  const bag = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 6), new THREE.MeshLambertMaterial({ color: 0xc9b98a }));
  bag.scale.set(1, 0.55, 0.8); bag.position.set(0, BELT.deck + 0.2, 0.4); g.add(bag);
  return { root: g };
}

// Rozdělovač / spojovač pásů: deska, rozbočovací skříň, pahýly pásů u zásuvek (2 na jednom konci, 1 na druhém)
export function buildBeltNode(kind) {
  const g = new THREE.Group();
  const M = c => new THREE.MeshLambertMaterial({ color: c });
  const plate = M(0x4b4f59), deck = M(0x24262c), hub = M(0xc9c6bc), hivis = M(0xf2b33d), inC = M(0x5fb8d9), outC = M(0xe8742a);
  const add = (w, h, d, x, y, z, m) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); g.add(o); return o; };
  add(3.2, 0.12, 2.8, 0, 0.06, 0, plate);
  add(3.24, 0.04, 0.12, 0, 0.13, -1.36, hivis);
  add(3.24, 0.04, 0.12, 0, 0.13, 1.36, hivis);
  add(2.0, 0.9, 1.6, 0, 0.57, 0, hub);
  add(2.05, 0.1, 1.65, 0, 1.06, 0, hivis);
  const two = kind === 'splitter' ? 1 : -1;                  // na které straně jsou 2 zásuvky (+z = vpředu)
  const stub = (x, z, out) => {
    add(1.0, 0.08, 0.7, x, BELT.deck, z, deck);
    add(0.5, 0.1, 0.1, x, BELT.deck + 0.12, z + (z > 0 ? 0.3 : -0.3), out ? outC : inC);
  };
  for (const x of [-0.8, 0.8]) stub(x, 1.05 * two, kind === 'splitter');
  stub(0, -1.05 * two, kind === 'merger');
  // šipky toku na víku skříně
  for (const x of kind === 'splitter' ? [-0.4, 0.4] : [0]) add(0.12, 0.04, 0.8, x, 1.13, 0.1, outC).rotation.y = kind === 'splitter' ? (x < 0 ? 0.4 : -0.4) : 0;
  return { root: g };
}

export function createBeltsView(scene) {
  // ---------- pásy ----------
  const frameMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const deckMat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, speed: { value: BELT.speed } },
    vertexShader: `
      attribute float along; varying float vAlong; varying vec3 vN;
      void main() { vAlong = along; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float time; uniform float speed; varying float vAlong; varying vec3 vN;
      void main() {
        float stripe = step(0.82, fract((vAlong - time * speed) / 0.6));
        vec3 c = mix(vec3(0.13, 0.135, 0.15), vec3(0.24, 0.25, 0.27), stripe) * (0.75 + 0.35 * max(0.0, vN.y));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  let frameMesh = null, deckMesh = null, sig = '';

  function rebuild() {
    for (const m of [frameMesh, deckMesh]) if (m) { scene.remove(m); m.geometry.dispose(); }
    frameMesh = deckMesh = null;
    const fp = [], fn = [], fc = [], fi = [];
    const dp = [], dn = [], da = [], di = [];
    const c = new THREE.Color();
    const P = new THREE.Vector3(), Q = new THREE.Vector3(), up = new THREE.Vector3(), t = new THREE.Vector3(), side = new THREE.Vector3();
    // kvádr w × h × d natočený podle os xv (vpravo), yv (nahoru), zv (podél), střed center → přidá do rámu.
    // O-11 / O-12: vrcholy ze šablony jednotkové krychle přímo do polí (dřív nový BoxGeometry + matice na každý kvádr –
    // přestavba 770 m pásů trvala ~150 ms v jednom snímku).
    const box = (center, xv, yv, zv, w, h, d, color) => {
      const base = fp.length / 3;
      c.setHex(color);
      for (let i = 0; i < BOX_N; i++) {
        const x = BOX_P[i * 3] * w, y = BOX_P[i * 3 + 1] * h, z = BOX_P[i * 3 + 2] * d;
        fp.push(center.x + xv.x * x + yv.x * y + zv.x * z, center.y + xv.y * x + yv.y * y + zv.y * z, center.z + xv.z * x + yv.z * y + zv.z * z);
        const nx = BOX_NR[i * 3], ny = BOX_NR[i * 3 + 1], nz = BOX_NR[i * 3 + 2];
        fn.push(xv.x * nx + yv.x * ny + zv.x * nz, xv.y * nx + yv.y * ny + zv.y * nz, xv.z * nx + yv.z * ny + zv.z * nz);
        fc.push(c.r, c.g, c.b);
      }
      for (let i = 0; i < BOX_I.length; i++) fi.push(base + BOX_I[i]);
    };
    for (const bl of game.s.belts || []) {
      const S = beltSamples(bl);
      let along = 0;
      for (let i = 0; i < S.length - 1; i++) {
        const a = S[i], b = S[i + 1];
        const ha = R + a.h + BELT.deck, hb = R + b.h + BELT.deck;
        P.set(a.p[0] * ha, a.p[1] * ha, a.p[2] * ha);
        Q.set(b.p[0] * hb, b.p[1] * hb, b.p[2] * hb);
        const L = P.distanceTo(Q);
        if (L < 1e-4) continue;
        t.subVectors(Q, P).normalize();
        up.copy(P).normalize();
        side.crossVectors(t, up).normalize();
        const n = up.clone().crossVectors(side, t).normalize();
        // pás (deska) – dva trojúhelníky s along
        const base = dp.length / 3;
        for (const [V, al] of [[P, along], [Q, along + L]]) for (const sgn of [-1, 1]) {
          const v = V.clone().addScaledVector(side, sgn * HALF_W).addScaledVector(n, 0.05);
          dp.push(v.x, v.y, v.z); dn.push(n.x, n.y, n.z); da.push(al);
        }
        di.push(base, base + 2, base + 1, base + 1, base + 2, base + 3, base, base + 1, base + 2, base + 1, base + 3, base + 2);
        // rám a boční lišty
        const mid = P.clone().add(Q).multiplyScalar(0.5);
        box(mid.clone().addScaledVector(n, -0.06), side, n, t, HALF_W * 2 + 0.1, 0.12, L + 0.02, 0x4b4f59);
        box(mid.clone().addScaledVector(side, -HALF_W - 0.04).addScaledVector(n, 0.07), side, n, t, 0.07, 0.16, L + 0.02, 0xf2b33d);
        box(mid.clone().addScaledVector(side, HALF_W + 0.04).addScaledVector(n, 0.07), side, n, t, 0.07, 0.16, L + 0.02, 0xf2b33d);
        // nožky každé ~3 m (na vršku mostu ne – stály by v kříženém pásu)
        if (i % 3 === 0 && !((a.lift || 0) > 0.6)) {
          for (const sgn of [-1, 1]) {
            const top = P.clone().addScaledVector(side, sgn * (HALF_W - 0.08)).addScaledVector(n, -0.1);
            const g = R + heightAt(a.p) - 0.2, hTop = top.length();
            const lenLeg = Math.max(0.1, hTop - g);
            box(top.clone().addScaledVector(up, -lenLeg / 2), side, up, t, 0.08, lenLeg, 0.08, 0x6c6a66);
          }
        }
        along += L;
      }
    }
    if (fp.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(fn, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(fc, 3));
      g.setIndex(fi);
      g.computeBoundingSphere();
      frameMesh = new THREE.Mesh(g, frameMat);
      frameMesh.userData.dbg = 'building';
      frameMesh.receiveShadow = true;
      scene.add(frameMesh);
    }
    if (dp.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(dp, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(dn, 3));
      g.setAttribute('along', new THREE.Float32BufferAttribute(da, 1));
      g.setIndex(di);
      g.computeBoundingSphere();
      deckMesh = new THREE.Mesh(g, deckMat);
      deckMesh.userData.dbg = 'building';
      scene.add(deckMesh);
    }
  }

  // ---------- náklad, LED, zásuvky, ukazatele ----------
  const mkInst = (geo, mat, n) => {
    const im = new THREE.InstancedMesh(geo, mat, n);
    if (mat.isMeshBasicMaterial) { const w = new THREE.Color(0xffffff); for (let i = 0; i < n; i++) im.setColorAt(i, w); }   // barvy instancí už při kompilaci shaderu
    im.count = 0; im.frustumCulled = false; im.userData.dbg = 'building';
    scene.add(im);
    return im;
  };
  const bagGeo = new THREE.SphereGeometry(0.32, 10, 6).scale(1, 0.55, 0.8);
  const bags = mkInst(bagGeo, new THREE.MeshLambertMaterial({ color: 0xc9b98a }), ITEM_MAX);
  const bricks = mkInst(new THREE.BoxGeometry(0.5, 0.24, 0.32), new THREE.MeshLambertMaterial({ color: 0xb8794f }), ITEM_MAX);
  const leds = mkInst(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), LED_MAX);
  const collars = mkInst(new THREE.CylinderGeometry(0.42, 0.42, 0.5, 12).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff }), SOCK_MAX);
  const arrows = mkInst(new THREE.ConeGeometry(0.28, 0.6, 10).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff }), SOCK_MAX);
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
  const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _b = new THREE.Matrix4();
  const COL = { in: new THREE.Color(0x5fb8d9), out: new THREE.Color(0xe8742a), orange: new THREE.Color(0xe8742a), red: new THREE.Color(0xe0654c),
    green: new THREE.Color(0x7fd38a), yellow: new THREE.Color(0xf2b33d), white: new THREE.Color(0xe4e2da), dark: new THREE.Color(0x2a2d33), neutral: new THREE.Color(0xc9b98a) };

  // orientace podle dvou bodů na povrchu (dopředu a nahoru)
  function frameAt(pos, fwd) {
    _y.copy(pos).normalize();
    _z.copy(fwd).addScaledVector(_y, -fwd.dot(_y)).normalize();
    _x.crossVectors(_y, _z);
    _b.makeBasis(_x, _y, _z);
    _q.setFromRotationMatrix(_b);
  }
  const worldAt = (dir, h) => _p.set(dir[0], dir[1], dir[2]).multiplyScalar(R + h);

  const itA = { p: [0, 0, 0], h: 0 }, itB = { p: [0, 0, 0], h: 0 };      // O-11: bez alokací na položku a snímek
  const itFwd = new THREE.Vector3(), itPos = new THREE.Vector3();
  function updateItems(focus) {
    let nb = 0, nk = 0;
    const phase = tickPhase(), v = beltSpeed();
    const fwd = itFwd, A = itPos;
    for (const bl of game.s.belts || []) {
      if (!bl.items.length) continue;
      const near = beltPointInto(bl, bl.len / 2, itA);
      if (worldAt(near.p, near.h).distanceTo(focus) > 80 + bl.len / 2) continue;   // dál než 80 m se nekreslí (O-04)
      const brick = bl.goods === 'brick';
      for (let i = 0; i < bl.items.length; i++) {
        const limit = i === 0 ? bl.len : bl.items[i - 1] - BELT.gap;
        const off = bl.clog ? bl.items[i] : Math.min(limit, bl.items[i] + v * phase);
        const a = beltPointInto(bl, off, itA), b = beltPointInto(bl, Math.min(bl.len, off + 0.3), itB);
        A.copy(worldAt(a.p, a.h + BELT.deck + 0.15));
        fwd.copy(worldAt(b.p, b.h + BELT.deck + 0.15)).sub(A);
        if (fwd.lengthSq() < 1e-8) fwd.set(1, 0, 0);
        frameAt(A, fwd);
        _m.compose(A, _q, _s.set(1, 1, 1));
        if (brick) { if (nk < ITEM_MAX) bricks.setMatrixAt(nk++, _m); } else if (nb < ITEM_MAX) bags.setMatrixAt(nb++, _m);
      }
    }
    bags.count = nb; bricks.count = nk;
    bags.instanceMatrix.needsUpdate = bricks.instanceMatrix.needsUpdate = true;
  }

  function addLed(n, pos, fwd, sx, sy, sz, col, glow) {
    if (n >= LED_MAX) return n;
    frameAt(pos, fwd);
    _m.compose(pos, _q, _s.set(sx, sy, sz));
    leds.setMatrixAt(n, _m);
    leds.setColorAt(n, _c.copy(col).multiplyScalar(glow));
    return n + 1;
  }

  function updateMarkers(now, focus) {
    let n = 0;
    const blink = Math.floor(now / 350) % 2 ? 1 : 0.2;
    const tmp = new THREE.Vector3(), fwd = new THREE.Vector3();
    // ucpané pásy: LED na konci
    for (const bl of game.s.belts || []) {
      if (!bl.clog) continue;
      const a = beltPointAt(bl, bl.len - 0.4);
      tmp.copy(worldAt(a.p, a.h + BELT.deck + 0.45));
      if (tmp.distanceTo(focus) > 90) continue;
      n = addLed(n, tmp.clone(), fwd.set(1, 0, 0), 0.22, 0.22, 0.22, COL.orange, blink);
    }
    // depa: ukazatel naplnění (sloupek na boku sila), maják při plném; slinovna: stavové světlo
    for (const b of game.s.buildings || []) {
      if (b.type !== 'depot' && b.type !== 'sinter') continue;
      const def = STRUCTURES[b.type];
      const base = padTopHeight(b) - (def.padTop || 0);
      const c = worldAt(b.p, base);
      if (c.distanceTo(focus) > 120) continue;
      const toward = new THREE.Vector3().subVectors(focus, c);
      if (b.type === 'depot') {
        const k = Math.min(1, (b.data.store || 0) / DEPOT.cap);
        const col = k >= 1 ? COL.red : k >= 0.8 ? COL.yellow : COL.neutral;
        const ax = new THREE.Vector3(); ax.copy(toward).addScaledVector(c.clone().normalize(), -toward.dot(c.clone().normalize())).normalize();   // strana k hráči
        const side = c.clone().add(ax.clone().multiplyScalar(1.56));
        const H = 4.0, y0 = 0.5;
        n = addLed(n, side.clone().addScaledVector(c.clone().normalize(), y0 + H / 2), ax, 0.34, H, 0.05, COL.dark, 1);   // průzor
        if (k > 0) n = addLed(n, side.clone().addScaledVector(ax, 0.02).addScaledVector(c.clone().normalize(), y0 + H * k / 2), ax, 0.3, H * k, 0.05, col, 1);
        if (k >= 1) n = addLed(n, c.clone().addScaledVector(c.clone().normalize(), 6.55), ax, 0.4, 0.3, 0.4, COL.red, Math.sin(now / 150) > 0 ? 1 : 0.15);   // maják
      } else {
        const st = b.data.state || 'idle';
        const col = st === 'work' ? COL.green : st === 'idle' ? COL.yellow : st === 'full' ? COL.orange : COL.red;
        // na čele haly (+Z) nad vchodem, výška 4,5 m
        const pos = worldAt(localToDir(b.p, b.yaw, 0, 2.7), base + 4.5);
        const glow = st === 'work' ? 0.7 + 0.3 * Math.sin(now / 300) : st === 'power' ? blink : 1;
        n = addLed(n, pos.clone(), toward, 0.6, 0.6, 0.08, col, glow);
      }
    }
    leds.count = n;
    leds.instanceMatrix.needsUpdate = true;
    if (leds.instanceColor) leds.instanceColor.needsUpdate = true;
  }

  function updateSockets(focus) {
    let n = 0;
    if (hammerActive()) {
      const fwd = new THREE.Vector3(), pos = new THREE.Vector3();
      for (const s of allSockets()) {
        if (n >= SOCK_MAX) break;
        const h = heightAt(s.p) + 0.75;
        pos.copy(worldAt(s.p, h));
        if (pos.distanceTo(focus) > 70) continue;
        const ahead = worldAt([s.p[0] + s.face[0] * 0.01, s.p[1] + s.face[1] * 0.01, s.p[2] + s.face[2] * 0.01], h);
        fwd.copy(ahead).sub(pos);
        if (s.dir === 'in') fwd.negate();                  // šipka ve směru toku: u vstupu dovnitř
        frameAt(pos, fwd);
        const free = socketFree(s.ref);
        const col = (s.dir === 'in' ? COL.in : COL.out).clone().multiplyScalar(free ? 1 : 0.35);
        _m.compose(pos, _q, _s.set(1, 1, 1));
        collars.setMatrixAt(n, _m); collars.setColorAt(n, col);
        _p.copy(pos).add(fwd.normalize().multiplyScalar(s.dir === 'in' ? -0.6 : 0.6)).addScaledVector(pos.clone().normalize(), 0.55);
        _m.compose(_p, _q, _s.set(1, 1, 1));
        arrows.setMatrixAt(n, _m); arrows.setColorAt(n, col);
        n++;
      }
    }
    collars.count = arrows.count = n;
    for (const im of [collars, arrows]) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
  }

  // ---------- náhled pásu při stavění ----------
  const PREV_MAX = 700;
  const prevGeo = new THREE.BufferGeometry();
  prevGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PREV_MAX * 2 * 3), 3));
  const preview = new THREE.LineSegments(prevGeo, new THREE.LineBasicMaterial({ color: 0x5fb8d9, transparent: true, opacity: 0.95 }));
  preview.frustumCulled = false;
  preview.visible = false;
  scene.add(preview);
  let prevSig = '';
  function updatePreview() {
    const pts = build.mode === 'belt' ? build.beltPts : null;
    if (!pts || pts.length < 2) { preview.visible = false; return; }
    preview.material.color.setHex(build.valid ? (build.beltTo ? 0x7fd38a : 0x5fb8d9) : 0xe0654c);
    const key = pts.map(p => p.map(v => v.toFixed(6)).join(',')).join('|') + '/' + (build.beltBridges || []).join(',');
    preview.visible = true;
    if (key === prevSig) return;
    prevSig = key;
    const S = liftSamples(samplePath(pts, 1), build.beltBridges);   // náhled ukáže i mosty přes jiné pásy
    const P = prevGeo.attributes.position;
    let k = 0;
    for (let i = 0; i < S.length - 1 && k < PREV_MAX; i++, k++) {
      const a = S[i], b = S[i + 1];
      const ha = R + a.h + BELT.deck + 0.1, hb = R + b.h + BELT.deck + 0.1;
      P.setXYZ(k * 2, a.p[0] * ha, a.p[1] * ha, a.p[2] * ha);
      P.setXYZ(k * 2 + 1, b.p[0] * hb, b.p[1] * hb, b.p[2] * hb);
    }
    prevGeo.setDrawRange(0, k * 2);
    P.needsUpdate = true;
  }

  // ---------- velký číselník depa (D-05): „3 420 / 5 000 kg“, svítí i v noci, barva podle naplnění ----------
  // Jedna malá textura na depo (překreslí se při změně o 10 kg), jen do 60 m od hráče. Na straně k hráči nad válcem sila.
  const dials = new Map();                                // id depa → { mesh, ctx, tex, shown }
  function dialFor(id) {
    let d = dials.get(id);
    if (d) return d;
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    const tex = new THREE.CanvasTexture(c);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }));
    mesh.userData.dbg = 'building';
    scene.add(mesh);
    d = { mesh, ctx: c.getContext('2d'), tex, shown: null };
    dials.set(id, d);
    return d;
  }
  function drawDial(d, kg) {
    const k = Math.min(1, kg / DEPOT.cap), ctx = d.ctx;
    const col = k >= 1 ? '#ff5a46' : k >= 0.8 ? '#f2b33d' : '#a6d9a0';
    ctx.clearRect(0, 0, 512, 128);
    ctx.fillStyle = 'rgba(13,16,23,0.92)';
    ctx.fillRect(4, 4, 504, 120);
    ctx.strokeStyle = col; ctx.lineWidth = 6; ctx.strokeRect(4, 4, 504, 120);
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(14, 96, 484, 14);
    ctx.fillStyle = col; ctx.fillRect(14, 96, 484 * k, 14);           // proužek naplnění
    ctx.font = '600 50px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.round(kg).toLocaleString('cs-CZ')} / ${DEPOT.cap.toLocaleString('cs-CZ')} kg`, 256, 50);
    d.tex.needsUpdate = true;
  }
  const _da = new THREE.Vector3(), _db = new THREE.Vector3(), _du = new THREE.Vector3(), _dm = new THREE.Matrix4();
  function updateDials(focus) {
    const seen = new Set();
    for (const b of game.s.buildings || []) {
      if (b.type !== 'depot') continue;
      const def = STRUCTURES.depot, base = padTopHeight(b) - (def.padTop || 0);
      const c = worldAt(b.p, base).clone();
      if (c.distanceTo(focus) > 60) continue;
      seen.add(b.id);
      const d = dialFor(b.id);
      const kg = Math.round((b.data.store || 0) / 10) * 10;
      if (d.shown !== kg) { d.shown = kg; drawDial(d, kg); }
      _du.copy(c).normalize();
      _da.subVectors(focus, c).addScaledVector(_du, -_da.copy(focus).sub(c).dot(_du)).normalize();     // vodorovně k hráči
      d.mesh.position.copy(c).addScaledVector(_du, 5.25).addScaledVector(_da, 1.3);   // nad válcem sila, nad sloupkovým ukazatelem
      _db.crossVectors(_du, _da);
      _dm.makeBasis(_db, _du, _da);
      d.mesh.quaternion.setFromRotationMatrix(_dm);
      d.mesh.visible = true;
    }
    for (const [id, d] of dials) {
      if (seen.has(id)) continue;
      if (!(game.s.buildings || []).some(b => b.id === id)) { scene.remove(d.mesh); d.mesh.geometry.dispose(); d.mesh.material.dispose(); d.tex.dispose(); dials.delete(id); }
      else d.mesh.visible = false;
    }
  }

  // ---------- slinovna: vlnění horkého vzduchu nad pecí, když pracuje (D-11; předvolba Nízká ho vypne) ----------
  // Průhledná rovina natočená k hráči s posouvanými vlnami v shaderu (bez lámání obrazu – levné).
  const HEAT_AT = [9.5, 5.2, 6.3];                         // nad blokem pece (model: záře u výstupu x 9,2, z 5,3–5,6)
  const heatMat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float time; varying vec2 vUv;
      void main() {
        float edge = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x) * smoothstep(0.0, 0.15, vUv.y) * (1.0 - vUv.y);
        float w = sin(vUv.y * 18.0 - time * 3.2 + sin(vUv.x * 9.0 + time * 1.7) * 1.6) * 0.5 + 0.5;
        float w2 = sin(vUv.x * 23.0 + vUv.y * 7.0 - time * 2.3) * 0.5 + 0.5;
        float a = edge * (0.07 + 0.15 * w * w2);
        gl_FragColor = vec4(mix(vec3(1.0, 0.82, 0.6), vec3(1.0), vUv.y), a);
      }`,
  });
  const heats = new Map();                                // id slinovny → mesh
  const _hu = new THREE.Vector3(), _hf = new THREE.Vector3(), _hx = new THREE.Vector3(), _hm = new THREE.Matrix4();
  function updateHeat(time, focus) {
    heatMat.uniforms.time.value = time;
    const seen = new Set();
    if (settings.particles) {
      for (const b of game.s.buildings || []) {
        if (b.type !== 'sinter' || b.data.state !== 'work') continue;
        const base = padTopHeight(b) - (STRUCTURES.sinter.padTop || 0);
        const c = worldAt(localToDir(b.p, b.yaw, HEAT_AT[0], HEAT_AT[2]), base + HEAT_AT[1]).clone();
        if (c.distanceTo(focus) > 90) continue;
        seen.add(b.id);
        let m = heats.get(b.id);
        if (!m) {
          m = new THREE.Mesh(new THREE.PlaneGeometry(8, 6), heatMat);
          m.renderOrder = 3;
          m.userData.dbg = 'building';
          scene.add(m);
          heats.set(b.id, m);
        }
        _hu.copy(c).normalize();
        _hf.subVectors(focus, c); _hf.addScaledVector(_hu, -_hf.dot(_hu)).normalize();
        _hx.crossVectors(_hu, _hf);
        _hm.makeBasis(_hx, _hu, _hf);
        m.quaternion.setFromRotationMatrix(_hm);
        m.position.copy(c).addScaledVector(_hu, 3);
        m.visible = true;
      }
    }
    for (const [id, m] of heats) {
      if (seen.has(id)) continue;
      if (!(game.s.buildings || []).some(b => b.id === id)) { scene.remove(m); m.geometry.dispose(); heats.delete(id); }
      else m.visible = false;
    }
  }

  // ---------- bourání: červeně úsek pásu, který se zbourá (od kloubu ke kloubu) ----------
  const CUT_MAX = 400;
  const cutGeo = new THREE.BufferGeometry();
  cutGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CUT_MAX * 6 * 3), 3));
  const cutMat = new THREE.MeshBasicMaterial({ color: 0xff3b2a, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
  const cut = new THREE.Mesh(cutGeo, cutMat);
  cut.frustumCulled = false;
  cut.renderOrder = 5;
  cut.visible = false;
  scene.add(cut);
  let cutSig = '';
  const cA = new THREE.Vector3(), cB = new THREE.Vector3(), cS = new THREE.Vector3(), cU = new THREE.Vector3();
  function updateCut() {
    const seg = build.mode === 'demolish' ? build.belt : null;
    const bl = seg ? (game.s.belts || []).find(b => b.id === seg.id) : null;
    if (!bl || seg.k >= bl.pts.length - 1) { cut.visible = false; cutSig = ''; return; }
    cut.visible = true;
    cutMat.opacity = 0.4 + 0.3 * (build.hold || 0) + 0.1 * Math.sin(performance.now() / 90);
    const key = `${bl.id}/${seg.k}/${bl.pts.length}`;
    if (key === cutSig) return;
    cutSig = key;
    // vzdálenost začátku a konce úseku podél pásu, z toho vzorky pásu (i s rampou k Výkupu)
    let s0 = 0;
    for (let i = 0; i < seg.k; i++) s0 += angleOf(bl.pts[i], bl.pts[i + 1]) * R;
    const s1 = s0 + angleOf(bl.pts[seg.k], bl.pts[seg.k + 1]) * R;
    const S = beltSamples(bl), P = cutGeo.attributes.position;
    let along = 0, n = 0;
    for (let i = 0; i < S.length - 1 && n < CUT_MAX; i++) {
      const a = S[i], b = S[i + 1], d = angleOf(a.p, b.p) * R;
      if (along + d > s0 - 0.01 && along < s1 + 0.01) {
        const ha = R + a.h + BELT.deck + 0.12, hb = R + b.h + BELT.deck + 0.12;
        cA.set(a.p[0] * ha, a.p[1] * ha, a.p[2] * ha);
        cB.set(b.p[0] * hb, b.p[1] * hb, b.p[2] * hb);
        cU.copy(cA).normalize();
        cS.subVectors(cB, cA).cross(cU).normalize().multiplyScalar(0.7);    // napříč pásem, 1,4 m
        const v = [cA.clone().sub(cS), cA.clone().add(cS), cB.clone().add(cS), cA.clone().sub(cS), cB.clone().add(cS), cB.clone().sub(cS)];
        v.forEach((q, j) => P.setXYZ(n * 6 + j, q.x, q.y, q.z));
        n++;
      }
      along += d;
    }
    cutGeo.setDrawRange(0, n * 6);
    P.needsUpdate = true;
  }
  const angleOf = (p, q) => Math.acos(Math.max(-1, Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2])));

  return {
    update(time, viewRange, focus) {
      const s = (game.s.belts || []).map(b => `${b.id}:${b.pts.length}:${b.br?.length || 0}`).join('|') + '#' + terrainVersion();
      if (s !== sig) { sig = s; rebuild(); }
      deckMat.uniforms.time.value = time;
      deckMat.uniforms.speed.value = beltSpeed();                 // výzkum Rychlejší pásy
      updateItems(focus);
      updateMarkers(performance.now(), focus);
      updateSockets(focus);
      updatePreview();
      updateCut();
      updateDials(focus);
      updateHeat(time, focus);
    },
    fade() {},                                          // nízké pásy kameru nezakrývají (v2 pásy byly 6,5 m vysoko)
  };
}
