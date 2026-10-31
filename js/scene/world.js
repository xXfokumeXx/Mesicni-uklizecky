// Renderer, světla a obloha: Slunce a hvězdy obíhají, Země visí na místě (vázaná rotace).
import { EARTH_DIR } from '../config.js';
import { sunAngle, sunDirection } from '../planet/sun.js';
import { fbm } from '../planet/noise.js';
import { dot } from '../planet/vec.js';

const THREE = window.THREE;
const SKY = { stars: 6000, sun: 4000, earth: 2500 };

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function canvasTexture(w, h, paint) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d'), w, h);
  return new THREE.CanvasTexture(c);
}

// Procedurální Země: oceán, pevniny, polární čepičky, mraky.
function earthTexture() {
  return canvasTexture(256, 128, (ctx, w, h) => {
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const lat = (0.5 - y / h) * Math.PI;
      for (let x = 0; x < w; x++) {
        const lon = x / w * Math.PI * 2;
        const dx = Math.cos(lat) * Math.cos(lon), dy = Math.sin(lat), dz = Math.cos(lat) * Math.sin(lon);
        const land = fbm(dx * 2.2 + 5, dy * 2.2, dz * 2.2, 4);
        const cloud = fbm(dx * 4 + 30, dy * 4, dz * 4, 3);
        let r = 28, g = 78, b = 168;
        if (land > 0.08) { r = 86; g = 118; b = 66; }
        if (land > 0.25) { r = 150; g = 128; b = 88; }
        if (Math.abs(dy) > 0.88) { r = g = b = 236; }
        if (cloud > 0.12) {
          const k = Math.min(1, (cloud - 0.12) * 4);
          r += (240 - r) * k; g += (240 - g) * k; b += (244 - b) * k;
        }
        const o = (y * w + x) * 4;
        img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

function glowTexture() {
  return canvasTexture(128, 128, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(255,248,230,1)');
    g.addColorStop(0.12, 'rgba(255,238,205,0.55)');
    g.addColorStop(1, 'rgba(255,220,170,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });
}

function buildStars() {
  const count = 2500;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const z = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    pos.set([Math.cos(th) * r * SKY.stars, z * SKY.stars, Math.sin(th) * r * SKY.stars], i * 3);
    const b = 0.45 + Math.random() * 0.55;
    col.set([b, b, b * (0.92 + Math.random() * 0.12)], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: 1.7, sizeAttenuation: false, vertexColors: true, transparent: true });
  return { points: new THREE.Points(geo, mat), mat };
}

// antialias jde nastavit jen při vytvoření rendereru, rozlišení kdykoli (setPixelRatio).
// shadows = stínová mapa objektů kolem hráče (stíny kopců řeší terén zvlášť a jsou vždy zapnuté).
export function createWorld(canvas, { antialias, pixelRatio, shadows }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias, powerPreference: 'high-performance' });
  renderer.setPixelRatio(pixelRatio);
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020306);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 9000);

  // Světla: Slunce, odraz od Země (earthshine) a slabé okolní světlo, aby noc nebyla úplně černá.
  const ambient = new THREE.AmbientLight(0x1c2433, 1);
  const sun = new THREE.DirectionalLight(0xfff2dc, 1.3);
  // stínová mapa jen v okolí hráče (posouvá se s ním) – levná i na integrované grafice
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera;
  sc.left = -28; sc.right = 28; sc.top = 28; sc.bottom = -28; sc.near = 1; sc.far = 180;
  sc.updateProjectionMatrix();
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  const earthLight = new THREE.DirectionalLight(0x7f9cd0, 0.2);
  earthLight.position.set(EARTH_DIR[0] * 100, EARTH_DIR[1] * 100, EARTH_DIR[2] * 100);
  scene.add(ambient, sun, sun.target, earthLight);

  // Obloha, která se otáčí (Slunce + hvězdy)
  const sky = new THREE.Group();
  const stars = buildStars();
  const tilt = Math.sin(0.0269), cosTilt = Math.cos(0.0269);
  const sunDisk = new THREE.Mesh(
    new THREE.SphereGeometry(45, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xfff6e6 }),
  );
  sunDisk.position.set(0, tilt * SKY.sun, cosTilt * SKY.sun);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  }));
  glow.position.copy(sunDisk.position);
  glow.scale.set(1400, 1400, 1);
  sky.add(stars.points, sunDisk, glow);
  scene.add(sky);

  // Země
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(42, 32, 20),
    new THREE.MeshLambertMaterial({ map: earthTexture(), emissive: 0x060b16 }),
  );
  earth.position.set(EARTH_DIR[0] * SKY.earth, EARTH_DIR[1] * SKY.earth, EARTH_DIR[2] * SKY.earth);
  earth.rotation.z = 0.41;                         // sklon zemské osy
  scene.add(earth);

  function resize() {
    const w = canvas.clientWidth || innerWidth;
    const h = canvas.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();

  // Posune oblohu na daný čas. up = „nahoru“ v místě hráče, focus = kam míří kamera (Vector3),
  // sunVis = 0–1, jak moc na hráče svítí Slunce (stín kopce ztmaví i objekty kolem něj).
  // Vrací údaje o světle pro shader terénu.
  function updateSky(ms, up, dt, focus, sunVis) {
    const angle = sunAngle(ms);
    sky.rotation.y = angle;
    const s = sunDirection(ms);
    sun.position.set(focus.x + s[0] * 90, focus.y + s[1] * 90, focus.z + s[2] * 90);
    sun.target.position.copy(focus);
    sun.intensity = 1.3 * sunVis;
    const earthIntensity = 0.32 * (1 - dot(s, EARTH_DIR)) / 2;  // „úplněk Země“ = silný earthshine
    earthLight.intensity = earthIntensity;
    stars.mat.opacity = 1 - 0.65 * smooth(-0.05, 0.3, dot(up, s)); // ve dne oči méně vidí hvězdy
    earth.rotation.y += dt * 0.05;
    const TAU = Math.PI * 2;
    return { sunDir: s, sunAngle: ((angle % TAU) + TAU) % TAU, earthDir: EARTH_DIR, earthIntensity };
  }

  // Stínová mapa pro shader terénu (null, když jsou stíny objektů vypnuté nebo ještě nevznikly).
  function shadowInfo() {
    if (!renderer.shadowMap.enabled || !sun.shadow.map) return null;
    return { map: sun.shadow.map, matrix: sun.shadow.matrix, mapSize: sun.shadow.mapSize };
  }

  function setShadows(on) {
    renderer.shadowMap.enabled = on;
    scene.traverse(o => {
      if (o.material) [].concat(o.material).forEach(m => { m.needsUpdate = true; });
    });
  }

  function setPixelRatio(ratio) {
    renderer.setPixelRatio(ratio);
    resize();
  }

  return { renderer, scene, camera, updateSky, setPixelRatio, shadowInfo, setShadows };
}
