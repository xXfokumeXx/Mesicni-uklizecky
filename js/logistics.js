// Logistika 3.0 (L-20 až L-25): depo 5 000 kg, zásuvky, pásové dopravníky jako fronty, slinovna (cihly), napojení Výkupu.
// Bez three.js – počítá hostitel / hráč sám (klient jen zobrazuje stav z H.lg a posouvá položky mezi pakety).
//
// Zásuvka = { id, dir: 'in' | 'out', goods: 'dust' | 'brick' | 'any', x, z, yaw } v místních souřadnicích stavby
// (yaw = směr ven ze stavby). Výkup je pevná budova – má virtuální id 'buyback' a 3 vstupy 'any' na ramenech střechy
// (base.js BUILDINGS.depot.belts, výška 5,5 m – pás k nim najede rampou, beltSamples).
// Pás: s.belts[] = { id, from: [idStavby, idZásuvky], to: [...], pts: [[x,y,z] jednotkové směry lomené čáry], len, goods,
// items: [offset m od začátku…] (0 = nejblíž ke konci), wait: s od poslední vypuštěné položky }.
// 4. 11.: from / to může být null (volný konec po bourání úseku) nebo ['belt:<id>', 'start' | 'end'] = navazující pás:
// A.to = ['belt:N', 'start'] → A předává náklad na začátek pásu N; N.from = ['belt:A', 'end'] → N nic sám nevypouští.
// Volný konec pásu je pro stavění „zásuvka“ (beltEndSockets), takže se pás dá navázat. Rozdělovač / spojovač
// (stavby splitter / merger) mají zásuvky 'any' – zboží převezmou od připojených pásů (nodeGoods).
import { MOON } from './config.js';
import { game, newUid, dustPrice, UPGRADES } from './state.js';
import { STRUCTURES, structureById, localToDir, dirToLocal, axes, footOf, partsOf, setBeltCheck, REFUND } from './structures.js';
import { BUILDINGS, baseDir, building, toBase } from './base.js';
import { BASE } from './config.js';
import { stationMk } from './catalog.js';
import { heightAt, terrainVersion } from './planet/height.js';
import { cellDir } from './planet/hexgrid.js';
import { norm, madd, angleBetween, tangentTo, anyTangent } from './planet/vec.js';
import { live } from './energy.js';
import { MARKET } from './catalog.js';
import { curvePoints, straightSegments, CURVE } from './beltCurve.js';

const R = MOON.radius;
export const BAG = 5;                                    // kg prachu v pytli (4. 11.: dřív 25 kg)
export const DEPOT = { cap: 5000, zone: 4.5 };
export const BELT = { speed: 1.125, gap: 1, price: 15, maxLen: 300, maxSlope: Math.tan(25 * Math.PI / 180), emit: 1, deck: 0.55, snap: 5 };
export const SINTER = { hopper: 500, kgPerBrick: 20, time: 6, power: 15, outCap: 50, upPrices: [10000, 20000], reserve: 30 };   // 4. 11.: 15 ⚡/s, 6 s na cihlu
// 4. 11.: vylepšení „Rychlejší lis“ (b.lv 0–2) – každá úroveň −1 s na cihlu (6 / 5 / 4 s), energie dál 15 ⚡/s při práci
export const sinterTime = b => SINTER.time - Math.max(0, Math.min(SINTER.upPrices.length, b?.lv | 0));
// Most při křížení pásů (4. 11.): novější pás vede nad starším o lift m; plochý vršek ±flat m kolem křížení,
// nájezdy ramp m na každou stranu (nejvýš ~21°). Křížení musí být aspoň minEnd m od konců nového pásu.
export const BRIDGE = { lift: 1.0, flat: 1.5, ramp: 4, minEnd: 6, near: 1.1, maxRun: 5 };
export const BRICK_PRICE = 80;
// Cena cihly roste s burzovní cenou prachu ve Výkupu stejně jako prach (+6 % za úroveň), zaokrouhleno na celé $
export const brickPrice = () => Math.round(BRICK_PRICE * (1 + MARKET.step * (game.s?.market | 0)));
// Prodej cihel ze zásoby ve Výkupu (11. 11.): n kusů po brickPrice() (sám / hostitel; klient přes žádost 'bricksell')
export function sellBricks(n) {
  const s = game.s;
  n = Math.floor(Number(n));
  if (!(n >= 1) || n > (s.bricks | 0)) return false;
  s.bricks = (s.bricks | 0) - n;
  s.money += n * brickPrice();
  return true;
}
// Rychlost pásů: základ 1,125 m/s (4. 11.: o 25 % pomalejší), výzkumy „Rychlejší pásy I / II“ každý +25 % základu
export const beltSpeed = () => BELT.speed * (1 + 0.25 * ['beltSpeed1', 'beltSpeed2'].filter(id => game.s?.research?.done?.includes(id)).length);
export const TICK = 0.1;                                 // s – pevný krok simulace (O-08)

// ---------- zásuvky ----------

// Zásuvky Výkupu: ramena pásů na střeše modelu (pevná budova, není ve s.buildings), at / face v souřadnicích základny
const BUYBACK_SOCKETS = (() => {
  const b = building('depot');
  return b.belts.map(a => {
    const at = toBase(b, a.at[0], a.at[1]), tip = toBase(b, a.at[0] + a.dir[0], a.at[1] + a.dir[1]);
    return { id: a.id, dir: 'in', goods: 'any', at, face: [tip[0] - at[0], tip[1] - at[1]], y: a.y };
  });
})();
// Staré zásuvky Výkupu (do 3.0 fáze 5: kopule uprostřed, vstupy ±7,5 m) – převod uložených pásů
const OLD_BUYBACK = { w: [-7.5, 0, -1], e: [7.5, 0, 1] };
const BUYBACK_NAME = 'Výkup prachu';

// Zásuvky stavby ve světě: [{ ref: [id, sid], dir, goods, p (jednotkový směr), face (tečný směr ven), owner }]
const isNode = b => b?.type === 'splitter' || b?.type === 'merger';
// Zboží rozdělovače / spojovače podle připojených pásů (null = zatím nic – výstup se nedá stavět, dokud nevede pás na vstup)
export function nodeGoods(b) {
  const bl = (game.s.belts || []).find(x => x.from?.[0] === b.id || x.to?.[0] === b.id);
  return bl ? bl.goods : null;
}
const beltRef = id => `belt:${id}`;
const beltOfRef = ref => (ref?.[0]?.startsWith('belt:') ? (game.s.belts || []).find(x => x.id === ref[0].slice(5)) || null : null);
// Volné konce pásů jako zásuvky: konec bez cíle = 'out', začátek bez zdroje = 'in' (face = ven z pásu)
function beltEndSockets() {
  const out = [];
  for (const bl of game.s.belts || []) {
    const n = bl.pts.length;
    if (n < 2) continue;
    if (!bl.to) {
      const p = bl.pts[n - 1], q = bl.pts[n - 2];
      out.push({ ref: [beltRef(bl.id), 'end'], dir: 'out', goods: bl.goods, p, face: tangentTo(p, [p[0] - q[0], p[1] - q[1], p[2] - q[2]]), name: 'Konec pásu' });
    }
    if (!bl.from) {
      const p = bl.pts[0], q = bl.pts[1];
      out.push({ ref: [beltRef(bl.id), 'start'], dir: 'in', goods: bl.goods, p, face: tangentTo(p, [p[0] - q[0], p[1] - q[1], p[2] - q[2]]), name: 'Začátek pásu' });
    }
  }
  return out;
}

// Pás bl a pásy za ním po proudu (řetěz končí stavbou, Výkupem nebo volným koncem)
function beltChain(bl) {
  const out = [], seen = new Set();
  while (bl && !seen.has(bl.id)) { seen.add(bl.id); out.push(bl); bl = beltOfRef(bl.to); }
  return out;
}
// 4. 11.: smí pás s volným začátkem (ref ['belt:<id>', 'start']) a pásy za ním převzít zboží goods? Např. zbytek
// prachového pásu do Výkupu napojený na výstup slinovny (cihly). Cíl řetězu musí brát 'any' (Výkup) nebo goods,
// rozdělovač / spojovač ne. wait = na řetězu ještě jede jiné zboží – napojit až dojede.
export function retypeCheck(ref, goods) {
  const bl = ref?.[1] === 'start' ? beltOfRef(ref) : null;
  if (!bl || !goods) return { ok: false, wait: false };
  const chain = beltChain(bl);
  if (chain.every(x => x.goods === goods)) return { ok: true, wait: false };
  const end = chain[chain.length - 1].to;
  if (end && !end[0].startsWith('belt:')) {
    const owner = end[0] === 'buyback' ? 'buyback' : structureById(end[0]);
    if (!owner || isNode(owner)) return { ok: false, wait: false };
    const s = socketByRef(end);
    if (!s || (s.goods !== 'any' && s.goods !== goods)) return { ok: false, wait: false };
  }
  return { ok: true, wait: chain.some(x => x.goods !== goods && x.items.length > 0) };
}

export function socketsOf(b) {
  if (b === 'buyback') {
    return BUYBACK_SOCKETS.map(s => {
      const p = baseDir(s.at[0], s.at[1]);
      const q = baseDir(s.at[0] + s.face[0], s.at[1] + s.face[1]);
      return { ref: ['buyback', s.id], dir: s.dir, goods: s.goods, p, face: tangentTo(p, [q[0] - p[0], q[1] - p[1], q[2] - p[2]]), name: BUYBACK_NAME, y: s.y };
    });
  }
  const def = STRUCTURES[b?.type];
  if (!def?.sockets) return [];
  const ax = axes(b.p, b.yaw);
  const ng = isNode(b) ? nodeGoods(b) : undefined;
  return def.sockets.map(s => {
    const p = localToDir(b.p, b.yaw, s.x, s.z, ax);
    const q = localToDir(b.p, b.yaw, s.x + Math.sin(s.yaw), s.z + Math.cos(s.yaw), ax);
    const goods = ng === undefined ? s.goods : s.dir === 'in' ? ng || 'any' : ng;      // výstup uzlu bez zboží = null
    return { ref: [b.id, s.id], dir: s.dir, goods, p, face: tangentTo(p, [q[0] - p[0], q[1] - p[1], q[2] - p[2]]), name: def.name };
  });
}
// ---------- stanice robotů (11. 11.) ----------
// Robot vykládá do zásobníku stanice (MK1 80 kg, MK2 200 kg); prodá se jen to, co pás ze stanice doveze do Výkupu
// (nebo do depa / slinovny). Výstupní zásuvka je na okraji hexu stanice směrem k základně. Odkaz stanice = 'st:<hex>'.
export const STATION_SOCKET = 3.8;                         // m od středu hexu
export const stationRef = st => `st:${st.hex}`;
export const stationOf = id => (game.s.stations || []).find(st => `st:${st.hex}` === id) || null;
export const stationRoom = st => Math.max(0, stationMk(st).store - (st.store || 0));
export const stationHasBelt = st => !!beltAt([stationRef(st), 'out']);
function stationSockets(st) {
  const c = cellDir(st.hex);
  let face = angleBetween(c, BASE.dir) > 1e-4 ? tangentTo(c, BASE.dir) : anyTangent(c);
  if (!Number.isFinite(face[0])) face = anyTangent(c);
  const p = norm(madd(c, face, STATION_SOCKET / R));
  return [{ ref: [stationRef(st), 'out'], dir: 'out', goods: 'dust', p, face, name: stationMk(st).name }];
}

export function allSockets() {
  const out = socketsOf('buyback');
  for (const st of game.s.stations || []) out.push(...stationSockets(st));
  for (const b of game.s.buildings || []) if (STRUCTURES[b.type]?.sockets) out.push(...socketsOf(b));
  out.push(...beltEndSockets());
  return out;
}
export function socketByRef(ref) {
  if (!ref) return null;
  if (ref[0]?.startsWith('belt:')) return beltEndSockets().find(s => s.ref[0] === ref[0] && s.ref[1] === ref[1]) || null;
  if (ref[0]?.startsWith('st:')) { const st = stationOf(ref[0]); return st ? stationSockets(st).find(s => s.ref[1] === ref[1]) || null : null; }
  const owner = ref[0] === 'buyback' ? 'buyback' : structureById(ref[0]);
  return owner ? socketsOf(owner).find(s => s.ref[1] === ref[1]) || null : null;
}
const sameRef = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];
export const beltAt = ref => (game.s.belts || []).find(bl => sameRef(bl.from, ref) || sameRef(bl.to, ref)) || null;
export const socketFree = ref => !beltAt(ref);

// Nejbližší volná zásuvka u bodu p (do BELT.snap m): dir = 'out' / 'in', goods = zboží pásu (u vstupu)
export function nearestSocket(p, dir, goods = null) {
  let best = null, bestD = BELT.snap;
  for (const s of allSockets()) {
    if (s.dir !== dir || !socketFree(s.ref)) continue;
    if (dir === 'out' && !s.goods) continue;                         // výstup rozdělovače bez přivedeného pásu
    if (goods && s.goods !== 'any' && s.goods !== goods && !retypeCheck(s.ref, goods).ok) continue;   // navazující pás převezme zboží
    const d = angleBetween(p, s.p) * R;
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

// ---------- trasa pásu ----------

// Bod 1,2 m před zásuvkou (pás z ní vychází / do ní vchází kolmo)
export const socketLead = s => norm(madd(s.p, s.face, 1.2 / R));

// Délka lomené čáry (m)
export function pathLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += angleBetween(pts[i - 1], pts[i]) * R;
  return L;
}
// Vzorky po ~1 m: [{ p, h }] (h = výška terénu)
export function samplePath(pts, step = 1) {
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const L = angleBetween(a, b) * R;
    const n = Math.max(1, Math.ceil(L / step));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const t = k / n;
      const p = norm([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
      out.push({ p, h: heightAt(p) });
    }
  }
  return out;
}

// Je bod p v zabrané ploše stavby b (s rezervou m)?
function inFoot(b, p, m = 0.3) {
  if (angleBetween(b.p, p) * R > 60) return false;
  return partsOf(b).some(part => {                                     // LAAC: věž i plošiny (3.1)
    const f = part.foot;
    const [x, z] = dirToLocal(part.p, part.yaw, p);
    return x > f[0] - m && x < f[1] + m && z > f[2] - m && z < f[3] + m;
  });
}

// Kontrola trasy (L-22): pts = [zásuvka, ...ohyby, konec]; skip = id stavby začátku a konce (u zásuvek se smí dotknout).
// Vrací { ok, reason, len, price }.
// at = kde trasa vadí (m od začátku, D-20: červeně jen ten kus), null = celá.
export function checkPath(pts, skip = [], ignoreBelt = null) {
  const len = pathLength(pts);
  const price = Math.ceil(len) * BELT.price;
  if (len > BELT.maxLen) return { ok: false, reason: `Pás je moc dlouhý (${Math.round(len)} m, nejvýš ${BELT.maxLen} m)`, len, price, at: null };
  const S = samplePath(pts, 1);
  const dist = [0];
  for (let i = 1; i < S.length; i++) dist.push(dist[i - 1] + angleBetween(S[i - 1].p, S[i].p) * R);
  for (let i = 1; i < S.length; i++) {
    const run = angleBetween(S[i - 1].p, S[i].p) * R;
    if (run > 0.05 && Math.abs(S[i].h - S[i - 1].h) / run > BELT.maxSlope) return { ok: false, reason: 'Příliš strmý svah (nejvýš 25°)', len, price, at: dist[i] };
  }
  const ends = [S[0].p, S[S.length - 1].p];
  const nearEnd = p => ends.some(e => angleBetween(e, p) * R < 2.5);
  for (let si = 0; si < S.length; si++) {
    const smp = S[si];
    for (const b of game.s.buildings || []) {
      if (skip.includes(b.id) && nearEnd(smp.p)) continue;
      if (STRUCTURES[b.type]?.hover) continue;                       // pod kotvou vedení se projde
      if (inFoot(b, smp.p, 0.2)) return { ok: false, reason: `Pás vede přes stavbu (${STRUCTURES[b.type].name})`, len, price, at: dist[si] };
    }
    for (const B of BUILDINGS) {
      if (angleBetween(B.dir, smp.p) * R > B.r + 1) continue;
      if (B.id === 'depot' && skip.includes('buyback') && nearEnd(smp.p)) continue;   // Výkup má v base.js id 'depot'
      const [x, z] = dirToLocal(B.dir, B.yaw, smp.p);                                // betonová deska nevadí, jen budova
      if (B.solid.some(r => x > r[0] - 0.5 && x < r[1] + 0.5 && z > r[2] - 0.5 && z < r[3] + 0.5)) return { ok: false, reason: `Pás vede přes budovu (${B.name})`, len, price, at: dist[si] };
    }
  }
  // jiné pásy (4. 11.): napříč se křížit smí – nový pás přes starší přejede mostem (bridges = vzdálenosti křížení od začátku).
  // Souběžně vedle sebe (blíž než 1,1 m na delším úseku) ani přes most / nájezd jiného pásu to nejde.
  const bridges = [];
  for (const bl of game.s.belts || []) {
    if (bl.id === ignoreBelt) continue;
    const other = beltSamples(bl);
    let run = null, runAt = null;
    const close = () => {
      if (!run) return null;
      const r = run; run = null;
      runAt = (dist[r.a] + dist[r.b]) / 2;
      if (r.n > BRIDGE.maxRun) return 'Pás by vedl těsně podél jiného pásu – křížit jde jen napříč';
      if (r.lifted) return 'Pás nejde křížit na mostě ani nájezdu jiného pásu';
      const c = (dist[r.a] + dist[r.b]) / 2;
      if (c < BRIDGE.minEnd || c > len - BRIDGE.minEnd) return `Křížení pásů musí být aspoň ${BRIDGE.minEnd} m od konců nového pásu (most potřebuje nájezd)`;
      bridges.push(Math.round(c * 10) / 10);
      return null;
    };
    for (let i = 0; i < S.length; i++) {
      const smp = S[i];
      let hit = null;
      if (!nearEnd(smp.p)) for (const o of other) if (angleBetween(o.p, smp.p) * R < BRIDGE.near) { hit = o; break; }
      if (hit) {
        if (!run) run = { a: i, b: i, n: 0, lifted: false };
        run.b = i; run.n++;
        if ((hit.lift || 0) > 0.02 || hit.ramp) run.lifted = true;
      } else {
        const err = close();
        if (err) return { ok: false, reason: err, len, price, at: runAt };
      }
    }
    const err = close();
    if (err) return { ok: false, reason: err, len, price, at: runAt };
  }
  bridges.sort((a, b) => a - b);
  return { ok: true, reason: '', len, price, bridges };
}
// Zvedne vzorky trasy nad křížením (mosty): s[i].h += lift, s[i].lift = 0–1. dist = vzdálenosti vzorků od začátku.
export function liftSamples(s, bridges) {
  if (!bridges?.length || !s.length) return s;
  let d = 0;
  for (let i = 0; i < s.length; i++) {
    if (i > 0) d += angleBetween(s[i - 1].p, s[i].p) * R;
    let k = 0;
    for (const c of bridges) {
      const x = Math.abs(d - c);
      const v = x <= BRIDGE.flat ? 1 : x >= BRIDGE.flat + BRIDGE.ramp ? 0 : (t => t * t * (3 - 2 * t))(1 - (x - BRIDGE.flat) / BRIDGE.ramp);
      if (v > k) k = v;
    }
    if (k > 0) { s[i].h += BRIDGE.lift * k; s[i].lift = k; }
  }
  return s;
}
const sampleCache = new WeakMap();
// Pás do Výkupu končí na rameni střechy (y = 5,5 m): posledních ~12 m stoupá rampou (deska, nožky i náklad to převezmou).
export function beltSamples(bl) {
  let s = sampleCache.get(bl);
  if (s && s.tv !== terrainVersion()) s = null;            // terén se srovnal pod novou stavbou → vzorky znovu
  if (!s) {
    s = samplePath(bl.pts, 1);
    const top = bl.to?.[0] === 'buyback' ? BUYBACK_SOCKETS.find(x => x.id === bl.to[1])?.y : 0;
    if (top && s.length > 1) {
      const lift = top - BELT.deck - s[s.length - 1].h + heightAt(baseDir(0, 0));   // výška ramene nad terénem u konce
      const L = Math.max(2, Math.min(12, bl.len * 0.9));
      let d = 0;
      for (let i = s.length - 1; i >= 0; i--) {
        if (i < s.length - 1) d += angleBetween(s[i].p, s[i + 1].p) * R;
        if (d >= L) break;
        const t = 1 - d / L;
        s[i].h += lift * t * t * (3 - 2 * t);
        s[i].ramp = true;                                   // rampa k rameni Výkupu – přes ni se pás křížit nesmí
      }
    }
    liftSamples(s, bl.br);                                  // mosty přes starší pásy (křížení)
    s.d = new Float64Array(s.length);                       // ujetá vzdálenost ke každému vzorku (položky jedou stálou rychlostí)
    for (let i = 1; i < s.length; i++) s.d[i] = s.d[i - 1] + angleBetween(s[i - 1].p, s[i].p) * R;
    s.tv = terrainVersion();
    sampleCache.set(bl, s);
  }
  return s;
}

// Stavby nesmí stát na pásu (L-12) – kontrola pro canPlace (hook, structures.js se logistiky neimportuje)
setBeltCheck((p, yaw, foot) => {
  const ax = axes(p, yaw);
  for (const bl of game.s.belts || []) {
    for (const smp of beltSamples(bl)) {
      if (angleBetween(p, smp.p) * R > 45) break;
      const [x, z] = dirToLocal(p, yaw, smp.p, ax);
      if (x > foot[0] && x < foot[1] && z > foot[2] && z < foot[3]) return 'Překáží pás';
    }
  }
  return '';
});

// ---------- zakřivené pásy (L-70, D-20, 3.1) ----------
// Nový pás si ukládá jen UZLY (bl.nodes: zásuvka, vývod 2 m, ohyby…, vývod, zásuvka) a zlomy s Alt (bl.zl = indexy uzlů),
// bl.shape = 'krivka', bl.cs / bl.ce = začátek / konec je u zásuvky s vývodem (rovný úsek). Body bl.pts (po 0,5 m) a
// bl.nodeAt se z uzlů vždy spočítají (deriveCurve) – NEUKLÁDAJÍ se (nevyčíslitelné vlastnosti), přes síť jdou uzly.
// Staré pásy ze 3.0 (bez shape) zůstávají lomené beze změny.
export const SHARP_REASON = 'Příliš ostrý ohyb – přidej další bod nebo použij Alt';
export const curveLead = s => norm(madd(s.p, s.face, CURVE.lead / R));
// Uzly trasy ze zásuvky from přes ohyby (bends) do zásuvky to (null → konec v posledním bodě, třeba u kurzoru).
export function curveNodes(from, bends, to) {
  const n = [from.p, curveLead(from), ...bends];
  if (to) n.push(curveLead(to), to.p);
  return n;
}
// Křivka přes uzly: { pts, nodeAt, sharp }. corners = indexy uzlů se zlomem.
export function curveOf(nodes, corners = [], hasStart = true, hasEnd = true) {
  return curvePoints(nodes, straightSegments(nodes.length, corners, hasStart, hasEnd));
}
function hidden(obj, key, value) { Object.defineProperty(obj, key, { value, writable: true, configurable: true, enumerable: false }); }
// Spočítá z uzlů body zakřiveného pásu (po načtení, u klienta, po stavbě a bourání úseku).
export function deriveCurve(bl) {
  const c = curveOf(bl.nodes, bl.zl || [], bl.cs !== 0, bl.ce !== 0);
  hidden(bl, 'pts', c.pts);
  hidden(bl, 'nodeAt', c.nodeAt);
  bl.len = pathLength(c.pts);
  sampleCache.delete(bl);
  return bl;
}
const isCurve = bl => bl?.shape === 'krivka' && Array.isArray(bl.nodes);
// Vzdálenost uzlu k od začátku pásu (m)
function nodeDist(bl, k) {
  let d = 0;
  for (let i = 1; i <= bl.nodeAt[k]; i++) d += angleBetween(bl.pts[i - 1], bl.pts[i]) * R;
  return d;
}

// Celá trasa pásu ze zásuvky do zásuvky: [zásuvka, vývod, ...ohyby, vývod, zásuvka]
export function fullPath(from, bends, to) {
  const pts = [from.p, socketLead(from), ...bends];
  if (to) pts.push(socketLead(to), to.p);
  return pts;
}

// Stavba pásu (hostitel / hráč sám): fromRef, toRef, bends (jednotkové směry), corners = indexy ohybů se zlomem (Alt).
// Od 3.1 vždy zakřivený (L-70). Vrací id, nebo false.
export function addBelt(fromRef, toRef, bends, corners = []) {
  const from = socketByRef(fromRef), to = socketByRef(toRef);
  if (!from || !to || from.dir !== 'out' || to.dir !== 'in' || !from.goods) return false;
  if (!socketFree(fromRef) || !socketFree(toRef)) return false;
  let retype = false;
  if (to.goods !== 'any' && to.goods !== from.goods) {
    const rc = retypeCheck(toRef, from.goods);
    if (!rc.ok || rc.wait) return false;
    retype = true;
  }
  if (fromRef[0] === toRef[0]) return false;
  const nodes = curveNodes(from, bends || [], to);
  const zl = (corners || []).map(i => (i | 0) + 2).filter(i => i >= 2 && i < nodes.length - 2);   // index ohybu → index uzlu
  const curve = curveOf(nodes, zl);
  if (curve.sharp.length) return false;
  const chk = checkPath(curve.pts, [fromRef[0], toRef[0]]);
  if (!chk.ok || game.s.money < chk.price) return false;
  game.s.money -= chk.price;
  const id = newUid();
  const bl = { id, from: fromRef.slice(), to: toRef.slice(), shape: 'krivka', nodes, cs: 1, ce: 1, len: chk.len, goods: from.goods, items: [], wait: 0, paid: chk.price };
  if (zl.length) bl.zl = zl;
  deriveCurve(bl);
  if (chk.bridges?.length) bl.br = chk.bridges;
  game.s.belts.push(bl);
  // navázání na volné konce pásů: předchozí pás předává do nového, nový do následujícího
  const A = beltOfRef(fromRef); if (A) A.to = [beltRef(id), 'start'];
  const B = beltOfRef(toRef); if (B) B.from = [beltRef(id), 'end'];
  if (retype && B) for (const x of beltChain(B)) if (x.goods !== bl.goods) { x.goods = bl.goods; x.items = []; }   // prázdné (retypeCheck)
  return id;
}
// Odpojí navazující pásy od pásu id (jejich konec / začátek zůstane volný), nebo je přepojí na pás newId.
// which = 'end' (pás, který id krmí za jeho koncem), 'start' (pás, který krmí id), 'both'
function relink(id, newId = null, which = 'both') {
  for (const x of game.s.belts || []) {
    if ((which === 'both' || which === 'end') && x.from?.[0] === beltRef(id)) x.from = newId ? [beltRef(newId), 'end'] : null;
    if ((which === 'both' || which === 'start') && x.to?.[0] === beltRef(id)) x.to = newId ? [beltRef(newId), 'start'] : null;
  }
}
// Zbourání pásu: vrátí 60 % ceny, náklad na pásu se ztratí
export function removeBelt(id) {
  const s = game.s, i = (s.belts || []).findIndex(b => b.id === id);
  if (i < 0) return false;
  s.money += Math.round((s.belts[i].paid || 0) * REFUND);
  s.belts.splice(i, 1);
  relink(id);
  return true;
}
// Zbourání jen úseku pásu id mezi body k a k + 1 lomené čáry (od kloubu ke kloubu). Zbytky zůstanou jako dva pásy
// s volným koncem / začátkem (kratší než 1 m zmizí), dají se znovu navázat. Vrátí 60 % ceny úseku.
export function cutBelt(id, k) {
  const s = game.s, bl = (s.belts || []).find(b => b.id === id);
  k |= 0;
  if (isCurve(bl)) return cutCurve(bl, k);
  if (!bl || k < 0 || k >= bl.pts.length - 1) return false;
  const total = bl.len || pathLength(bl.pts);
  const A = bl.pts.slice(0, k + 1), B = bl.pts.slice(k + 1);
  const lenA = pathLength(A), lenB = pathLength(B);
  const keepA = A.length >= 2 && lenA >= 1, keepB = B.length >= 2 && lenB >= 1;
  if (!keepA && !keepB) return removeBelt(id);
  const paid = bl.paid || 0, share = L => Math.round(paid * L / Math.max(total, 1e-6));
  s.money += Math.round(share(total - (keepA ? lenA : 0) - (keepB ? lenB : 0)) * REFUND);
  let bId = null;
  if (keepB) {
    bId = newUid();
    const off = total - lenB;
    const nb = { id: bId, from: null, to: bl.to, pts: B, len: lenB, goods: bl.goods, items: bl.items.filter(o => o >= off).map(o => o - off), wait: 0, paid: share(lenB) };
    const brB = (bl.br || []).map(c => Math.round((c - off) * 10) / 10).filter(c => c > -BRIDGE.flat - BRIDGE.ramp);
    if (brB.length) nb.br = brB;
    s.belts.push(nb);
  }
  relink(id, bId, 'end');                           // pás za koncem teď krmí zbytek B (nebo má volný začátek)
  if (keepA) {
    bl.pts = A; bl.len = lenA; bl.to = null; bl.paid = share(lenA);
    bl.items = bl.items.filter(o => o <= lenA);
    if (bl.br) { bl.br = bl.br.filter(c => c < lenA + BRIDGE.flat + BRIDGE.ramp); if (!bl.br.length) delete bl.br; }
    sampleCache.delete(bl);
  } else {
    s.belts.splice(s.belts.indexOf(bl), 1);
    relink(id, null, 'start');                      // pás před začátkem má teď volný konec
  }
  return true;
}
// Zakřivený pás: zbourá úsek mezi uzly k a k + 1 (zbytky se z uzlů znovu spočítají). 60 % ceny úseku zpět.
function cutCurve(bl, k) {
  const s = game.s;
  if (k < 0 || k >= bl.nodes.length - 1) return false;
  const total = bl.len, d0 = nodeDist(bl, k), d1 = nodeDist(bl, k + 1);
  const NA = bl.nodes.slice(0, k + 1), NB = bl.nodes.slice(k + 1);
  const keepA = NA.length >= 2 && d0 >= 1, keepB = NB.length >= 2 && total - d1 >= 1;
  if (!keepA && !keepB) return removeBelt(bl.id);
  const paid = bl.paid || 0, share = L => Math.round(paid * L / Math.max(total, 1e-6));
  s.money += Math.round(share(total - (keepA ? d0 : 0) - (keepB ? total - d1 : 0)) * REFUND);
  const zl = bl.zl || [];
  let bId = null;
  if (keepB) {
    bId = newUid();
    const nb = { id: bId, from: null, to: bl.to, shape: 'krivka', nodes: NB, cs: 0, ce: bl.ce, len: 0, goods: bl.goods, items: [], wait: 0, paid: share(total - d1) };
    const zB = zl.filter(c => c > k + 1).map(c => c - (k + 1));
    if (zB.length) nb.zl = zB;
    deriveCurve(nb);
    nb.items = bl.items.filter(o => o >= d1).map(o => Math.min(nb.len, o - d1));
    const brB = (bl.br || []).map(c => Math.round((c - d1) * 10) / 10).filter(c => c > -BRIDGE.flat - BRIDGE.ramp);
    if (brB.length) nb.br = brB;
    s.belts.push(nb);
  }
  relink(bl.id, bId, 'end');
  if (keepA) {
    bl.nodes = NA; bl.to = null; bl.ce = 0; bl.paid = share(d0);
    const zA = zl.filter(c => c < k);
    if (zA.length) bl.zl = zA; else delete bl.zl;
    deriveCurve(bl);
    bl.items = bl.items.filter(o => o <= bl.len);
    if (bl.br) { bl.br = bl.br.filter(c => c < bl.len + BRIDGE.flat + BRIDGE.ramp); if (!bl.br.length) delete bl.br; }
  } else {
    s.belts.splice(s.belts.indexOf(bl), 1);
    relink(bl.id, null, 'start');
  }
  return true;
}

// Úsek pásu u bodu p (do 1,5 m): { id, k } – k = index úseku mezi body lomené čáry; u zakřiveného pásu úsek mezi
// uzly + s0 / s1 (m od začátku – zvýraznění a vrácená cena při bourání).
export function beltSegmentAt(p) {
  let best = null, bd = 1.5 / R;
  for (const bl of game.s.belts || []) {
    for (let k = 0; k < bl.pts.length - 1; k++) {
      const a = bl.pts[k], b = bl.pts[k + 1];
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
      const L2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
      const t = L2 > 0 ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / L2)) : 0;
      const d = Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t);
      if (d < bd) { bd = d; best = { id: bl.id, k }; }
    }
  }
  const bl = best && (game.s.belts || []).find(b => b.id === best.id);
  if (isCurve(bl) && bl.nodeAt) {
    let n = 0;
    while (n + 1 < bl.nodeAt.length - 1 && bl.nodeAt[n + 1] <= best.k) n++;
    return { id: bl.id, k: n, s0: nodeDist(bl, n), s1: nodeDist(bl, n + 1) };
  }
  return best;
}
// Pásy napojené na stavbu (při zboření stavby se zbourají s ní)
export const beltsOf = id => (game.s.belts || []).filter(b => b.from?.[0] === id || b.to?.[0] === id);
export function removeBeltsOf(id) {
  let refund = 0;
  for (const b of beltsOf(id)) { refund += Math.round((b.paid || 0) * REFUND); removeBelt(b.id); }
  return refund;
}

// Bod na pásu bez alokací (O-11, zobrazení položek každý snímek): zapíše do out = { p: [x,y,z], h }
// Index vzorku a podíl t pro vzdálenost od začátku (binární hledání v S.d – zakřivené pásy mají vzorky různě daleko).
function sampleAt(S, bl, offset) {
  const d = S.d;
  if (!d) { const k = Math.max(0, Math.min(S.length - 1, offset / Math.max(0.001, bl.len) * (S.length - 1))); return [Math.floor(k), k - Math.floor(k)]; }
  const x = Math.max(0, Math.min(d[d.length - 1], offset * (d[d.length - 1] / Math.max(0.001, bl.len))));
  let lo = 0, hi = d.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (d[m] <= x) lo = m; else hi = m; }
  const seg = d[hi] - d[lo];
  return [lo, seg > 1e-9 ? (x - d[lo]) / seg : 0];
}
export function beltPointInto(bl, offset, out) {
  const S = beltSamples(bl);
  const [i, t] = sampleAt(S, bl, offset);
  const a = S[i], b = S[Math.min(S.length - 1, i + 1)];
  const x = a.p[0] + (b.p[0] - a.p[0]) * t, y = a.p[1] + (b.p[1] - a.p[1]) * t, z = a.p[2] + (b.p[2] - a.p[2]) * t, l = Math.hypot(x, y, z) || 1;
  out.p[0] = x / l; out.p[1] = y / l; out.p[2] = z / l;
  out.h = a.h + (b.h - a.h) * t;
  return out;
}
// Bod na pásu podle offsetu (m): { p, h } – pro zobrazení položek
export function beltPointAt(bl, offset) {
  const S = beltSamples(bl);
  const [i, t] = sampleAt(S, bl, offset);
  const a = S[i], b = S[Math.min(S.length - 1, i + 1)];
  return { p: norm([a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t, a.p[2] + (b.p[2] - a.p[2]) * t]), h: a.h + (b.h - a.h) * t };
}

// ---------- depo ----------

export const depots = () => (game.s.buildings || []).filter(b => b.type === 'depot');
// Depo, do jehož zóny míří bod p (id), nebo null
export function depotAt(p) {
  for (const b of depots()) if (angleBetween(p, b.p) * R < DEPOT.zone) return b.id;
  return null;
}
export const depotRoom = b => Math.max(0, DEPOT.cap - (b?.data?.store || 0));
// Vysype náklad do depa (hostitel / hráč sám). Vrací přijaté kg (vejde se jen část, když je skoro plné).
export function depositToDepot(id, kg) {
  const b = structureById(id);
  if (b?.type !== 'depot' || !(kg > 0)) return 0;
  const add = Math.min(kg, depotRoom(b));
  b.data.store = (b.data.store || 0) + add;
  return add;
}
// Depo s výstupním pásem (dron tam smí vyložit – prach odjede)
// ---------- výsypka depa (L-63, D-15, 3.1): vozidlo, které pod ní stojí, do ní vysype zásobník (hráč 10. 11.:
// prach se do depa nasypává, ne nakládá z něj). Rameno prach z vozidla nasaje rychlostí podle výzkumu. ----------
// Zóna 5 × 5 m za depem (místní −z: vpředu je násypka pro vysypávání, po stranách zásuvky pásů), mimo kruh vysypávání.
export const DUMP = { z: -7.5, half: 2.5, chuteY: 5.5, still: 0.5, maxSpeed: 0.5, rates: [100, 200, 400] };
const researched = id => !!game.s?.research?.done?.includes(id);
export const dumpRate = () => (researched('dump2') ? DUMP.rates[2] : researched('dump1') ? DUMP.rates[1] : DUMP.rates[0]);   // výzkum Rychlý výsyp (L-68)
// Depo, pod jehož výsypkou je bod p (jednotkový směr), nebo null.
export function dumpZoneAt(p) {
  for (const b of depots()) {
    if (angleBetween(p, b.p) * R > 12) continue;
    const [x, z] = dirToLocal(b.p, b.yaw, p);
    if (Math.abs(x) <= DUMP.half && Math.abs(z - DUMP.z) <= DUMP.half) return b;
  }
  return null;
}
// Odebere ze skladu depa nejvýš kg (pro Kondora – fáze 8). Vrací, kolik opravdu odebral.
export function takeFromDepot(id, kg) {
  const b = structureById(id);
  if (b?.type !== 'depot' || !(kg > 0)) return 0;
  const t = Math.min(kg, b.data.store || 0);
  b.data.store = (b.data.store || 0) - t;
  return t;
}

export const depotWithBelt = b => b?.type === 'depot' && !!beltAt([b.id, 'out']);

// ---------- simulace (hostitel / hráč sám) ----------

// Přijme cíl položku? (a rovnou ji uloží). goods = 'dust' | 'brick'
function deliver(ref, goods) {
  const s = game.s;
  if (!ref) return false;                                  // volný konec pásu: náklad stojí
  const next = beltOfRef(ref);
  if (next) {                                              // navazující pás: na jeho začátek, je-li místo
    const it = next.items;
    if (it.length && it[it.length - 1] < BELT.gap) return false;
    it.push(0);
    return true;
  }
  if (ref[0] === 'buyback') {
    if (game.mode === 'client') return true;               // klient: jen zobrazení – peníze a cihly počítá hostitel
    if (goods === 'dust') { const e = BAG * dustPrice(); s.money += e; logEarn(e); }
    else if (s.brickMode === 'store') s.bricks = (s.bricks | 0) + 1;
    else { const e = brickPrice(); s.money += e; logEarn(e); }
    return true;
  }
  const b = structureById(ref[0]);
  if (!b) return false;
  if (b.type === 'depot' && goods === 'dust') {
    if (depotRoom(b) < BAG) return false;
    b.data.store = (b.data.store || 0) + BAG;
    return true;
  }
  if (b.type === 'sinter' && goods === 'dust') {
    if ((b.data.hopper || 0) + BAG > SINTER.hopper) return false;
    b.data.hopper = (b.data.hopper || 0) + BAG;
    return true;
  }
  if (isNode(b)) {
    // rozdělovač / spojovač: zásobník na 2 položky; spojovač střídá vstupy, když čekají oba
    const d = b.data;
    if ((d.buf | 0) >= NODE_BUF) return false;
    if (b.type === 'merger' && d.lastIn === ref[1]) {
      const other = beltAt([b.id, ref[1] === 'a' ? 'b' : 'a']);
      if (other && other.items.length && other.items[0] >= other.len - 1e-6) return false;   // teď je na řadě druhý vstup
    }
    d.buf = (d.buf | 0) + 1;
    d.lastIn = ref[1];
    return true;
  }
  return false;
}
const NODE_BUF = 2;
// Může zdroj vypustit položku? (a rovnou ji odebere)
function emit(ref) {
  if (!ref || ref[0].startsWith('belt:')) return false;    // pás krmený jiným pásem (nebo volný začátek) nic nevypouští
  if (ref[0].startsWith('st:')) {                          // stanice robota: pytel ze zásobníku (11. 11.)
    const st = stationOf(ref[0]);
    if (st && (st.store || 0) >= BAG) { st.store -= BAG; return true; }
    return false;
  }
  const b = structureById(ref[0]);
  if (isNode(b)) {
    const d = b.data;
    if (!((d.buf | 0) > 0)) return false;
    if (b.type === 'splitter') {
      // rozdělovač střídá výstupy; když druhý výstup nemůže brát (není pás / je plný na začátku), jde vše sem
      const other = ref[1] === 'a' ? 'b' : 'a', ob = beltAt([b.id, other]);
      const otherReady = ob && (!ob.items.length || ob.items[ob.items.length - 1] >= BELT.gap);
      if (d.turn && d.turn !== ref[1] && otherReady) return false;
      d.turn = other;
    }
    d.buf -= 1;
    return true;
  }
  if (b?.type === 'depot' && (b.data.store || 0) >= BAG) { b.data.store -= BAG; return true; }
  if (b?.type === 'sinter' && (b.data.out || 0) >= 1) { b.data.out -= 1; return true; }
  return false;
}
let earnLog = 0;
const logEarn = e => { earnLog += e; };
export const takeBeltEarnings = () => { const e = earnLog; earnLog = 0; return e; };

// Slinovna: 20 kg → 1 cihla za 6 s (vylepšení 5 / 4 s) při plném výkonu (f = podíl energie 0–1).
// f < 0 = slinovna při poslední bilanci sítě nic nechtěla (neměla prach) – energii dostane až v další bilanci (≤ 0,5 s),
// do té doby stojí (dřív jela zadarmo s f = 1).
function sinterStep(b, dt, f) {
  const d = b.data;
  d.hopper = d.hopper || 0; d.out = d.out || 0; d.t = d.t || 0;
  const can = d.hopper >= SINTER.kgPerBrick && d.out < SINTER.outCap;
  if (!can) { d.state = d.out >= SINTER.outCap ? 'full' : 'idle'; return; }
  if (f < 0) return;
  if (f <= 0.01) { d.state = 'power'; return; }
  d.state = 'work';
  d.t += dt * f;
  const T = sinterTime(b);
  if (d.t >= T) {
    d.t -= T;
    d.hopper -= SINTER.kgPerBrick;
    d.out += 1;
  }
}
// Vylepšení slinovny „Rychlejší lis“ (hostitel / hráč sám): cena další úrovně, nebo null (nejvyšší úroveň)
export const sinterUpPrice = b => SINTER.upPrices[b?.lv | 0] ?? null;
export function upgradeSinter(id) {
  const b = structureById(id), price = sinterUpPrice(b);
  if (b?.type !== 'sinter' || price == null || game.s.money < price) return false;
  game.s.money -= price;
  b.lv = (b.lv | 0) + 1;
  b.paid = (b.paid || 0) + price;                          // bourání vrátí 60 % i z vylepšení
  return true;
}
export const sinterWants = b => (b.data.hopper || 0) >= SINTER.kgPerBrick && (b.data.out || 0) < SINTER.outCap;

// Posun pásu o dt: fronta – první položka ke konci, další nejblíž o mezeru za předchozí (O-08)
function beltStep(bl, dt) {
  const it = bl.items, v = beltSpeed() * dt;
  for (let i = 0; i < it.length; i++) {
    const limit = i === 0 ? bl.len : it[i - 1] - BELT.gap;
    if (it[i] < limit) it[i] = Math.min(it[i] + v, limit);
  }
  bl.clog = false;
  if (it.length && it[0] >= bl.len - 1e-6) {
    if (deliver(bl.to, bl.goods)) it.shift();
    else bl.clog = true;                                   // cíl nepřijímá → pás stojí (D-06)
  }
  bl.wait = (bl.wait || 0) + dt;
  const tail = it.length ? it[it.length - 1] : Infinity;
  // stavby vypouštějí 1 položku za s, rozdělovač / spojovač tak rychle, jak pás stačí
  const every = isNode(structureById(bl.from?.[0])) ? BELT.gap / beltSpeed() : BELT.emit;
  if (bl.wait >= every && tail >= BELT.gap && emit(bl.from)) { it.push(0); bl.wait = 0; }
}

let acc = 0;
export const tickPhase = () => Math.min(acc, TICK);   // s od posledního kroku (plynulé zobrazení)
export function logisticsTick(dt) {
  acc += dt;
  let n = 0;
  while (acc >= TICK && n++ < 20) {
    acc -= TICK;
    for (const b of game.s.buildings || []) {
      if (b.type !== 'sinter') continue;
      const L = live.get(b.id);
      sinterStep(b, TICK, !L?.wired ? 0 : L.pend ? -1 : L.f ?? 0);
    }
    for (const bl of game.s.belts || []) beltStep(bl, TICK);
  }
}
// Offline (L-30 obdoba): energie se nesimuluje, slinovna jede naplno; po 1 s, nejvýš 1 h (pak se linky stejně ustálí)
export function logisticsOffline(seconds) {
  const before = game.s.money;
  const steps = Math.min(3600, Math.floor(seconds));
  for (let k = 0; k < steps; k++) {
    for (const b of game.s.buildings || []) if (b.type === 'sinter') sinterStep(b, 1, 1);
    for (const bl of game.s.belts || []) beltStep(bl, 1);
  }
  takeBeltEarnings();
  return game.s.money - before;
}

// ---------- síť (H.bl = pásy, H.lg = živý stav) ----------

const enc = p => [Math.round(p[0] * 1e6), Math.round(p[1] * 1e6), Math.round(p[2] * 1e6)];
// [id, z, zZás, do, doZás, cihly?, cena, mosty („12.5,40.1“ nebo ''), body ×3 (1e6)…]
// [id, z, zZás, do, doZás, cihly?, cena, mosty, tvar, body ×3…] – tvar '' = lomený (body = pts), 'k<s><e>:<zlomy>' = zakřivený
// (body = uzly, s / e = začátek / konec se zásuvkou 0/1). Od 3.1 (NET_PROTOCOL 5).
const shapeCode = b => (isCurve(b) ? `k${b.cs !== 0 ? 1 : 0}${b.ce !== 0 ? 1 : 0}:${(b.zl || []).join(',')}` : '');
export const encodeBelts = () => (game.s.belts || []).map(b => [b.id, b.from?.[0] || '', b.from?.[1] || '', b.to?.[0] || '', b.to?.[1] || '', b.goods === 'brick' ? 1 : 0, Math.round(b.paid || 0), (b.br || []).join(','), shapeCode(b), ...(isCurve(b) ? b.nodes : b.pts).flatMap(enc)]);
const refOf = (a, b) => (a ? [String(a), String(b)] : null);
const brOf = v => String(v || '').split(',').filter(x => x !== '').map(Number).filter(Number.isFinite);
export function applyBelts(list) {
  const old = new Map((game.s.belts || []).map(b => [b.id, b]));
  game.s.belts = (Array.isArray(list) ? list : []).filter(e => Array.isArray(e) && e.length >= 15).map(e => {
    const prev = old.get(String(e[0]));
    const pts = [];
    for (let i = 9; i + 2 < e.length; i += 3) pts.push(norm([e[i] / 1e6, e[i + 1] / 1e6, e[i + 2] / 1e6]));
    const from = refOf(e[1], e[2]), to = refOf(e[3], e[4]), goods = e[5] ? 'brick' : 'dust', br = brOf(e[7]);
    const shape = String(e[8] || '');
    const curved = shape.startsWith('k');
    const zl = curved ? brOf(shape.split(':')[1]).map(x => x | 0) : [];
    const cs = curved && shape[1] === '0' ? 0 : 1, ce = curved && shape[2] === '0' ? 0 : 1;
    const prevPts = prev ? (isCurve(prev) ? prev.nodes : prev.pts) : null;
    if (prev && isCurve(prev) === curved && prevPts.length === pts.length && (prev.br || []).join(',') === br.join(',') && (prev.zl || []).join(',') === zl.join(',')
      && prev.cs === (curved ? cs : prev.cs) && prev.ce === (curved ? ce : prev.ce) && pts.every((q, i) => angleBetween(q, prevPts[i]) * R < 0.01)) {
      Object.assign(prev, { from, to, goods, paid: e[6] | 0 });      // trasa beze změny – nech položky a vzorky
      return prev;
    }
    const bl = curved
      ? { id: String(e[0]), from, to, goods, paid: e[6] | 0, shape: 'krivka', nodes: pts, cs, ce, len: 0, items: [], wait: 0 }
      : { id: String(e[0]), from, to, goods, paid: e[6] | 0, pts, len: pathLength(pts), items: [], wait: 0 };
    if (curved) { if (zl.length) bl.zl = zl; deriveCurve(bl); }
    if (br.length) bl.br = br;
    return bl;
  });
}
// Živý stav: depa (sklad), slinovny (zásobník, cihly, stav), položky pásů (offsety v dm jako base36 po 3 znacích), ucpané pásy
const SIN_STATE = ['idle', 'work', 'full', 'power'];
export function encodeLogistics() {
  const s = game.s;
  const d = [], k = [], it = {};
  for (const b of s.buildings || []) {
    if (b.type === 'depot') d.push([b.id, Math.round(b.data.store || 0)]);
    if (b.type === 'sinter') k.push([b.id, Math.round(b.data.hopper || 0), b.data.out | 0, SIN_STATE.indexOf(b.data.state || 'idle')]);
  }
  for (const bl of s.belts || []) it[bl.id] = (bl.clog ? '!' : '') + bl.items.map(o => Math.round(o * 10).toString(36).padStart(3, '0')).join('');
  return { d, k, it, bk: s.bricks | 0, bm: s.brickMode === 'store' ? 1 : 0 };
}
export function applyLogistics(L) {
  if (!L || typeof L !== 'object') return;
  const s = game.s;
  for (const e of Array.isArray(L.d) ? L.d : []) { const b = structureById(String(e[0])); if (b) b.data.store = e[1] | 0; }
  for (const e of Array.isArray(L.k) ? L.k : []) {
    const b = structureById(String(e[0]));
    if (b) { b.data.hopper = e[1] | 0; b.data.out = e[2] | 0; b.data.state = SIN_STATE[e[3] | 0] || 'idle'; }
  }
  const items = L.it && typeof L.it === 'object' ? L.it : {};
  for (const bl of s.belts || []) {
    const str = String(items[bl.id] || '');
    bl.clog = str.startsWith('!');
    const body = bl.clog ? str.slice(1) : str;
    bl.items = [];
    for (let i = 0; i + 3 <= body.length; i += 3) bl.items.push(parseInt(body.slice(i, i + 3), 36) / 10);
  }
  s.bricks = L.bk | 0;
  s.brickMode = L.bm ? 'store' : 'sell';
}
// Klient (4. 11.): mezi pakety hostitele (1× za 2 s) simuluje pásy stejně jako hostitel – vypouštění z dep / slinoven,
// předávání na navazující pásy a přes rozdělovače / spojovače, doručení. Peníze a cihly ve Výkupu nepočítá (deliver),
// slinovny nelisuje (stav a cihly na výstupu má z paketu). Každý paket stav opraví (applyLogistics).
// Dřív se pytle jen posouvaly k cíli a čekaly tam na paket → u spojovačů, rozdělovačů a navázaných pásů náklad
// „stál“ a pak naráz přeskočil.
export function logisticsClientTick(dt) {
  acc += dt;
  let n = 0;
  while (acc >= TICK && n++ < 20) {
    acc -= TICK;
    for (const bl of game.s.belts || []) beltStep(bl, TICK);
  }
}

// ---------- převod pásů do starého Výkupu (vstupy ±7,5 m) na ramena nového modelu ----------
// 3.1: zakřivené pásy si body spočítají z uzlů (neukládají se)
UPGRADES.push(s => { for (const bl of s.belts || []) if (isCurve(bl)) deriveCurve(bl); });
UPGRADES.push(s => {
  for (const bl of s.belts || []) {
    if (isCurve(bl)) continue;
    const old = bl.to?.[0] === 'buyback' ? OLD_BUYBACK[bl.to[1]] : null;
    const end = bl.pts?.[bl.pts.length - 1];
    if (!old || !end || angleBetween(end, baseDir(old[0], old[1])) * R > 0.5) continue;   // už je na novém rameni
    const sock = socketsOf('buyback').find(x => x.ref[1] === bl.to[1]);
    const lead = socketLead(sock);
    const oldLead = baseDir(old[0] + old[2] * 1.2, old[1]);
    if (bl.pts.length >= 3 && angleBetween(bl.pts[bl.pts.length - 2], oldLead) * R < 0.5) bl.pts.splice(-2, 2, lead, sock.p);
    else bl.pts.splice(-1, 1, lead, sock.p);
    bl.len = pathLength(bl.pts);
    bl.items = (bl.items || []).filter(o => o <= bl.len);
  }
});

// ---------- převod dep a pásů z verze 2 (rozhodnutí 3. 11.: depa převést, pásy vrátit) ----------

// v2 depo (hex, store, belt, to, transit) → stavba depo na středu hexu; sklad nad 5 000 kg a prach na pásu se prodá,
// pás se vrátí penězi (25 $ za hex, jako stál ve v2).
UPGRADES.push(s => {
  if (!Array.isArray(s.depots) || !s.depots.length) return;
  s.buildings ||= [];
  s.belts ||= [];
  for (const d of s.depots) {
    const p = cellDir(d.hex);
    const store = Number(d.store) || 0;
    const onBelt = (d.acc || 0) + (d.transit || []).reduce((a, e) => a + (e[1] || 0), 0);
    s.money += Math.max(0, store - DEPOT.cap) * dustPrice() + onBelt * dustPrice();
    if (d.belt) {
      const to = d.to >= 0 ? cellDir(d.to) : baseDir(0, 0);
      s.money += Math.max(1, Math.round(angleBetween(p, to) * R / 9)) * 25;          // ~ hexy × $25
    }
    s.buildings.push({ id: newUid(), type: 'depot', p, yaw: 0, lv: 0, paid: STRUCTURES.depot.price, data: { store: Math.min(DEPOT.cap, store) } });
  }
  s.depots = [];
});
