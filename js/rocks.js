// Kameny (3.0): náhodně po celé planetě z pevného seedu (po načtení vždy stejně), 70 % malých / 30 % středních,
// malé i ve skupinkách. Rozbije je jen Měsíční zametací vůz a Mega rover nárazem, ostatní vozidla se o ně zastaví.
// Astronaut pěšky malé kameny přejde, o střední se zastaví. Prach pod kamenem zůstává – hex se dočistí, až kámen
// rozbiješ roverem (rozhodl hráč). Kameny pod stavbami, pásy a stanicemi se schovají (i bez kolize).
// Stav: game.s.rocks = id rozbitých kamenů (hostitel → H.rk), game.s.rocksPn = planeta, ke které patří.
import { PLANET, MOON, BASE } from './config.js';
import { game } from './state.js';
import { grid, cellDir, HEX_SPACING } from './planet/hexgrid.js';
import { probeDust, TEXEL_M } from './planet/dustmap.js';
import { heightAt, terrainVersion } from './planet/height.js';
import { mulberry32 } from './planet/noise.js';
import { anyTangent, cross } from './planet/vec.js';
import { ROCKET_SITE } from './rocket.js';
import { STRUCTURES, axes, dirToLocal } from './structures.js';
import { beltSamples } from './logistics.js';
import { purchase } from './econ.js';

const R = MOON.radius;

// rad = poloměr kolize a místa bez prachu při měřítku 1 (průměr šířky a hloubky × 0,85 – konce kamene trochu přesahují)
export const ROCK_TYPES = [
  { model: 'rock-s1', w: 0.9, h: 0.3, d: 0.7, big: false },
  { model: 'rock-s2', w: 0.8, h: 0.5, d: 0.6, big: false },
  { model: 'rock-s3', w: 1.1, h: 0.3, d: 0.8, big: false },
  { model: 'rock-m1', w: 2.3, h: 1.1, d: 2.0, big: true },
  { model: 'rock-m2', w: 2.9, h: 0.9, d: 1.8, big: true },
].map(t => ({ ...t, rad: (t.w + t.d) / 4 * 0.85 }));
export const ROCK_MODELS = ROCK_TYPES.map(t => t.model);
export const ROCK_BREAKERS = new Set(['lunar', 'mega']);   // Měsíční zametací vůz, Mega vysávací rover

const AREA_PER_ROCK = 100;      // m² na kámen v průměru (zadání: 25 – na hratelnost s menšími vozidly řidčeji)
const BIG_SHARE = 0.4;          // podíl míst se středním kamenem (malé jsou ve skupinkách 1–3 → ~28 % středních kamenů)
const BASE_FREE = BASE.flat + 8;   // kolem základny (náměstí, cesty, stavební zóna) žádné kameny
const ROCKET_FREE = 28;
const STRUCT_GAP = 3;           // odstup od staveb (zadání)
const BELT_GAP = 1.2;           // od osy pásu

export const rocks = {
  n: 0,
  dir: null,        // Float64Array(3n)
  type: null,       // Uint8Array
  yaw: null,        // Float32Array
  scale: null,      // Float32Array
  rad: null,        // Float32Array – poloměr kolize (m)
  off: null,        // Uint8Array: 1 = rozbitý, 2 = pod stavbou / pásem
  base: null,       // Float32Array – výška spodku nad koulí (NaN = spočítat)
  baseTv: -1,
};
let version = 0;                 // mění se při rozbití / schování → přestavba instancí
export const rockVersion = () => version;

// ---------- prostorová mřížka 8 m (dotazy kolize a vykreslení) ----------
const CELL = 8;
const buckets = new Map();
const keyOf = (x, y, z) => ((Math.floor(x / CELL) + 128) * 256 + (Math.floor(y / CELL) + 128)) * 256 + (Math.floor(z / CELL) + 128);

// fn(i) pro kameny do vzdálenosti dist (m) od směru p (přibližně – kostka mřížky, fn si vzdálenost ověří sama)
export function rocksNear(p, dist, fn) {
  const x = p[0] * R, y = p[1] * R, z = p[2] * R;
  const x0 = Math.floor((x - dist) / CELL), x1 = Math.floor((x + dist) / CELL);
  const y0 = Math.floor((y - dist) / CELL), y1 = Math.floor((y + dist) / CELL);
  const z0 = Math.floor((z - dist) / CELL), z1 = Math.floor((z + dist) / CELL);
  for (let ix = x0; ix <= x1; ix++) {
    for (let iy = y0; iy <= y1; iy++) {
      for (let iz = z0; iz <= z1; iz++) {
        const b = buckets.get(((ix + 128) * 256 + (iy + 128)) * 256 + (iz + 128));
        if (b) for (let k = 0; k < b.length; k++) fn(b[k]);
      }
    }
  }
}
// vzdálenost kamene i od směru p (m, tětiva ≈ oblouk)
export function rockDist(i, p) {
  const d = rocks.dir;
  return Math.hypot(d[i * 3] - p[0], d[i * 3 + 1] - p[1], d[i * 3 + 2] - p[2]) * R;
}

// ---------- rozmístění (jednou po initGrid, pevný seed planety) ----------
export function initRocks() {
  const rand = mulberry32(PLANET.id === 'mars' ? 9131 : 5171);
  const hexArea = 0.866 * HEX_SPACING * HEX_SPACING;
  const spots = hexArea / AREA_PER_ROCK / (BIG_SHARE + (1 - BIG_SHARE) * 1.7);
  const out = { dir: [], type: [], yaw: [], scale: [] };
  const free = d => angDist(d, BASE.dir) > BASE_FREE && angDist(d, ROCKET_SITE.dir) > ROCKET_FREE;
  const put = (c, e1, e2, u, v, t) => {
    const d = unit(c[0] + (e1[0] * u + e2[0] * v) / R, c[1] + (e1[1] * u + e2[1] * v) / R, c[2] + (e1[2] * u + e2[2] * v) / R);
    const yaw = rand() * Math.PI * 2, sc = 0.75 + rand() * 0.6;
    if (!free(d)) return;
    out.dir.push(d[0], d[1], d[2]);
    out.type.push(t);
    out.yaw.push(yaw);
    out.scale.push(sc);
  };
  for (let c = 0; c < grid.cells; c++) {
    const center = cellDir(c);
    const n = Math.floor(spots + rand());
    if (!n) continue;
    const e1 = anyTangent(center), e2 = cross(center, e1);
    for (let k = 0; k < n; k++) {
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * HEX_SPACING * 0.55;
      const u = Math.cos(a) * r, v = Math.sin(a) * r;
      if (rand() < BIG_SHARE) { put(center, e1, e2, u, v, 3 + (rand() < 0.5 ? 0 : 1)); continue; }
      const q = rand(), cnt = q < 0.5 ? 1 : q < 0.8 ? 2 : 3;                 // skupinka malých kamenů
      for (let j = 0; j < cnt; j++) {
        const b = j ? rand() * Math.PI * 2 : 0, rr = j ? 0.9 + rand() * 0.8 : 0;
        put(center, e1, e2, u + Math.cos(b) * rr, v + Math.sin(b) * rr, Math.floor(rand() * 3));
      }
    }
  }
  const n = out.type.length;
  rocks.n = n;
  rocks.dir = Float64Array.from(out.dir);
  rocks.type = Uint8Array.from(out.type);
  rocks.yaw = Float32Array.from(out.yaw);
  rocks.scale = Float32Array.from(out.scale);
  rocks.rad = new Float32Array(n);
  rocks.off = new Uint8Array(n);
  rocks.base = new Float32Array(n).fill(NaN);
  buckets.clear();
  for (let i = 0; i < n; i++) {
    rocks.rad[i] = ROCK_TYPES[rocks.type[i]].rad * rocks.scale[i];
    const k = keyOf(rocks.dir[i * 3] * R, rocks.dir[i * 3 + 1] * R, rocks.dir[i * 3 + 2] * R);
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = []));
    b.push(i);
  }
  version++;
  return n;
}
function angDist(a, b) { return Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * R; }
function unit(x, y, z) { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; }

// Výška spodku kamene (m nad poloměrem): nejnižší z 5 bodů terénu pod ním, trochu zapuštěný (na svahu nelevituje).
export function rockBase(i) {
  const tv = terrainVersion();
  if (rocks.baseTv !== tv) { rocks.base.fill(NaN); rocks.baseTv = tv; }
  let h = rocks.base[i];
  if (h === h) return h;
  const cx = rocks.dir[i * 3], cy = rocks.dir[i * 3 + 1], cz = rocks.dir[i * 3 + 2];
  const c = [cx, cy, cz], e1 = anyTangent(c), e2 = cross(c, e1), r = rocks.rad[i] * 1.15;
  h = heightAt(c);
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2, u = Math.cos(a) * r, v = Math.sin(a) * r;
    h = Math.min(h, heightAt(unit(cx + (e1[0] * u + e2[0] * v) / R, cy + (e1[1] * u + e2[1] * v) / R, cz + (e1[2] * u + e2[2] * v) / R)));
  }
  h -= 0.05 * rocks.scale[i];
  rocks.base[i] = h;
  return h;
}

// ---------- kolize ----------

// Kámen, do kterého zasahuje těleso (směr p, poloměr r m): index nejbližšího, nebo -1. bigOnly = jen střední.
export function rockHit(p, r, bigOnly = false) {
  if (!rocks.n) return -1;
  let best = -1, bestPen = 0;
  rocksNear(p, r + 2.5, i => {
    if (rocks.off[i]) return;
    if (bigOnly && !ROCK_TYPES[rocks.type[i]].big) return;
    const pen = r + rocks.rad[i] - rockDist(i, p);
    if (pen > bestPen) { bestPen = pen; best = i; }
  });
  return best;
}

// Vytlačení tělesa (p, r) z kamene i: { p, n } jako structures.js pushOut.
export function rockPush(i, p, r) {
  const c = [rocks.dir[i * 3], rocks.dir[i * 3 + 1], rocks.dir[i * 3 + 2]];
  const k = p[0] * c[0] + p[1] * c[1] + p[2] * c[2];
  let nx = p[0] - c[0] * k, ny = p[1] - c[1] * k, nz = p[2] - c[2] * k;   // vodorovně od středu kamene
  let l = Math.hypot(nx, ny, nz);
  if (l < 1e-12) { const t = anyTangent(c); nx = t[0]; ny = t[1]; nz = t[2]; l = 1; }
  nx /= l; ny /= l; nz /= l;
  const a = (r + rocks.rad[i]) / R;
  const np = unit(c[0] * Math.cos(a) + nx * Math.sin(a), c[1] * Math.cos(a) + ny * Math.sin(a), c[2] * Math.cos(a) + nz * Math.sin(a));
  return { p: np, n: [nx, ny, nz] };
}

// Výška kamene (m) – astronaut s jetpackem nad ním přeletí.
export const rockHeight = i => ROCK_TYPES[rocks.type[i]].h * rocks.scale[i];

// ---------- rozbití a síť ----------

const events = [];               // indexy právě rozbitých kamenů (prach ve scéně)
export const takeRockEvents = () => events.splice(0);
const pending = new Map();       // klient: rozbité u mě, hostitel to ještě nepotvrdil → čas
let note = null;
export function takeRockNote() { const n = note; note = null; return n; }
let noteAt = 0;
export function rockBlockedNote() {
  const now = performance.now();
  if (now - noteAt < 5000) return;
  noteAt = now;
  note = 'Tímto vozidlem kámen nerozbiješ – zvládne to jen Měsíční zametací vůz nebo Mega vysávací rover.';
}

function ensureState() {
  const s = game.s;
  if (!Array.isArray(s.rocks) || s.rocksPn !== PLANET.id) { s.rocks = []; s.rocksPn = PLANET.id; }
  return s.rocks;
}

// Hostitel / sám: zapíše rozbitý kámen.
export function breakRockHost(i) {
  i |= 0;
  if (i < 0 || i >= rocks.n) return false;
  const list = ensureState();
  if (!list.includes(i)) list.push(i);
  if (!(rocks.off[i] & 1)) { rocks.off[i] |= 1; events.push(i); version++; }
  return true;
}

// Řidič narazil do kamene vozidlem, které ho rozbije.
export function breakRock(i) {
  if (rocks.off[i] & 1) return;
  rocks.off[i] |= 1;
  events.push(i);
  version++;
  pending.set(i, Date.now());
  purchase('rock', [i], 0, () => breakRockHost(i));
}

// Po načtení hry / převzetí světa: rozbité kameny ze stavu.
export function loadRocks() {
  const list = ensureState();
  for (let i = 0; i < rocks.n; i++) rocks.off[i] &= ~1;
  for (const i of list) if (i >= 0 && i < rocks.n) rocks.off[i] |= 1;
  pending.clear();
  blockSig = '';
  version++;
}

// Klient: seznam rozbitých kamenů od hostitele (H.rk). Moje nepotvrzená rozbití vydrží 10 s.
let lastRk = '';
export function applyRocks(rk) {
  const list = Array.isArray(rk) ? rk.map(v => v | 0) : [];
  const sig = list.join();
  const now = Date.now();
  for (const [i, t] of pending) if (list.includes(i) || now - t > 10000) pending.delete(i);
  if (sig === lastRk && !pending.size) return;
  lastRk = sig;
  game.s.rocks = list;
  game.s.rocksPn = PLANET.id;
  const set = new Set(list);
  for (const i of pending.keys()) set.add(i);
  let changed = false;
  for (let i = 0; i < rocks.n; i++) {
    const want = set.has(i);
    if (want === !!(rocks.off[i] & 1)) continue;
    if (want) { rocks.off[i] |= 1; events.push(i); } else rocks.off[i] &= ~1;
    changed = true;
  }
  if (changed) version++;
}

// ---------- roboti MK1 / MK2 (robots.js) ----------

// Stojí v hexu c (nebo na jeho okraji) aspoň jeden nerozbitý kámen?
export function hexHasRock(c) {
  if (!rocks.n) return false;
  const p = cellDir(c);
  let any = false;
  rocksNear(p, HEX_SPACING * 0.7, i => { if (!any && !rocks.off[i] && rockDist(i, p) < HEX_SPACING * 0.62 + rocks.rad[i]) any = true; });
  return any;
}
// Body mapy prachu pod nerozbitými kameny u hexu c (offline roboti je nevyčistí) – Set, nebo null.
export function rockTexels(c) {
  if (!rocks.n) return null;
  const p = cellDir(c), set = new Set(), probe = [0, 0, 0], q = [0, 0, 0], step = TEXEL_M * 0.7;
  rocksNear(p, HEX_SPACING * 0.7, i => {
    if (rocks.off[i] || rockDist(i, p) > HEX_SPACING * 0.62 + rocks.rad[i]) return;
    const cx = rocks.dir[i * 3], cy = rocks.dir[i * 3 + 1], cz = rocks.dir[i * 3 + 2];
    const c3 = [cx, cy, cz], e1 = anyTangent(c3), e2 = cross(c3, e1), r = rocks.rad[i];
    for (let u = -r; u <= r; u += step) {
      for (let v = -r; v <= r; v += step) {
        if (u * u + v * v > r * r) continue;
        const x = cx + (e1[0] * u + e2[0] * v) / R, y = cy + (e1[1] * u + e2[1] * v) / R, z = cz + (e1[2] * u + e2[2] * v) / R;
        const l = Math.hypot(x, y, z);
        q[0] = x / l; q[1] = y / l; q[2] = z / l;
        set.add(probeDust(q, probe)[2]);
      }
    }
  });
  return set.size ? set : null;
}

// ---------- kameny pod stavbami, pásy a stanicemi (schované, bez kolize) ----------
let blockSig = '', blockAt = 0;
export function refreshRockBlocks(force = false) {
  if (!rocks.n) return;
  const now = performance.now();
  if (!force && now - blockAt < 500) return;
  blockAt = now;
  const s = game.s;
  const sig = (s.buildings || []).map(b => `${b.id}:${b.type}:${b.p[0].toFixed(6)}:${b.yaw}`).join() + '|' +
    (s.belts || []).map(b => `${b.id}:${b.pts?.length}`).join() + '|' + (s.stations || []).map(st => st.hex).join() + '|' + terrainVersion();
  if (sig === blockSig) return;
  blockSig = sig;
  const off = rocks.off;
  for (let i = 0; i < rocks.n; i++) off[i] &= ~2;
  for (const b of s.buildings || []) {
    const def = STRUCTURES[b.type];
    const rect = def?.pad || def?.foot;
    if (!rect) continue;
    const ax = axes(b.p, b.yaw);
    const reach = Math.max(Math.abs(rect[0]), Math.abs(rect[1]), Math.abs(rect[2]), Math.abs(rect[3])) * 1.5 + STRUCT_GAP + 2;
    const q = [0, 0, 0];
    rocksNear(b.p, reach, i => {
      q[0] = rocks.dir[i * 3]; q[1] = rocks.dir[i * 3 + 1]; q[2] = rocks.dir[i * 3 + 2];
      const [x, z] = dirToLocal(b.p, b.yaw, q, ax);
      const g = STRUCT_GAP + rocks.rad[i];
      if (x > rect[0] - g && x < rect[1] + g && z > rect[2] - g && z < rect[3] + g) off[i] |= 2;
    });
  }
  for (const bl of s.belts || []) {
    const smp = beltSamples(bl);
    for (let k = 0; k < smp.length; k += 2) {
      const p = smp[k].p;
      rocksNear(p, BELT_GAP + 2.5, i => { if (rockDist(i, p) < BELT_GAP + rocks.rad[i] + 1) off[i] |= 2; });
    }
  }
  for (const st of s.stations || []) {
    const p = cellDir(st.hex);
    rocksNear(p, 6, i => { if (rockDist(i, p) < 3 + rocks.rad[i]) off[i] |= 2; });
  }
  version++;
}

// Pracovní tick (10×/s): nový stav hry (načtení, převzetí světa) → rozbité kameny ze stavu; schované pod stavbami.
let seenState = null;
export function rocksTick() {
  if (!rocks.n) return;
  if (game.s !== seenState) { seenState = game.s; loadRocks(); }
  refreshRockBlocks();
}
