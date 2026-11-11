// Energetická síť 3.0 (L-05 až L-08): kabely mezi kotvami vedení a stavbami, sítě, bilance výroby a spotřeby,
// baterie (úložiště) a nabíjení vozidel na nabíječce. Bez three.js; počítá hostitel (nebo hráč sám), klient jen zobrazuje.
//
// Kabel = [idA, idB] v s.cables. Síť = souvislá skupina staveb spojených kabely (union-find, přepočet každé 0,5 s – je to levné).
// Stavba bez kabelu nefunguje (nabíječka nenabíjí, solár vyrábí do prázdna) a má nad sebou ikonu přeškrtnutého blesku.
import { MOON } from './config.js';
import { game, gameTime } from './state.js';
import { batteryCap } from './catalog.js';
import { STRUCTURES, structureById, localToDir, axes, padTopHeight, CHARGER_RATE, garageSlot, SWAP } from './structures.js';
import { heightAt } from './planet/height.js';
import { angleBetween, norm, dot } from './planet/vec.js';
import { sunElevationDeg, sunAngle } from './planet/sun.js';
import { sunWindow } from './planet/sunwindow.js';
import { researching, researchProgress, RESEARCH_POWER } from './research.js';
import { roofRest } from './solarRoof.js';
import { laacParts } from './laac.js';
import { isAirType } from './catalog.js';
import { sinterWants, SINTER, DEPOT, beltAt } from './logistics.js';

const R = MOON.radius;
export const SPAN_POLE = 30;           // m kotva–kotva
export const SPAN_NEAR = 12;           // m kotva–stavba a stavba–stavba
export const SPAN_MIN = 4;             // m – blíž kabel nejde (rozhodnutí 3. 11.)
export const MAX_CABLES = { pole: 6 };
const MAX_OTHER = 4;
export const TICK = 0.5;               // s – bilance sítě 2× za sekundu
const SLOT_R = 1.6;                    // m – vozidlo stojí na slotu nabíječky (±1,5 m)

// ---------- body pro kabel ----------

// Kotevní bod k stavby b ve světě: { dir, r } (r = vzdálenost od středu Měsíce).
export function anchorAt(b, k = 0) {
  const def = STRUCTURES[b.type];
  const a = def.anchors?.[k] || def.anchors?.[0] || [0, 2, 0];
  const base = padTopHeight(b) - (def.padTop || 0);
  return { dir: localToDir(b.p, b.yaw, a[0], a[2]), r: R + base + a[1] };
}
const anchorPos = ({ dir, r }) => [dir[0] * r, dir[1] * r, dir[2] * r];

// Nejbližší dvojice kotevních bodů dvou staveb → { a, b, len } (body ve světě [x,y,z]).
export function cableEnds(A, B) {
  const da = STRUCTURES[A.type].anchors || [[0, 2, 0]], db = STRUCTURES[B.type].anchors || [[0, 2, 0]];
  let best = null;
  for (let i = 0; i < da.length; i++) for (let j = 0; j < db.length; j++) {
    const ka = anchorAt(A, i), kb = anchorAt(B, j);
    const a = anchorPos(ka), b = anchorPos(kb);
    const len = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const span = angleBetween(ka.dir, kb.dir) * R;                     // vodorovné rozpětí (limity 30 / 12 / 4 m)
    if (!best || span < best.span) best = { a, b, len, span };
  }
  return best;
}

// Průvěs kabelu (README modelů ~10 % délky, nejvýš 1,6 m, aby kotvy nesahaly kabelem do země)
export const sagOf = len => Math.min(len * 0.1, 1.6);
// Bod na prověšeném kabelu pro t ∈ 0…1 (parabola mezi body, průvěs dolů ke středu Měsíce).
export function cablePoint(a, b, t, sag, out = [0, 0, 0]) {
  const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t;
  const l = Math.hypot(x, y, z), d = 4 * sag * t * (1 - t);
  out[0] = x - x / l * d; out[1] = y - y / l * d; out[2] = z - z / l * d;
  return out;
}

const isPole = b => b.type === 'pole';
export const maxSpan = (A, B) => (isPole(A) && isPole(B) ? SPAN_POLE : SPAN_NEAR);
export const cablesOf = id => (game.s.cables || []).filter(c => c[0] === id || c[1] === id);
export const hasCable = (a, b) => (game.s.cables || []).some(c => (c[0] === a && c[1] === b) || (c[0] === b && c[1] === a));
const capOf = b => MAX_CABLES[b.type] ?? MAX_OTHER;

// Jde mezi stavbami natáhnout kabel? { ok, reason, len }
export function cableCheck(A, B, { ignoreDuplicate = false } = {}) {
  if (!A || !B || A.id === B.id) return { ok: false, reason: 'Vyber jinou stavbu', len: 0 };
  if (!STRUCTURES[A.type]?.energy || !STRUCTURES[B.type]?.energy) return { ok: false, reason: 'Tahle stavba elektřinu nepotřebuje', len: 0 };
  if (!isPole(A) && !isPole(B) && !ignoreDuplicate) { /* stavba–stavba je dovolená do 12 m */ }
  const ends = cableEnds(A, B);
  const len = ends.span;
  if (!ignoreDuplicate && hasCable(A.id, B.id)) return { ok: false, reason: 'Už jsou spojené', len };
  if (len < SPAN_MIN) return { ok: false, reason: `Příliš blízko (nejméně ${SPAN_MIN} m)`, len };
  if (len > maxSpan(A, B)) return { ok: false, reason: `Příliš daleko (${Math.round(len)} m, nejvýš ${maxSpan(A, B)} m)`, len };
  if (cablesOf(A.id).length >= capOf(A) || cablesOf(B.id).length >= capOf(B)) return { ok: false, reason: 'Na kotvě už je nejvíc kabelů', len };
  // kabel nesmí vést terénem (12 bodů podél prověšené křivky, D-13)
  const sag = sagOf(ends.len), p = [0, 0, 0];
  for (let i = 1; i < 12; i++) {
    cablePoint(ends.a, ends.b, i / 12, sag, p);
    const l = Math.hypot(p[0], p[1], p[2]);
    if (l < R + heightAt([p[0] / l, p[1] / l, p[2] / l]) + 0.3) return { ok: false, reason: 'Kabel by vedl přes kopec', len };
  }
  return { ok: true, reason: '', len };
}

// Kam se nová stavba sama připojí (L-06): kotva k nejbližším 3 uzlům v dosahu, ostatní stavby k nejbližšímu uzlu.
// b = stavba (může být i hologram { id: null, type, p, yaw }). Vrací pole id.
export function autoTargets(b) {
  if (!STRUCTURES[b.type]?.energy) return [];
  const want = isPole(b) ? 3 : 1;
  const list = [];
  for (const o of game.s.buildings || []) {
    if (o.id === b.id || !STRUCTURES[o.type]?.energy) continue;
    if (angleBetween(b.p, o.p) * R > SPAN_POLE + 15) continue;
    const chk = cableCheck({ ...b, id: b.id || '__new' }, o);
    if (chk.ok) list.push({ id: o.id, len: chk.len, pole: isPole(o) });
  }
  // stavba se přednostně připojí ke kotvě (L-06: „kotvou nebo stavbou“ – kotva je přirozený uzel sítě)
  list.sort((x, y) => (isPole(b) ? 0 : (y.pole - x.pole)) || x.len - y.len);
  return list.slice(0, want).map(x => x.id);
}

// Po postavení: připojit automaticky (sám / hostitel). Vrací počet nových kabelů.
export function autoConnect(id) {
  const b = structureById(id);
  if (!b) return 0;
  const targets = autoTargets(b);
  for (const t of targets) addCable(id, t);
  return targets.length;
}

export function addCable(a, b) {
  const A = structureById(a), B = structureById(b);
  if (!cableCheck(A, B).ok) return false;
  (game.s.cables ||= []).push([a, b]);
  return true;
}
export function removeCable(a, b) {
  const s = game.s;
  const n = s.cables.length;
  s.cables = s.cables.filter(c => !((c[0] === a && c[1] === b) || (c[0] === b && c[1] === a)));
  return s.cables.length < n;
}

// ---------- sítě ----------

// id stavby → číslo sítě (jen energetické stavby). Stavba bez kabelu má svou vlastní síť.
export function networks() {
  const parent = new Map();
  const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (const b of game.s.buildings || []) if (STRUCTURES[b.type]?.energy) parent.set(b.id, b.id);
  for (const [a, b] of game.s.cables || []) {
    if (!parent.has(a) || !parent.has(b)) continue;
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const out = new Map();
  for (const id of parent.keys()) out.set(id, find(id));
  return out;
}

// ---------- výroba ----------

const windows = new Map();             // id soláru → okno osvětlení [východ, západ] (spočítá se jednou, O-09)
function litNow(b, theta) {
  let w = windows.get(b.id);
  if (!w || w.key !== b.p.join(',')) { w = { key: b.p.join(','), win: sunWindow(b.p) }; windows.set(b.id, w); }
  const [rise, set] = w.win;
  if (rise === set) return false;
  const noon = Math.atan2(b.p[0], b.p[2]);
  let h = theta - noon;
  h = Math.atan2(Math.sin(h), Math.cos(h));
  return h >= rise && h <= set;
}

// Výkon zdroje právě teď (⚡/s) a stav pro LED: { out, light: 'full' | 'low' | 'dark' }
export function sourceOutput(b, t = gameTime()) {
  const e = STRUCTURES[b.type].energy;
  if (e.rtg) return { out: e.out, light: 'full' };
  const elev = sunElevationDeg(b.p, t);
  if (elev <= 0 || !litNow(b, sunAngle(t))) return { out: 0, light: 'dark' };
  const k = e.tracker ? 1 : Math.sin(elev * Math.PI / 180);
  return { out: e.out * k, light: k > 0.5 ? 'full' : 'low' };
}

// ---------- nabíječka ----------

// Vozidlo stojící na slotu k nabíječky b (index vozidla, nebo −1). busy(i) = vozidlo se právě hýbe.
export function vehicleOnSlot(b, k, busy = () => false) {
  const def = STRUCTURES.charger;
  const [x, z] = def.slots[k];
  const dir = localToDir(b.p, b.yaw, x, z);
  let best = -1, bestD = SLOT_R;
  game.s.vehicles.forEach((v, i) => {
    if (!batteryCap(v) || busy(i)) return;                // busy = vozidlo jede (řidič smí sedět, stačí stát – L-05)
    const d = angleBetween(v.p, dir) * R;
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}
export const slotRate = b => CHARGER_RATE[Math.min(2, b.data?.fast | 0)];

// ---------- výměník baterií ----------
export const hostNow = () => Date.now() + (game.clockOffset || 0);   // hodiny hostitele (ms) – začátek výměny pro animaci
export const swapEvents = [];                                          // indexy vozidel s právě vyměněnou baterií (main.js → toast)
export function vehicleOnBay(b, busy = () => false) {
  const [x, z] = STRUCTURES.swapper.bay;
  const dir = localToDir(b.p, b.yaw, x, z);
  let best = -1, bestD = SWAP.bayR;
  game.s.vehicles.forEach((v, i) => {
    if (!batteryCap(v) || busy(i)) return;
    const d = angleBetween(v.p, dir) * R;
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}
// Za kolik sekund bude v regálu nejbližší nabitá baterie (null = nenabíjí se – bez sítě)
export function swapperEta(b) {
  const L = live.get(b.id), rack = b.data.rack || [];
  if (rack.some(x => x >= 0.999)) return 0;
  const f = L?.wired ? (L.f ?? 0) : 0;
  const inRack = rack.filter(x => x >= 0);                              // −1 = baterii odnesl dron (3.1)
  if (f <= 0.01 || !inRack.length) return null;
  const best = Math.max(...inRack);
  return (1 - best) * SWAP.cap / (SWAP.rate * f);
}

// ---------- bilance (hostitel / hráč sám) ----------

// Živé hodnoty pro zobrazení: id stavby → { out, use, flow, f, light, slots: [stav], net }
export const live = new Map();
export const netInfo = new Map();      // číslo sítě → { prod, demand, stored, cap, f }

export function energyTick(dt = TICK, busy = () => false) {
  const s = game.s;
  const nets = networks();
  const t = gameTime();
  const sums = new Map();
  const sum = n => sums.get(n) || sums.set(n, { prod: 0, demand: 0, stored: 0, cap: 0, storages: [], loads: [], sinters: [] }).get(n);
  const degree = new Map();
  for (const [a, b] of s.cables || []) { degree.set(a, (degree.get(a) || 0) + 1); degree.set(b, (degree.get(b) || 0) + 1); }
  live.clear();
  netInfo.clear();
  // solární střecha (L-04): stojící vozidla se na Slunci pomalu dobíjejí
  s.vehicles.forEach((v, i) => {
    if (!(v.lv?.solar > 0) || busy(i)) return;
    const cap = batteryCap(v);
    if (cap > 0 && v.charge < cap) v.charge = Math.min(cap, v.charge + roofRest(v) * dt);
  });

  for (const b of s.buildings || []) {
    const e = STRUCTURES[b.type]?.energy;
    if (!e) continue;
    const n = nets.get(b.id);
    const S = sum(n);
    const L = { out: 0, use: 0, flow: 0, f: 1, light: 'dark', slots: null, net: n, wired: (degree.get(b.id) || 0) > 0 };
    live.set(b.id, L);
    if (e.role === 'source') {
      const o = sourceOutput(b, t);
      L.out = o.out; L.light = o.light;
      if (L.wired) S.prod += o.out;
    } else if (e.role === 'storage') {
      const cap = e.cap;
      b.data.charge = Math.max(0, Math.min(cap, b.data.charge || 0));
      S.stored += b.data.charge; S.cap += cap;
      if (L.wired) S.storages.push({ b, e, L });
    } else if (b.type === 'charger') {
      const n2 = Math.min(4, b.data.slots || 1);
      L.slots = [];
      for (let k = 0; k < n2; k++) {
        const i = vehicleOnSlot(b, k, busy);
        const v = s.vehicles[i];
        const need = v ? batteryCap(v) - v.charge : 0;
        L.slots.push({ i, state: i < 0 ? 'free' : need <= 0.01 ? 'full' : 'charging', want: need > 0.01 ? Math.min(slotRate(b), need / dt) : 0 });
      }
      const want = L.slots.reduce((x, sl) => x + sl.want, 0);
      if (L.wired && want > 0) { S.demand += want; S.loads.push({ b, L, want }); }
      else if (!L.wired) L.slots.forEach(sl => { if (sl.state === 'charging') sl.state = 'short'; });
    } else if (b.type === 'swapper') {
      // výměník (L-09): vozidlo stojí uprostřed → jeřáb vymění baterii za nabitou z regálu; regál se nabíjí 15 ⚡/s na baterii
      const d = b.data, n = Math.min(4, Math.max(2, d.slots || 2));
      d.rack = Array.from({ length: n }, (_, k) => { const x = Number(d.rack?.[k] ?? 0); return x < 0 ? -1 : Math.min(1, x || 0); });   // −1 = odnesl dron
      if (d.swap) {
        const v = s.vehicles[d.swap.i];
        if (!v || v.uid !== d.swap.uid || busy(d.swap.i)) d.swap = null;               // odjel dřív → nic se nevyměnilo
        else if (hostNow() - d.swap.at >= SWAP.dur * 1000) {
          const cap = batteryCap(v);
          d.rack[d.swap.k] = cap ? Math.max(0, v.charge) / cap : 1;                     // vybitá jde do regálu (univerzální)
          v.charge = cap;
          swapEvents.push(d.swap.i);
          d.swap = null;
        }
      }
      L.waiting = false;
      if (!d.swap) {
        const i = vehicleOnBay(b, busy), v = s.vehicles[i];
        const cap = v ? batteryCap(v) : 0;
        if (v && cap && v.charge < cap * 0.95) {
          let k = -1;
          d.rack.forEach((x, j) => { if (x >= 0.999 && (k < 0 || x > d.rack[k])) k = j; });
          if (k >= 0) d.swap = { i, uid: v.uid, at: hostNow(), k };
          else L.waiting = true;                                                          // v regálu není nabitá baterie
        }
      }
      const need = d.rack.map((x, k) => (k === d.swap?.k || x < 0 || x >= 1 ? 0 : Math.min(SWAP.rate, (1 - x) * SWAP.cap / dt)));
      // dronport (3.1, L-62): nabíjející se dron bere 8 ⚡/s
      const dp = d.dp?.n > 0 ? d.dp : null;
      const drones = dp ? dp.dr.map((x, k) => (k < dp.n && x.st === 'charging' ? STRUCTURES.swapper.dronport.power : 0)) : null;
      const want = need.reduce((a, x) => a + x, 0) + (drones || []).reduce((a, x) => a + x, 0);
      L.rack = d.rack; L.need = need; L.f = want ? 0 : 1;
      if (L.wired && want > 0) { S.demand += want; S.loads.push({ b, L, want, rack: need, drones }); }
    } else if (b.type === 'sinter') {
      // slinovna (L-23): 15 ⚡/s (4. 11.), jen když má prach a místo na cihly. 4. 11.: bez prachu nebere nic a ani
      // nejede (pend – energii dostane až v další bilanci); s prachem jede jen na plný výkon (viz níže, S.sinters)
      const want = sinterWants(b) ? SINTER.power : 0;
      L.f = 0; L.pend = !want;
      if (L.wired && want > 0) S.sinters.push({ b, L, want });
      else b.data.on = false;
    } else if (b.type === 'laac') {
      // LAAC (3.1, L-64): plošiny nabíjí letouny 25 ⚡/s přívodem z věže; sloty = plošiny v pořadí b.data.pads (jako nabíječka)
      const rate = STRUCTURES.laac.chargeRate;
      L.slots = laacParts(b).filter(x => x.kind === 'pad').map(pp => {
        const i = s.vehicles.findIndex((v, j) => isAirType(v.type) && !busy(j) && angleBetween(v.p, pp.p) * R < 2 * pp.scale + 0.5);
        const v = s.vehicles[i];
        const need = v ? batteryCap(v) - v.charge : 0;
        return { i, side: pp.side, state: i < 0 ? 'free' : need <= 0.01 ? 'full' : 'charging', want: need > 0.01 ? Math.min(rate, need / dt) : 0 };
      });
      const want = L.slots.reduce((x, sl) => x + sl.want, 0);
      if (L.wired && want > 0) { S.demand += want; S.loads.push({ b, L, want }); }
      else if (!L.wired) L.slots.forEach(sl => { if (sl.state === 'charging') sl.state = 'short'; });
    } else if (b.type === 'research') {
      // výzkumné centrum: 5 ⚡/s jen během výzkumu (L-30); bez kabelu f = 0 → výzkum stojí
      const want = researching() ? RESEARCH_POWER : 0;
      L.f = want ? 0 : 1;
      if (L.wired && want > 0) { S.demand += want; S.loads.push({ b, L, want }); }
    }
  }

  for (const [n, S] of sums) {
    // Slinovny (4. 11.) mají nejnižší přednost a jedou jen na plný výkon: dřív při malé výrobě lisovaly třeba na 17 %,
    // snědly celou výrobu solárů a baterie se nenabíjela. Teď slinovna, na kterou nezbývá celých 15 ⚡/s (výroba po
    // ostatních spotřebičích + co smí dát baterie), stojí a přebytek nabíjí baterie. Znovu se rozjede, až výroba sama
    // stačí, nebo baterie mají zásobu aspoň na SINTER.reserve s práce (30 s × 15 ⚡ = 450 ⚡).
    if (S.sinters.length) {
      let budget = (S.prod - S.demand) * dt + S.storages.reduce((a, x) => a + Math.min(x.e.rate * dt, x.b.data.charge), 0);
      let spare = S.prod - S.demand;
      let stored = S.storages.reduce((a, x) => a + x.b.data.charge, 0);
      for (const sn of S.sinters) {
        const need = sn.want * dt;
        const start = sn.b.data.on || spare >= sn.want || stored >= sn.want * SINTER.reserve;
        if (start && budget >= need - 1e-6) {
          budget -= need; spare -= sn.want; stored -= Math.max(0, need - Math.max(0, spare + sn.want) * dt);
          S.demand += sn.want; S.loads.push(sn); sn.b.data.on = true;
        } else { sn.b.data.on = false; sn.L.starved = true; }
      }
    }
    let f = 1;
    if (S.prod >= S.demand) {
      // přebytek do baterií: rovnoměrně podle volné kapacity, omezeno nabíjecím výkonem
      let surplus = S.prod - S.demand;
      const free = S.storages.map(x => ({ x, room: Math.min(x.e.rate * dt, x.e.cap - x.b.data.charge) }));
      const total = free.reduce((a, y) => a + y.room, 0);
      if (total > 0) for (const y of free) {
        const add = Math.min(y.room, surplus * dt * y.room / total);
        y.x.b.data.charge += add;
        y.x.L.flow = add / dt;
      }
    } else {
      // schodek z baterií, a když nestačí, spotřebiče dostanou poměrný díl
      const deficit = (S.demand - S.prod) * dt;
      const can = S.storages.map(x => ({ x, give: Math.min(x.e.rate * dt, x.b.data.charge) }));
      const total = can.reduce((a, y) => a + y.give, 0);
      const take = Math.min(deficit, total);
      if (total > 0) for (const y of can) {
        const sub = take * y.give / total;
        y.x.b.data.charge -= sub;
        y.x.L.flow = -sub / dt;
      }
      f = S.demand > 0 ? (S.prod * dt + take) / (S.demand * dt) : 1;
    }
    S.f = Math.max(0, Math.min(1, f));
    // nabíjení vozidel
    for (const ld of S.loads) {
      ld.L.f = S.f;
      ld.L.use = ld.want * S.f;
      if (ld.rack) ld.rack.forEach((w, k) => { if (w > 0) ld.b.data.rack[k] = Math.min(1, ld.b.data.rack[k] + w * S.f * dt / SWAP.cap); });
      if (ld.drones) ld.drones.forEach((w, k) => {                    // dron: zbývající čas nabíjení ubývá podle dodané energie
        const x = ld.b.data.dp?.dr?.[k];
        if (!(w > 0) || x?.st !== 'charging') return;
        x.chg = Math.max(0, (x.chg || 0) - S.f * dt);
        if (x.chg <= 0) { x.st = 'ready'; x.chg = 0; }
      });
      for (const sl of ld.L.slots || []) {
        if (sl.want <= 0) continue;
        const v = s.vehicles[sl.i];
        v.charge = Math.min(batteryCap(v), v.charge + sl.want * S.f * dt);
        if (S.f < 0.98) sl.state = 'short';
      }
    }
    netInfo.set(n, { prod: S.prod, demand: S.demand, stored: S.storages.reduce((a, x) => a + x.b.data.charge, 0), cap: S.storages.reduce((a, x) => a + x.e.cap, 0), f: S.f });
  }
}

// Stav pro klienta (hostitel posílá v H.pw): [[id, nabití ⚡ (baterie) | výkon×10 (zdroj), slot stavy…], …]
const SLOT_CODE = { free: 0, charging: 1, full: 2, short: 3 };
const SLOT_NAME = ['free', 'charging', 'full', 'short'];
const LIGHT_CODE = { dark: 0, low: 1, full: 2 };
const LIGHT_NAME = ['dark', 'low', 'full'];
// Souhrn celé soustavy pro HUD (panel ⚡ In / Out): výroba všech zapojených zdrojů a skutečně dodaná spotřeba
// spotřebičů v ⚡/s, ze živých hodnot (hostitel je počítá, klient je má z H.pw). null = žádná energetická stavba.
// stored / cap = energie uložená ve všech postavených bateriových úložištích (i nezapojených) a jejich kapacita.
export function energyTotals() {
  let prod = 0, use = 0, stored = 0, cap = 0, any = false;
  for (const b of game.s.buildings || []) {
    const e = STRUCTURES[b.type]?.energy;
    if (!e || e.role === 'node') continue;
    any = true;
    if (e.role === 'storage') { stored += Math.max(0, b.data?.charge || 0); cap += e.cap || 0; }
    const L = live.get(b.id);
    if (!L?.wired) continue;
    if (e.role === 'source') prod += L.out || 0;
    else if (e.role === 'load') use += L.use || 0;
  }
  return any ? { prod, use, stored, cap } : null;
}

export function encodeLive() {
  const out = [];
  for (const b of game.s.buildings || []) {
    const L = live.get(b.id);
    if (!L) continue;
    const role = STRUCTURES[b.type].energy.role;
    if (role === 'storage') out.push([b.id, Math.round(b.data.charge || 0), Math.round(L.flow)]);
    else if (role === 'source') out.push([b.id, Math.round(L.out * 10), LIGHT_CODE[L.light]]);
    else if (L.slots) out.push([b.id, Math.round(L.f * 100), Math.round(L.use * 10), ...L.slots.map(sl => SLOT_CODE[sl.state])]);
    else if (b.type === 'research' || b.type === 'sinter') out.push([b.id, Math.round(L.f * 100), Math.round(L.use * 10)]);
    else if (b.type === 'swapper') out.push([b.id, Math.round(L.f * 100), Math.round(L.use * 10), L.waiting ? 1 : 0, ...(b.data.rack || []).map(x => Math.round(x * 100))]);
  }
  return out;
}
// Klient: živé hodnoty od hostitele (sítě si spočítá sám z kabelů).
export function applyLive(list) {
  const s = game.s;
  const nets = networks();
  const degree = new Map();
  for (const [a, b] of s.cables || []) { degree.set(a, (degree.get(a) || 0) + 1); degree.set(b, (degree.get(b) || 0) + 1); }
  live.clear();
  for (const e of Array.isArray(list) ? list : []) {
    const b = structureById(String(e[0]));
    if (!b || !STRUCTURES[b.type]?.energy) continue;
    const role = STRUCTURES[b.type].energy.role;
    const L = { out: 0, use: 0, flow: 0, f: 1, light: 'dark', slots: null, net: nets.get(b.id), wired: (degree.get(b.id) || 0) > 0 };
    if (role === 'storage') { b.data.charge = e[1] | 0; L.flow = e[2] | 0; }
    else if (role === 'source') { L.out = (e[1] | 0) / 10; L.light = LIGHT_NAME[e[2] | 0] || 'dark'; }
    else if (b.type === 'research' || b.type === 'sinter') { L.f = (e[1] | 0) / 100; L.use = (e[2] | 0) / 10; }
    else if (b.type === 'swapper') { L.f = (e[1] | 0) / 100; L.use = (e[2] | 0) / 10; L.waiting = !!e[3]; b.data.rack = e.slice(4).map(x => (x | 0) / 100); L.rack = b.data.rack; }
    else { L.f = (e[1] | 0) / 100; L.use = (e[2] | 0) / 10; L.slots = e.slice(3).map(c => ({ i: -1, state: SLOT_NAME[c] || 'free', want: 0 })); }
    live.set(b.id, L);
  }
}

// ---------- směr toku v kabelech (zobrazení) ----------
// Z živých hodnot: zdroj dodává (out), baterie dodává při vybíjení / bere při nabíjení (flow), spotřebiče berou (use).
// Každý dodavatel pošle každému odběrateli poměrný díl po nejkratší cestě sítí (BFS); na kabelu se sčítá tok
// v obou směrech zvlášť. Výsledek pro kabel s.cables[k]: 1 = od c[0] k c[1], −1 = opačně, 2 = oběma směry, 0 = nic.
const FLOW_MIN = 0.05;                       // ⚡/s – menší tok se nekreslí
export function cableFlows() {
  const s = game.s, cables = s.cables || [];
  const adj = new Map();
  cables.forEach(([a, b], k) => {
    (adj.get(a) || adj.set(a, []).get(a)).push([b, k, 1]);
    (adj.get(b) || adj.set(b, []).get(b)).push([a, k, -1]);
  });
  const inj = new Map();
  for (const b of s.buildings || []) {
    const L = live.get(b.id), e = STRUCTURES[b.type]?.energy;
    if (!L || !e || !L.wired) continue;
    const x = e.role === 'source' ? L.out : e.role === 'storage' ? -(L.flow || 0) : e.role === 'load' ? -(L.use || 0) : 0;
    if (Math.abs(x) > FLOW_MIN) inj.set(b.id, x);
  }
  const fwd = new Float64Array(cables.length), back = new Float64Array(cables.length);
  // sítě zvlášť: dodavatelé a odběratelé ve stejné síti
  const byNet = new Map();
  for (const [id, x] of inj) {
    const n = live.get(id).net;
    const g = byNet.get(n) || byNet.set(n, { src: [], dst: [], total: 0 }).get(n);
    if (x > 0) { g.src.push([id, x]); g.total += x; } else g.dst.push([id, -x]);
  }
  for (const g of byNet.values()) {
    if (!g.src.length || !g.dst.length || g.total <= 0) continue;
    for (const [sid, sx] of g.src) {
      // BFS od dodavatele: předchozí kabel ke každému uzlu
      const prev = new Map([[sid, null]]);
      const q = [sid];
      for (let h = 0; h < q.length; h++) for (const [nb, k, dir] of adj.get(q[h]) || []) if (!prev.has(nb)) { prev.set(nb, [q[h], k, dir]); q.push(nb); }
      for (const [did, dx] of g.dst) {
        const amount = sx * dx / g.total;
        let cur = did;
        while (prev.get(cur)) {                       // zpět od odběratele k dodavateli
          const [from, k, dir] = prev.get(cur);
          if (dir > 0) fwd[k] += amount; else back[k] += amount;
          cur = from;
        }
      }
    }
  }
  return cables.map((_, k) => (fwd[k] > FLOW_MIN && back[k] > FLOW_MIN ? 2 : fwd[k] > FLOW_MIN ? 1 : back[k] > FLOW_MIN ? -1 : 0));
}

// ---------- pro HUD a hlášky ----------

// Nejbližší nabíječka s volným slotem (směr) pro šipku pod 20 % baterie.
export function nearestCharger(p) {
  let best = null, bestD = Infinity;
  for (const b of game.s.buildings || []) {
    if (b.type !== 'charger') continue;
    const d = angleBetween(p, b.p);
    if (d < bestD) { bestD = d; best = b; }
  }
  if (!best) return null;
  const [x, z] = STRUCTURES.charger.slots[0];
  return { b: best, dir: localToDir(best.p, best.yaw, x, z), dist: bestD * R };
}

// Popis stavby pro štítek po najetí (D-01, D-02, D-03).
export function describe(b) {
  const def = STRUCTURES[b.type];
  const e = def?.energy;
  const fmt0 = v => Math.round(v).toLocaleString('cs-CZ');
  if (b.type === 'depot') {
    const st = b.data.store || 0;
    return `Depo · ${fmt0(st)} / ${fmt0(DEPOT.cap)} kg${st >= DEPOT.cap ? ' · PLNÉ' : ''}${beltAt([b.id, 'out']) ? '' : ' · bez výstupního pásu'}`;
  }
  if (!e) return null;
  const L = live.get(b.id);
  if (b.type === 'sinter') {
    const st = { work: 'pracuje', idle: 'čeká na prach', full: 'výstup ucpaný', power: 'málo energie' }[b.data.state || 'idle'];
    return `Slinovna · ${st} · prach ${fmt0(b.data.hopper || 0)} / ${SINTER.hopper} kg · cihly ${b.data.out | 0} / ${SINTER.outCap}${L?.wired ? '' : ' · bez kabelu'}`;
  }
  const wired = L?.wired;
  const fmt = v => Math.round(v).toLocaleString('cs-CZ');
  if (e.role === 'storage') {
    const pct = Math.round((b.data.charge || 0) / e.cap * 100);
    const arrow = (L?.flow || 0) > 0.5 ? ' ▲' : (L?.flow || 0) < -0.5 ? ' ▼' : '';
    return `${def.name} · ${pct} % · ${fmt(b.data.charge || 0)} / ${fmt(e.cap)} ⚡${arrow}${wired ? '' : ' · bez kabelu'}`;
  }
  if (e.role === 'source') return `${def.name} · ${(L?.out || 0).toFixed(1).replace('.', ',')} / ${e.out} ⚡/s${wired ? '' : ' · bez kabelu – vyrábí do prázdna'}`;
  if (b.type === 'charger') {
    const n = b.data.slots || 1;
    const st = (L?.slots || []).map(x => ({ free: 'volno', charging: 'nabíjí', full: 'nabito', short: 'málo energie' }[x.state])).join(' · ');
    return `${def.name} · ${n} ${n === 1 ? 'slot' : n < 5 ? 'sloty' : 'slotů'} · ${slotRate(b)} ⚡/s${st ? ` · ${st}` : ''}${wired ? '' : ' · bez kabelu'}`;
  }
  if (b.type === 'laac') {                                            // LAAC (3.1): plošiny nabíjí letouny
    const sl = L?.slots || [];
    const ch = sl.filter(x => x.state === 'charging' || x.state === 'short').length, full = sl.filter(x => x.state === 'full').length;
    const np = (b.data.pads || []).length;
    return `${def.name} · ${np} ${np === 1 ? 'plošina' : np < 5 ? 'plošiny' : 'plošin'} · ${STRUCTURES.laac.chargeRate} ⚡/s na plošinu${ch ? ` · nabíjí ${ch}` : ''}${full ? ` · nabito ${full}` : ''}${wired ? '' : ' · bez kabelu – plošiny nenabíjí'}`;
  }
  if (b.type === 'swapper') {
    const rack = b.data.rack || [];
    const full = rack.filter(x => x >= 0.999).length;
    const eta = swapperEta(b);
    const tail = b.data.swap ? ' · vyměňuje…' : full ? '' : eta == null ? ' · žádná nabitá – bez energie' : ` · nabitá za ${Math.ceil(eta)} s`;
    const dp = b.data.dp?.n > 0 ? b.data.dp : null;
    const drones = dp ? ` · ${dp.n === 1 ? 'dron' : 'drony'}: ${dp.dr.slice(0, dp.n).map(x => (x.st === 'ready' ? 'připraven' : x.st === 'out' ? 'letí' : `nabíjí ${Math.ceil(x.chg || 0)} s`)).join(', ')}` : '';
    return `${def.name} · regál ${full} / ${rack.length} nabité${tail}${drones}${wired ? '' : ' · bez kabelu'}`;
  }
  if (b.type === 'research') {
    const pr = researchProgress();
    if (!pr) return `${def.name} · nic se nevyvíjí${wired ? '' : ' · bez kabelu'}`;
    const f = L?.f ?? 0;
    return `${def.name} · ${pr.tech.name} ${Math.round(pr.k * 100)} %${!wired ? ' · bez kabelu – stojí' : f < 0.98 ? ` · málo energie (${Math.round(f * 100)} %)` : ` · ${RESEARCH_POWER} ⚡/s`}`;
  }
  if (b.type === 'pole') return `${def.name} · ${cablesOf(b.id).length} / ${MAX_CABLES.pole} kabelů`;
  return def.name;
}
