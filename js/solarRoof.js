// Solární střecha vozidel (L-04): kolik Slunce na střechu právě dopadá, 0–1 = max(0, sin(výška Slunce)) × (není ve stínu kopce).
// Stín se zjišťuje přes sunVisible() nejvýš jednou za 0,5 s na vozidlo (jako u hráče), mezitím se vrací poslední hodnota.
import { MOON } from './config.js';
import { gameTime } from './state.js';
import { SOLAR_ROOF } from './catalog.js';
import { heightAt } from './planet/height.js';
import { sunElevationDeg, sunAngle } from './planet/sun.js';
import { sunVisible } from './planet/sunwindow.js';

const R = MOON.radius;
const cache = new Map();            // uid → { at, k }

export const roofLevel = v => SOLAR_ROOF[Math.min(3, v?.lv?.solar | 0)] || null;

export function roofSun(v) {
  if (!roofLevel(v) || !v.p) return 0;
  const now = performance.now();
  const c = cache.get(v.uid);
  if (c && now - c.at < 500) return c.k;
  const t = gameTime();
  const elev = sunElevationDeg(v.p, t);
  let k = 0;
  if (elev > 0) {
    const r = R + heightAt(v.p) + 2;
    k = sunVisible([v.p[0] * r, v.p[1] * r, v.p[2] * r], sunAngle(t)) ? Math.sin(elev * Math.PI / 180) : 0;
  }
  cache.set(v.uid, { at: now, k });
  return k;
}

// Podíl spotřeby, který střecha při jízdě pokryje (0–0,5)
export const roofCover = v => (roofLevel(v) ? roofLevel(v).cover * roofSun(v) : 0);
// Dobíjení ve stání ⚡/s
export const roofRest = v => (roofLevel(v) ? roofLevel(v).rest * roofSun(v) : 0);
