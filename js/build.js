// Stavební režim s kladivem (L-10, D-07, D-08):
//   Kladivo zabírá políčko hotbaru (1–3 / Q = na něj přepnout a zpět), V = stavební lišta, X = bourání
//   (bez kladiva v ruce X nic nedělá; nástroj / kladivo zničí jen × v jeho políčku hotbaru).
//   Stavění: hologram na místě kurzoru (do 25 m), jinak 6 m před hráčem. R + kolečko otáčí po 1° (Shift po 15°),
//   , / . otáčí plynule 90°/s. Klik / E postaví, Esc / pravé tlačítko zruší. Stejná stavba zůstane vybraná.
//   Bourání: kurzor na stavbu, podržet E nebo levé tlačítko 1 s.
import { MOON } from './config.js';
import { game } from './state.js';
import { purchase } from './econ.js';
import {
  STRUCTURES, TYPE_IDS, canPlace, buildPrice, placeStructure, demolishInfo, demolishStructure, lockReason,
  structureAt, structureById, yawFor, BUILD_REACH, AHEAD, moveStructure,
} from './structures.js';
import { ownsHammer } from './equipment.js';
import { heldHammer, hammerSlot, previousSlot, selectSlot, putTool, hotbarSlots, HAMMER_ID } from './hotbar.js';
import { autoConnect, cableCheck, addCable, removeCable } from './energy.js';
import { nearestSocket, socketByRef, checkPath, addBelt, cutBelt, beltSegmentAt, retypeCheck, BELT, curveNodes, curveOf, SHARP_REASON } from './logistics.js';

// Postaví stavbu a hned ji připojí kabelem k síti (L-06). Vrací id, nebo false. Volá i hostitel (net.js).
export function placeAndWire(type, p, yaw) {
  const id = placeStructure(type, p, yaw);
  if (id) autoConnect(id);
  return id;
}
import { norm, madd, angleBetween, tangentTo } from './planet/vec.js';
import { dirToCell, cellDir } from './planet/hexgrid.js';
import { laacCheck, laacLayout, placeLaac } from './laac.js';

const R = MOON.radius;
const DEG = Math.PI / 180;
const HOLD = 1;                              // s držení pro zboření
const DEMOLISH_REACH = 45;                   // m – velké budovy se bourají i z dálky (kurzor na kterékoli části)
const enc = p => [Math.round(p[0] * 1e6), Math.round(p[1] * 1e6), Math.round(p[2] * 1e6)];

export const build = {
  menu: false,                 // otevřená stavební lišta (V)
  mode: null,                  // null | 'build' | 'demolish' | 'cable' (ruční kabel z kotvy) | 'belt' (pás)
  beltFrom: null,              // pás: výstupní zásuvka [id, sid], ze které vede
  beltTo: null,                // pás: vstupní zásuvka pod kurzorem (přichycení)
  beltBends: [],               // pás: ohyby (jednotkové směry)
  beltCorners: [],             // pás: indexy ohybů se zlomem (přidané s Alt – D-20)
  beltBad: null,               // pás: kde trasa vadí (m od začátku; null = celá / nic) – červený kus hologramu
  beltNodes: null,             // pás: uzly pro značky v hologramu [{ p, corner }]
  alt: false,                  // drží se Alt (další ohyb = zlom)
  beltPts: null,               // pás: celá trasa pro náhled
  beltHover: null,             // pás: výstupní zásuvka pod kurzorem (před prvním klikem)
  beltBridges: [],             // pás: místa křížení (m od začátku) – nový pás tam vede mostem
  belt: null,                  // bourání: pás pod kurzorem (id)
  from: null,                  // kabel: id kotvy, ze které vede
  cable: null,                 // bourání: kabel pod kurzorem [idA, idB]
  type: null,                  // vybraná stavba
  moveId: null,                // přesun depa (3.1): id přesouvaného depa
  p: null, yaw: 0,             // hologram
  valid: false, reason: '', price: 0,
  target: null,                // id stavby pod kurzorem (bourání)
  hold: 0,                     // průběh držení 0–1
  mouseHold: false,            // levé tlačítko drží bourání
  lastYaw: {},                 // poslední úhel podle typu (řada solárů míří stejně)
  busy: false,                 // čeká se na hostitele
  hits: 0,                     // čas posledního postavení (animace úderů kladivem)
  version: 0,                  // mění se s každou změnou (překreslení lišty)
  cancelledAt: 0,              // kdy Esc naposledy něco zrušil (ať stejný Esc neotevře i menu pauzy)
};
const bump = () => { build.version++; };

// Kladivo v ruce = vybrané políčko hotbaru s kladivem (hotbar.js), pěšky.
export const hammerActive = () => heldHammer() && ownsHammer() && game.s.driving < 0;

// Q: přepne na políčko s kladivem / zpátky na předchozí políčko. Kladivo bez políčka (vytlačil ho nástroj)
// se dá do prázdného, jinak do vybraného políčka. Vrací text pro hlášku, nebo null.
export function toggleHammer() {
  if (!ownsHammer()) return 'Kladivo si kup v Dílně (záložka Astronaut).';
  if (game.s.driving >= 0) return 'Z vozidla se nestaví – nejdřív vystup.';
  const k = hammerSlot();
  if (k >= 0 && k === game.s.sel) {                            // odložit = zpátky na předchozí políčko
    const n = hotbarSlots();
    let back = previousSlot();
    if (back === k || back >= n) back = Array.from({ length: n }, (_, i) => i).find(i => i !== k) ?? -1;
    if (back < 0) return 'Kladivo zabírá tvoje jediné políčko hotbaru. Nástroj vezmeš do ruky v Obchodě, další políčka přidá opasek v Dílně.';
    selectSlot(back);
    closeAll();
    return null;
  }
  if (k >= 0) selectSlot(k);
  else putTool(HAMMER_ID);
  bump();
  return `Kladivo v ruce (políčko ${hammerSlot() + 1}): V = stavební menu, X = bourání, Q = zpět.`;
}

export function closeAll() {
  build.menu = false;
  build.mode = null;
  build.type = null;
  build.target = null;
  build.hold = 0;
  build.mouseHold = false;
  build.from = null;
  build.cable = null;
  resetBelt();
  build.belt = null;
  bump();
}
function resetBelt() { build.beltFrom = null; build.beltTo = null; build.beltBends = []; build.beltCorners = []; build.beltPts = null; build.beltHover = null; build.beltBad = null; build.beltNodes = null; }

export function toggleMenu() {
  if (!hammerActive()) return false;
  build.menu = !build.menu;
  // zavření lišty vybranou stavbu nechá (ruší ji Esc / pravé tlačítko) – lišta se po výběru zavírá sama
  if (build.menu && build.mode === 'demolish') build.mode = null;
  bump();
  return true;
}

export function toggleDemolish() {
  if (!hammerActive()) return false;
  build.mode = build.mode === 'demolish' ? null : 'demolish';
  build.menu = false;
  build.type = null;
  build.hold = 0;
  bump();
  return true;
}

export function selectType(type) {
  if (!STRUCTURES[type]?.ready || lockReason(STRUCTURES[type])) return;
  build.moveId = null;
  build.type = type;
  build.mode = STRUCTURES[type].kind === 'belt' ? 'belt' : 'build';
  build.menu = false;                                 // lišta po výběru zmizí, ať nepřekáží při stavění (V = znovu otevřít)
  resetBelt();
  build.p = null;
  bump();
}

// Esc / pravé tlačítko: zruší hologram, pak bourání, pak zavře lištu. Vrací true, když něco zrušil.
export function cancelBuild() {
  const done = () => { build.cancelledAt = performance.now(); bump(); return true; };
  if (build.mode === 'build') { build.mode = null; build.type = null; build.moveId = null; return done(); }
  if (build.mode === 'belt') {                       // pás: nejdřív poslední ohyb, pak začátek, pak celý režim
    if (build.beltBends.length) { build.beltBends.pop(); build.beltCorners = build.beltCorners.filter(i => i < build.beltBends.length); }
    else if (build.beltFrom) build.beltFrom = null;
    else { build.mode = null; build.type = null; }
    return done();
  }
  if (build.mode === 'demolish') { build.mode = null; build.hold = 0; build.cable = null; return done(); }
  if (build.mode === 'cable') { build.mode = null; build.from = null; return done(); }
  if (build.menu) { build.menu = false; return done(); }
  return false;
}

// Ruční kabel (D-13): klik na kotvu s kladivem v ruce → klik na cílovou kotvu / stavbu.
export function startCable(id) {
  const b = structureById(id);
  if (!hammerActive() || b?.type !== 'pole') return false;
  build.mode = 'cable';
  build.from = id;
  build.target = null;
  build.menu = false;
  bump();
  return true;
}
export function connectNow() {
  if (build.mode !== 'cable' || !build.valid || !build.target) return null;
  const a = build.from, b = build.target;
  build.busy = true;
  const r = purchase('cable', [a, b], 0, () => addCable(a, b));
  const done = res => { build.busy = false; if (res === 'cabled') { build.mode = null; build.from = null; bump(); } return res; };
  const out = outcome(r, 'cabled');
  return out && typeof out.then === 'function' ? out.then(done) : done(out);
}

// Otočení hologramu o deg stupňů; snap = přichytit na násobky 15°.
export function rotateBy(deg, snap = false) {
  if (build.mode !== 'build') return;
  if (STRUCTURES[build.type]?.hex) { build.laacRot = ((build.laacRot | 0) + Math.sign(deg) + 6) % 6; return; }   // LAAC: další strana
  let y = build.yaw + deg * DEG;
  if (snap) y = Math.round(y / (15 * DEG)) * 15 * DEG;
  build.yaw = y;
  build.lastYaw[build.type] = y;
}

// Každý snímek: poloha hologramu / cíl bourání. cursor = místo pod kurzorem (jednotkový vektor) nebo null,
// picked = id stavby pod kurzorem podle 3D modelu (bourání; undefined = hledat podle místa na terénu).
let placeCache = { key: '', at: 0, chk: null };
let beltCache = { key: '', at: 0, pts: null, chk: { ok: false, reason: '', len: 0, price: 0 } };
export function updateBuild(dt, cursor, keys, picked, pickedCable = null) {
  if (!hammerActive()) { if (build.menu || build.mode) closeAll(); return; }
  build.alt = !!keys.alt;
  const s = game.s;
  const near = cursor && angleBetween(s.p, cursor) * R <= BUILD_REACH ? cursor : null;

  if (build.mode === 'build' && build.type && STRUCTURES[build.type].hex) {
    // LAAC (3.1, L-64): věž se přichytí ke středu hexu pod kurzorem, R + kolečko / , . = strana první plošiny
    const def = STRUCTURES[build.type];
    const at = near || norm(madd(s.p, s.f, (AHEAD + 8) / R));
    const cell = dirToCell(at);
    const turn = (keys['.'] ? 1 : 0) - (keys[','] ? 1 : 0);
    if (turn && performance.now() - (build.rotAt || 0) > 250) { build.rotAt = performance.now(); build.laacRot = ((build.laacRot | 0) + turn + 6) % 6; }
    const key = `laac|${cell}|${build.laacRot | 0}`;
    const nowMs = performance.now();
    if (key !== placeCache.key || nowMs - placeCache.at > 300) placeCache = { key, at: nowMs, chk: laacCheck(cell, build.laacRot | 0) };
    const chk = placeCache.chk;
    const L = chk.layout || laacLayout(cell, build.laacRot | 0);
    build.cell = cell;
    build.layout = L;
    build.p = L ? L.p : cellDir(cell);
    build.yaw = L ? L.yaw : 0;
    build.price = def.price;
    build.valid = chk.ok && s.money >= build.price && !build.busy;
    build.reason = !chk.ok ? chk.reason : s.money < build.price ? `Chybí peníze ($${fmtMoney(build.price - s.money)})` : '';
  } else if (build.mode === 'build' && build.type) {
    const def = STRUCTURES[build.type];
    const depth = (def.pad[3] - def.pad[2]) / 2;
    const p = near || norm(madd(s.p, s.f, (AHEAD + depth) / R));
    const first = !build.p;
    build.p = p;
    if (first) {
      // první umístění: čelem k hráči, nebo poslední úhel stejného typu
      const toMe = tangentTo(p, [s.p[0] - p[0], s.p[1] - p[1], s.p[2] - p[2]]);
      build.yaw = build.lastYaw[build.type] ?? (Number.isFinite(toMe[0]) ? yawFor(p, toMe) : 0);
    }
    const turn = (keys['.'] ? 1 : 0) - (keys[','] ? 1 : 0);
    if (turn) {
      build.yaw += turn * 90 * DEG * dt;
      if (keys.shift) build.yaw = Math.round(build.yaw / (15 * DEG)) * 15 * DEG;
      build.lastYaw[build.type] = build.yaw;
    }
    build.price = build.moveId ? 0 : buildPrice(build.type);              // přesun depa je zdarma (pásy se zbourají s vrácením 60 %)
    // kontrola umístění (heightRange vzorkuje po 2 m) jen při posunu / otočení, jinak nejvýš 5× za s
    const key = `${build.type}|${p[0].toFixed(6)},${p[1].toFixed(6)},${p[2].toFixed(6)}|${build.yaw.toFixed(3)}`;
    const nowMs = performance.now();
    if (key !== placeCache.key || nowMs - placeCache.at > 200) placeCache = { key, at: nowMs, chk: canPlace(build.type, p, build.yaw, build.moveId) };
    const chk = placeCache.chk;
    build.valid = chk.ok && s.money >= build.price && !build.busy;
    build.reason = !chk.ok ? chk.reason : s.money < build.price ? `Chybí peníze ($${fmtMoney(build.price - s.money)})` : '';
  }

  if (build.mode === 'belt') {
    const far = cursor && angleBetween(s.p, cursor) * R <= 150 ? cursor : null;
    if (!build.beltFrom) {
      const hov = far ? nearestSocket(far, 'out') : null;
      build.beltHover = hov?.ref || null;
      build.beltPts = null;
      build.valid = !!hov && !build.busy;
      build.reason = hov ? '' : 'Klikni na výstupní zásuvku (oranžová šipka ven)';
      build.price = 0;
    } else {
      const from = socketByRef(build.beltFrom);
      if (!from) { resetBelt(); return null; }
      const to = far ? nearestSocket(far, 'in', from.goods) : null;
      const target = to && to.ref[0] !== build.beltFrom[0] ? to : null;
      build.beltTo = target?.ref || null;
      // zakřivený pás (L-70): uzly → oblouk; náhled nejvýš 20× za s (O-29)
      const nodes = target ? curveNodes(from, build.beltBends, target) : [...curveNodes(from, build.beltBends, null), ...(far ? [far] : [])];
      const corners = build.beltCorners.map(i => i + 2);
      const nowMs = performance.now();
      const nkey = nodes.map(p => p.map(v => v.toFixed(6)).join(',')).join('|') + '/' + corners.join(',');
      if (nkey !== beltCache.key && nowMs - beltCache.at > 50) {
        const curve = nodes.length >= 2 ? curveOf(nodes, corners, true, !!target) : null;
        let chk = curve ? checkPath(curve.pts, [build.beltFrom[0], target?.ref[0]].filter(Boolean)) : { ok: false, reason: 'Namiř kurzor na terén', len: 0, price: 0 };
        if (curve && chk.ok && curve.sharp.length) {
          let d = 0;
          for (let i = 1; i <= curve.sharp[0]; i++) d += angleBetween(curve.pts[i - 1], curve.pts[i]) * R;
          chk = { ...chk, ok: false, reason: SHARP_REASON, at: d };
        }
        beltCache = { key: nkey, at: nowMs, pts: curve ? curve.pts : null, chk };
      }
      build.beltNodes = nodes.map((p, i) => ({ p, corner: corners.includes(i) }));
      const pts = beltCache.pts || nodes;
      build.beltPts = pts;
      const chk = beltCache.chk;
      build.beltBad = chk.ok ? null : chk.at ?? null;
      build.price = chk.price;
      build.len = chk.len;
      build.beltBridges = chk.ok ? chk.bridges || [] : [];          // mosty přes křížené pásy (náhled)
      // navazující pás s jiným zbožím (zbytek prachového pásu → výstup slinovny): převezme zboží, ale až z něj sjede náklad
      const wait = target && target.goods !== 'any' && target.goods !== from.goods && retypeCheck(target.ref, from.goods).wait;
      build.valid = chk.ok && !wait && !build.busy && (!target || s.money >= chk.price);
      build.reason = !chk.ok ? chk.reason : wait ? `Na navazujícím pásu ještě jede ${target.goods === 'brick' ? 'cihla' : 'prach'} – počkej, až dojede` : target && s.money < chk.price ? `Chybí peníze ($${fmtMoney(chk.price - s.money)})` : '';
    }
  }

  if (build.mode === 'cable') {
    const A = structureById(build.from), B = picked ? structureById(picked) : null;
    build.target = B && B.id !== build.from ? B.id : null;
    if (!A) { build.mode = null; return null; }
    const chk = build.target ? cableCheck(A, B) : { ok: false, reason: 'Klikni na cílovou kotvu nebo stavbu' };
    build.valid = chk.ok && !build.busy;
    build.reason = chk.reason;
    build.len = chk.len || 0;
  }

  if (build.mode === 'demolish') {
    let t = null;
    if (picked !== undefined) t = picked ? structureById(picked) : null;
    else {
      const far = cursor && angleBetween(s.p, cursor) * R <= DEMOLISH_REACH ? cursor : null;
      t = far ? structureAt(far) : null;
    }
    if (t && angleBetween(s.p, t.p) * R > DEMOLISH_REACH + 15) t = null;
    if ((t?.id || null) !== build.target) { build.target = t?.id || null; build.hold = 0; }
    const cab = !build.target && pickedCable ? pickedCable : null;                 // bez stavby pod kurzorem: kabel
    if ((cab || []).join('|') !== (build.cable || []).join('|')) { build.cable = cab; build.hold = 0; }
    const bel = !build.target && !build.cable && cursor ? beltSegmentAt(cursor) : null;  // pak úsek pásu
    if ((bel ? `${bel.id}/${bel.k}` : '') !== (build.belt ? `${build.belt.id}/${build.belt.k}` : '')) { build.belt = bel; build.hold = 0; }
    const holding = (!!build.target || !!build.cable || !!build.belt) && (keys.e || build.mouseHold) && !build.busy;
    build.hold = holding ? Math.min(1, build.hold + dt / HOLD) : 0;
    if (build.hold >= 1) {
      build.hold = 0;
      return build.target ? demolishNow(build.target) : build.cable ? uncableNow(build.cable) : unbeltNow(build.belt);
    }
  }
  return null;
}

const fmtMoney = v => Math.round(v).toLocaleString('cs-CZ');
const outcome = (r, done) => (r && typeof r.then === 'function' ? r.then(ok => (ok ? done : 'denied')) : (r ? done : null));

// Postaví stavbu z hologramu (E / klik). Vrací 'built' / 'denied' / Promise / null.
// Přesun depa kladivem (3.1, L-63): E u depa → hologram depa, klik / E ho postaví jinde i se zásobou.
export function startDepotMove(id) {
  const b = structureById(id);
  if (!b || b.type !== 'depot') return;
  build.type = 'depot';
  build.mode = 'build';
  build.moveId = id;
  build.menu = false;
  build.p = null;
  build.lastYaw.depot = b.yaw;
  bump();
}

export function placeNow() {
  if (build.mode !== 'build' || !build.valid || !build.p) return null;
  const type = build.type, p = build.p.slice(), yaw = build.yaw, price = build.price;
  if (build.moveId) {
    const id = build.moveId;
    build.busy = true;
    build.hits = performance.now();
    const r = purchase('dmove3', [id, ...enc(p), Math.round(yaw * 1000)], 0, () => moveStructure(id, p, yaw));
    const done = res => { build.busy = false; if (res === 'dmoved') { build.mode = null; build.type = null; build.moveId = null; bump(); } return res; };
    const out = outcome(r, 'dmoved');
    return out && typeof out.then === 'function' ? out.then(done) : done(out);
  }
  build.lastYaw[type] = yaw;
  build.busy = true;
  build.hits = performance.now();
  if (STRUCTURES[type].hex) {                                            // LAAC: hex + strana první plošiny (3.1)
    const cell = build.cell, rot = build.laacRot | 0;
    const rl = purchase('laac', [cell, rot], price, () => { const id = placeLaac(cell, rot); if (id) autoConnect(id); return id; });
    const doneL = res => { build.busy = false; return res; };
    const outL = outcome(rl, 'built');
    return outL && typeof outL.then === 'function' ? outL.then(doneL) : doneL(outL);
  }
  const r = purchase('build', [TYPE_IDS.indexOf(type), ...enc(p), Math.round(yaw * 1000)], price, () => placeAndWire(type, p, yaw));
  const done = res => { build.busy = false; return res; };
  const out = outcome(r, 'built');
  return out && typeof out.then === 'function' ? out.then(done) : done(out);
}

// Bourání pásu po úsecích (4. 11.): zbourá jen úsek od kloubu ke kloubu, zbytky se dají znovu navázat
function unbeltNow(seg) {
  build.busy = true;
  const r = purchase('beltcut', [seg.id, seg.k], 0, () => cutBelt(seg.id, seg.k));
  const done = res => { build.busy = false; build.belt = null; return res; };
  const out = outcome(r, 'unbelted');
  return out && typeof out.then === 'function' ? out.then(done) : done(out);
}

// Klik / E v režimu pásu: 1. výstupní zásuvka, další = ohyb, u vstupní zásuvky = dokončit (zaplatí se až teď)
export function beltClick() {
  if (build.mode !== 'belt' || build.busy) return null;
  if (!build.beltFrom) {
    if (!build.beltHover) return null;
    build.beltFrom = build.beltHover;
    build.beltBends = [];
    bump();
    return null;
  }
  if (!build.valid) return null;
  if (!build.beltTo) {                                // ohyb na místě kurzoru (s Alt = ostrý zlom, D-20)
    const last = build.beltNodes?.[build.beltNodes.length - 1]?.p;
    if (last && build.beltBends.length < 40) {
      if (build.alt) build.beltCorners.push(build.beltBends.length);
      build.beltBends.push(last.slice());
      bump();
    }
    return null;
  }
  const from = build.beltFrom, to = build.beltTo, bends = build.beltBends.map(p => p.slice()), price = build.price;
  const corners = build.beltCorners.slice();
  build.busy = true;
  build.hits = performance.now();
  const r = purchase('beltadd', [from[0], from[1], to[0], to[1], corners.join(','), ...bends.flatMap(enc)], price, () => addBelt(from, to, bends, corners));
  const done = res => { build.busy = false; if (res === 'belted') resetBelt(); bump(); return res; };
  const out = outcome(r, 'belted');
  return out && typeof out.then === 'function' ? out.then(done) : done(out);
}

function uncableNow([a, b]) {
  build.busy = true;
  const r = purchase('uncable', [a, b], 0, () => removeCable(a, b));
  const done = res => { build.busy = false; build.cable = null; return res; };
  const out = outcome(r, 'uncabled');
  return out && typeof out.then === 'function' ? out.then(done) : done(out);
}

function demolishNow(id) {
  const b = structureById(id);
  if (!b) return null;
  const info = demolishInfo(id);
  if (info.blocked) return { blocked: info.blocked };
  build.busy = true;
  const r = purchase('demolish', [id], 0, () => demolishStructure(id));
  const done = res => { build.busy = false; return res; };
  const out = outcome(r, 'demolished');
  return out && typeof out.then === 'function' ? out.then(done) : done(out);
}

// Text pro výzvu (E) a HUD podle režimu, nebo null.
export function buildPrompt() {
  if (!hammerActive()) return null;
  if (build.mode === 'build' && build.moveId) {
    const deg = `${Math.round(((build.yaw / DEG) % 360 + 360) % 360)}°`;
    if (!build.valid) return { label: `Přesun depa: ${build.reason || 'tady stát nemůže'} · ${deg} · Esc zruší`, key: 'Esc', run: null };
    return { label: `Přesunout depo sem (i se zásobou) · napojené pásy se zbourají, 60 % zpět · ${deg}`, key: 'E', run: placeNow };
  }
  if (!build.mode && !build.menu) {                   // kladivo v ruce u depa: E = přesunout
    const s = game.s;
    const d = (s.buildings || []).find(b => b.type === 'depot' && angleBetween(s.p, b.p) * R < 4.5);
    if (d) return { label: 'Depo · E = přesunout jinam (i se zásobou)', key: 'E', run: () => { startDepotMove(d.id); return null; } };
  }
  if (build.mode === 'build' && build.type && STRUCTURES[build.type].hex) {   // LAAC (3.1): hex + strana plošiny
    const def = STRUCTURES[build.type];
    const side = 'R + kolečko = plošina na jiný sousední hex';
    if (!build.valid) return { label: `${build.reason || 'Tady postavit nejde'} · ${side} · Esc zruší`, key: 'Esc', run: null };
    return { label: `Postavit: ${def.name} · $${fmtMoney(build.price)}${build.links ? ' · kabel k síti' : ' · bez spojení (kotva do 12 m)'} · ${side}`, key: 'E', run: placeNow };
  }
  if (build.mode === 'build' && build.type) {
    const def = STRUCTURES[build.type];
    const deg = `${Math.round(((build.yaw / DEG) % 360 + 360) % 360)}°`;
    if (!build.valid) return { label: `${build.reason || 'Tady postavit nejde'} · ${deg} · Esc zruší`, key: 'Esc', run: null };
    const price = build.price ? `$${fmtMoney(build.price)}` : 'zdarma';
    const wire = def.energy ? (build.links ? ` · kabel k ${build.links} ${build.links === 1 ? 'uzlu' : 'uzlům'}` : ' · bez spojení (kotva do 12 m)') : '';
    return { label: `Postavit: ${def.name} · ${price}${wire} · ${deg}`, key: 'E', run: placeNow };
  }
  if (build.mode === 'belt') {
    if (!build.beltFrom) return { label: build.beltHover ? 'Začít pás z této zásuvky · klik / E' : `Pás: ${build.reason} · Esc zruší`, key: build.beltHover ? 'E' : 'Esc', run: build.beltHover ? beltClick : null };
    const info = `${Math.round(build.len || 0)} m · $${fmtMoney(build.price || 0)}`;
    if (!build.valid) return { label: `Pás: ${build.reason} · ${info} · Esc = zpět`, key: 'Esc', run: null };
    if (build.beltTo) return { label: `Dokončit pás do: ${socketByRef(build.beltTo)?.name || 'zásuvka'} · ${info} · klik / E`, key: 'E', run: beltClick };
    return { label: `Pás ${info} · klik = ohyb (s Alt = ostrý zlom), klik na vstupní zásuvku (modrá) = dokončit · Esc = zpět`, key: 'E', run: beltClick };
  }
  if (build.mode === 'cable') {
    if (!build.valid) return { label: `Kabel z kotvy: ${build.reason} · Esc zruší`, key: 'Esc', run: null };
    return { label: `Natáhnout kabel k: ${STRUCTURES[structureById(build.target).type].name} · ${Math.round(build.len)} m · klik / E`, key: 'E', run: connectNow };
  }
  if (build.mode === 'demolish') {
    const b = build.target && structureById(build.target);
    if (!b && build.cable) return { label: 'Zrušit kabel · podrž E nebo levé tlačítko (kabel je zdarma)', key: 'E', run: null };
    if (!b && build.belt) {
      // úsek od kloubu ke kloubu: vrátí se 60 % jeho podílu na ceně pásu (logistics.js cutBelt)
      const bl = game.s.belts.find(x => x.id === build.belt.id), k = build.belt.k;
      const seg = build.belt.s1 != null ? build.belt.s1 - build.belt.s0 : bl && bl.pts[k + 1] ? angleBetween(bl.pts[k], bl.pts[k + 1]) * R : 0;
      const back = bl ? Math.round((bl.paid || 0) * seg / Math.max(bl.len || 1, 1e-6) * 0.6) : 0;
      return { label: `Zbourat úsek pásu (${Math.round(seg)} m) · vrátí se $${fmtMoney(back)} · náklad na úseku se ztratí · podrž E nebo levé tlačítko`, key: 'E', run: null };
    }
    if (!b) return { label: 'Bourání: namiř kurzor na stavbu, kabel nebo pás · X / Esc = konec', key: 'X', run: null };
    const info = demolishInfo(b.id);
    if (info.blocked) return { label: `${STRUCTURES[b.type].name}: ${info.blocked}`, key: 'X', run: null };
    return { label: `Zbourat: ${STRUCTURES[b.type].name} · vrátí se $${fmtMoney(info.refund)}${info.warn ? ` · ${info.warn}` : ''} · podrž E nebo levé tlačítko`, key: 'E', run: null };
  }
  return null;                                      // jen otevřená lišta: stačí řádek režimu (buildHud)
}

// Řádek HUD s režimem kladiva (D-08).
export function buildHud() {
  if (!hammerActive()) return '';
  if (build.mode === 'build' && build.type) {
    const price = build.price ? `$${fmtMoney(build.price)}` : 'zdarma';
    return `Stavění: ${STRUCTURES[build.type].name} · ${price}   E / klik = postavit · R + kolečko, , . = otočit (Shift po 15°) · V = jiná stavba · Esc = zrušit`;
  }
  if (build.mode === 'demolish') return 'Bourání   stavba, kabel nebo úsek pásu (od kloubu ke kloubu): podrž E / levé tlačítko 1 s · X / Esc = konec';
  if (build.mode === 'cable') return 'Kabel   klikni na cílovou kotvu nebo stavbu · Esc / pravé tlačítko = zrušit';
  if (build.mode === 'belt') return `Pás   $${BELT.price}/m · výstupní zásuvka → klikání = ohyby → vstupní zásuvka · nejvýš ${BELT.maxLen} m, 25° · V = jiná stavba · Esc = krok zpět`;
  if (build.menu) return 'Stavební menu   vyber stavbu · V = zavřít · X = bourání';
  return 'Kladivo   V = stavět · X = bourat · klik na kotvu = kabel · Q = zpět na předchozí políčko';
}
