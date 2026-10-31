// Prachová mapa: jemná mřížka ~30 cm po celém Měsíci (atlas 20 stěn ikosaedru).
// Každý bod = kolik prachu tam leží (0 = čisto). Stejné pole je přímo data textury terénu.
// Atlas: 10 čtverců 5×2, v každém dvě stěny (stěna 2q vlevo dole, 2q+1 otočená vpravo nahoře).
// Nad tím hexové sektory: hex je hotový, když v něm zbývá ≤ 1 % původního prachu.
import { MOON, DUST, BASE, HEX_DONE_LEFT } from '../config.js';
import { FACES, EDGE, faceOf, planar } from './icosa.js';
import { grid, hexAtParam } from './hexgrid.js';
import { mulberry32 } from './noise.js';
import { tangentTo, anyTangent, cross, angleBetween } from './vec.js';

const R = MOON.radius;
export const S = DUST.faceTexels;
export const SQX = 5, SQY = 2;
export const W = S * SQX, H = S * SQY;
export const TEXEL_M = EDGE * R / S;                 // velikost bodu mapy v metrech (~0,3 m)

let dust = null;                                     // Uint8Array(W·H)
let origin = null;                                   // kopie čerstvě vygenerované mapy (pro uložení rozdílu)
export const setDust = d => { dust = d; };
export const dustOrigin = () => origin;

// Statistiky hexů
export const hexes = {
  init: null,      // Int32Array: původní prach v hexu
  left: null,      // Int32Array: zbývající prach
  done: null,      // Uint8Array: 1 = hotový sektor
  doneCount: 0,
  total: 0,        // hexů, ve kterých vůbec nějaký prach byl
};

// Změny pro terén: obdélníky atlasu k nahrání do textury + nově hotové hexy.
export const dirty = { rects: [], full: true, completed: [] };

// ---------- převody ----------

export function texelOf(f, s, t) {
  const q = f >> 1;
  let x = s * S, y = t * S;
  if (f & 1) { x = S - x; y = S - y; }
  const xi = Math.min(S - 1, Math.max(0, Math.floor(x)));
  const yi = Math.min(S - 1, Math.max(0, Math.floor(y)));
  return ((q / SQX | 0) * S + yi) * W + (q % SQX) * S + xi;
}

// UV atlasu pro bod (s, t) stěny f (pro vrcholy terénu).
export function atlasUv(f, s, t, out) {
  const q = f >> 1;
  let x = s * S, y = t * S;
  if (f & 1) { x = S - x; y = S - y; }
  out[0] = ((q % SQX) * S + x) / W;
  out[1] = ((q / SQX | 0) * S + y) / H;
  return out;
}

// Hex, do kterého patří bod mapy (podle středu bodu – stejně jako při počítání hexů).
export function hexOfTexel(i) {
  const x = i % W, y = i / W | 0;
  const qx = x / S | 0, qy = y / S | 0, lx = x - qx * S, ly = y - qy * S, q = qy * SQX + qx;
  if (lx + ly <= S - 1) return hexAtParam(2 * q, (lx + 0.5) / S, (ly + 0.5) / S);
  return hexAtParam(2 * q + 1, (S - lx - 0.5) / S, (S - ly - 0.5) / S);
}

// Projde všechny body mapy: fn(index, stěna, s, t).
function forEachTexel(fn) {
  for (let qy = 0; qy < SQY; qy++) {
    for (let qx = 0; qx < SQX; qx++) {
      const q = qy * SQX + qx;
      for (let ly = 0; ly < S; ly++) {
        const row = (qy * S + ly) * W + qx * S;
        for (let lx = 0; lx < S; lx++) {
          if (lx + ly <= S - 1) fn(row + lx, 2 * q, (lx + 0.5) / S, (ly + 0.5) / S);
          else fn(row + lx, 2 * q + 1, (S - lx - 0.5) / S, (S - ly - 0.5) / S);
        }
      }
    }
  }
}

// ---------- vytvoření a přepočet ----------

// Rychlý 2D šum z předpočítané tabulky (6,4 mil. bodů → 3D šum by trval sekundy).
const NT = 256;
const table = (() => {
  const rand = mulberry32(7);
  const t = new Float32Array(NT * NT);
  for (let i = 0; i < t.length; i++) t[i] = rand();
  return t;
})();
function tnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let u = x - xi, v = y - yi;
  u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v);
  const x0 = xi & (NT - 1), y0 = yi & (NT - 1), x1 = (x0 + 1) & (NT - 1), y1 = (y0 + 1) & (NT - 1);
  const a = table[y0 * NT + x0], b = table[y0 * NT + x1], c = table[y1 * NT + x0], d = table[y1 * NT + x1];
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Nová mapa prachu (deterministická → dobře se komprimuje). Nastaví i statistiky hexů.
export function generateDust() {
  const d = new Uint8Array(W * H);
  const rand = mulberry32(42);
  const density = new Float32Array(grid.cells);
  for (let c = 0; c < grid.cells; c++) density[c] = 0.7 + rand() * 0.6;
  const cosDepot = Math.cos(BASE.clean / R);
  const [ex, ey, ez] = BASE.dir;

  forEachTexel((i, f, s, t) => {
    const P = FACES[f];
    const x = P.A[0] + P.e1[0] * s + P.e2[0] * t;
    const y = P.A[1] + P.e1[1] * s + P.e2[1] * t;
    const z = P.A[2] + P.e1[2] * s + P.e2[2] * t;
    if ((x * ex + y * ey + z * ez) / Math.hypot(x, y, z) > cosDepot) return;   // základna je čistá
    const c = hexAtParam(f, s, t);
    const gx = s * S, gy = t * S;                                  // souřadnice v bodech mapy
    const patch = tnoise(gx * 0.05 + f * 31, gy * 0.05);           // skvrny ~6 m
    const broad = tnoise(gx * 0.013 + f * 17 + 100, gy * 0.013);   // oblasti ~25 m
    // násobky 5 → mapa se při ukládání výborně komprimuje (síly nástrojů jsou násobky 10)
    d[i] = Math.max(5, Math.min(DUST.max, Math.round(density[c] * (20 + 14 * patch + 34 * broad) / 5) * 5));
  });

  dust = d;
  origin = d.slice();
  recountHexes(null);
  return d;
}

// Převezme mapu vygenerovanou ve Web Workeru (moonWorker.js) včetně původního prachu v hexech.
export function adoptGenerated(d, init) {
  dust = d;
  origin = d.slice();
  hexes.init = init;
  hexes.left = Int32Array.from(init);
  hexes.done = new Uint8Array(grid.cells);
  hexes.doneCount = 0;
  hexes.total = 0;
  for (let c = 0; c < grid.cells; c++) if (init[c]) hexes.total++;
  dirty.full = true;
  return d;
}

// ---------- rozdíl proti vygenerované mapě (ukládání a přenos v multiplayeru) ----------

// Rozdíl = kolik prachu kde ubylo. Skoro všude 0 → gzip ho zmenší na zlomek.
export function dustDiff() {
  const out = new Uint8Array(dust.length);
  for (let i = 0; i < dust.length; i++) out[i] = (origin[i] - dust[i]) & 255;
  return out;
}

// Použije uložený rozdíl na čerstvě vygenerovanou mapu a přepočítá hexy (jen změněné body).
export function applyDustDiff(diff) {
  if (!diff || diff.length !== dust.length) return false;
  const left = hexes.left;
  forEachTexel((i, f, s, t) => {
    const dv = diff[i];
    if (!dv) return;
    dust[i] = (origin[i] - dv) & 255;
    left[hexAtParam(f, s, t)] -= dv;
  });
  hexes.done.fill(0);
  hexes.doneCount = 0;
  for (let c = 0; c < grid.cells; c++) {
    if (hexes.init[c] && left[c] <= hexes.init[c] * HEX_DONE_LEFT) {
      hexes.done[c] = 1;
      hexes.doneCount++;
    }
  }
  dirty.full = true;
  return true;
}

// Spočítá prach v hexech. init = uložené původní hodnoty (nebo null → vezme současný stav).
export function recountHexes(init) {
  const left = new Int32Array(grid.cells);
  forEachTexel((i, f, s, t) => {
    const v = dust[i];
    if (v) left[hexAtParam(f, s, t)] += v;
  });
  hexes.left = left;
  hexes.init = init ? Int32Array.from(init) : Int32Array.from(left);
  hexes.done = new Uint8Array(grid.cells);
  hexes.doneCount = 0;
  hexes.total = 0;
  for (let c = 0; c < grid.cells; c++) {
    if (!hexes.init[c]) continue;
    hexes.total++;
    if (left[c] <= hexes.init[c] * HEX_DONE_LEFT) {
      hexes.done[c] = 1;
      hexes.doneCount++;
    }
  }
  dirty.full = true;
}

// ---------- zametání ----------

const visited = new Set();
const tmp = [0, 0];
const rmin = new Int32Array(SQX * SQY), rmax = new Int32Array(SQX * SQY);
const cmin = new Int32Array(SQX * SQY), cmax = new Int32Array(SQX * SQY);

// Zamete „kapsli“: pás šířky 2·radius od bodu p0 do p1 (jednotkové vektory).
// power = kolik prachu se z bodu sebere naráz; limit = max celkem.
// Vrací { got, completed: [id hexů, které se právě dočistily] }.
export function sweepCapsule(p0, p1, radius, power, limit) {
  const L = angleBetween(p0, p1) * R;
  const tx = L > 1e-4 ? tangentTo(p0, p1) : anyTangent(p0);
  const ty = cross(p0, tx);
  const step = TEXEL_M * 0.6;
  const vstep = Math.min(step, radius * 0.7);           // i úzký kartáček pokryje celý bod mapy
  const K = Math.floor(radius / vstep);
  const M = Math.max(1, Math.ceil((L + 2 * radius) / step));
  const du = (L + 2 * radius) / M;
  const r2 = radius * radius;

  visited.clear();
  rmin.fill(1e9); rmax.fill(-1); cmin.fill(1e9); cmax.fill(-1);
  let got = 0;
  const completed = [];
  const d = [0, 0, 0];

  outer:
  for (let m = 0; m <= M; m++) {
    const u = -radius + m * du;
    const along = u < 0 ? u : u > L ? u - L : 0;
    for (let k = -K; k <= K; k++) {
      const v = k * vstep;
      if (along * along + v * v > r2 && K > 0) continue;
      const a = u / R, b = v / R;
      d[0] = p0[0] + tx[0] * a + ty[0] * b;
      d[1] = p0[1] + tx[1] * a + ty[1] * b;
      d[2] = p0[2] + tx[2] * a + ty[2] * b;
      const l = Math.hypot(d[0], d[1], d[2]);
      d[0] /= l; d[1] /= l; d[2] /= l;

      const f = faceOf(d);
      planar(d, f, tmp);
      const i = texelOf(f, tmp[0], tmp[1]);
      if (visited.has(i)) continue;
      visited.add(i);
      const val = dust[i];
      if (!val) continue;
      const take = Math.min(val, power, limit - got);
      if (take <= 0) break outer;
      dust[i] = val - take;
      got += take;

      const c = hexOfTexel(i);
      hexes.left[c] -= take;
      if (!hexes.done[c] && hexes.left[c] <= hexes.init[c] * HEX_DONE_LEFT) {
        hexes.done[c] = 1;
        hexes.doneCount++;
        completed.push(c);
        dirty.completed.push(c);
      }

      const x = i % W, y = i / W | 0;
      const sq = (y / S | 0) * SQX + (x / S | 0);
      if (x < cmin[sq]) cmin[sq] = x;
      if (x > cmax[sq]) cmax[sq] = x;
      if (y < rmin[sq]) rmin[sq] = y;
      if (y > rmax[sq]) rmax[sq] = y;
    }
  }

  for (let sq = 0; sq < SQX * SQY; sq++) {
    if (rmax[sq] >= 0) dirty.rects.push(cmin[sq], rmin[sq], cmax[sq], rmax[sq]);
  }
  // dočištěný hex: zbytek (≤ 1 %) se vynuluje, aby byl hex vizuálně úplně čistý
  for (const c of completed) finishHex(c);
  if (dirty.rects.length > 4 * 400) { dirty.rects.length = 0; dirty.full = true; }
  return { got, completed };
}

// Projde všechny body mapy uvnitř hexu c: fn(index).
function forEachTexelInHex(c, fn) {
  const cd = [grid.dirs[c * 3], grid.dirs[c * 3 + 1], grid.dirs[c * 3 + 2]];
  const e1 = anyTangent(cd), e2 = cross(cd, e1);
  const ext = 9.5, step = TEXEL_M * 0.6, n = Math.ceil(2 * ext / step);
  const d = [0, 0, 0];
  for (let a = 0; a <= n; a++) {
    for (let b = 0; b <= n; b++) {
      const u = (-ext + a * step) / R, v = (-ext + b * step) / R;
      d[0] = cd[0] + e1[0] * u + e2[0] * v;
      d[1] = cd[1] + e1[1] * u + e2[1] * v;
      d[2] = cd[2] + e1[2] * u + e2[2] * v;
      const f = faceOf(d);
      planar(d, f, tmp);
      const i = texelOf(f, tmp[0], tmp[1]);
      if (hexOfTexel(i) !== c) continue;
      fn(i);
    }
  }
}

// Vynuluje zbytek prachu v hexu a označí změněné obdélníky textury. Vrací odstraněný prach.
function finishHex(c) {
  let got = 0;
  rmin.fill(1e9); rmax.fill(-1); cmin.fill(1e9); cmax.fill(-1);
  forEachTexelInHex(c, i => {
    if (!dust[i]) return;
    got += dust[i];
    dust[i] = 0;
    const x = i % W, y = i / W | 0;
    const sq = (y / S | 0) * SQX + (x / S | 0);
    if (x < cmin[sq]) cmin[sq] = x;
    if (x > cmax[sq]) cmax[sq] = x;
    if (y < rmin[sq]) rmin[sq] = y;
    if (y > rmax[sq]) rmax[sq] = y;
  });
  for (let sq = 0; sq < SQX * SQY; sq++) {
    if (rmax[sq] >= 0) dirty.rects.push(cmin[sq], rmin[sq], cmax[sq], rmax[sq]);
  }
  hexes.left[c] = 0;
  return got;
}

// Úplně vyčistí jeden hex (offline práce robotů). Vrací { got, completed }.
export function clearHex(c) {
  let got = 0;
  forEachTexelInHex(c, i => { got += dust[i]; dust[i] = 0; });
  hexes.left[c] = 0;
  const completed = !hexes.done[c] && !!hexes.init[c];
  if (completed) {
    hexes.done[c] = 1;
    hexes.doneCount++;
    dirty.completed.push(c);
  }
  dirty.full = true;
  return { got, completed };
}

// Kolik procent hexu je hotovo (pro HUD).
export function hexProgress(c) {
  const init = hexes.init[c];
  return init ? Math.min(100, (1 - hexes.left[c] / init) * 100) : 100;
}
