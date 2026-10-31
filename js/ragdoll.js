// Ragdoll astronauta po srážce s vozidlem.
// Tělo = 15 bodů (klouby) spojených tyčemi pevné délky (Verletova integrace).
// Gravitace míří do středu Měsíce (1,62 m/s²), body se odrážejí od terénu a kloužou s třením.
// Když se tělo uklidní, astronaut vstane a hráč ho zase ovládá.
import { MOON, MOON_GRAVITY } from './config.js';
import { heightAt } from './planet/height.js';

const R = MOON.radius;

// Indexy bodů
export const RG = {
  pelvis: 0, chest: 1, head: 2,
  shL: 3, elL: 4, haL: 5, shR: 6, elR: 7, haR: 8,
  hipL: 9, knL: 10, ftL: 11, hipR: 12, knR: 13, ftR: 14,
};
export const RG_COUNT = 15;

// Tyče: [a, b] (délka se vezme z výchozí pózy) a „opěry“, které drží trup pohromadě.
const STICKS = [
  [0, 1], [1, 2], [1, 3], [1, 6], [3, 6], [0, 9], [0, 12], [9, 12], [3, 9], [6, 12], [3, 12], [6, 9],
  [0, 2], [3, 2], [6, 2],
  [3, 4], [4, 5], [6, 7], [7, 8],
  [9, 10], [10, 11], [12, 13], [13, 14],
];
// Minimální vzdálenosti (kolena a lokty se nepřehnou úplně)
const MIN_DIST = [[9, 11, 0.45], [12, 14, 0.45], [3, 5, 0.22], [6, 8, 0.22], [2, 0, 0.6]];

const SUBSTEPS = 3, ITER = 5;
const BOUNCE = 0.35, FRICTION = 0.55, RADIUS = 0.1;

// Vytvoří ragdoll z bodů výchozí pózy (pole [x,y,z] ve světě) a počáteční rychlosti.
// vel = [vx,vy,vz] (m/s), spin = úhlová rychlost [wx,wy,wz] (rad/s) kolem těžiště.
export function createRagdoll(points, vel, spin) {
  const n = points.length;
  const pos = new Float64Array(n * 3), prev = new Float64Array(n * 3);
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += points[i][0]; cy += points[i][1]; cz += points[i][2]; }
  cx /= n; cy /= n; cz /= n;
  const dt = 1 / 60;
  for (let i = 0; i < n; i++) {
    const [x, y, z] = points[i];
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    // rychlost bodu = posun + rotace kolem těžiště (ω × r)
    const rx = x - cx, ry = y - cy, rz = z - cz;
    const vx = vel[0] + spin[1] * rz - spin[2] * ry;
    const vy = vel[1] + spin[2] * rx - spin[0] * rz;
    const vz = vel[2] + spin[0] * ry - spin[1] * rx;
    prev[i * 3] = x - vx * dt; prev[i * 3 + 1] = y - vy * dt; prev[i * 3 + 2] = z - vz * dt;
  }
  const rest = STICKS.map(([a, b]) => Math.hypot(points[a][0] - points[b][0], points[a][1] - points[b][1], points[a][2] - points[b][2]));
  return { pos, prev, rest, n, time: 0, calm: 0, lastDt: dt, done: false };
}

function satisfy(rd) {
  const p = rd.pos;
  for (let k = 0; k < STICKS.length; k++) {
    const [a, b] = STICKS[k];
    const dx = p[b * 3] - p[a * 3], dy = p[b * 3 + 1] - p[a * 3 + 1], dz = p[b * 3 + 2] - p[a * 3 + 2];
    const d = Math.hypot(dx, dy, dz) || 1e-6;
    const diff = (d - rd.rest[k]) / d * 0.5;
    p[a * 3] += dx * diff; p[a * 3 + 1] += dy * diff; p[a * 3 + 2] += dz * diff;
    p[b * 3] -= dx * diff; p[b * 3 + 1] -= dy * diff; p[b * 3 + 2] -= dz * diff;
  }
  for (const [a, b, min] of MIN_DIST) {
    const dx = p[b * 3] - p[a * 3], dy = p[b * 3 + 1] - p[a * 3 + 1], dz = p[b * 3 + 2] - p[a * 3 + 2];
    const d = Math.hypot(dx, dy, dz) || 1e-6;
    if (d >= min) continue;
    const diff = (d - min) / d * 0.5;
    p[a * 3] += dx * diff; p[a * 3 + 1] += dy * diff; p[a * 3 + 2] += dz * diff;
    p[b * 3] -= dx * diff; p[b * 3 + 1] -= dy * diff; p[b * 3 + 2] -= dz * diff;
  }
}

// Kolize s terénem: bod nesmí pod povrch; při dopadu se odrazí a klouže s třením.
function collide(rd, i, landed) {
  const p = rd.pos, q = rd.prev, o = i * 3;
  const x = p[o], y = p[o + 1], z = p[o + 2];
  const l = Math.hypot(x, y, z);
  const ux = x / l, uy = y / l, uz = z / l;
  const ground = R + heightAt([ux, uy, uz]) + RADIUS;
  if (l >= ground) return landed;
  // rychlost (krok) rozložená na kolmou a tečnou složku
  const vx = x - q[o], vy = y - q[o + 1], vz = z - q[o + 2];
  const vn = vx * ux + vy * uy + vz * uz;
  const tx = vx - vn * ux, ty = vy - vn * uy, tz = vz - vn * uz;
  p[o] = ux * ground; p[o + 1] = uy * ground; p[o + 2] = uz * ground;
  const nvn = vn < 0 ? -vn * BOUNCE : vn;
  const k = 1 - FRICTION;
  q[o] = p[o] - (tx * k + ux * nvn);
  q[o + 1] = p[o + 1] - (ty * k + uy * nvn);
  q[o + 2] = p[o + 2] - (tz * k + uz * nvn);
  return Math.max(landed, -vn / rd.lastDt);
}

// Krok simulace. Vrací rychlost dopadu (pro obláček prachu) nebo 0.
export function stepRagdoll(rd, dt) {
  dt = Math.min(dt, 1 / 20);
  const h = dt / SUBSTEPS;
  const p = rd.pos, q = rd.prev;
  let landed = 0;
  let maxV = 0;
  for (let s = 0; s < SUBSTEPS; s++) {
    const ratio = h / rd.lastDt;
    for (let i = 0; i < rd.n; i++) {
      const o = i * 3;
      const x = p[o], y = p[o + 1], z = p[o + 2];
      const l = Math.hypot(x, y, z);
      const g = MOON_GRAVITY * h * h / l;
      const nx = x + (x - q[o]) * ratio * 0.999 - x * g;
      const ny = y + (y - q[o + 1]) * ratio * 0.999 - y * g;
      const nz = z + (z - q[o + 2]) * ratio * 0.999 - z * g;
      q[o] = x; q[o + 1] = y; q[o + 2] = z;
      p[o] = nx; p[o + 1] = ny; p[o + 2] = nz;
    }
    rd.lastDt = h;
    for (let it = 0; it < ITER; it++) {
      satisfy(rd);
      for (let i = 0; i < rd.n; i++) landed = collide(rd, i, landed);
    }
  }
  for (let i = 0; i < rd.n; i++) {
    const o = i * 3;
    maxV = Math.max(maxV, Math.hypot(p[o] - q[o], p[o + 1] - q[o + 1], p[o + 2] - q[o + 2]) / rd.lastDt);
  }
  rd.time += dt;
  rd.calm = maxV < 0.35 ? rd.calm + dt : 0;
  if ((rd.calm > 0.7 && rd.time > 1.2) || rd.time > 16) rd.done = true;
  return landed > 1.2 ? landed : 0;
}

// Body jako pole [[x,y,z], ...] (kopie).
export function ragdollPoints(rd) {
  const out = [];
  for (let i = 0; i < rd.n; i++) out.push([rd.pos[i * 3], rd.pos[i * 3 + 1], rd.pos[i * 3 + 2]]);
  return out;
}

// Zakódování pro multiplayer: pánev v cm absolutně, ostatní body relativně v cm.
export function encodeRagdoll(rd) {
  const p = rd.pos;
  const out = [Math.round(p[0] * 100), Math.round(p[1] * 100), Math.round(p[2] * 100)];
  for (let i = 1; i < rd.n; i++) {
    out.push(Math.round((p[i * 3] - p[0]) * 100), Math.round((p[i * 3 + 1] - p[1]) * 100), Math.round((p[i * 3 + 2] - p[2]) * 100));
  }
  return out;
}

export function decodeRagdoll(arr) {
  if (!Array.isArray(arr) || arr.length !== RG_COUNT * 3) return null;
  const px = arr[0] / 100, py = arr[1] / 100, pz = arr[2] / 100;
  const pts = [[px, py, pz]];
  for (let i = 1; i < RG_COUNT; i++) pts.push([px + arr[i * 3] / 100, py + arr[i * 3 + 1] / 100, pz + arr[i * 3 + 2] / 100]);
  return pts.every(p => p.every(Number.isFinite)) ? pts : null;
}
