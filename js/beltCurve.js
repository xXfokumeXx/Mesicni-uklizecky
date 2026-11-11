// Zakřivené pásy (L-70, 3.1): plynulý oblouk přes uzly trasy z kubických Bézierových křivek.
// Kontrolní body = centripetální Catmull-Rom (α = 0,5 – oblouk nekmitá ani nedělá smyčky) převedený na Bézier.
// Počítá se v prostoru (body na kouli × poloměr) a výsledek se promítne zpět na povrch, takže funguje i pro dlouhé
// pásy na malém Měsíci. Bez three.js – stejný výpočet u hostitele, klientů i v Node testech.
//
// nodes = jednotkové směry uzlů [zásuvka, vývod, ohyby…, vývod, zásuvka]; straight = indexy úseků (i → i+1), které
// vedou rovně (vývody u zásuvek, sousedé zlomu s Alt). Výsledek: pts = body po ~0,5 m délky oblouku (uzly jsou mezi
// nimi přesně), nodeAt = index bodu v pts pro každý uzel, sharp = indexy bodů s poloměrem ohybu pod CURVE.minRadius.
import { MOON } from './config.js';

const R = MOON.radius;
// minRadius: zadání 3 m, ale křivka přes uzel v rohu má u obyčejné pravoúhlé zatáčky ~2 m (musí projít přesně uzlem) →
// 1,5 m (pás je 1 m široký, kříží se až pod 0,5 m). Opravdu vratké ohyby (~1 m) dál neprojdou.
export const CURVE = { step: 0.5, minRadius: 1.5, lead: 2, alpha: 0.5 };

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const len = a => Math.hypot(a[0], a[1], a[2]);
const unit = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

function bezier(P0, P1, P2, P3, t) {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [P0[0] * a + P1[0] * b + P2[0] * c + P3[0] * d, P0[1] * a + P1[1] * b + P2[1] * c + P3[1] * d, P0[2] * a + P1[2] * b + P2[2] * c + P3[2] * d];
}

// Bézierovy kontrolní body úseku P1 → P2 ze sousedů P0, P3 (centripetální Catmull-Rom, Yuksel a kol.).
function controls(P0, P1, P2, P3, alpha) {
  const d1 = Math.max(1e-6, len(sub(P1, P0))), d2 = Math.max(1e-6, len(sub(P2, P1))), d3 = Math.max(1e-6, len(sub(P3, P2)));
  const a1 = d1 ** alpha, a2 = d2 ** alpha, a3 = d3 ** alpha;
  const b1 = d1 ** (2 * alpha), b2 = d2 ** (2 * alpha), b3 = d3 ** (2 * alpha);
  const B1 = mul(add(add(mul(P2, b1), mul(P0, -b2)), mul(P1, 2 * b1 + 3 * a1 * a2 + b2)), 1 / (3 * a1 * (a1 + a2)));
  const B2 = mul(add(add(mul(P1, b3), mul(P3, -b2)), mul(P2, 2 * b3 + 3 * a3 * a2 + b2)), 1 / (3 * a3 * (a3 + a2)));
  return [B1, B2];
}

export function curvePoints(nodes, straight = []) {
  const n = nodes.length;
  if (n < 2) return { pts: nodes.map(p => p.slice()), nodeAt: nodes.map((_, i) => i), sharp: [] };
  const S = new Set(straight);
  const P = nodes.map(p => mul(p, R));
  const isStraight = i => S.has(i) || n === 2;
  const pts = [nodes[0].slice()], nodeAt = [0];
  for (let i = 0; i < n - 1; i++) {
    const A = P[i], B = P[i + 1];
    const d = len(sub(B, A));
    let C1, C2;
    if (isStraight(i)) {
      C1 = add(A, mul(sub(B, A), 1 / 3));
      C2 = add(A, mul(sub(B, A), 2 / 3));
    } else {
      // soused před A: skutečný uzel, nebo „fantom“ ve směru rovného úseku (tečna navazuje bez zlomu)
      let Pm;
      if (i === 0) Pm = sub(A, sub(B, A));
      else if (isStraight(i - 1)) Pm = sub(A, mul(unit(sub(A, P[i - 1])), d));
      else Pm = P[i - 1];
      let Pp;
      if (i + 2 >= n) Pp = add(B, sub(B, A));
      else if (isStraight(i + 1)) Pp = add(B, mul(unit(sub(P[i + 2], B)), d));
      else Pp = P[i + 2];
      [C1, C2] = controls(Pm, A, B, Pp, CURVE.alpha);
      // na rovný soused (vývod u zásuvky, zlom) navázat přesně jeho směrem – pás vyjede ze zásuvky rovně
      if (i > 0 && isStraight(i - 1)) C1 = add(A, mul(unit(sub(A, P[i - 1])), len(sub(C1, A))));
      if (i + 2 < n && isStraight(i + 1)) C2 = sub(B, mul(unit(sub(P[i + 2], B)), len(sub(B, C2))));
    }
    // délka oblouku jemným vzorkováním, pak body po ~0,5 m (rovnoměrně podle délky, ne podle t)
    const FINE = isStraight(i) ? 2 : 24;
    const fine = [A], acc = [0];
    for (let k = 1; k <= FINE; k++) {
      const q = bezier(A, C1, C2, B, k / FINE);
      acc.push(acc[k - 1] + len(sub(q, fine[k - 1])));
      fine.push(q);
    }
    const L = acc[FINE];
    const m = Math.max(1, Math.ceil(L / CURVE.step));
    let j = 1;
    for (let k = 1; k <= m; k++) {
      const want = (k / m) * L;
      while (j < FINE && acc[j] < want) j++;
      const t0 = acc[j - 1], t1 = acc[j];
      const f = t1 > t0 ? (want - t0) / (t1 - t0) : 1;
      const q = k === m ? B : add(fine[j - 1], mul(sub(fine[j], fine[j - 1]), f));
      pts.push(unit(q));
    }
    nodeAt.push(pts.length - 1);
  }
  // poloměr ohybu (úhel mezi sousedními úseky / délka); zlomy s Alt se nepočítají
  const sharp = [], corner = new Set();
  for (let i = 1; i < n - 1; i++) if (S.has(i - 1) && S.has(i)) corner.add(nodeAt[i]);
  // měří se na úseku ±1 m (2 body po 0,5 m na každou stranu) – pás je metr široký, krátký výkyv v uzlu nevadí
  const W = 2;
  for (let i = W; i < pts.length - W; i++) {
    let skip = false;
    for (let j = i - W; j <= i + W; j++) if (corner.has(j)) skip = true;
    if (skip) continue;
    const a = sub(pts[i], pts[i - W]), b = sub(pts[i + W], pts[i]);
    const la = len(a), lb = len(b);
    if (la < 1e-9 || lb < 1e-9) continue;
    const cos = Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb)));
    const ang = Math.acos(cos);
    if (ang < 1e-4) continue;
    const r = ((la + lb) / 2) * R / ang;
    if (r < CURVE.minRadius) sharp.push(i);
  }
  return { pts, nodeAt, sharp };
}

// Úseky, které vedou rovně: vývod u zásuvky na začátku (0) a na konci (n−2), a oba sousedé každého zlomu.
// corners = indexy uzlů se zlomem (Alt), hasStart / hasEnd = je na začátku / konci zásuvka s vývodem.
export function straightSegments(n, corners = [], hasStart = true, hasEnd = true) {
  const out = new Set();
  if (hasStart && n >= 2) out.add(0);
  if (hasEnd && n >= 2) out.add(n - 2);
  for (const c of corners) { if (c - 1 >= 0) out.add(c - 1); if (c < n - 1) out.add(c); }
  return [...out];
}
