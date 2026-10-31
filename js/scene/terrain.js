// Povrch Měsíce.
// Geometrie: každá stěna ikosaedru je trojúhelníková síť (192 dílků ≈ 1,3 m) rozdělená na 16 kusů;
// staví a kreslí se jen kusy v dohledu kamery.
// Prach: textura atlasu z planet/dustmap.js (1 bod ≈ 0,3 m). Shader podle ní terén ztmaví;
// po zametání se do GPU nahrají jen změněné obdélníky (ne celých 6,4 MB).
// Hexové sektory: tenké obrysy na povrchu, hotové sektory jsou lehce namodralé.
// Stíny kopců: pro každý kus se ve Web Workeru spočítá okno osvětlení (planet/sunwindow.js)
// a uloží do atributu vrcholů; shader (terrainMaterial.js) pak jen porovná úhel Slunce.
import { MOON, DUST, RELIEF, PLANET } from '../config.js';
import { FACES, faceOf, planar } from '../planet/icosa.js';
import { heightAt } from '../planet/height.js';
import { grid, dirToCell, HEX_SPACING } from '../planet/hexgrid.js';
import { W, H, atlasUv, hexes, dirty } from '../planet/dustmap.js';
import { game } from '../state.js';
import { FLAT_WINDOW, chunkWindowsRow } from '../planet/sunwindow.js';
import { createTerrainMaterial } from './terrainMaterial.js';

const THREE = window.THREE;
const R = MOON.radius;
const M = MOON.terrainSeg;           // dílků na hranu stěny
const K = MOON.terrainChunks;        // kusů na hranu stěny
const Q = M / K;                     // dílků na hranu kusu
const BUILD_PER_FRAME = 1;
const MAX_BUILT = 210;
const EDGE_STEPS = 6;                // na kolik úseků se dělí hrana hexu (aby kopírovala terén)
const SHADOW_STEP = 2;               // stíny se počítají v každém 2. vrcholu (~2,6 m) a interpolují
const SHADOW_N = Q / SHADOW_STEP + 1;

const BASE = PLANET.clean;           // čistý povrch (prach ho v shaderu ztmaví / na Marsu zrezaví)
const DONE = PLANET.done;            // hotový sektor – jasně odlišený (Měsíc namodralý, Mars světlejší)

// ---------- rozdělení stěn na kusy ----------

const CHUNKS = [];
const chunkKey = new Map();
for (let f = 0; f < 20; f++) {
  for (let I = 0; I < K; I++) {
    for (let J = 0; J < K - I; J++) {
      chunkKey.set(`${f},${I},${J},1`, CHUNKS.length);
      CHUNKS.push({ f, oi: I * Q, oj: J * Q, dir: 1 });
      if (I + J <= K - 2) {
        chunkKey.set(`${f},${I},${J},0`, CHUNKS.length);
        CHUNKS.push({ f, oi: (I + 1) * Q, oj: (J + 1) * Q, dir: -1 });
      }
    }
  }
}
CHUNKS.forEach((ch, i) => { ch.index = i; });
for (const ch of CHUNKS) {
  const P = FACES[ch.f];
  const pt = (a, b) => {
    const s = (ch.oi + ch.dir * a) / M, t = (ch.oj + ch.dir * b) / M;
    const x = P.A[0] + P.e1[0] * s + P.e2[0] * t, y = P.A[1] + P.e1[1] * s + P.e2[1] * t, z = P.A[2] + P.e1[2] * s + P.e2[2] * t;
    const l = Math.hypot(x, y, z);
    return [x / l, y / l, z / l];
  };
  ch.center = pt(Q / 3, Q / 3);
  const corners = [pt(0, 0), pt(Q, 0), pt(0, Q)];
  ch.radius = Math.max(...corners.map(c => Math.acos(Math.min(1, c[0] * ch.center[0] + c[1] * ch.center[1] + c[2] * ch.center[2])))) + 0.01;
  ch.mesh = null;
  ch.lines = null;
  ch.vertHex = null;
  ch.lastSeen = 0;
  ch.hexes = [];
}

const tmp = [0, 0];
function chunkOfDir(d) {
  const f = faceOf(d);
  planar(d, f, tmp);
  const x = Math.min(K - 1e-6, Math.max(0, tmp[0] * K)), y = Math.min(K - 1e-6, Math.max(0, tmp[1] * K));
  const I = Math.floor(x), J = Math.floor(y);
  const up = (x - I) + (y - J) < 1 || I + J >= K - 1;
  return chunkKey.get(`${f},${I},${Math.min(J, K - 1 - I)},${up ? 1 : 0}`);
}

// ---------- terén ----------

export function createTerrain(scene, renderer, viewDistance) {
  // přiřazení hexů ke kusům (podle středu) kvůli obrysům
  for (const ch of CHUNKS) ch.hexes = [];
  for (let c = 0; c < grid.cells; c++) {
    const idx = chunkOfDir([grid.dirs[c * 3], grid.dirs[c * 3 + 1], grid.dirs[c * 3 + 2]]);
    if (idx !== undefined) CHUNKS[idx].hexes.push(c);
  }

  const texture = new THREE.DataTexture(game.dust, W, H, THREE.LuminanceFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;

  const { material, uniforms } = createTerrainMaterial(texture, 255 / DUST.max, renderer);
  // Obrysy hexů jsou vidět jen do 3 hexů od astronauta, dál plynule mizí (shader podle vzdálenosti).
  const LINE_NEAR = HEX_SPACING * 3.3, LINE_FAR = HEX_SPACING * 4.1;
  const lineUniforms = {
    focus: { value: new THREE.Vector3(0, 0, R) },
    color: { value: new THREE.Color(0xf2b33d) },
    opacity: { value: 0.36 },
    near: { value: LINE_NEAR },
    far: { value: LINE_FAR },
  };
  const lineMat = new THREE.ShaderMaterial({
    uniforms: lineUniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */`
      uniform vec3 focus;
      varying float vDist;
      void main() {
        vDist = distance(position, focus);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 color;
      uniform float opacity, near, far;
      varying float vDist;
      void main() {
        float a = opacity * (1.0 - smoothstep(near, far, vDist));
        if (a < 0.004) discard;
        gl_FragColor = vec4(color, a);
      }`,
  });

  let viewAngle = viewDistance / R;
  let frameNo = 0;
  let built = 0;
  let seenDust = game.dust;

  // ---------- stíny kopců (okna osvětlení) ----------

  const shadowCache = new Map();                    // index kusu → Float32Array (SHADOW_N² · 2)
  const queued = new Set();
  let inFlight = 0;
  let worker = null;
  let fallbackJob = null;                           // výpočet po řádcích v hlavním vlákně
  try {
    worker = new Worker(new URL(`../planet/shadowWorker.js?planet=${PLANET.id}`, import.meta.url), { type: 'module' });
    worker.onmessage = e => { inFlight--; shadowDone(e.data.key, e.data.data); };
    worker.onerror = () => { worker = null; inFlight = 0; };
  } catch { worker = null; }

  const jobFor = idx => {
    const ch = CHUNKS[idx];
    return { key: idx, f: ch.f, oi: ch.oi, oj: ch.oj, dir: ch.dir, Q, step: SHADOW_STEP };
  };

  function shadowDone(idx, data) {
    queued.delete(idx);
    shadowCache.set(idx, data);
    const ch = CHUNKS[idx];
    if (ch.mesh) applyShadow(ch, data);
  }

  // Okna z hrubé mřížky → každý vrchol (bilineárně).
  function applyShadow(ch, data) {
    const attr = ch.mesh.geometry.attributes.sunWin;
    const arr = attr.array, ab = ch.vertAB;
    for (let v = 0; v < ab.length / 2; v++) {
      const x = ab[v * 2] / SHADOW_STEP, y = ab[v * 2 + 1] / SHADOW_STEP;
      const i = Math.min(SHADOW_N - 2, Math.floor(x)), j = Math.min(SHADOW_N - 2, Math.floor(y));
      const fx = x - i, fy = y - j;
      for (let c = 0; c < 2; c++) {
        const g = (ii, jj) => data[(jj * SHADOW_N + ii) * 2 + c];
        arr[v * 2 + c] = (g(i, j) * (1 - fx) + g(i + 1, j) * fx) * (1 - fy) + (g(i, j + 1) * (1 - fx) + g(i + 1, j + 1) * fx) * fy;
      }
    }
    attr.needsUpdate = true;
  }

  // Rozdá práci: Worker dostane nejbližší kusy, bez Workeru se počítá po řádcích.
  function pumpShadows(visibleOrder) {
    if (worker) {
      for (const idx of visibleOrder) {
        if (inFlight >= 2) break;
        if (!queued.has(idx) || CHUNKS[idx].sent) continue;
        CHUNKS[idx].sent = true;
        inFlight++;
        worker.postMessage(jobFor(idx));
      }
      return;
    }
    if (!fallbackJob) {
      const idx = visibleOrder.find(i => queued.has(i));
      if (idx === undefined) return;
      fallbackJob = { job: jobFor(idx), row: 0, out: new Float32Array(SHADOW_N * SHADOW_N * 2) };
    }
    for (let k = 0; k < 2 && fallbackJob.row < SHADOW_N; k++) {
      chunkWindowsRow(fallbackJob.job, fallbackJob.row++, fallbackJob.out);
    }
    if (fallbackJob.row >= SHADOW_N) {
      shadowDone(fallbackJob.job.key, fallbackJob.out);
      fallbackJob = null;
    }
  }

  // ---------- stavba kusu ----------

  function buildChunk(ch) {
    const P = FACES[ch.f];
    const side = Q + 3;                               // mřížka s okrajem 1 kvůli normálám
    const pos = new Float32Array(side * side * 3);
    const at = (a, b) => ((b + 1) * side + (a + 1)) * 3;
    for (let b = -1; b <= Q + 1; b++) {
      for (let a = -1; a <= Q + 1 - Math.max(0, b); a++) {
        const s = (ch.oi + ch.dir * a) / M, t = (ch.oj + ch.dir * b) / M;
        const x = P.A[0] + P.e1[0] * s + P.e2[0] * t, y = P.A[1] + P.e1[1] * s + P.e2[1] * t, z = P.A[2] + P.e1[2] * s + P.e2[2] * t;
        const l = Math.hypot(x, y, z);
        const d = [x / l, y / l, z / l];
        const r = R + heightAt(d);
        const o = at(a, b);
        pos[o] = d[0] * r; pos[o + 1] = d[1] * r; pos[o + 2] = d[2] * r;
      }
    }

    const vc = (Q + 1) * (Q + 2) / 2;
    const vPos = new Float32Array(vc * 3), vNor = new Float32Array(vc * 3), vUv = new Float32Array(vc * 2);
    const vCol = new Uint8Array(vc * 3), vHex = new Int32Array(vc), vShade = new Float32Array(vc);
    const vAB = new Uint8Array(vc * 2), vSun = new Float32Array(vc * 2);
    const vid = new Int32Array((Q + 1) * (Q + 1));
    let v = 0;
    for (let b = 0; b <= Q; b++) {
      for (let a = 0; a <= Q - b; a++) {
        const o = at(a, b);
        vPos.set([pos[o], pos[o + 1], pos[o + 2]], v * 3);
        // normála z okolních bodů
        const ax = at(a + 1, b), bx = at(a - 1, b), ay = at(a, b + 1), by = at(a, b - 1);
        const ux = pos[ax] - pos[bx], uy = pos[ax + 1] - pos[bx + 1], uz = pos[ax + 2] - pos[bx + 2];
        const wx = pos[ay] - pos[by], wy = pos[ay + 1] - pos[by + 1], wz = pos[ay + 2] - pos[by + 2];
        let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
        const nl = Math.hypot(nx, ny, nz) || 1;
        vNor.set([nx / nl, ny / nl, nz / nl], v * 3);

        const s = (ch.oi + ch.dir * a) / M, t = (ch.oj + ch.dir * b) / M;
        atlasUv(ch.f, s, t, tmp);
        vUv.set(tmp, v * 2);
        const l = Math.hypot(pos[o], pos[o + 1], pos[o + 2]);
        vHex[v] = dirToCell([pos[o] / l, pos[o + 1] / l, pos[o + 2] / l]);
        vShade[v] = 0.9 + Math.random() * 0.1;          // jemné zrno povrchu
        vAB[v * 2] = a; vAB[v * 2 + 1] = b;
        vSun[v * 2] = FLAT_WINDOW[0]; vSun[v * 2 + 1] = FLAT_WINDOW[1];
        vid[b * (Q + 1) + a] = v;
        v++;
      }
    }
    ch.vertHex = vHex;
    ch.shade = vShade;
    ch.colors = vCol;
    for (let i = 0; i < vc; i++) paintVertex(ch, i);

    const idx = new Uint16Array(Q * Q * 3);
    let ii = 0;
    for (let b = 0; b < Q; b++) {
      for (let a = 0; a < Q - b; a++) {
        const p0 = vid[b * (Q + 1) + a], p1 = vid[b * (Q + 1) + a + 1], p2 = vid[(b + 1) * (Q + 1) + a];
        idx[ii++] = p0; idx[ii++] = p1; idx[ii++] = p2;
        if (a + b < Q - 1) {
          const p3 = vid[(b + 1) * (Q + 1) + a + 1];
          idx[ii++] = p1; idx[ii++] = p3; idx[ii++] = p2;
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(vPos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(vNor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(vUv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(vCol, 3, true));
    geo.setAttribute('sunWin', new THREE.BufferAttribute(vSun, 2));
    geo.setIndex(new THREE.BufferAttribute(idx.subarray(0, ii), 1));
    geo.computeBoundingSphere();
    ch.mesh = new THREE.Mesh(geo, material);
    ch.mesh.frustumCulled = true;
    scene.add(ch.mesh);
    ch.vertAB = vAB;
    const cached = shadowCache.get(ch.index);
    if (cached) applyShadow(ch, cached);
    else queued.add(ch.index);

    ch.lines = buildHexLines(ch.hexes);
    if (ch.lines) scene.add(ch.lines);
    built++;
  }

  function paintVertex(ch, i) {
    const base = hexes.done[ch.vertHex[i]] ? DONE : BASE;
    const k = ch.shade[i];
    ch.colors[i * 3] = base[0] * k; ch.colors[i * 3 + 1] = base[1] * k; ch.colors[i * 3 + 2] = base[2] * k;
  }

  // Obrysy hexů, jejichž střed leží v kusu; hrany kopírují terén.
  function buildHexLines(cells) {
    if (!cells.length) return null;
    let segs = 0;
    for (const c of cells) segs += grid.cellTriCount[c] * EDGE_STEPS;
    const pos = new Float32Array(segs * 6);
    const TD = grid.triDir, CT = grid.cellTris;
    let v = 0;
    const put = (x, y, z) => {
      const l = Math.hypot(x, y, z);
      const d = [x / l, y / l, z / l];
      const r = R + heightAt(d) + 0.12;
      pos[v++] = d[0] * r; pos[v++] = d[1] * r; pos[v++] = d[2] * r;
    };
    for (const c of cells) {
      const k = grid.cellTriCount[c];
      for (let m = 0; m < k; m++) {
        const a = CT[c * 6 + m] * 3, b = CT[c * 6 + (m + 1) % k] * 3;
        for (let s = 0; s < EDGE_STEPS; s++) {
          const t0 = s / EDGE_STEPS, t1 = (s + 1) / EDGE_STEPS;
          put(TD[a] + (TD[b] - TD[a]) * t0, TD[a + 1] + (TD[b + 1] - TD[a + 1]) * t0, TD[a + 2] + (TD[b + 2] - TD[a + 2]) * t0);
          put(TD[a] + (TD[b] - TD[a]) * t1, TD[a + 1] + (TD[b + 1] - TD[a + 1]) * t1, TD[a + 2] + (TD[b + 2] - TD[a + 2]) * t1);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.computeBoundingSphere();
    return new THREE.LineSegments(geo, lineMat);
  }

  function disposeChunk(ch) {
    scene.remove(ch.mesh);
    ch.mesh.geometry.dispose();
    ch.mesh = null;
    ch.sent = false;
    if (ch.lines) {
      scene.remove(ch.lines);
      ch.lines.geometry.dispose();
      ch.lines = null;
    }
    built--;
  }

  // ---------- prach → textura ----------

  const patch = { isDataTexture: true, image: { data: null, width: 0, height: 0 } };
  const patchBuf = new Uint8Array(512 * 512);
  const offset = new THREE.Vector2();

  function updateDust() {
    if (game.dust !== seenDust) {                     // nová hra
      seenDust = game.dust;
      texture.image.data = game.dust;
      dirty.full = true;
      for (const ch of CHUNKS) if (ch.mesh) recolorChunk(ch);
    }
    if (dirty.full) {
      dirty.full = false;
      dirty.rects.length = 0;
      texture.needsUpdate = true;
    } else {
      const r = dirty.rects;
      for (let i = 0; i < r.length; i += 4) {
        const x0 = r[i], y0 = r[i + 1], w = r[i + 2] - x0 + 1, h = r[i + 3] - y0 + 1;
        if (w * h > patchBuf.length) { texture.needsUpdate = true; break; }
        for (let y = 0; y < h; y++) patchBuf.set(game.dust.subarray((y0 + y) * W + x0, (y0 + y) * W + x0 + w), y * w);
        patch.image.data = patchBuf.subarray(0, w * h);
        patch.image.width = w;
        patch.image.height = h;
        offset.set(x0, y0);
        renderer.copyTextureToTexture(offset, patch, texture);
      }
      r.length = 0;
    }

    // dočištěné hexy → přebarvit
    if (dirty.completed.length) {
      const done = new Set(dirty.completed);
      dirty.completed.length = 0;
      for (const ch of CHUNKS) {
        if (!ch.mesh) continue;
        let changed = false;
        for (let i = 0; i < ch.vertHex.length; i++) {
          if (done.has(ch.vertHex[i])) { paintVertex(ch, i); changed = true; }
        }
        if (changed) ch.mesh.geometry.attributes.color.needsUpdate = true;
      }
    }
  }

  function recolorChunk(ch) {
    for (let i = 0; i < ch.vertHex.length; i++) paintVertex(ch, i);
    ch.mesh.geometry.attributes.color.needsUpdate = true;
  }

  // ---------- co je v dohledu ----------

  // focus = kde stojí astronaut (Vector3) – kolem něj se ukazují obrysy hexů
  function setFocus(focus) {
    lineUniforms.focus.value.copy(focus);
  }

  // Mapa celého Měsíce: kusy terénu se schovají (kreslí se zjednodušený glóbus).
  let hidden = false;
  function setHidden(h) {
    hidden = h;
    for (const ch of CHUNKS) {
      if (!ch.mesh) continue;
      if (h) { ch.mesh.visible = false; if (ch.lines) ch.lines.visible = false; }
    }
  }

  function updateVisibility(camPos, budget = BUILD_PER_FRAME) {
    if (hidden) return;
    frameNo++;
    const fl = lineUniforms.focus.value.length();
    const fx = lineUniforms.focus.value.x / fl, fy = lineUniforms.focus.value.y / fl, fz = lineUniforms.focus.value.z / fl;
    const lineAngle = (LINE_FAR + HEX_SPACING) / R;    // + přesah hexů přes okraj kusu
    const l = camPos.length();
    const cx = camPos.x / l, cy = camPos.y / l, cz = camPos.z / l;
    const alt = Math.max(1, l - R);
    const horizon = Math.acos(R / (R + alt + RELIEF.maxH)) + Math.acos(R / (R + RELIEF.maxH));   // + hory za obzorem
    const limit = Math.min(horizon, viewAngle);

    const missing = [];
    const order = [];
    for (const ch of CHUNKS) {
      const ang = Math.acos(Math.max(-1, Math.min(1, cx * ch.center[0] + cy * ch.center[1] + cz * ch.center[2])));
      const visible = ang - ch.radius < limit;
      if (visible) {
        ch.lastSeen = frameNo;
        order.push([ang, ch.index]);
        if (ch.mesh) {
          ch.mesh.visible = true;
          if (ch.lines) {
            const fa = Math.acos(Math.max(-1, Math.min(1, fx * ch.center[0] + fy * ch.center[1] + fz * ch.center[2])));
            ch.lines.visible = fa - ch.radius < lineAngle;
          }
        } else {
          missing.push([ang, ch]);
        }
      } else if (ch.mesh) {
        ch.mesh.visible = false;
        if (ch.lines) ch.lines.visible = false;
      }
    }

    missing.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < missing.length && i < budget; i++) buildChunk(missing[i][1]);
    if (queued.size) pumpShadows(order.sort((a, b) => a[0] - b[0]).map(o => o[1]));

    if (built > MAX_BUILT) {
      const old = CHUNKS.filter(ch => ch.mesh && ch.lastSeen !== frameNo).sort((a, b) => a.lastSeen - b.lastSeen);
      for (let i = 0; i < old.length && built > MAX_BUILT; i++) disposeChunk(old[i]);
    }
  }

  function setViewDistance(meters) {
    viewAngle = meters / R;
  }

  // Světla pro shader terénu (volá main.js každý snímek). Další materiály se stejným shaderem
  // (glóbus na mapě) dostanou stejné světlo, jen bez stínové mapy objektů.
  const linked = [];
  const linkUniforms = u => linked.push(u);

  function applyLight(u, l, sm) {
    u.sunAngle.value = l.sunAngle;
    u.sunDir.value.set(...l.sunDir);
    u.earthDir.value.set(...l.earthDir);
    u.earthColor.value.setHex(0x7f9cd0).multiplyScalar(l.earthIntensity);
    u.lampPos.value.copy(l.lampPos);
    u.lampColor.value.setHex(0xffeccc).multiplyScalar(l.lampIntensity);
    u.useShadowMap.value = sm && sm.map ? 1 : 0;
    if (sm && sm.map) {
      u.shadowMap.value = sm.map.texture;
      u.shadowMatrix.value.copy(sm.matrix);
      u.shadowTexel.value = 1 / sm.mapSize.x;
    }
  }

  function setLighting(l) {
    applyLight(uniforms, l, l.shadow);
    applySpots(uniforms, l.spots, l.spotShadow);
    for (const u of linked) applyLight(u, l, null);      // glóbus na mapě bez reflektorů
  }

  // Reflektory (scene/lights.js) do shaderu terénu.
  function applySpots(u, spots, ss) {
    if (!spots) return;
    for (let i = 0; i < spots.pos.length; i++) {
      u.spotPos.value[i].copy(spots.pos[i]);
      u.spotDir.value[i].copy(spots.dir[i]);
      u.spotColor.value[i].copy(spots.color[i]);
      u.spotCone.value[i].copy(spots.cone[i]);
      u.spotRange.value[i] = spots.range[i];
    }
    u.useSpotShadow.value = ss && ss.map ? 1 : 0;
    if (ss && ss.map) {
      u.spotShadowMap.value = ss.map.texture;
      u.spotShadowMatrix.value.copy(ss.matrix);
      u.spotShadowTexel.value = 1 / ss.mapSize.x;
    }
  }

  return {
    updateDust, updateVisibility, setViewDistance, setLighting, setFocus, setHidden, linkUniforms,
    texture, hexSpacing: HEX_SPACING,
  };
}
