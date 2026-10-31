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

// Dekódování pózy z multiplayeru: pánev v cm absolutně, ostatní body relativně v cm.
export function decodeRagdoll(arr) {
  if (!Array.isArray(arr) || arr.length !== RG_COUNT * 3) return null;
  const px = arr[0] / 100, py = arr[1] / 100, pz = arr[2] / 100;
  const pts = [[px, py, pz]];
  for (let i = 1; i < RG_COUNT; i++) pts.push([px + arr[i * 3] / 100, py + arr[i * 3 + 1] / 100, pz + arr[i * 3 + 2] / 100]);
  return pts.every(p => p.every(Number.isFinite)) ? pts : null;
}

// ---------- multiplayer: ragdoll se počítá u každého hráče sám ----------
// Letící hráč pošle jednou začátek letu (póza, rychlost, rotace, čas srážky na společných hodinách)
// a pak 4× za sekundu polohu pánve (čas letu + bod). Ostatní si let simulují stejnou fyzikou
// (terén je u všech stejný) pevným krokem a malé odchylky plynule dotahují → plynulé a skoro bez dat.

export const RAG_STEP = 1 / 60;              // pevný krok simulace u všech hráčů (stejný výsledek)

// Začátek letu pro presence: { k: pořadí, a: čas srážky (ms, společné hodiny), p: póza, v, w } (cm, cm/s, crad/s)
export function encodeRagdollStart(k, at, pose, vel, spin) {
  const pts = pose.flat();
  const out = [Math.round(pts[0] * 100), Math.round(pts[1] * 100), Math.round(pts[2] * 100)];
  for (let i = 1; i < pose.length; i++) {
    out.push(Math.round((pts[i * 3] - pts[0]) * 100), Math.round((pts[i * 3 + 1] - pts[1]) * 100), Math.round((pts[i * 3 + 2] - pts[2]) * 100));
  }
  return { k, a: Math.round(at), p: out, v: vel.map(c => Math.round(c * 100)), w: spin.map(c => Math.round(c * 100)) };
}

const okNums = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);

// Ragdoll ostatního hráče ze začátku letu; elapsed = kolik sekund let už trvá (dohoní se hned).
export function remoteRagdoll(start, elapsed) {
  if (!start || !okNums(start.p, RG_COUNT * 3) || !okNums(start.v, 3) || !okNums(start.w, 3)) return null;
  const pose = decodeRagdoll(start.p);
  if (!pose) return null;
  const rd = createRagdoll(pose, start.v.map(c => c / 100), start.w.map(c => c / 100));
  rd.k = start.k;
  rd.acc = 0;
  rd.hist = [];                                // [čas letu, x, y, z] pánve po krocích (pro korekce)
  rd.off = [0, 0, 0];                          // zbývající korekce polohy (dotahuje se plynule)
  rd.lastFix = -1;
  advanceRemote(rd, Math.min(3, Math.max(0, elapsed)));
  return rd;
}

// Krok pevným krokem + plynulé dotažení korekce (posun celého těla, rychlost se nemění).
export function advanceRemote(rd, dt) {
  if (!rd.done) {
    rd.acc += Math.min(dt, 3.5);
    while (rd.acc >= RAG_STEP && !rd.done) {
      stepRagdoll(rd, RAG_STEP);
      rd.acc -= RAG_STEP;
      rd.hist.push([rd.time, rd.pos[0], rd.pos[1], rd.pos[2]]);
      if (rd.hist.length > 240) rd.hist.shift();
    }
  }
  const k = 1 - Math.exp(-dt * 8);
  const dx = rd.off[0] * k, dy = rd.off[1] * k, dz = rd.off[2] * k;
  if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) < 1e-5) return;
  rd.off[0] -= dx; rd.off[1] -= dy; rd.off[2] -= dz;
  for (let i = 0; i < rd.n; i++) {
    const o = i * 3;
    rd.pos[o] += dx; rd.pos[o + 1] += dy; rd.pos[o + 2] += dz;
    rd.prev[o] += dx; rd.prev[o + 1] += dy; rd.prev[o + 2] += dz;
  }
  for (const h of rd.hist) { h[1] += dx; h[2] += dy; h[3] += dz; }
}

// Korekce od letícího hráče: fix = [čas letu (cs), x, y, z (cm)] → odchylka proti mé simulaci ve stejném čase.
export function correctRemote(rd, fix) {
  if (!okNums(fix, 4) || fix[0] === rd.lastFix || !rd.hist.length) return;
  rd.lastFix = fix[0];
  const t = fix[0] / 100;
  let best = rd.hist[0];
  for (const h of rd.hist) if (Math.abs(h[0] - t) < Math.abs(best[0] - t)) best = h;
  if (Math.abs(best[0] - t) > 0.2) return;     // tak starou historii už nemám
  const ex = fix[1] / 100 - best[1], ey = fix[2] / 100 - best[2], ez = fix[3] / 100 - best[3];
  if (Math.hypot(ex, ey, ez) > 25) return;      // nesmysl (jiný let) – nechat být
  rd.off = [rd.off[0] + ex, rd.off[1] + ey, rd.off[2] + ez];
}
