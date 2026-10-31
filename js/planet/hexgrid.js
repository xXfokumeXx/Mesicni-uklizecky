// Hexové sektory Měsíce (Goldbergův mnohostěn).
// Každá stěna ikosaedru se rozdělí trojúhelníkovou sítí s frekvencí n; bod sítě = střed hexu,
// rohy hexu = těžiště okolních trojúhelníků. Počet hexů = 10·n² + 2 (12 jsou pětiúhelníky).
import { MOON } from '../config.js';
import { FACES, faceOf, planar } from './icosa.js';
import { cross, anyTangent } from './vec.js';

const n = MOON.hexFreq;
const N1 = n + 1;
const R = MOON.radius;

// Vzdálenost středů sousedních hexů (přibližně, uprostřed stěn ikosaedru).
export const HEX_SPACING = R * 1.1071487 / n;

export const grid = {
  ready: false,
  cells: 0,
  dirs: null,          // Float32Array: směr středu hexu (jednotkový)
  triDir: null,        // Float32Array: směr rohů hexů (jednotkový)
  cellTris: null,      // Int32Array(cells·6): rohy hexu seřazené proti směru hodin
  cellTriCount: null,  // Uint8Array: 6, nebo 5 u pětiúhelníků
  neighbors: null,     // Int32Array(cells·6): sousední hexy (−1 = žádný)
};

const lattice = [];    // pro každou stěnu: (i, j) → id hexu

export function initGrid() {
  if (grid.ready) return;

  // --- body sítě, sloučení společných bodů na hranách stěn ---
  const maxCells = 10 * n * n + 2;
  const dirs = new Float32Array(maxCells * 3);
  const keyMap = new Map();
  let cells = 0;

  for (const F of FACES) {
    const lat = new Int32Array(N1 * N1).fill(-1);
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n - i; j++) {
        const x = F.A[0] + F.e1[0] * i / n + F.e2[0] * j / n;
        const y = F.A[1] + F.e1[1] * i / n + F.e2[1] * j / n;
        const z = F.A[2] + F.e1[2] * i / n + F.e2[2] * j / n;
        const l = Math.hypot(x, y, z);
        const key = Math.round(x / l * 2e4) + ',' + Math.round(y / l * 2e4) + ',' + Math.round(z / l * 2e4);
        let id = keyMap.get(key);
        if (id === undefined) {
          id = cells++;
          keyMap.set(key, id);
          dirs[id * 3] = x / l; dirs[id * 3 + 1] = y / l; dirs[id * 3 + 2] = z / l;
        }
        lat[i * N1 + j] = id;
      }
    }
    lattice.push(lat);
  }

  // --- trojúhelníky sítě (míří ven) a jejich těžiště = rohy hexů ---
  const T = 20 * n * n;
  const tris = new Int32Array(T * 3);
  let t = 0;
  for (const L of lattice) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n - i; j++) {
        const a = L[i * N1 + j], b = L[(i + 1) * N1 + j], c = L[i * N1 + j + 1];
        tris[t * 3] = a; tris[t * 3 + 1] = b; tris[t * 3 + 2] = c; t++;
        if (i + j < n - 1) {
          const e = L[(i + 1) * N1 + j + 1];
          tris[t * 3] = b; tris[t * 3 + 1] = e; tris[t * 3 + 2] = c; t++;
        }
      }
    }
  }
  const triDir = new Float32Array(T * 3);
  for (let k = 0; k < T; k++) {
    let cx = 0, cy = 0, cz = 0;
    for (let m = 0; m < 3; m++) {
      const v = tris[k * 3 + m];
      cx += dirs[v * 3]; cy += dirs[v * 3 + 1]; cz += dirs[v * 3 + 2];
    }
    const l = Math.hypot(cx, cy, cz);
    triDir[k * 3] = cx / l; triDir[k * 3 + 1] = cy / l; triDir[k * 3 + 2] = cz / l;
  }

  // --- rohy hexu seřazené dokola + sousedé ---
  const cellTris = new Int32Array(cells * 6).fill(-1);
  const cnt = new Uint8Array(cells);
  for (let k = 0; k < T; k++) {
    for (let m = 0; m < 3; m++) {
      const v = tris[k * 3 + m];
      if (cnt[v] < 6) cellTris[v * 6 + cnt[v]++] = k;
    }
  }
  const neighbors = new Int32Array(cells * 6).fill(-1);
  const ang = new Float64Array(6), ord = new Int32Array(6);
  for (let c = 0; c < cells; c++) {
    const cd = [dirs[c * 3], dirs[c * 3 + 1], dirs[c * 3 + 2]];
    const e1 = anyTangent(cd), e2 = cross(cd, e1);
    const k = cnt[c];
    for (let m = 0; m < k; m++) {
      const tk = cellTris[c * 6 + m];
      const vx = triDir[tk * 3], vy = triDir[tk * 3 + 1], vz = triDir[tk * 3 + 2];
      ang[m] = Math.atan2(vx * e2[0] + vy * e2[1] + vz * e2[2], vx * e1[0] + vy * e1[1] + vz * e1[2]);
      ord[m] = tk;
    }
    for (let a = 1; a < k; a++) {
      const av = ang[a], ov = ord[a];
      let b = a - 1;
      while (b >= 0 && ang[b] > av) { ang[b + 1] = ang[b]; ord[b + 1] = ord[b]; b--; }
      ang[b + 1] = av; ord[b + 1] = ov;
    }
    let nb = 0;
    for (let m = 0; m < k; m++) {
      const tk = ord[m];
      cellTris[c * 6 + m] = tk;
      for (let q = 0; q < 3; q++) {
        const v = tris[tk * 3 + q];
        if (v === c) continue;
        let seen = false;
        for (let s = 0; s < nb; s++) if (neighbors[c * 6 + s] === v) { seen = true; break; }
        if (!seen && nb < 6) neighbors[c * 6 + nb++] = v;
      }
    }
  }

  Object.assign(grid, {
    ready: true, cells,
    dirs: dirs.subarray(0, cells * 3), triDir, cellTris, cellTriCount: cnt, neighbors,
  });
}

// Hex v bodě (s, t) stěny f – nejbližší bod trojúhelníkové sítě (metrika pro úhel 60°).
export function hexAtParam(f, s, t) {
  const u = s * n, v = t * n;
  const i0 = Math.floor(u), j0 = Math.floor(v);
  let bi = i0, bj = j0, bd = Infinity;
  for (let di = 0; di < 2; di++) {
    for (let dj = 0; dj < 2; dj++) {
      const du = u - (i0 + di), dv = v - (j0 + dj);
      const dd = du * du + dv * dv + du * dv;
      if (dd < bd) { bd = dd; bi = i0 + di; bj = j0 + dj; }
    }
  }
  bi = Math.max(0, Math.min(n, bi));
  bj = Math.max(0, Math.min(n - bi, bj));
  return lattice[f][bi * N1 + bj];
}

const tmp = [0, 0];
export function dirToCell(d) {
  const f = faceOf(d);
  planar(d, f, tmp);
  return hexAtParam(f, tmp[0], tmp[1]);
}

export const cellDir = c => [grid.dirs[c * 3], grid.dirs[c * 3 + 1], grid.dirs[c * 3 + 2]];
