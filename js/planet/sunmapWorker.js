// Web Worker mapy oken osvětlení (3.1, O-28): počítá dlaždice atlasu ve vysokém rozlišení.
// Zpráva: { key, x0, y0, size, S2, pver, patches } → odpověď { key, data: Uint16Array (half float, size² · 2) }.
// patches = srovnané plochy pod stavbami (height.js); mění se jen s verzí pver → mezipaměť výšek se zahodí.
import { texelWindows, resetHeights } from './sunwindow.js';
import { setTerrainPatches } from './height.js';

let ver = -1;
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
// float → half float (IEEE 754 binary16), stačí pro úhly −π…π (krok ~0,002 rad u π, ~0,0005 u 1)
function toHalf(v) {
  f32[0] = v;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  let e = ((x >>> 23) & 0xff) - 127 + 15;
  let m = x & 0x7fffff;
  if (e <= 0) return sign;                             // podtečení → ±0
  if (e >= 31) return sign | 0x7c00;
  m += 0x1000;                                          // zaokrouhlení
  if (m & 0x800000) { m = 0; e++; if (e >= 31) return sign | 0x7c00; }
  return sign | (e << 10) | (m >>> 13);
}

self.onmessage = e => {
  const job = e.data;
  if (job.pver !== ver) { setTerrainPatches(job.patches || []); resetHeights(); ver = job.pver; }
  const w = texelWindows(job);
  const out = new Uint16Array(w.length);
  for (let i = 0; i < w.length; i++) out[i] = toHalf(w[i]);
  self.postMessage({ key: job.key, data: out }, [out.buffer]);
};
