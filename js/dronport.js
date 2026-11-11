// Dronport výměníku a dronová donáška baterií (3.1: L-62, D-14). Bez three.js – scéna je scene/dronesView.js.
//
// Data: výměník b.data.dp = { n: počet dronů (1–2), dr: [{ st: 'ready' | 'charging' | 'out', chg: s nabíjení zbývá, m: let }] }.
// Let (m) simuluje jen hostitel / hráč sám (dronesTick). Klient dostane lety v H.dn 2× za s a mezi pakety je
// posouvá sám stejným pohybem (predictTick) – fáze mění jen hostitel.
//
// Fáze letu: load (vezme nabitou baterii z regálu) → up (svisle na 25 m nad terén) → go (20 m/s k vozidlu, drží výšku
// nad terénem) → hover (3 m nad střechou, čeká, až vozidlo zastaví) → swap (4 s výměna) → ret (zpět) → down (přistání)
// → unload (vybitá do regálu) → dron se nabíjí 10 s + 2 s / 50 m letu (nejvýš 60 s), 8 ⚡/s ze sítě (energy.js).
import { game, UPGRADES } from './state.js';
import { MOON } from './config.js';
import { STRUCTURES, localToDir, heightRange, structureById, hasResearch } from './structures.js';
import { batteryCap } from './catalog.js';
import { heightAt, terrainVersion } from './planet/height.js';
import { angleBetween, norm, madd, tangentTo, dot, cross } from './planet/vec.js';
import { hostNow, swapperEta, live } from './energy.js';

const R = MOON.radius;

export const DRONE = {
  range: 450,            // m vzdušnou čarou od výměníku (rozhodnutí 1; 10. 11. hráč změnil 600 → 450)
  cruise: 25,            // m nad terénem při letu
  speed: 20,             // m/s vodorovně
  climb: 6,              // m/s svisle
  above: 3,              // m nad střechou vozidla při výměně
  swap: 4,               // s výměny
  load: 1.5, unload: 1.5, // s nabrání / vrácení baterie na dronportu
  still: 0.5,            // vozidlo musí stát (pod 0,5 m/s) aspoň 0,5 s
  stillSpeed: 0.5,
  power: 8,              // ⚡/s při nabíjení dronu
  chargeBase: 10, chargePer50: 2, chargeMax: 60,
  research: 'droneDelivery',
};
export const PHASES = ['load', 'up', 'go', 'hover', 'swap', 'ret', 'down', 'unload'];

// Napojení na zbytek hry (main.js): poloha a rychlost vozidla (řízené kýmkoli), výška střechy podle typu.
let hooks = { vehicle: i => { const v = game.s.vehicles[i]; return v ? { p: v.p, speed: 0 } : null; }, roof: () => 1.8 };
export function setDroneHooks(h) { hooks = { ...hooks, ...h }; }

// ---------- dronport na výměníku ----------
export const dronportOf = b => (b?.type === 'swapper' && b.data?.dp?.n > 0 ? b.data.dp : null);
export const hasDronport = b => !!dronportOf(b);
export const dronportsInWorld = () => (game.s.buildings || []).some(hasDronport);

// Výška počátku modelu výměníku (m nad poloměrem) – stejně jako scene/structures.js place(); cache podle terénu
const baseCache = new WeakMap();
export function swapperBase(b) {
  const tv = terrainVersion(), c = baseCache.get(b);
  if (c && c.tv === tv && c.p === b.p && c.yaw === b.yaw) return c.h;
  const def = STRUCTURES.swapper;
  const h = heightRange(b.p, b.yaw, def.pad)[1] + 0.03 - (def.padTop || 0);
  baseCache.set(b, { tv, p: b.p, yaw: b.yaw, h });
  return h;
}
// Místo přistání dronu k: { p: směr, h: výška nad poloměrem }
export function padOf(b, k) {
  const D = STRUCTURES.swapper.dronport, [px, py, pz] = D.pads[k];
  return { p: localToDir(b.p, b.yaw, D.at[0] + px, D.at[2] + pz), h: swapperBase(b) + D.at[1] + py };
}

// Načtení uložené hry: dron uložený za letu je zpět na dronportu (nabíjí se), baterie v regálu (L-69: bez stavu letu).
UPGRADES.push(s => {
  for (const b of s.buildings || []) {
    if (b.type !== 'swapper' || !b.data) continue;
    const dp = b.data.dp;
    const rack = Array.isArray(b.data.rack) ? b.data.rack : [];
    if (dp) {
      dp.n = Math.max(0, Math.min(2, dp.n | 0));
      dp.dr = Array.from({ length: dp.n }, (_, k) => dp.dr?.[k] || { st: 'ready', chg: 0 });
      for (const d of dp.dr) {
        if (d.st === 'out' && d.m) {
          const k = d.m.rk;
          if (k >= 0 && k < rack.length) rack[k] = d.m.carry === 'full' ? 1 : Math.max(0, Math.min(0.99, Number(d.m.bat) || 0));
        }
        if (d.st === 'out') { d.st = 'charging'; d.chg = DRONE.chargeBase; }
        if (!['ready', 'charging'].includes(d.st)) d.st = 'ready';
        d.chg = Math.max(0, Math.min(DRONE.chargeMax, Number(d.chg) || 0));
        d.m = null;
      }
      if (!dp.n) delete b.data.dp;
    }
    rack.forEach((x, k) => { if (x < 0) rack[k] = 0; });       // místo bez dronu na cestě → vybitá baterie
  }
});

// ---------- objednávka ----------
// Kam (který výměník, dron a baterie) by šel dron k vozidlu i. { ok, reason, b, k, rk }
export function droneOffer(i) {
  const s = game.s, v = s.vehicles[i];
  if (!hasResearch(DRONE.research)) return { ok: false, reason: 'Chybí výzkum „Dronová donáška“' };
  if (!v || !batteryCap(v)) return { ok: false, reason: 'Ruční vozík nemá baterii' };
  if (v.charge >= batteryCap(v) * 0.98) return { ok: false, reason: 'Baterie je plná' };
  const at = hooks.vehicle(i)?.p || v.p;
  const list = (s.buildings || []).filter(b => hasDronport(b) && angleBetween(b.p, at) * R <= DRONE.range)
    .sort((a, b) => angleBetween(a.p, at) - angleBetween(b.p, at));
  if (!list.length) return { ok: false, reason: `Žádný výměník s dronem do ${DRONE.range} m` };
  let why = null;
  for (const b of list) {
    const dp = b.data.dp;
    const k = dp.dr.findIndex((d, j) => j < dp.n && d.st === 'ready');
    const rack = b.data.rack || [];
    let rk = -1;
    rack.forEach((x, j) => { if (x >= 0.999 && (rk < 0 || x > rack[rk])) rk = j; });
    if (k >= 0 && rk >= 0) return { ok: true, reason: '', b, k, rk };
    if (k < 0) {
      const ch = dp.dr.slice(0, dp.n).filter(d => d.st === 'charging');
      if (ch.length) {
        const f = live.get(b.id)?.wired ? (live.get(b.id)?.f ?? 0) : 0;
        const left = Math.min(...ch.map(d => d.chg));
        why ||= f > 0.01 ? `Dron se nabíjí (ještě ${Math.max(1, Math.ceil(left / f))} s)` : 'Dron se nenabíjí – výměník je bez energie';
      } else why ||= 'Dron je na cestě';
    } else {
      const eta = swapperEta(b);
      why ||= eta == null ? 'Ve výměníku není nabitá baterie (bez energie)' : `Ve výměníku není nabitá baterie (za ${Math.max(1, Math.ceil(eta))} s)`;
    }
  }
  return { ok: false, reason: why };
}

// Let k vozidlu i (hostitel i klient – klient z H.dn): { b, k, m } nebo null
export function missionFor(i) {
  const uid = game.s.vehicles[i]?.uid;
  for (const x of allMissions()) if (x.m.v === i && (!uid || !x.m.uid || x.m.uid === uid)) return x;
  return null;
}
export function allMissions() {
  if (clientMode) return [...clientMissions.values()];
  const out = [];
  for (const b of game.s.buildings || []) {
    const dp = dronportOf(b);
    if (dp) dp.dr.forEach((d, k) => { if (d.st === 'out' && d.m) out.push({ b, k, m: d.m }); });
  }
  return out;
}

// Hostitel / sám: objednat (on = true) nebo zrušit (on = false) dron k vozidlu i. true = provedeno.
export function orderDrone(i, on = true) {
  const cur = missionFor(i);
  if (!on) {
    if (!cur || cur.m.ph === 'swap' || cur.m.carry !== 'full' || cur.m.cancel) return false;
    cur.m.cancel = true;
    return true;
  }
  if (cur) return false;
  const o = droneOffer(i);
  if (!o.ok) return false;
  const v = game.s.vehicles[i], d = o.b.data.dp.dr[o.k], pad = padOf(o.b, o.k);
  o.b.data.rack[o.rk] = -1;                                     // baterie odešla z regálu (místo čeká na vybitou)
  d.st = 'out';
  d.m = { v: i, uid: v.uid, ph: 'load', at: hostNow(), p: pad.p.slice(), h: pad.h, f: tangentTo(pad.p, localToDir(o.b.p, o.b.yaw, 0, 1)), dist: 0, carry: 'full', bat: 0, rk: o.rk, still: 0, eta: 0 };
  return true;
}

// ---------- let ----------
const events = [];                                   // { kind: 'done' | 'away', v } – main.js → hláška
export const takeDroneEvents = () => events.splice(0);

const cruiseAlt = (p, f) => Math.max(heightAt(p), heightAt(norm(madd(p, f, 40 / R)))) + DRONE.cruise;
// Krok k cíli: vodorovně po velké kružnici, svisle k výšce alt. Vrací zbývající vodorovnou vzdálenost (m).
function fly(m, to, alt, dt, speed = DRONE.speed) {
  const d = angleBetween(m.p, to) * R;
  if (d > 0.01) {
    const dir = tangentTo(m.p, madd(to, m.p, -dot(to, m.p)));
    const step = Math.min(d, speed * dt);
    m.p = norm(madd(m.p, dir, step / R));
    m.dist += step;
    if (d > 0.5) m.f = tangentTo(m.p, madd(m.f, dir, Math.min(1, dt * 4)));   // natočení po směru letu (plynule)
    else m.f = tangentTo(m.p, m.f);
  }
  const dh = alt - m.h;
  m.h += Math.sign(dh) * Math.min(Math.abs(dh), DRONE.climb * dt);
  return Math.max(0, d - speed * dt);
}
const vehicleTop = (i, at) => heightAt(at) + hooks.roof(game.s.vehicles[i]?.type);

// Jeden krok letu. predict = klient (jen pohyb, fáze mění hostitel).
function stepMission(b, k, m, dt, predict) {
  const s = game.s, now = hostNow();
  const v = s.vehicles[m.v];
  const lv = v ? hooks.vehicle(m.v) : null;
  const pad = padOf(b, k);
  const since = (now - m.at) / 1000;
  const set = ph => { m.ph = ph; m.at = now; };
  // vozidlo zmizelo / odjelo z dosahu → zpět s nabitou
  if (!predict && m.carry === 'full' && m.ph !== 'swap' && !m.cancel) {
    if (!v || v.uid !== m.uid) m.cancel = true;
    else if (angleBetween(b.p, lv.p) * R > DRONE.range) { m.cancel = true; events.push({ kind: 'away', v: m.v }); }
  }
  if (!predict && m.cancel && m.carry === 'full' && ['load', 'up', 'go', 'hover'].includes(m.ph)) set(m.ph === 'load' ? 'unload' : 'ret');
  switch (m.ph) {
    case 'load':
      if (!predict && since >= DRONE.load) set('up');
      break;
    case 'up': {
      const alt = cruiseAlt(m.p, m.f);
      m.h = Math.min(alt, m.h + DRONE.climb * dt);
      if (!predict && m.h >= alt - 0.05) set('go');
      break;
    }
    case 'go': case 'hover': case 'swap': {
      if (!lv) break;
      const d = angleBetween(m.p, lv.p) * R;
      const top = vehicleTop(m.v, lv.p) + DRONE.above;
      // daleko: cestovní výška; posledních 30 m klesá k vozidlu
      const alt = m.ph === 'go' && d > 30 ? cruiseAlt(m.p, m.f) : Math.max(top, Math.min(m.h, cruiseAlt(m.p, m.f)) - (m.ph === 'go' ? (30 - d) : 99));
      fly(m, lv.p, alt, dt, m.ph === 'go' ? DRONE.speed : DRONE.speed * 1.25);
      if (m.ph !== 'go' && v?.f) m.f = tangentTo(m.p, madd(m.f, tangentTo(m.p, v.f), Math.min(1, dt * 3)));   // nad vozidlem natočený jako vozidlo
      m.eta = m.ph === 'go' ? d / DRONE.speed + Math.max(0, m.h - top) / DRONE.climb : 0;
      if (predict) break;
      if (m.ph === 'go' && d < 1.5) set('hover');
      else if (m.ph === 'hover') {
        if (d > 25) { set('go'); break; }
        m.still = (lv.speed ?? 0) < DRONE.stillSpeed ? m.still + dt : 0;
        if (m.still >= DRONE.still && d < 0.4 && Math.abs(m.h - top) < 0.25) set('swap');
      } else if (m.ph === 'swap') {
        if ((lv.speed ?? 0) >= DRONE.stillSpeed || !v || v.uid !== m.uid) { m.still = 0; set('hover'); break; }   // rozjel se → výměna znovu
        if (since >= DRONE.swap) {
          const cap = batteryCap(v);
          m.bat = cap ? Math.max(0, v.charge) / cap : 0;
          v.charge = cap;
          m.carry = 'empty';
          events.push({ kind: 'done', v: m.v });
          set('ret');
        }
      }
      break;
    }
    case 'ret': {
      const d = angleBetween(m.p, pad.p) * R;
      const alt = d > 25 ? cruiseAlt(m.p, m.f) : Math.max(pad.h + 4, Math.min(m.h, cruiseAlt(m.p, m.f)));
      if (m.h < alt - 2 && d > 25) m.h = Math.min(alt, m.h + DRONE.climb * dt);   // nejdřív nahoru, pak letí
      else fly(m, pad.p, alt, dt);
      m.eta = d / DRONE.speed;
      if (!predict && d < 0.3) set('down');
      break;
    }
    case 'down': {
      fly(m, pad.p, pad.h, dt, 3);
      m.f = tangentTo(m.p, madd(m.f, tangentTo(m.p, localToDir(b.p, b.yaw, 0, 1)), Math.min(1, dt * 3)));
      if (!predict && m.h <= pad.h + 0.02) { m.h = pad.h; set('unload'); }
      break;
    }
    case 'unload':
      m.p = pad.p.slice(); m.h = pad.h;
      if (!predict && since >= DRONE.unload) {
        const rack = b.data.rack || [];
        if (m.rk >= 0 && m.rk < rack.length) rack[m.rk] = m.carry === 'full' ? 1 : Math.max(0, Math.min(0.99, m.bat));
        const d = b.data.dp.dr[k];
        d.st = 'charging';
        d.chg = Math.min(DRONE.chargeMax, DRONE.chargeBase + DRONE.chargePer50 * m.dist / 50);
        d.m = null;
      }
      break;
  }
}

// Hostitel / sám: všechny lety (každý snímek). Nabíjení dronů je v energy.js (energyTick).
let clientMode = false;
export function dronesTick(dt) {
  clientMode = false;
  for (const b of game.s.buildings || []) {
    const dp = dronportOf(b);
    if (!dp) continue;
    dp.dr.forEach((d, k) => {
      if (d.st === 'out' && d.m) stepMission(b, k, d.m, dt, false);
      else if (d.st === 'out') { d.st = 'charging'; d.chg = DRONE.chargeBase; }   // rozbitý let → zpět na místě
    });
  }
}

// ---------- síť ----------
// Stav dronportů pro H.dp: [[id výměníku, n, kód dronu…]] – kód: 0 připravený, −1 letí, jinak s nabíjení (zaokrouhleno nahoru)
export function encodeDronports() {
  const out = [];
  for (const b of game.s.buildings || []) {
    const dp = dronportOf(b);
    if (dp) out.push([b.id, dp.n, ...dp.dr.slice(0, dp.n).map(d => (d.st === 'ready' ? 0 : d.st === 'out' ? -1 : Math.max(1, Math.ceil(d.chg || 0))))]);
  }
  return out;
}
export const dronportSig = () => encodeDronports().map(e => e[0] + ':' + e.slice(1).map(c => (c > 0 ? 'c' : c)).join(',')).join('|');
export function applyDronports(list) {
  const seen = new Set();
  for (const e of Array.isArray(list) ? list : []) {
    const b = structureById(String(e?.[0]));
    if (b?.type !== 'swapper') continue;
    const n = Math.max(1, Math.min(2, e[1] | 0));
    b.data.dp = { n, dr: Array.from({ length: n }, (_, k) => { const c = Number(e[2 + k]) || 0; return c === 0 ? { st: 'ready', chg: 0 } : c < 0 ? { st: 'out', chg: 0 } : { st: 'charging', chg: c }; }) };
    seen.add(b.id);
  }
  for (const b of game.s.buildings || []) if (b.type === 'swapper' && b.data?.dp && !seen.has(b.id)) delete b.data.dp;
}
// Lety pro H.dn (net.js je zakóduje): [{ id, k, m }]
export const missionsForNet = () => allMissions().map(({ b, k, m }) => ({ id: b.id, k, m }));

// Klient: lety od hostitele. list = [{ id, k, ph, p, h, f, v, uid, carry, at, eta }]
const clientMissions = new Map();
export function applyMissions(list) {
  clientMode = true;
  const seen = new Set();
  for (const x of list) {
    const b = structureById(x.id);
    if (b?.type !== 'swapper') continue;
    const key = `${x.id}:${x.k}`;
    seen.add(key);
    let c = clientMissions.get(key);
    if (!c) { c = { b, k: x.k, m: { ...x, dist: 0, still: 0 } }; clientMissions.set(key, c); continue; }
    c.b = b;
    const m = c.m, err = angleBetween(m.p, x.p) * R + Math.abs(m.h - x.h);
    Object.assign(m, { ph: x.ph, v: x.v, uid: x.uid, carry: x.carry, at: x.at, eta: x.eta });
    if (err > 25) { m.p = x.p; m.h = x.h; m.f = x.f; }
    else { m.p = norm(madd(m.p, madd(x.p, m.p, -1), 0.5)); m.h += (x.h - m.h) * 0.5; }   // hladká korekce
  }
  for (const key of clientMissions.keys()) if (!seen.has(key)) clientMissions.delete(key);
}
export function predictTick(dt) {
  clientMode = true;
  for (const { b, k, m } of clientMissions.values()) if (structureById(b.id)) stepMission(b, k, m, dt, true);
}
export function resetClientDrones() { clientMissions.clear(); clientMode = false; }

// ---------- texty pro HUD ----------
// Stav dronu k řízenému vozidlu: { text, eta, dir } nebo null (žádný let)
export function droneStatus(i) {
  const x = missionFor(i);
  if (!x) return null;
  const { m } = x;
  const lv = hooks.vehicle(i);
  if (m.carry !== 'full') return m.ph === 'ret' && (hostNow() - m.at) < 3000 ? { text: 'Baterie vyměněná – dron se vrací', m } : null;
  if (m.cancel || m.ph === 'ret' || m.ph === 'down' || m.ph === 'unload') return { text: 'Dron se vrací s baterií', m };
  if (m.ph === 'load') return { text: 'Dron bere baterii z regálu', m };
  if (m.ph === 'swap') return { text: `Výměna baterie… ${Math.max(1, Math.ceil(DRONE.swap - (hostNow() - m.at) / 1000))} s`, m };
  if (m.ph === 'hover') return { text: (lv?.speed ?? 0) >= DRONE.stillSpeed ? 'Zastav pro výměnu baterie' : 'Dron je nad tebou – stůj', m };
  const eta = Math.max(1, Math.ceil(m.eta + (m.ph === 'up' ? (cruiseAlt(m.p, m.f) - m.h) / DRONE.climb + angleBetween(m.p, lv?.p || m.p) * R / DRONE.speed : 0)));
  return { text: `Dron za ${eta} s`, eta, m, dir: m.p };
}
// Šipka směru k dronu vůči natočení vozidla (8 směrů)
export function arrowTo(from, f, to) {
  const t = tangentTo(from, madd(to, from, -dot(to, from)));
  const side = cross(from, f);
  const a = Math.atan2(dot(t, side), dot(t, f));                // 0 = vpředu, + = vlevo
  return ['↑', '↖', '←', '↙', '↓', '↘', '→', '↗'][((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
}

// Pro scénu: poloha a rychlost vozidla, výška střechy (stejné jako pro let)
export const droneVehicle = i => hooks.vehicle(i);
export const vehicleRoof = type => hooks.roof(type);
