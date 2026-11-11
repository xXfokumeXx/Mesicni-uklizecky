// LAAC – Lunar Apex Aircraft Centrum (3.1, L-64, D-16, A-10). Bez three.js – scéna je scene/laacView.js.
//
// Věž stojí na jednom hexu (přichycená ke středu), plošiny na sousedních hexech. Strany 1–6 jdou po směru hodin
// od místní osy +Z věže (strana 1 = soused, ke kterému míří +Z; model laac.glb má pad_1 na +Z, pad_2 na +X…).
// Data stavby: b.data = { cell, rot, pads: [čísla stran] }. Polohy plošin se odvozují z mřížky hexů (neukládají se).
// Letoun má domov na plošině: v.garage = id LAAC, v.spot = číslo strany.
import { game, UPGRADES, newUid } from './state.js';
import { MOON } from './config.js';
import {
  STRUCTURES, structureById, canPlace, dirToLocal, yawFor, hasResearch, lockReason, partTopHeight, heightRange, MAX_SLOPE,
} from './structures.js';
import { grid, cellDir, dirToCell } from './planet/hexgrid.js';
import { angleBetween, tangentTo, madd, cross, dot, anyTangent, norm } from './planet/vec.js';
import { isAirType } from './catalog.js';

const R = MOON.radius;
export const LAAC = {
  hexD: 11.1,                 // vzdálenost středů hexů, pro kterou je model (extras.hex_vzdalenost)
  scale: [0.75, 1.1],         // měřítko podle skutečné vzdálenosti středů
  maxPads: 6,
  landReach: 30,              // m – E do 30 m od vlastní plošiny = přistání na ni (L-66)
  keepOut: 7,                 // m od osy věže – letoun se k věži nepřiblíží (L-66: odstup 6 m od dříku)
};
const D = () => STRUCTURES.laac;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const scaleOf = d => clamp(d / LAAC.hexD, LAAC.scale[0], LAAC.scale[1]);
const sc = (rect, k) => rect.map(v => v * k);
// Prach se u LAAC kontroluje jen kolem středu vlastního hexu dílu (obdélník desky rohy zasahuje do dalších hexů,
// na malých hexech 8,4 m i čtverec ±3,5 m), svah zvlášť přes vnitřek hexu (slopeOk)
const INNER = [-1.5, 1.5, -1.5, 1.5];
const SLOPE_RECT = [-3.6, 3.6, -3.6, 3.6];
const slopeOk = (part) => { const [lo, hi] = heightRange(part.p, part.yaw, sc(SLOPE_RECT, part.scale)); return hi - lo <= MAX_SLOPE; };
const SLOPE_MSG = `Příliš strmý svah (nejvýš ${MAX_SLOPE} m)`;

// Sousedé hexu seřazení podle úhlu: [{ cell, dir }]
export function hexNeighbors(cell) {
  const out = [];
  for (let m = 0; m < 6; m++) {
    const c = grid.neighbors[cell * 6 + m];
    if (c >= 0) out.push({ cell: c, dir: cellDir(c) });
  }
  const p = cellDir(cell), e1 = anyTangent(p), e2 = cross(p, e1);
  for (const o of out) { const t = tangentTo(p, o.dir); o.ang = Math.atan2(dot(t, e2), dot(t, e1)); }
  return out.sort((a, b) => a.ang - b.ang);
}
const isPent = c => grid.cellTriCount[c] === 5;
export const nearPentagon = cell => isPent(cell) || hexNeighbors(cell).some(o => isPent(o.cell));

// Rozložení na hexu cell, otočení rot (0–5 = soused, ke kterému míří strana 1). null = nejde (pětiúhelník…).
const layoutCache = new Map();
export function laacLayout(cell, rot) {
  rot = ((rot | 0) % 6 + 6) % 6;
  const key = cell * 6 + rot;
  if (layoutCache.has(key)) return layoutCache.get(key);
  let out = null;
  const nb = hexNeighbors(cell);
  if (nb.length === 6 && !isPent(cell)) {
    const p = cellDir(cell);
    const yaw = yawFor(p, tangentTo(p, nb[rot].dir));
    const sides = [];
    for (const o of nb) {
      const [x, z] = dirToLocal(p, yaw, o.dir);
      let a = Math.atan2(x, z);
      if (a < 0) a += Math.PI * 2;
      sides[Math.round(a / (Math.PI / 3)) % 6] = o;
    }
    if (sides.filter(Boolean).length === 6) {
      const dist = nb.map(o => angleBetween(p, o.dir) * R);
      out = { cell, rot, p, yaw, sides, scale: scaleOf(dist.reduce((a, x) => a + x, 0) / 6) };
    }
  }
  layoutCache.set(key, out);
  return out;
}

// Díl plošiny na straně side (1–6) rozložení L
function padPart(L, side) {
  const o = L.sides[side - 1];
  const P = D().padPart, k = scaleOf(angleBetween(L.p, o.dir) * R);
  const yaw = yawFor(o.dir, tangentTo(o.dir, madd(o.dir, L.p, -1)));     // −Z míří k věži
  return { kind: 'pad', side, cell: o.cell, p: o.dir, yaw, scale: k, pad: sc(P.pad, k), foot: sc(P.foot, k), solid: P.solid.map(r => sc(r, k)) };
}
function towerPart(L) {
  const d = D(), k = L.scale;
  return { kind: 'tower', p: L.p, yaw: L.yaw, scale: k, pad: sc(d.pad, k), foot: sc(d.foot, k), solid: d.solid.map(r => sc(r, k)) };
}

// Díly postavené LAAC (cache podle buňky, otočení a plošin – partTopHeight drží výšku podle objektu dílu)
const partsCache = new WeakMap();
export function laacParts(b) {
  const d = b.data || {}, sig = `${d.cell}|${d.rot}|${(d.pads || []).join('')}`;
  const c = partsCache.get(b);
  if (c && c.sig === sig) return c.parts;
  const L = Number.isInteger(d.cell) ? laacLayout(d.cell, d.rot) : null;
  const parts = L ? [towerPart(L), ...(d.pads || []).filter(s => s >= 1 && s <= 6).map(s => padPart(L, s))]
    : [{ kind: 'tower', p: b.p, yaw: b.yaw, scale: 1, pad: D().pad, foot: D().foot, solid: D().solid }];
  partsCache.set(b, { sig, parts });
  return parts;
}
STRUCTURES.laac.partsFor = laacParts;

// Hologram při stavění: věž a první plošina rozložení L
export const ghostParts = L => [towerPart(L), padPart(L, 1)];

export const laac = () => (game.s.buildings || []).find(b => b.type === 'laac') || null;
export const padOf = (b, side) => laacParts(b).find(x => x.kind === 'pad' && x.side === side) || null;

// ---------- stavění ----------
// Kontrola umístění věže na hexu cell s otočením rot (+ první plošina na straně 1). { ok, reason, layout }
export function laacCheck(cell, rot, ignoreId = null) {
  const def = D();
  const lock = lockReason(def);
  if (lock) return { ok: false, reason: lock === 'už stojí' ? 'LAAC může stát jen jedno' : `LAAC: ${lock}` };
  if (nearPentagon(cell)) return { ok: false, reason: 'LAAC nejde postavit na pětiúhelník ani na hex vedle něj' };
  const L = laacLayout(cell, rot);
  if (!L) return { ok: false, reason: 'Na tomhle hexu LAAC stát nemůže' };
  const t = towerPart(L);
  const ct = canPlace('laac', t.p, t.yaw, ignoreId, t.foot, sc(INNER, t.scale));
  if (!ct.ok) return { ok: false, reason: ct.reason, layout: L };
  if (!slopeOk(t)) return { ok: false, reason: SLOPE_MSG, layout: L };
  const pp = padPart(L, 1);
  const cp = canPlace('laac', pp.p, pp.yaw, ignoreId, pp.foot, sc(INNER, pp.scale));
  if (!cp.ok) return { ok: false, reason: `Plošina: ${cp.reason}`, layout: L };
  if (!slopeOk(pp)) return { ok: false, reason: `Plošina: ${SLOPE_MSG}`, layout: L };
  return { ok: true, reason: '', layout: L };
}
// Postaví LAAC (sám / hostitel). Vrací id, nebo false.
export function placeLaac(cell, rot) {
  const s = game.s, def = D();
  const chk = laacCheck(cell, rot);
  if (!chk.ok || s.money < def.price) return false;
  s.money -= def.price;
  const L = chk.layout;
  const b = { id: newUid(), type: 'laac', p: L.p, yaw: L.yaw, lv: 0, paid: def.price, data: { cell, rot: L.rot, pads: [1] } };
  (s.buildings ||= []).push(b);
  return b.id;
}

// Další plošina na straně side: { price, reason }
export function padOffer(b, side) {
  const d = b?.data;
  if (!d) return { price: null, reason: 'LAAC neexistuje' };
  if ((d.pads || []).includes(side)) return { price: null, reason: 'Plošina stojí' };
  if ((d.pads || []).length >= LAAC.maxPads) return { price: null, reason: 'Všech 6 plošin stojí' };
  const price = D().padPrices[Math.max(0, (d.pads || []).length - 1)];
  const L = laacLayout(d.cell, d.rot);
  if (!L) return { price, reason: 'Rozložení LAAC chybí' };
  const pp = padPart(L, side);
  const chk = canPlace('laac', pp.p, pp.yaw, b.id, pp.foot, sc(INNER, pp.scale));
  if (!chk.ok) return { price, reason: chk.reason, blocked: true };
  if (!slopeOk(pp)) return { price, reason: SLOPE_MSG, blocked: true };
  if (game.s.money < price) return { price, reason: 'Chybí peníze' };
  return { price, reason: '' };
}
export function addPad(id, side) {
  const b = structureById(id);
  if (b?.type !== 'laac') return false;
  const o = padOffer(b, side);
  if (o.reason) return false;
  game.s.money -= o.price;
  b.data.pads = [...b.data.pads, side].sort((a, c) => a - c);
  b.paid = (b.paid || 0) + o.price;
  return true;
}
// Zbourat plošinu: jen když na ní nic nestojí a není jediná, vrací se 60 % ceny té plošiny
export function padRemoveInfo(b, side) {
  const d = b?.data;
  if (!d?.pads?.includes(side)) return { refund: 0, reason: 'Plošina nestojí' };
  if (d.pads.length <= 1) return { refund: 0, reason: 'Poslední plošinu nejde zbořit (zbourej celou věž)' };
  if (game.s.vehicles.some(v => v.garage === b.id && v.spot === side)) return { refund: 0, reason: 'Plošina je domovem letounu – prodej ho v Hangáru' };
  const pp = padOf(b, side);
  if (pp && game.s.vehicles.some(v => angleBetween(v.p, pp.p) * R < 5 * pp.scale)) return { refund: 0, reason: 'Na plošině stojí vozidlo' };
  const price = D().padPrices[Math.max(0, d.pads.length - 2)];
  return { refund: Math.round(price * 0.6), reason: '' };
}
export function removePad(id, side) {
  const b = structureById(id);
  const o = padRemoveInfo(b, side);
  if (o.reason) return false;
  b.data.pads = b.data.pads.filter(x => x !== side);
  b.paid = Math.max(0, (b.paid || 0) - o.refund / 0.6);
  game.s.money += o.refund;
  return true;
}

// ---------- letouny na plošinách ----------
// Volná plošina pro nový letoun: číslo strany, nebo 0
export function freePad(b) {
  const used = new Set(game.s.vehicles.filter(v => v.garage === b.id).map(v => v.spot));
  return (b?.data?.pads || []).find(s => !used.has(s)) || 0;
}
// Domov letounu: { dir, facing, top } (top = výška plochy plošiny nad poloměrem), nebo null
export function airHome(v) {
  const b = v?.garage && structureById(v.garage);
  const pp = b?.type === 'laac' ? padOf(b, v.spot) : null;
  if (!pp) return null;
  return { dir: pp.p, facing: tangentTo(pp.p, madd(pp.p, b.p, -1)), top: partTopHeight(pp) };
}
STRUCTURES.laac.homeFor = airHome;

// Plošina, na které letoun stojí (do 2 m od středu): { b, side } nebo null
export function padUnder(p) {
  const b = laac();
  if (!b) return null;
  for (const pp of laacParts(b)) if (pp.kind === 'pad' && angleBetween(p, pp.p) * R < 2 * pp.scale + 0.5) return { b, side: pp.side, part: pp };
  return null;
}
export const airCount = () => game.s.vehicles.filter(v => isAirType(v.type)).length;

// Načtení: LAAC s neplatnými daty → doplnit buňku z polohy; letouny bez platné plošiny dostanou volnou
UPGRADES.push(s => {
  for (const b of s.buildings || []) {
    if (b.type !== 'laac') continue;
    b.data ||= {};
    if (!Number.isInteger(b.data.cell) && grid.ready) b.data.cell = dirToCell(b.p);
    b.data.rot = ((b.data.rot | 0) % 6 + 6) % 6;
    b.data.pads = [...new Set((b.data.pads || []).map(Number).filter(x => x >= 1 && x <= 6))].sort((a, c) => a - c);
    if (!b.data.pads.length) b.data.pads = [1];
  }
  // letoun uložený za letu = přistálý na místě (L-69); doplnit úrovně vylepšení letounů
  for (const v of s.vehicles || []) {
    delete v.carriedUp;                                              // nesené vozidlo (fáze 8) stojí na zemi
    if (!isAirType(v.type)) continue;
    if (v.carry) {                                                   // uloženo s vozidlem na laně / v ruce → vedle letounu
      const w = s.vehicles[v.carry.i];
      if (w && w.uid === v.carry.uid && w !== v) { w.p = norm(madd(v.p, anyTangent(v.p), 7 / R)); w.moved = true; }
      delete v.carry;
    }
    delete v.ropeLen;
    v.air = { mode: 'ground', alt: 6 };
    v.lv ||= {};
    for (const k of ['motor', 'abatt', 'special']) v.lv[k] = Math.max(0, Math.min(3, v.lv[k] | 0));
    v.moved = true;
  }
});
