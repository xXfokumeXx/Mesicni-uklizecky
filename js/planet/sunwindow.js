// Stíny terénu: pro každý bod povrchu spočítá „okno“, kdy na něj svítí Slunce.
// Slunce obíhá po pevné dráze (osa Měsíce, sklon 1,54°), takže stačí zjistit, při jakém úhlu
// dráhy Slunce bod poprvé osvítí (vyjde nad terénem) a kdy zapadne. Viditelnost se zjistí
// pochodováním paprsku od bodu ke Slunci přes výškovou mapu.
// Výsledek je dvojice úhlů vůči místnímu poledni: [východ, západ] (v radiánech, záporný / kladný).
// Shader pak každý snímek jen porovná úhel Slunce s těmito dvěma čísly – bez další práce CPU.
import { MOON, SUN, RELIEF } from '../config.js';
import { heightAt } from './height.js';
import { FACES, faceOf, planar } from './icosa.js';

const R = MOON.radius;
const M = MOON.terrainSeg;
const N1 = M + 1;
const CE = Math.cos(SUN.tilt), SE = Math.sin(SUN.tilt);
const MAX_H = RELIEF.maxH;                              // nejvyšší kopec (rychlý konec paprsku)
const STEPS = [1.2, 2.5, 4.5, 7.5, 12, 19, 30, 48, 75, 115, 170, 240];
const SEARCH = 7;                                       // kroků půlení intervalu (přesnost ~0,7°)

// ---------- výšky z mřížky terénu (s mezipamětí) ----------

const cache = FACES.map(() => null);
const tmp = [0, 0];
const dir = [0, 0, 0];

function gridHeight(f, i, j) {
  let c = cache[f];
  if (!c) { c = cache[f] = new Float32Array(N1 * N1).fill(NaN); }
  const k = i * N1 + j;
  let h = c[k];
  if (h !== h) {                                        // NaN = ještě nespočítáno
    const P = FACES[f];
    const s = i / M, t = j / M;
    dir[0] = P.A[0] + P.e1[0] * s + P.e2[0] * t;
    dir[1] = P.A[1] + P.e1[1] * s + P.e2[1] * t;
    dir[2] = P.A[2] + P.e1[2] * s + P.e2[2] * t;
    const l = Math.hypot(dir[0], dir[1], dir[2]);
    dir[0] /= l; dir[1] /= l; dir[2] /= l;
    h = c[k] = heightAt(dir);
  }
  return h;
}

// Výška terénu ve směru d (lineárně z mřížky – stejně jako vykreslený povrch).
export function terrainHeight(d) {
  const f = faceOf(d);
  planar(d, f, tmp);
  const u = Math.min(M - 1e-6, Math.max(0, tmp[0] * M));
  const v = Math.min(M - 1e-6, Math.max(0, tmp[1] * M));
  const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
  const h00 = gridHeight(f, i, j), h10 = gridHeight(f, i + 1, j), h01 = gridHeight(f, i, j + 1);
  if (fu + fv <= 1) return h00 + (h10 - h00) * fu + (h01 - h00) * fv;
  const h11 = gridHeight(f, i + 1, j + 1);
  return h11 + (h01 - h11) * (1 - fu) + (h10 - h11) * (1 - fv);
}

// ---------- viditelnost Slunce ----------

const q = [0, 0, 0];

// Je Slunce (na úhlu dráhy theta) vidět z bodu P [x,y,z]?
export function sunVisible(P, theta) {
  const sx = Math.sin(theta) * CE, sy = SE, sz = Math.cos(theta) * CE;
  for (const t of STEPS) {
    const x = P[0] + sx * t, y = P[1] + sy * t, z = P[2] + sz * t;
    const l = Math.hypot(x, y, z);
    if (l > R + MAX_H) return true;                     // paprsek už je nad všemi kopci
    q[0] = x / l; q[1] = y / l; q[2] = z / l;
    if (l < R + terrainHeight(q)) return false;
  }
  return true;
}

// Okno osvětlení bodu ve směru d: [východ, západ] jako úhly vůči místnímu poledni.
export function sunWindow(d) {
  const r = R + terrainHeight(d) + 0.35;
  const P = [d[0] * r, d[1] * r, d[2] * r];
  const noon = Math.atan2(d[0], d[2]);
  const rho = Math.hypot(d[0], d[2]);
  // půlden H: geometrický východ/západ (bez terénu); u pólů polární den/noc
  const c = rho > 1e-6 ? -SE * d[1] / (CE * rho) : (d[1] * SE > 0 ? -2 : 2);
  const H = c <= -1 ? Math.PI : c >= 1 ? 0 : Math.acos(c);
  if (H === 0 || !sunVisible(P, noon)) return [0, 0];   // sem Slunce nesvítí vůbec

  const edge = sign => {
    let vis = 0;
    let inv = sign * Math.min(Math.PI, H + 0.06);
    if (H > Math.PI - 1e-6 && sunVisible(P, noon + inv)) return inv;
    for (let k = 0; k < SEARCH; k++) {
      const mid = (vis + inv) / 2;
      if (sunVisible(P, noon + mid)) vis = mid; else inv = mid;
    }
    return vis;
  };
  return [edge(-1), edge(1)];
}

// Okna pro mřížku bodů kusu terénu (každý step-tý vrchol). Vrací Float32Array (n·n·2).
export function chunkWindows({ f, oi, oj, dir: sgn, Q, step }) {
  const P = FACES[f];
  const n = Q / step + 1;
  const out = new Float32Array(n * n * 2);
  const d = [0, 0, 0];
  for (let b2 = 0; b2 < n; b2++) {
    for (let a2 = 0; a2 < n; a2++) {
      const s = (oi + sgn * a2 * step) / M, t = (oj + sgn * b2 * step) / M;
      d[0] = P.A[0] + P.e1[0] * s + P.e2[0] * t;
      d[1] = P.A[1] + P.e1[1] * s + P.e2[1] * t;
      d[2] = P.A[2] + P.e1[2] * s + P.e2[2] * t;
      const l = Math.hypot(d[0], d[1], d[2]);
      const w = sunWindow([d[0] / l, d[1] / l, d[2] / l]);
      out[(b2 * n + a2) * 2] = w[0];
      out[(b2 * n + a2) * 2 + 1] = w[1];
    }
  }
  return out;
}

// Výchozí okno, dokud se stín nespočítá: rovina (Slunce svítí od východu do západu).
export const FLAT_WINDOW = [-Math.PI / 2 - 0.03, Math.PI / 2 + 0.03];

// Jeden řádek mřížky (pro výpočet po kouskách v hlavním vlákně, když Worker není k dispozici).
export function chunkWindowsRow({ f, oi, oj, dir: sgn, Q, step }, b2, out) {
  const P = FACES[f];
  const n = Q / step + 1;
  const d = [0, 0, 0];
  for (let a2 = 0; a2 < n; a2++) {
    const s = (oi + sgn * a2 * step) / M, t = (oj + sgn * b2 * step) / M;
    d[0] = P.A[0] + P.e1[0] * s + P.e2[0] * t;
    d[1] = P.A[1] + P.e1[1] * s + P.e2[1] * t;
    d[2] = P.A[2] + P.e1[2] * s + P.e2[2] * t;
    const l = Math.hypot(d[0], d[1], d[2]);
    const w = sunWindow([d[0] / l, d[1] / l, d[2] / l]);
    out[(b2 * n + a2) * 2] = w[0];
    out[(b2 * n + a2) * 2 + 1] = w[1];
  }
}
