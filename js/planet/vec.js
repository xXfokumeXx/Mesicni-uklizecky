// Drobná vektorová matematika nad poli [x, y, z] (logika hry nepotřebuje Three.js).

export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

// a + b·s
export const madd = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

export function norm(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

// Průmět vektoru v do tečné roviny koule v bodě p (p je jednotkový), normalizovaný.
export const tangentTo = (p, v) => norm(madd(v, p, -dot(v, p)));

export const angleBetween = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b))));

// Libovolný tečný vektor v bodě p.
export const anyTangent = p => tangentTo(p, Math.abs(p[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);

// Otočení vektoru v (kolmého na osu) kolem osy o úhel.
export function rotateAround(v, axis, angle) {
  const c = Math.cos(angle), s = Math.sin(angle), k = cross(axis, v);
  return [v[0] * c + k[0] * s, v[1] * c + k[1] * s, v[2] * c + k[2] * s];
}
