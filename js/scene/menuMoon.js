// Otáčející se Měsíc na úvodní obrazovce (D-19, O-25, 3.1). Náš Měsíc: ikosaedr dělený na 5 120 trojúhelníků
// s reliéfem z herní funkce rawHeightAt() (převýšení 0,7× – viz EXAGGERATE), takže krátery jsou na stejných místech jako ve hře.
// Ploché stínování (geometrie bez sdílených vrcholů → normála = normála stěny), písková barva s jemnou
// odchylkou na každém trojúhelníku, žlutá značka základny přímo v barvách (bez dalšího vykreslení).
// Vlastní malý WebGL renderer bez antialiasu, 1 vykreslení, nejvýš 30 snímků/s, jen když je menu vidět.
// Při startu hry se uvolní (dispose). Když WebGL nejde, zůstane obrázek moon.png otáčený přes CSS.
import { MOON, PLANET, BASE } from '../config.js';
import { rawHeightAt } from '../planet/height.js';
import { mulberry32 } from '../planet/noise.js';

const DETAIL = 15;                       // IcosahedronGeometry(1, 15) = 20 × 16² = 5 120 trojúhelníků, 2 562 různých vrcholů
const EXAGGERATE = 0.8;                  // převýšení reliéfu: zadání 2,5×, ale výšky jsou −30…+36 m na poloměru 304 m → ±30 % (kámen);
                                         // 0,7× = asi ±8 % poloměru jako na moon.png
const TURN_S = 180, TURN_SLOW_S = 900;   // jedna otáčka za 3 min (při omezení pohybu za 15 min)
const TILT = 15 * Math.PI / 180;         // sklon osy
const FRAME_MS = 1000 / 30;
const BASE_MARK_M = 26;                  // poloměr žluté značky základny (m)
const COLORS = { moon: [0.86, 0.69, 0.48], mars: [0.72, 0.38, 0.22] };

export function createMenuMoon(sky, img) {
  const THREE = window.THREE;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fallback = () => { img?.classList.add('menu__moon-img--spin'); return null; };
  if (!THREE || !sky) return fallback();

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'low-power' });
    if (!renderer.getContext()) throw new Error('webgl');
  } catch {
    return fallback();
  }
  renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.className = 'menu__moon-canvas';
  canvas.setAttribute('aria-hidden', 'true');

  // --- geometrie ---
  const t0 = performance.now();
  const geo = new THREE.IcosahedronGeometry(1, DETAIL);         // r128: bez indexu → každý trojúhelník má vlastní vrcholy
  const pos = geo.attributes.position;
  const R = MOON.radius;
  const scaleOf = new Map();                                     // stejné místo = stejná výška (2 562 volání heightAt)
  let maxScale = 1;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const l = Math.hypot(x, y, z) || 1;
    x /= l; y /= l; z /= l;
    const key = `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`;
    let s = scaleOf.get(key);
    if (s === undefined) {
      s = 1 + (rawHeightAt([x, y, z]) * EXAGGERATE) / R;
      scaleOf.set(key, s);
      if (s > maxScale) maxScale = s;
    }
    pos.setXYZ(i, x * s, y * s, z * s);
  }
  geo.computeVertexNormals();

  const rand = mulberry32((PLANET.seed | 0) + 77);
  const [cr, cg, cb] = COLORS[PLANET.id] || COLORS.moon;
  const colors = new Float32Array(pos.count * 3);
  const markCos = Math.cos(BASE_MARK_M / R);
  for (let t = 0; t < pos.count; t += 3) {
    let mx = 0, my = 0, mz = 0;
    for (let k = 0; k < 3; k++) { mx += pos.getX(t + k); my += pos.getY(t + k); mz += pos.getZ(t + k); }
    const ml = Math.hypot(mx, my, mz) || 1;
    const onBase = (mx * BASE.dir[0] + my * BASE.dir[1] + mz * BASE.dir[2]) / ml > markCos;
    const j = 0.92 + rand() * 0.14;                              // jemná odchylka na každém trojúhelníku
    const c = onBase ? [1.0, 0.8, 0.18] : [cr * j, cg * j, cb * j];
    for (let k = 0; k < 3; k++) colors.set(c, (t + k) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat);

  // základna na začátku k divákovi (trochu vlevo nahoru, ať je značka hned vidět)
  const want = new THREE.Vector3(-0.35, 0.3, 1).normalize();
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(...BASE.dir).normalize(), want);
  const spin = new THREE.Group();
  spin.add(mesh);
  const tilt = new THREE.Group();
  tilt.rotation.z = TILT;
  tilt.add(spin);

  const scene = new THREE.Scene();
  scene.add(tilt);
  const sun = new THREE.DirectionalLight(0xfff4e2, 1.05);       // světlo zleva shora, terminátor vpravo dole
  sun.position.set(-1, 0.9, 0.75);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0x8c8fa0, 0.22));
  const camera = new THREE.PerspectiveCamera(18, 1, 0.1, 100);
  camera.position.set(0, 0, (maxScale * 1.03) / Math.sin((18 / 2) * Math.PI / 180));
  camera.lookAt(0, 0, 0);
  const buildMs = performance.now() - t0;

  sky.appendChild(canvas);
  if (img) img.hidden = true;

  let w = 0, h = 0;
  function resize() {
    const r = canvas.getBoundingClientRect();
    const nw = Math.round(r.width), nh = Math.round(r.height);
    if (!nw || !nh || (nw === w && nh === h)) return;
    w = nw; h = nh;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  let raf = 0, last = 0, alive = true;
  const start = performance.now();
  const period = (reduced ? TURN_SLOW_S : TURN_S) * 1000;
  function frame(now) {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    if (now - last < FRAME_MS) return;
    if (document.hidden || !canvas.offsetParent) return;          // skrytá karta / menu zavřené / lobby → nekreslit
    last = now;
    resize();
    spin.rotation.y = ((now - start) / period) * Math.PI * 2;
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);

  return {
    buildMs,
    triangles: pos.count / 3,
    // start hry: uvolnit všechno, ať hra nemá v paměti dva WebGL kontexty
    dispose() {
      if (!alive) return;
      alive = false;
      cancelAnimationFrame(raf);
      geo.dispose();
      mat.dispose();
      renderer.dispose();
      renderer.forceContextLoss?.();
      canvas.remove();
      if (img) img.hidden = false;
    },
  };
}
