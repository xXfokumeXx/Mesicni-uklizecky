// Písková textura pro terén (dlaždice 512 × 512 bodů ≈ 8 × 8 m, opakuje se bez švů).
// Kanál R = zrnitost písku, G = drobné vlnky (čeřiny) od „větru“ – na Měsíci spíš od dopadů mikrometeoritů,
// ale ve hře působí jako písek. Mipmapy zajistí, že zrno v dálce nebliká.
import { mulberry32 } from '../planet/noise.js';

const THREE = window.THREE;
const N = 512;
let cached = null;

// Opakovatelný hodnotový šum na mřížce `cells` × `cells`.
function tileNoise(rand, cells) {
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rand();
  return (x, y) => {
    const fx = x * cells, fy = y * cells;
    const xi = Math.floor(fx), yi = Math.floor(fy);
    let u = fx - xi, v = fy - yi;
    u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v);
    const x0 = ((xi % cells) + cells) % cells, y0 = ((yi % cells) + cells) % cells;
    const x1 = (x0 + 1) % cells, y1 = (y0 + 1) % cells;
    const a = g[y0 * cells + x0], b = g[y0 * cells + x1], c = g[y1 * cells + x0], d = g[y1 * cells + x1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

export function sandTexture(renderer) {
  if (cached) return cached;
  const rand = mulberry32(2024);
  const warpA = tileNoise(rand, 6), warpB = tileNoise(rand, 6);
  const clump = tileNoise(rand, 64), clump2 = tileNoise(rand, 160);
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N;
      // zrno: jemný šum + shluky
      const grain = 0.45 * rand() + 0.35 * clump2(u, v) + 0.2 * clump(u, v);
      // čeřiny: celé počty vln na dlaždici (bez švu), zvlněné šumem
      const w = (warpA(u, v) - 0.5) * 1.6 + (warpB(u * 2 % 1, v * 2 % 1) - 0.5) * 0.5;
      const phase = (u * 15 + v * 4) + w;
      const t = phase - Math.floor(phase);
      const ripple = t < 0.7 ? t / 0.7 : (1 - t) / 0.3;            // pozvolná návětrná, strmá závětrná strana
      const o = (y * N + x) * 4;
      data[o] = Math.round(grain * 255);
      data[o + 1] = Math.round(ripple * 255);
      data[o + 2] = 128;
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  if (renderer) tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  tex.needsUpdate = true;
  cached = tex;
  return tex;
}
