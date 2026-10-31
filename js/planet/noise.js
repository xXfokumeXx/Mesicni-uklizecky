// Deterministický 3D šum pro terén, prach a texturu Země.

function hash(x, y, z) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fade = t => t * t * (3 - 2 * t);

// Hodnotový šum v rozsahu 0–1.
export function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const u = fade(x - xi), v = fade(y - yi), w = fade(z - zi);
  const c000 = hash(xi, yi, zi),         c100 = hash(xi + 1, yi, zi);
  const c010 = hash(xi, yi + 1, zi),     c110 = hash(xi + 1, yi + 1, zi);
  const c001 = hash(xi, yi, zi + 1),     c101 = hash(xi + 1, yi, zi + 1);
  const c011 = hash(xi, yi + 1, zi + 1), c111 = hash(xi + 1, yi + 1, zi + 1);
  const x00 = c000 + (c100 - c000) * u, x10 = c010 + (c110 - c010) * u;
  const x01 = c001 + (c101 - c001) * u, x11 = c011 + (c111 - c011) * u;
  const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
  return y0 + (y1 - y0) * w;
}

// Fraktální šum v rozsahu přibližně −1 až 1.
export function fbm(x, y, z, octaves) {
  let sum = 0, amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * (vnoise(x, y, z) * 2 - 1);
    total += amp;
    amp *= 0.5;
    x *= 2.03; y *= 2.03; z *= 2.03;
  }
  return sum / total;
}

export function mulberry32(seed) {
  let a = seed | 0;
  return () => {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
