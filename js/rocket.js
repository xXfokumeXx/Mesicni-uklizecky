// Obrovská raketa s lunárním modulem a vlajkou na odvrácené straně Měsíce (naproti základně).
// Čeká, až bude Měsíc na 100 % čistý (všechny hexy hotové); pak do ní jde nastoupit (E)
// a odletět domů – úspěch „Poslední zhasne“. Start vidí jen hráč, který odletěl; raketa se
// po minutě vrátí na rampu pro další kolegy. Místo je pro všechny stejné (pevné semínko).
import { MOON, BASE } from './config.js';
import { heightAt } from './planet/height.js';
import { hexes } from './planet/dustmap.js';
import { mulberry32 } from './planet/noise.js';
import { norm, madd, anyTangent, cross, angleBetween } from './planet/vec.js';

const R = MOON.radius;
export const ROCKET = { reach: 9, pad: 7.5, countdown: 3, back: 60 };

// Rozdíl nejvyšší a nejnižší výšky terénu do 10 m od bodu (menší = rovnější místo).
function roughness(d) {
  const e1 = anyTangent(d), e2 = cross(d, e1);
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < 13; k++) {
    const a = k / 12 * Math.PI * 2, r = k === 12 ? 0 : (k % 2 ? 5 : 10);
    const h = heightAt(norm(madd(madd(d, e1, Math.cos(a) * r / R), e2, Math.sin(a) * r / R)));
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  return hi - lo;
}

// Nejrovnější z 40 náhodných míst 5–20° od protinožce základny.
export const ROCKET_SITE = (() => {
  const anti = BASE.dir.map(c => -c);
  const e1 = anyTangent(anti), e2 = cross(anti, e1);
  const rand = mulberry32(2026);
  let best = anti, bestR = Infinity;
  for (let k = 0; k < 40; k++) {
    const a = rand() * Math.PI * 2, ang = (5 + rand() * 15) * Math.PI / 180;
    const d = norm(madd(madd(anti, e1, Math.cos(a) * ang), e2, Math.sin(a) * ang));
    const r = roughness(d);
    if (r < bestR) { bestR = r; best = d; }
  }
  const east = anyTangent(best);
  return { dir: best, east, north: cross(best, east) };
})();

// Směr bodu x m na východ a y m na sever od rakety.
export const siteDir = (x, y) => norm(madd(madd(ROCKET_SITE.dir, ROCKET_SITE.east, x / R), ROCKET_SITE.north, y / R));

export const nearRocket = p => angleBetween(p, ROCKET_SITE.dir) * R < ROCKET.reach;
export const distanceToRocket = p => angleBetween(p, ROCKET_SITE.dir) * R;
export const rocketReady = () => hexes.total > 0 && hexes.doneCount >= hexes.total;
export const cleanPercent = () => (hexes.total ? Math.floor(hexes.doneCount / hexes.total * 1000) / 10 : 0);

// Start rakety (jen u tohoto hráče): čas startu v ms (performance.now), 0 = stojí na rampě.
let launchedAt = 0;
export function launchRocket() {
  if (launchSeconds() >= 0) return false;
  launchedAt = performance.now();
  return true;
}
// Sekundy od stisku E (−1 = raketa stojí na rampě). Po ROCKET.back s je zpátky.
export function launchSeconds() {
  if (!launchedAt) return -1;
  const t = (performance.now() - launchedAt) / 1000;
  if (t > ROCKET.back) { launchedAt = 0; return -1; }
  return t;
}
