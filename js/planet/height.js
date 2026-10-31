// Reliéf Měsíce (verze 2 – výraznější vertikalita): vysočiny a pánve, hřebeny, velká pole dun
// a krátery se strmou vnitřní stěnou, zvednutým valem, vyvrženinou a u velkých kráterů
// s plochým dnem a centrálním vrcholem. Vrací výšku v metrech nad poloměrem.
import { MOON, BASE, PLANET } from '../config.js';
import { fbm, mulberry32 } from './noise.js';
import { dot, angleBetween } from './vec.js';
import { FACES, faceOf } from './icosa.js';

const R = MOON.radius;

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Krátery rozházené náhodně, ale vždy stejně (pevné semínko).
// kind: 0 = malý mísovitý, 1 = střední, 2 = velký „komplexní“ (ploché dno + centrální vrchol)
const CRATERS = [];
{
  const rand = mulberry32(PLANET.seed);
  for (let k = 0; k < PLANET.craters; k++) {
    const z = rand() * 2 - 1, th = rand() * Math.PI * 2, rr = Math.sqrt(1 - z * z);
    const c = [rr * Math.cos(th), z, rr * Math.sin(th)];
    const roll = rand();
    const radius = roll < 0.06 ? 38 + rand() * 34 : roll < 0.3 ? 13 + rand() * 18 : 3.5 + rand() * 7;
    const kind = radius > 36 ? 2 : radius > 12 ? 1 : 0;
    if (angleBetween(c, BASE.dir) * R < radius * 1.6 + BASE.flat + 12) continue;   // základnu nechat v rovině
    const depth = kind === 2 ? Math.min(17, radius * 0.24) : radius * 0.3;
    CRATERS.push({ c, radius, kind, depth, cosMax: Math.cos(radius * 2.3 / R) });
  }
}

// Krátery roztříděné podle stěn ikosaedru → heightAt testuje jen pár kráterů místo 300.
const FACE_RADIUS = 0.66;   // úhel od středu stěny k jejímu rohu (+ rezerva)
const BINS = FACES.map(F => CRATERS.filter(cr =>
  Math.acos(Math.min(1, dot(F.center, cr.c))) < FACE_RADIUS + Math.acos(cr.cosMax) + 0.01));

// Profil krateru podle vzdálenosti od středu (q = vzdálenost / poloměr).
function craterProfile(cr, q) {
  const d = cr.depth;
  let h = 0;
  if (q < 1) {
    if (cr.kind === 2) {
      h -= d * (1 - smooth(0.42, 1.0, q));                          // ploché dno a strmá stěna
      h += d * 0.6 * Math.exp(-((q / 0.12) ** 2));                   // centrální vrchol
    } else {
      h -= d * (1 - q * q) ** 1.6;                                   // mísa bez zlomu na okraji
    }
  }
  // val: strmý dovnitř, pozvolný ven (vyvržený materiál)
  const w = q < 1 ? 0.16 : 0.5;
  h += d * 0.42 * Math.exp(-(((q - 1) / w) ** 2));
  return h;
}

// Duna se strmou závětrnou stranou (fáze 0–1 → výška 0–1).
function duneProfile(ph) {
  const t = ph - Math.floor(ph);
  return t < 0.72 ? smooth(0, 0.72, t) : 1 - smooth(0.72, 1, t);
}

const OFF = PLANET.noise;                           // jiná planeta = jiný výřez šumu

export function heightAt(d) {
  const x = d[0] * R + OFF, y = d[1] * R, z = d[2] * R - OFF;

  // velké vlny terénu (pánve a vysočiny)
  let h = fbm(x * 0.0048, y * 0.0048, z * 0.0048, 3) * 34;

  // hřebeny a vrcholy (zaoblená špička – žádný ostrý zlom, ze kterého by se vyletělo)
  const n = fbm(x * 0.014 + 11, y * 0.014, z * 0.014 - 5, 3);
  const ridge = 1 - Math.sqrt(n * n + 0.012);
  h += ridge ** 3 * 17 - 3;

  // drobné nerovnosti
  h += fbm(x * 0.04, y * 0.04 + 3, z * 0.04, 2) * 0.8;

  // pole dun (velké oblasti), hřebeny zvlněné šumem a výška duny se mění
  const duneMask = smooth(-0.08, 0.28, fbm(x * 0.006 + 40, y * 0.006, z * 0.006, 2));
  if (duneMask > 0) {
    const warp = fbm(x * 0.022, y * 0.022 + 17, z * 0.022, 2) * 7;
    const ph = (x * 0.026 + y * 0.009 + z * 0.019) + warp * 0.16;
    const amp = 3.4 + 3.6 * (0.5 + 0.5 * fbm(x * 0.012 + 3, y * 0.012, z * 0.012 + 8, 2));
    h += duneMask * (duneProfile(ph) * amp - amp * 0.35);
    // jemné příčné vlnky na dunách
    h += duneMask * Math.sin(x * 0.21 - z * 0.17 + warp) * 0.18;
  }

  // krátery
  for (const cr of BINS[faceOf(d)]) {
    const cd = dot(d, cr.c);
    if (cd < cr.cosMax) continue;
    const dist = Math.acos(Math.min(1, cd)) * R;
    h += craterProfile(cr, dist / cr.radius);
  }

  // rovina pro základnu
  h *= smooth(BASE.flat, BASE.flat + 26, angleBetween(d, BASE.dir) * R);
  return h;
}
