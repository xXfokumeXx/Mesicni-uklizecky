// Mapa oken osvětlení v textuře (3.1, O-28): ostré stíny kopců na ~0,66 m nezávisle na hustotě sítě terénu.
//
// Textura RG16F (východ, západ) ve stejném rozložení jako atlas prachu, v polovičním rozlišení (Měsíc 2 400 × 960).
// Počítá se po dlaždicích 60 × 60 ve 2–3 Workerech (planet/sunmapWorker.js), nejbližší k hráči napřed; než je
// dlaždice hotová, shader použije dnešní hrubé okno z vrcholů (hodnota 9 = „ještě není“). Hotové dlaždice se nahrají
// do textury jednotlivě (copyTextureToTexture) a uloží do IndexedDB – při dalším spuštění se jen načtou.
// Cache je z čistého terénu: dlaždice v pásu kolem srovnaných ploch pod stavbami (Slunce jde zhruba východ–západ,
// paprsek se pochoduje nejvýš 240 m) se v každé hře spočítají znovu se stavbami a do cache se neukládají.
// Bez WebGL2 (half float RG) se nepoužije – zůstanou okna z vrcholů.
import { MOON, PLANET, RELIEF, DUST } from '../config.js';
import { FACES } from '../planet/icosa.js';
import { onTerrainChange, terrainPatches } from '../planet/height.js';

const THREE = window.THREE;
const R = MOON.radius;
const S2 = DUST.faceTexels / 2, W2 = S2 * 5, H2 = S2 * 2;
const TILE = 60;                                      // S2 je 480 (Měsíc) / 720 (Mars) → celé dlaždice
const TX = W2 / TILE, TY = H2 / TILE;
const NONE = 0x4880;                                  // half float 9.0 = okno ještě není spočítané
const SIG = `w1|${PLANET.id}|${R}|${MOON.terrainSeg}|${DUST.faceTexels}|${JSON.stringify(RELIEF)}|${JSON.stringify(PLANET.noise ?? '')}`;
const DB = 'ms2_sunmap', STORE = 'tiles';

let hash = 0;
for (let i = 0; i < SIG.length; i++) hash = (hash * 31 + SIG.charCodeAt(i)) | 0;
const KEY = `${PLANET.id}:${(hash >>> 0).toString(36)}`;

// Střed dlaždice jako směr (jednotkový vektor) – priorita podle vzdálenosti od hráče a pásy po stavbách
function tileCenter(tx, ty) {
  const x = tx * TILE + TILE / 2, y = ty * TILE + TILE / 2;
  const qx = x / S2 | 0, qy = y / S2 | 0, lx = x - qx * S2, ly = y - qy * S2, q = qy * 5 + qx;
  let f, s, t;
  if (lx + ly <= S2 - 1) { f = 2 * q; s = lx / S2; t = ly / S2; } else { f = 2 * q + 1; s = (S2 - lx) / S2; t = (S2 - ly) / S2; }
  const P = FACES[f];
  const d = [P.A[0] + P.e1[0] * s + P.e2[0] * t, P.A[1] + P.e1[1] * s + P.e2[1] * t, P.A[2] + P.e1[2] * s + P.e2[2] * t];
  const l = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / l, d[1] / l, d[2] / l];
}

function openDb() {
  return new Promise(res => {
    try {
      const rq = indexedDB.open(DB, 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore(STORE);
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => res(null);
    } catch { res(null); }
  });
}

export function createSunMap(renderer) {
  if (!renderer?.capabilities?.isWebGL2) return null;
  const data = new Uint16Array(W2 * H2 * 2).fill(NONE);
  const texture = new THREE.DataTexture(data, W2, H2, THREE.RGFormat, THREE.HalfFloatType);
  texture.internalFormat = 'RG16F';
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  const tiles = [];
  for (let ty = 0; ty < TY; ty++) for (let tx = 0; tx < TX; tx++) tiles.push({ tx, ty, c: tileCenter(tx, ty), done: false, sent: false, patched: false });
  const tileR = TILE * 0.66 * 0.75;                   // poloměr dlaždice (m), ~30 m
  let pver = 0, patches = [];
  const stats = { start: performance.now(), doneAt: 0, loaded: 0, computed: 0, firstNear: 0 };

  // pás dlaždic, které může stín stavby (srovnaný terén) ovlivnit
  function band(c, ang) {
    const rad = ang * R;
    for (const t of tiles) {
      const a = Math.acos(Math.max(-1, Math.min(1, t.c[0] * c[0] + t.c[1] * c[1] + t.c[2] * c[2]))) * R;
      if (a > 260 + rad + tileR) continue;
      if (Math.abs(t.c[1] - c[1]) * R > rad + tileR + 20) continue;
      t.patched = true;
      t.done = false;
      t.sent = false;
    }
  }
  function setPatches(list, changed) {
    patches = list.map(p => ({ c: p.c, X: p.X, Z: p.Z, rect: p.rect, level: p.level, margin: p.margin, cos: p.cos }));
    pver++;
    for (const ch of changed) band(ch.c, ch.ang);
  }
  setPatches(terrainPatches(), terrainPatches().map(p => ({ c: p.c, ang: p.ang })));
  onTerrainChange(setPatches);

  // ---------- IndexedDB ----------
  let db = null;
  const ready = openDb().then(d => {
    db = d;
    if (!db) return;
    return new Promise(res => {
      try {
        const rq = db.transaction(STORE).objectStore(STORE).getAll(IDBKeyRange.bound(`${KEY}:`, `${KEY}:￿`));
        const keys = db.transaction(STORE).objectStore(STORE).getAllKeys(IDBKeyRange.bound(`${KEY}:`, `${KEY}:￿`));
        let vals = null, ks = null;
        const fin = () => {
          if (!vals || !ks) return;
          ks.forEach((k, n) => {
            const idx = Number(String(k).split(':').pop());
            const t = tiles[idx], v = vals[n];
            if (!t || t.patched || !(v instanceof Uint16Array) || v.length !== TILE * TILE * 2) return;
            writeTile(t, v);
            t.done = true;
            stats.loaded++;
          });
          texture.needsUpdate = true;                 // jedno nahrání celé textury po načtení
          res();
        };
        rq.onsuccess = () => { vals = rq.result; fin(); };
        keys.onsuccess = () => { ks = keys.result; fin(); };
        rq.onerror = keys.onerror = () => res();
      } catch { res(); }
    });
  });
  function store(t, v) {
    if (!db || t.patched) return;
    try { db.transaction(STORE, 'readwrite').objectStore(STORE).put(v, `${KEY}:${tiles.indexOf(t)}`); } catch { /* bez cache */ }
  }

  function writeTile(t, v) {
    for (let y = 0; y < TILE; y++) data.set(v.subarray(y * TILE * 2, (y + 1) * TILE * 2), ((t.ty * TILE + y) * W2 + t.tx * TILE) * 2);
  }

  // ---------- Workery ----------
  const nW = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 1));
  const workers = [];
  const tileTex = new THREE.DataTexture(new Uint16Array(TILE * TILE * 2), TILE, TILE, THREE.RGFormat, THREE.HalfFloatType);
  tileTex.internalFormat = 'RG16F';
  const at = new THREE.Vector2();
  let uploadedOnce = false;
  for (let k = 0; k < nW; k++) {
    try {
      const w = new Worker(new URL(`../planet/sunmapWorker.js?planet=${PLANET.id}`, import.meta.url), { type: 'module' });
      w.busy = false;
      w.onmessage = e => {
        w.busy = false;
        const t = tiles[e.data.key];
        if (!t || t.sent !== w.ticket) return;        // mezitím se změnil terén → spočítá se znovu
        t.sent = false;
        t.done = true;
        stats.computed++;
        writeTile(t, e.data.data);
        if (uploadedOnce) {
          tileTex.image.data = e.data.data;
          renderer.copyTextureToTexture(at.set(t.tx * TILE, t.ty * TILE), tileTex, texture);
        } else texture.needsUpdate = true;
        store(t, e.data.data);
        if (!tiles.some(x => !x.done) && !stats.doneAt) { stats.doneAt = performance.now(); console.info(`[stíny] mapa oken hotová: ${stats.computed} dlaždic spočítáno, ${stats.loaded} z cache, ${((stats.doneAt - stats.start) / 1000).toFixed(1)} s`); }
      };
      w.onerror = () => { w.dead = true; };
      workers.push(w);
    } catch { /* bez Workeru zůstanou okna z vrcholů */ }
  }
  let ticket = 0;

  // Každý snímek: rozdat práci volným Workerům, nejbližší dlaždice k hráči napřed (pořadí 2× za s)
  let order = [], orderAt = 0;
  function update(focus) {
    if (!workers.length) return;
    if (!uploadedOnce && texture.version > 0 && renderer.properties.get(texture).__webglTexture) uploadedOnce = true;
    const now = performance.now();
    if (now - orderAt > 500) {
      orderAt = now;
      const l = focus.length() || 1, fx = focus.x / l, fy = focus.y / l, fz = focus.z / l;
      order = tiles.filter(t => !t.done && !t.sent).map(t => [-(t.c[0] * fx + t.c[1] * fy + t.c[2] * fz), t]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
    }
    for (const w of workers) {
      if (w.busy || w.dead) continue;
      const t = order.find(x => !x.done && !x.sent);
      if (!t) break;
      w.busy = true;
      w.ticket = t.sent = ++ticket;
      w.postMessage({ key: tiles.indexOf(t), x0: t.tx * TILE, y0: t.ty * TILE, size: TILE, S2, pver, patches });
    }
  }

  return {
    texture, update, ready,
    progress: () => tiles.filter(t => t.done).length / tiles.length,
    stats,
  };
}
