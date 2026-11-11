// Létání (3.1, L-66): konstanty a pomocné výpočty pro řízení letounu (player.js fly). Bez three.js.
// Letoun drží cílovou výšku nad terénem (2–40 m, Prachovka zametá v 1,5 m), nad stavbou nejméně 3 m nad její
// střechou, od věže LAAC odstup. Přistává se E: do 30 m od vlastní plošiny na ni, jinak na místě (svah do 15°).
import { game } from './state.js';
import { MOON } from './config.js';
import { STRUCTURES, partsOf, partTopHeight, dirToLocal } from './structures.js';
import { BUILDINGS } from './base.js';
import { heightAt } from './planet/height.js';
import { modelInfo } from './assets/models.js';
import { angleBetween, madd, norm, tangentTo, anyTangent, cross } from './planet/vec.js';
import { laac, airHome, padUnder, LAAC } from './laac.js';

const R = MOON.radius;
export const AIR = {
  start: 6,                   // m – výška po vzletu
  min: 2, max: 40,            // m nad terénem (mezerník / Shift)
  sweepAlt: 1.5,              // Prachovka zametá v 1,5 m
  climb: 5,                   // m/s změna cílové výšky při držení kláves
  vRate: 5,                   // m/s nejvyšší svislá rychlost
  accel: 4,                   // m/s² zrychlení
  stop: 2,                    // s – stabilizace zastaví letoun po puštění kláves
  emergencyAlt: 3, emergencySpeed: 4,   // vybitá baterie: nízko a pomalu domů (L-66)
  landSpeed: 2.5,             // m/s klesání při přistání
  approach: 6,                // m/s přiblížení k místu přistání
  slope: Math.tan(15 * Math.PI / 180),
  sellAlt: 10,                // m – výsyp ve Výkupu i ve visu do 10 m
  roof: 3,                    // m nad střechou stavby
  defaultHeight: 12,          // m – výška stavby, když model nezná rozměr
};

const heightCache = new Map();
function structHeight(type) {
  if (!heightCache.has(type)) {
    const info = modelInfo(STRUCTURES[type]?.model);
    if (!info) return AIR.defaultHeight;                      // model ještě není načtený – zkusit příště
    heightCache.set(type, info.size[1]);
  }
  return heightCache.get(type);
}
const inRect = (f, x, z, m = 0) => x > f[0] - m && x < f[1] + m && z > f[2] - m && z < f[3] + m;

// Nejnižší dovolená výška letounu nad poloměrem v bodě p (střecha stavby + 3 m), nebo -Infinity.
// Plošiny LAAC a věž se nepočítají (na plošiny se přistává, od věže drží odstup – towerPush).
export function airFloor(p) {
  let floor = -Infinity;
  for (const b of game.s.buildings || []) {
    if (b.type === 'laac' || angleBetween(b.p, p) * R > 45) continue;
    const def = STRUCTURES[b.type];
    if (def?.kind === 'belt' || def?.hover) continue;
    for (const part of partsOf(b)) {
      const [x, z] = dirToLocal(part.p, part.yaw, p);
      if (inRect(part.foot, x, z, 1)) floor = Math.max(floor, partTopHeight(part) + structHeight(b.type) + AIR.roof);
    }
  }
  for (const B of BUILDINGS) {
    if (angleBetween(B.dir, p) * R > (B.r || 15) + 3) continue;
    const [x, z] = dirToLocal(B.dir, B.yaw, p);
    if ((B.solid || []).some(r => inRect(r, x, z, 1))) floor = Math.max(floor, heightAt(B.dir) + AIR.defaultHeight + AIR.roof);
  }
  return floor;
}

// Odstup od věže LAAC: posune bod p ven z kruhu LAAC.keepOut kolem osy věže (vrací nový bod, nebo p)
export function towerPush(p) {
  const b = laac();
  if (!b) return p;
  const d = angleBetween(b.p, p) * R;
  if (d >= LAAC.keepOut || d < 1e-4) return p;
  const out = tangentTo(b.p, madd(p, b.p, -1));
  return norm(madd(b.p, out, LAAC.keepOut / R));
}

// Kam přistát (E ve vzduchu): { to, top, pad } nebo { reason }
export function landSite(v, p) {
  const home = airHome(v);
  if (home && angleBetween(home.dir, p) * R <= LAAC.landReach) return { to: home.dir, top: home.top, pad: true };
  const on = padUnder(p);
  if (on && !game.s.vehicles.some(x => x !== v && angleBetween(x.p, on.part.p) * R < 3)) return { to: on.part.p, top: partTopHeight(on.part), pad: true };
  if (airFloor(p) > -Infinity) return { reason: 'Na stavbu přistát nejde – jen na plošinu LAAC nebo na volný terén' };
  const t = anyTangent(p), u = cross(p, t);
  let lo = Infinity, hi = -Infinity;
  for (const [a, c] of [[0, 0], [2.5, 0], [-2.5, 0], [0, 2.5], [0, -2.5]]) {
    const h = heightAt(norm(madd(madd(p, t, a / R), u, c / R)));
    lo = Math.min(lo, h); hi = Math.max(hi, h);
  }
  if ((hi - lo) / 5 > AIR.slope) return { reason: 'Moc strmý svah na přistání (víc než 15°) – popoleť jinam' };
  return { to: p, top: heightAt(p), pad: false };
}

// ---------- skener Kolibříku (L-65, O-23) ----------
// 5 nejšpinavějších hexů (nejvíc zbývajícího prachu) do dosahu range m od p. Volá se nejvýš 1× za 2 s.
import { hexes } from './planet/dustmap.js';
import { grid } from './planet/hexgrid.js';
export const scan = { cells: [], at: 0 };
export function scanDust(p, range) {
  const out = [];
  if (!hexes.left || !grid.ready) return out;
  const cosMax = Math.cos(range / R);
  const d = grid.dirs;
  for (let c = 0; c < grid.cells; c++) {
    if (hexes.done?.[c] || !(hexes.left[c] > 0)) continue;
    if (d[c * 3] * p[0] + d[c * 3 + 1] * p[1] + d[c * 3 + 2] * p[2] < cosMax) continue;
    const left = hexes.left[c];
    if (out.length < 5) { out.push({ c, left }); out.sort((a, b) => b.left - a.left); }
    else if (left > out[4].left) { out[4] = { c, left }; out.sort((a, b) => b.left - a.left); }
  }
  return out.map(x => x.c);
}
