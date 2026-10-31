// Ikosaedr: základ hexové mřížky, prachové mapy i terénu.
// Bod na kouli se promítne (gnómonicky) do roviny stěny; (s, t) jsou souřadnice
// ve stěně: bod = A + s·(B − A) + t·(C − A), s, t ≥ 0, s + t ≤ 1.
import { dot, cross, norm } from './vec.js';

const PHI = (1 + Math.sqrt(5)) / 2;
const V = [
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
  [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
  [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
].map(norm);
const F = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export const FACES = F.map(([ia, ib, ic]) => {
  const A = V[ia], B = V[ib], C = V[ic];
  const e1 = sub(B, A), e2 = sub(C, A);
  const nrm = norm(cross(e1, e2));
  const g11 = dot(e1, e1), g12 = dot(e1, e2), g22 = dot(e2, e2), det = g11 * g22 - g12 * g12;
  return {
    A, e1, e2, nrm,
    planeD: dot(A, nrm),
    Ds: [0, 1, 2].map(k => (e1[k] * g22 - e2[k] * g12) / det),   // duální báze pro výpočet s
    Dt: [0, 1, 2].map(k => (e2[k] * g11 - e1[k] * g12) / det),   // … a t
    center: norm([A[0] + B[0] + C[0], A[1] + B[1] + C[1], A[2] + B[2] + C[2]]),
  };
});

// Délka hrany stěny (na jednotkové kouli, v rovině stěny).
export const EDGE = Math.hypot(...FACES[0].e1);

// Na které stěně leží směr d?
export function faceOf(d) {
  let f = 0, best = -2;
  for (let k = 0; k < 20; k++) {
    const c = FACES[k].center;
    const v = d[0] * c[0] + d[1] * c[1] + d[2] * c[2];
    if (v > best) { best = v; f = k; }
  }
  return f;
}

// Souřadnice (s, t) směru d ve stěně f; zapíše do out a vrátí ho.
export function planar(d, f, out) {
  const P = FACES[f];
  const k = P.planeD / (d[0] * P.nrm[0] + d[1] * P.nrm[1] + d[2] * P.nrm[2]);
  const rx = d[0] * k - P.A[0], ry = d[1] * k - P.A[1], rz = d[2] * k - P.A[2];
  out[0] = rx * P.Ds[0] + ry * P.Ds[1] + rz * P.Ds[2];
  out[1] = rx * P.Dt[0] + ry * P.Dt[1] + rz * P.Dt[2];
  return out;
}

// Jednotkový směr bodu (s, t) ve stěně f.
export function pointOnFace(f, s, t) {
  const P = FACES[f];
  return norm([
    P.A[0] + P.e1[0] * s + P.e2[0] * t,
    P.A[1] + P.e1[1] * s + P.e2[1] * t,
    P.A[2] + P.e1[2] * s + P.e2[2] * t,
  ]);
}
