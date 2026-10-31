// Hologram Měsíce z hexů: zelené hexy = dočištěné, žluté = rozpracované, červené = nedotčené (0 %).
// Jedna sdílená geometrie (všechny hexy, mírně od sebe) slouží malému hologramu nad Výkupem
// i velkému otáčecímu hologramu v okně Výkupu (vlastní renderer, běží jen když je okno otevřené).
import { BASE } from '../config.js';
import { grid } from '../planet/hexgrid.js';
import { hexes } from '../planet/dustmap.js';
import { game } from '../state.js';
import { ROCKET_SITE } from '../rocket.js';

const THREE = window.THREE;
const INSET = 0.84;                                  // velikost hexu proti mřížce (mezery mezi hexy)
const GREEN = [70, 255, 150], YELLOW = [255, 210, 60], RED = [255, 72, 72];

let shared = null;                                   // { geo, colors, attr, start, count, last }
let material = null;

function buildGeometry() {
  const n = grid.cells, TD = grid.triDir, CT = grid.cellTris, CC = grid.cellTriCount, D = grid.dirs;
  const pos = new Float32Array(n * 7 * 3), colors = new Uint8Array(n * 7 * 3);
  const idx = new Uint32Array(n * 6 * 3);
  const start = new Int32Array(n), count = new Uint8Array(n);
  let v = 0, ii = 0;
  for (let c = 0; c < n; c++) {
    const k = CC[c], cx = D[c * 3], cy = D[c * 3 + 1], cz = D[c * 3 + 2];
    start[c] = v;
    count[c] = k + 1;
    pos[v * 3] = cx; pos[v * 3 + 1] = cy; pos[v * 3 + 2] = cz;
    v++;
    for (let m = 0; m < k; m++) {
      const a = CT[c * 6 + m] * 3;
      const x = cx + (TD[a] - cx) * INSET, y = cy + (TD[a + 1] - cy) * INSET, z = cz + (TD[a + 2] - cz) * INSET;
      const l = Math.hypot(x, y, z);
      pos[v * 3] = x / l; pos[v * 3 + 1] = y / l; pos[v * 3 + 2] = z / l;
      v++;
    }
    for (let m = 0; m < k; m++) {
      idx[ii++] = start[c]; idx[ii++] = start[c] + 1 + m; idx[ii++] = start[c] + 1 + (m + 1) % k;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, v * 3), 3));
  const attr = new THREE.BufferAttribute(colors.subarray(0, v * 3), 3, true);
  geo.setAttribute('hcol', attr);
  geo.setIndex(new THREE.BufferAttribute(idx.subarray(0, ii), 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.01);
  return { geo, colors: attr.array, attr, start, count, last: -1e9 };
}

// Stav hexu: 0 = dočištěný (nebo bez prachu), 1 = rozpracovaný, 2 = nedotčený.
const hexState = c => (hexes.done[c] || !hexes.init[c] ? 0 : hexes.left[c] >= hexes.init[c] ? 2 : 1);

// Počty hexů s prachem: { done, started, fresh, total }.
export function holoCounts() {
  const out = { done: 0, started: 0, fresh: 0, total: hexes.total };
  if (!hexes.init) return out;
  for (let c = 0; c < grid.cells; c++) {
    if (!hexes.init[c]) continue;
    const st = hexState(c);
    if (st === 0) out.done++; else if (st === 1) out.started++; else out.fresh++;
  }
  return out;
}

function recolor(force) {
  const now = performance.now();
  if (!force && now - shared.last < 900) return;
  shared.last = now;
  const { colors, start, count } = shared;
  for (let c = 0; c < grid.cells; c++) {
    const col = [GREEN, YELLOW, RED][hexState(c)];
    for (let v = start[c], e = v + count[c]; v < e; v++) {
      colors[v * 3] = col[0]; colors[v * 3 + 1] = col[1]; colors[v * 3 + 2] = col[2];
    }
  }
  shared.attr.needsUpdate = true;
}

function holoMaterial() {
  if (material) return material;
  material = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: `
      attribute vec3 hcol;
      varying vec3 vCol;
      varying vec3 vN;
      varying vec3 vView;
      varying float vY;
      void main() {
        vCol = hcol;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * position);
        vView = -mv.xyz;
        vY = mv.y / length(modelViewMatrix[1].xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float time;
      varying vec3 vCol;
      varying vec3 vN;
      varying vec3 vView;
      varying float vY;
      void main() {
        float fres = 1.0 - abs(dot(normalize(vN), normalize(vView)));
        float scan = 0.8 + 0.2 * sin(vY * 70.0 - time * 5.0);
        float flick = 0.94 + 0.06 * sin(time * 23.0);
        vec3 col = vCol * scan * flick * (0.55 + 1.1 * fres * fres);
        gl_FragColor = vec4(col, 0.5 + 0.45 * fres);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  return material;
}

// Globus hologramu (poloměr 1): hexy, jemná modrá slupka a značky Výkupu, rakety a hráče.
export function createHoloGlobe() {
  if (!shared) shared = buildGeometry();
  recolor(true);
  const root = new THREE.Group();
  const spin = new THREE.Group();
  root.add(spin);
  spin.add(new THREE.Mesh(shared.geo, holoMaterial()));
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.985, 32, 20), new THREE.MeshBasicMaterial({
    color: 0x0b2a3a, transparent: true, opacity: 0.55, depthWrite: true,
  }));
  shell.renderOrder = -1;                            // slupka první → zakryje hexy na odvrácené straně
  spin.add(shell);
  const pin = (color, size) => {
    // průhledné jako slupka, ať se kreslí po ní a značky na odvrácené straně zakryje
    const m = new THREE.Mesh(new THREE.SphereGeometry(size, 10, 8), new THREE.MeshBasicMaterial({ color, transparent: true }));
    m.renderOrder = 1;
    spin.add(m);
    return m;
  };
  const at = (m, d, lift = 1.03) => m.position.set(d[0] * lift, d[1] * lift, d[2] * lift);
  at(pin(0x5fb8d9, 0.035), BASE.dir);
  at(pin(0xffffff, 0.035), ROCKET_SITE.dir);
  const me = pin(0xff8a3d, 0.03);
  // prstenec „projektoru“ kolem rovníku
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.12, 1.15, 64), new THREE.MeshBasicMaterial({
    color: 0x6fe0ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  ring.rotation.x = Math.PI / 2;
  root.add(ring);
  return {
    root, spin,
    update(time) {
      material.uniforms.time.value = time;
      recolor(false);
      if (game.s) at(me, game.s.p, 1.035);
      me.visible = Math.floor(time * 3) % 2 === 0;
    },
  };
}

// Velký hologram v okně Výkupu: tažení = otáčení, kolečko = přiblížení.
export function createHoloView() {
  const canvas = document.createElement('canvas');
  canvas.className = 'holo__canvas';
  canvas.setAttribute('aria-label', 'Hologram Měsíce – táhni myší pro otočení');
  let renderer = null, scene, camera, globe, raf = 0, mounted = false;
  let dragging = false, lx = 0, ly = 0, dist = 3.4, auto = true;
  const qa = new THREE.Quaternion(), ax = new THREE.Vector3(1, 0, 0), ay = new THREE.Vector3(0, 1, 0);

  function setup() {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
    globe = createHoloGlobe();
    scene.add(globe.root);
    canvas.addEventListener('pointerdown', e => { dragging = true; auto = false; lx = e.clientX; ly = e.clientY; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', e => {
      if (!dragging) return;
      turn(e.clientX - lx, e.clientY - ly);
      lx = e.clientX; ly = e.clientY;
    });
    const stop = () => { dragging = false; };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      dist = Math.max(1.8, Math.min(6, dist * (e.deltaY > 0 ? 1.1 : 1 / 1.1)));
    }, { passive: false });
  }

  function turn(dx, dy) {
    qa.setFromAxisAngle(ay, dx * 0.008);
    globe.spin.quaternion.premultiply(qa);
    qa.setFromAxisAngle(ax, dy * 0.008);
    globe.spin.quaternion.premultiply(qa);
  }

  // Natočí glóbus tak, aby hráč byl uprostřed (pohled zepředu).
  function faceDir(d) {
    globe.spin.quaternion.setFromUnitVectors(new THREE.Vector3(d[0], d[1], d[2]), new THREE.Vector3(0, 0.35, 1).normalize());
  }

  function loop(t) {
    raf = requestAnimationFrame(loop);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    if (auto) turn(0.35, 0);
    camera.position.set(0, 0, dist);
    camera.lookAt(0, 0, 0);
    globe.update(t / 1000);
    renderer.render(scene, camera);
  }

  return {
    mount(container) {
      if (!renderer) setup();
      container.append(canvas);
      if (!mounted) {
        mounted = true;
        auto = true;
        if (game.s) faceDir(game.s.p);
        raf = requestAnimationFrame(loop);
      }
    },
    unmount() {
      if (!mounted) return;
      mounted = false;
      cancelAnimationFrame(raf);
      canvas.remove();
    },
  };
}
