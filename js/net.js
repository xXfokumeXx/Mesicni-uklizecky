// Multiplayer – co nejjednodušší řešení, které funguje přímo v artefaktu na claude.ai.
//
// Stavební kameny (schopnosti artefaktu):
//  • room  = všichni, kdo mají stránku právě otevřenou. Každý hráč má „presence“ – jeden malý
//            objekt (max 4 KiB), který platforma rozesílá ostatním ~30× za s.
//  • join(název) = pojmenovaná místnost pro jeden svět („svet-abc12“).
//  • db    = trvalé úložiště; hostitel do něj zapíše mapu prachu pro nově příchozí.
//
// Role:
//  • HOSTITEL (kdo svět založil) je autorita: drží peníze, garáž, flotilu, stanice a roboty,
//    ukládá svět do svého slotu. Sdílený stav vysílá ve své presence v lobby (pole H, 4× za s).
//  • HRÁČ posílá ve své presence ve světě: pozici a animaci, posledních 32 tahů koštětem,
//    poslední zprávy chatu, kolik celkem vydělal (e), žádosti o nákup (b) a kam zaparkoval vozidlo (pk).
//  • Všichni aplikují tahy ostatních na svou mapu prachu → vidí změny v reálném čase.
//  • Peníze jsou společné: výdělky hráčů přičítá hostitel, nákupy schvaluje hostitel (ack).
//  • Čas: všichni počítají denní dobu z hodin počítače + posunu hostitele → stejná denní doba.
//
// Vše jde přes presence (ne přes události), takže hrát může i pozvaný hráč s právem jen ke čtení.
import { MOON, HEX_BONUS, PRICE_PER_KG } from './config.js';
import { game, newGame, addStat } from './state.js';
import { profile, sanitizeName, validLook } from './profile.js';
import { strokes, exitVehicle, riding, remapRide, playerFx } from './player.js';
import { hexes, sweepCapsule, clearHex } from './planet/dustmap.js';
import { grid, cellDir } from './planet/hexgrid.js';
import { norm, cross, anyTangent, dot, tangentTo } from './planet/vec.js';
import { VEHICLES, STATION, DRONE } from './catalog.js';
import { packDust, unpackDust, toBase64, fromBase64 } from './storage.js';
import { buildGarage, buyVehicle, upgradeVehicle, callBackVehicle, sellVehicle } from './equipment.js';
import { placeStation, moveStation } from './robots.js';
import { placeDepot, buildBelt, depositToDepot, beltLoad } from './depots.js';
import { buyDrone } from './drones.js';
import { ensureHotbar } from './hotbar.js';
import { connectPlatform } from './platform/platform.js';

const R = MOON.radius;
const PART = 200000;                       // znaků base64 v jednom dokumentu db (limit 256 KiB)
const enc = v => [Math.round(v[0] * 1e6), Math.round(v[1] * 1e6), Math.round(v[2] * 1e6)];
const encF = v => [Math.round(v[0] * 1e3), Math.round(v[1] * 1e3), Math.round(v[2] * 1e3)];
const decU = (a, o = 0) => norm([a[o] / 1e6, a[o + 1] / 1e6, a[o + 2] / 1e6]);
const decF = (a, o = 0) => norm([a[o] / 1e3, a[o + 1] / 1e3, a[o + 2] / 1e3]);
const isNum = x => typeof x === 'number' && Number.isFinite(x);
const okVec = (a, o, n = 3) => Array.isArray(a) && a.length >= o + n && a.slice(o, o + n).every(isNum);
const cleanText = s => String(s || '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '').slice(0, 140);

export const net = {
  room: null,               // lobby (všichni na stránce); false = multiplayer nedostupný
  error: '',                // proč multiplayer nejde (pro menu)
  kind: null,               // 'artifact' | 'firebase'
  world: null,              // pojmenovaná místnost světa
  db: null,
  me: null,                 // můj „peer“ (označení této karty)
  mode: 'off',              // 'off' | 'host' | 'client'
  code: null,
  hostPeer: null,
  ready: false,             // klient: mapa přenesená a stav převzatý
  remotes: new Map(),       // peer → vzdálený hráč
  lobbyStatus: 'menu',
  onLobby: null,            // změna lobby (pro menu)
  onChat: null,             // ({ name, color, text, system }) → chat
  onHostLeft: null,
  onState: null,            // klient: přišel nový sdílený stav
};

// ---------- lobby ----------

let connecting = null;
export function initLobby() {
  if (net.room !== null) return Promise.resolve(net.room);
  connecting ||= connect();
  return connecting;
}

async function connect() {
  const p = await connectPlatform();
  if (!p?.room) {
    net.room = false;
    net.error = p?.error || 'Multiplayer tu není dostupný.';
    return false;
  }
  net.room = p.room;
  net.db = p.db || null;
  net.kind = p.kind;
  if (p.me) net.me = p.me;
  net.room.onPeers(ch => {
    for (const p of ch.peers) if (p.isMe && p.sameTab) net.me = p.peer;
    if (net.mode === 'client') watchHost();
    net.onLobby?.();
  }, () => { net.onLobby?.(); });
  setLobby({});
  return net.room;
}

export const roomOnline = () => !!net.room && net.room.connected();

function setLobby(extra) {
  if (!net.room) return;
  net.room.presence({ v: 2, scr: net.lobbyStatus, n: profile.name, a: lookArr(), w: net.code, ...extra }).catch(() => {});
}

export function setLobbyStatus(scr) {
  net.lobbyStatus = scr;
  setLobby({});
}

const lookArr = () => [profile.look.color, profile.look.top, profile.look.face];

// Lidé na stránce: [{ peer, name, look, scr, world, me, hosting }]
export function lobbyPeers() {
  if (!net.room) return [];
  return net.room.peers()
    .filter(p => p.kind === 'viewer' && p.presence?.v === 2)
    .map(p => ({
      peer: p.peer,
      name: sanitizeName(p.presence.n) || 'Astronaut',
      look: validLook({ color: p.presence.a?.[0], top: p.presence.a?.[1], face: p.presence.a?.[2] }),
      scr: p.presence.scr,
      world: typeof p.presence.w === 'string' ? p.presence.w : null,
      me: p.isMe && p.sameTab,
      hosting: !!p.presence.H,
      guest: p.guest,
    }));
}

// Otevřené světy: [{ code, title, hostPeer, hostName, players }]
// Soukromé světy (pub = 0) se v seznamu neukazují – připojí se k nim jen ten, kdo zná kód.
export function openWorlds(includePrivate = false) {
  if (!net.room) return [];
  return net.room.peers()
    .filter(p => p.presence?.v === 2 && p.presence.H && /^[a-z0-9]{3,12}$/.test(p.presence.H.code || ''))
    .filter(p => includePrivate || p.presence.H.pub !== 0)
    .map(p => ({
      code: p.presence.H.code,
      title: cleanText(p.presence.H.t).slice(0, 40) || 'Svět',
      hostPeer: p.peer,
      hostName: sanitizeName(p.presence.n) || 'Hostitel',
      players: p.presence.H.pl | 0,
      me: p.isMe && p.sameTab,
    }));
}

// Svět podle kódu (i soukromý).
export const findWorld = code => openWorlds(true).find(w => w.code === String(code || '').toLowerCase().trim()) || null;

// Odkaz pro kamarády: adresa hry + #kód světa.
export const inviteLink = () => (net.code ? `${location.origin}${location.pathname}#${net.code}` : '');

const hostPresence = () => net.room?.peers().find(p => p.peer === net.hostPeer)?.presence?.H || null;

// ---------- společné: světová presence ----------

const sent = {};                      // naposledy odeslané hodnoty polí (JSON)
const chatOut = [];                   // moje poslední zprávy [[seq, text]]
let chatSeq = 0;
let earned = 0;                       // klient: kolik jsem celkem vydělal (přičte hostitel)
const requests = [];                  // klient: [[id, druh, argumenty, cena]]
const pending = new Map();            // id → { resolve, t }
let parkReport = null;                // klient: [seq, i, ...pozice, ...směr, náplň]
let parkSeq = 0;
let ragdollEnc = null;
let kgTotal = 0;                      // klient: kolik kg prachu jsem celkem nasbíral (pro statistiky)
const deposits = [];                  // klient: kolik kg jsem celkem vysypal do depa i

// Klíč hráče pro statistiky: uid přihlášení (stejný prohlížeč) + jméno postavy.
const uidOf = peer => String(peer || '').split('_')[0];
export const myStatKey = () => `${net.me ? uidOf(net.me) : 'me'}|${profile.name}`;
const statKeyOf = r => `${uidOf(r.peer)}|${r.name}`;

export function setRagdollPresence(arr) { ragdollEnc = arr; }

function myWorldPresence(fx, vehicleSpeed) {
  const s = game.s;
  const b = fx.body;
  return {
    v: 2,
    n: profile.name,
    a: lookArr(),
    p: enc(s.p),
    r: Math.round((b ? b.r : R) * 100),
    f: encF(s.f),
    m: [Math.round(fx.speed * 10), Math.round(fx.alt * 100), Math.round(fx.vr * 10), fx.swept ? 1 : 0, fx.airborne ? 1 : 0],
    d: s.driving,
    vs: s.driving >= 0 ? Math.round(vehicleSpeed * 10) : 0,
    tl: s.tool,
    tw: Math.round(fx.toolWidth * 100),
    s: strokes.list.map(k => [k.seq, ...enc(k.p), Math.round(k.w * 100), k.pw, k.cont ? 1 : 0]),
    c: chatOut,
    e: Math.round(earned * 100) / 100,
    kg: Math.round(kgTotal * 10) / 10,
    dk: deposits.length ? Array.from(deposits, x => Math.round((x || 0) * 10) / 10) : null,
    b: requests,
    pk: parkReport,
    g: ragdollEnc,
    rd: riding() ? [riding().i, riding().seat] : null,        // cestující v přepravníku [vozidlo, sedadlo]
    jp: s.jetpack ? (performance.now() - playerFx.jet < 700 ? 2 : 1) : 0,   // jetpack: 1 = na zádech, 2 = právě hoří
  };
}

let presenceTimer = 0;
function pushWorldPresence(fx, vehicleSpeed) {
  const full = myWorldPresence(fx, vehicleSpeed);
  const patch = {};
  let any = false;
  for (const k in full) {
    const j = JSON.stringify(full[k] ?? null);
    if (sent[k] !== j) { sent[k] = j; patch[k] = full[k] ?? null; any = true; }
  }
  if (any) net.world.presence(patch).catch(() => {});
}

// ---------- vzdálení hráči ----------

function remoteOf(peer) {
  let r = net.remotes.get(peer);
  if (!r) {
    r = {
      peer, name: 'Astronaut', look: validLook(null), announced: false,
      p: null, r: R, f: [0, 1, 0], m: [0, 0, 0, 0, 0], d: -1, vs: 0,
      sp: null, sr: R,                               // vyhlazená poloha pro vykreslení
      lastSeq: 0, lastPt: null, buffer: [],          // tahy koštětem
      chatSeq: -1, e: 0, pk: null, done: new Set(), rag: null, updated: 0,
      tool: 'toothbrush', tw: 30, rd: null, jp: 0,
    };
    net.remotes.set(peer, r);
  }
  return r;
}

function readRemote(peer, pr) {
  const r = remoteOf(peer);
  if (!pr || pr.v !== 2) return r;
  r.name = sanitizeName(pr.n) || r.name;
  r.look = validLook({ color: pr.a?.[0], top: pr.a?.[1], face: pr.a?.[2] });
  if (okVec(pr.p, 0)) r.p = decU(pr.p);
  if (isNum(pr.r)) r.r = Math.min(R + 400, Math.max(R - 60, pr.r / 100));
  if (okVec(pr.f, 0)) r.f = decF(pr.f);
  if (okVec(pr.m, 0, 5)) r.m = pr.m;
  r.d = Number.isInteger(pr.d) ? pr.d : -1;
  r.vs = isNum(pr.vs) ? pr.vs / 10 : 0;
  r.tool = typeof pr.tl === 'string' ? pr.tl : r.tool;
  r.tw = isNum(pr.tw) ? pr.tw : r.tw;
  r.rag = Array.isArray(pr.g) ? pr.g : null;
  r.rd = okVec(pr.rd, 0, 2) && Number.isInteger(pr.rd[0]) && Number.isInteger(pr.rd[1]) ? [pr.rd[0], pr.rd[1]] : null;
  r.jp = pr.jp | 0;
  if (!r.sp && r.p) { r.sp = r.p.slice(); r.sr = r.r; }
  r.updated = performance.now();
  if (!r.announced && pr.n) {
    r.announced = true;
    net.onChat?.({ system: true, text: `${r.name} se připojil(a) do světa.` });
  }
  return r;
}

// Tahy koštětem jiného hráče → na mou mapu prachu (bez peněz – ty dostal on).
function takeStrokes(r, list, apply) {
  if (!Array.isArray(list)) return;
  for (const k of list) {
    if (!okVec(k, 0, 7) || k[0] <= r.lastSeq) continue;
    if (!apply) {                                    // klient čeká na mapu: uložit na později
      if (!r.buffer.some(b => b[0] === k[0])) r.buffer.push(k);
      if (r.buffer.length > 400) r.buffer.shift();
      continue;
    }
    sweepStroke(r, k);
  }
}

function sweepStroke(r, k) {
  const p = decU(k, 1);
  const w = Math.min(8, Math.max(0.1, k[4] / 100));
  const pw = Math.min(200, Math.max(1, k[5] | 0));
  const from = k[6] && r.lastPt && r.lastSeqPt === k[0] - 1 ? r.lastPt : p;
  sweepCapsule(from, p, w / 2, pw, 1e12);
  r.lastPt = p;
  r.lastSeqPt = k[0];
  r.lastSeq = Math.max(r.lastSeq, k[0]);
}

function readChat(r, list) {
  if (!Array.isArray(list)) return;
  for (const c of list) {
    if (!Array.isArray(c) || !isNum(c[0]) || c[0] <= r.chatSeq) continue;
    r.chatSeq = c[0];
    const text = cleanText(c[1]);
    if (text) net.onChat?.({ name: r.name, color: r.look.color, text });
  }
}

function onWorldPeers(ch) {
  const joined = new Set(ch.joined.map(p => p.peer));
  for (const p of ch.peers) {
    if (p.isMe && p.sameTab) { net.me = p.peer; continue; }
    if (p.kind !== 'viewer') continue;
    const r = readRemote(p.peer, p.presence);
    const fresh = joined.has(p.peer) && r.chatSeq < 0;
    if (fresh) r.chatSeq = 0;                        // poslední zprávy od nově viděného hráče ukázat
    readChat(r, p.presence?.c);
    takeStrokes(r, p.presence?.s, net.mode === 'host' || net.ready);
    if (net.mode === 'host') hostReadPeer(r, p.presence || {});
  }
  for (const p of ch.left) {
    const r = net.remotes.get(p.peer);
    if (r) net.onChat?.({ system: true, text: `${r.name} odešel(a).` });
    net.remotes.delete(p.peer);
    if (p.peer === net.hostPeer && net.mode === 'client') net.onHostLeft?.();
  }
  if (net.mode === 'host' && ch.joined.some(p => !(p.isMe && p.sameTab))) scheduleSnapshot();
}

// Vyhlazení pohybu vzdálených hráčů (volá se každý snímek).
function smoothRemotes(dt) {
  const k = 1 - Math.exp(-dt * 12);
  for (const r of net.remotes.values()) {
    if (!r.p) continue;
    if (!r.sp) { r.sp = r.p.slice(); r.sr = r.r; continue; }
    const far = dot(r.sp, r.p) < Math.cos(15 / R);   // skok o víc než 15 m → přesunout hned
    if (far) { r.sp = r.p.slice(); r.sr = r.r; continue; }
    r.sp = norm([r.sp[0] + (r.p[0] - r.sp[0]) * k, r.sp[1] + (r.p[1] - r.sp[1]) * k, r.sp[2] + (r.p[2] - r.sp[2]) * k]);
    r.sr += (r.r - r.sr) * k;
  }
}

// Vozidlo, které řídí jiný hráč → poloha z jeho presence.
export function vehicleOverride(i) {
  for (const r of net.remotes.values()) {
    if (r.d === i && r.sp) return { p: r.sp, r: r.sr, f: r.f, speed: Math.abs(r.vs), peer: r.peer };
  }
  return null;
}

export function vehicleTakenBy(i) {
  for (const r of net.remotes.values()) if (r.d === i) return r.name;
  return null;
}

// Sedadla cestujících ve vozidle i, která má někdo obsazená (Set čísel sedadel; i moje).
export function seatsTaken(i) {
  const set = new Set();
  for (const r of net.remotes.values()) if (r.rd && r.rd[0] === i) set.add(r.rd[1]);
  const me = riding();
  if (me && me.i === i) set.add(me.seat);
  return set;
}
// Cestující ve vozidle i (vzdálení hráči) – pro úspěch „Plný autobus“.
export const passengersOf = i => [...net.remotes.values()].filter(r => r.rd && r.rd[0] === i);

// Vozidla v pohybu (pro srážky): [{ pos, radius, vel, speed }]
export function movingVehicles(radiusOf) {
  const out = [];
  for (const r of net.remotes.values()) {
    if (r.d < 0 || !r.sp || Math.abs(r.vs) < 1.5) continue;
    const pos = [r.sp[0] * r.sr, r.sp[1] * r.sr, r.sp[2] * r.sr];
    const dir = tangentTo(r.sp, r.f);
    const v = r.vs;
    out.push({ pos, radius: radiusOf(r.d), vel: [dir[0] * v, dir[1] * v, dir[2] * v], speed: Math.abs(v) });
  }
  return out;
}

export function players() {
  const list = [{ name: profile.name, color: profile.look.color, me: true, host: net.mode === 'host', stats: statsFor(myStatKey()) }];
  for (const r of net.remotes.values()) {
    list.push({ name: r.name, color: r.look.color, me: false, host: r.peer === net.hostPeer, stats: statsFor(statKeyOf(r)) });
  }
  return list;
}

// Statistiky hráče { kg, e, sp }: hostitel je drží v uložené hře, připojený hráč je dostává v H.ps.
function statsFor(key) {
  if (net.mode === 'host') {
    const st = game.s.pstats?.[key];
    return st ? { kg: st.kg || 0, e: st.e || 0, sp: st.sp || 0 } : { kg: 0, e: 0, sp: 0 };
  }
  const row = Array.isArray(lastH?.ps) ? lastH.ps.find(x => Array.isArray(x) && x[0] === key) : null;
  return row ? { kg: Number(row[2]) || 0, e: Number(row[3]) || 0, sp: Number(row[4]) || 0 } : { kg: 0, e: 0, sp: 0 };
}

// ---------- chat ----------

export function sendChat(text) {
  const t = cleanText(text).trim();
  if (!t || !net.world) return false;
  chatSeq++;
  chatOut.push([chatSeq, t]);
  if (chatOut.length > 4) chatOut.shift();
  net.onChat?.({ name: profile.name, color: profile.look.color, text: t, me: true });
  return true;
}

// ---------- HOSTITEL ----------

const host = {
  rc: [], rcBase: 1,          // dočištěné hexy od robotů [hex] (sekvence od rcBase)
  acks: [],                   // [[id, ok]]
  ep: {},                     // peer → přijatý součet výdělků
  kp: {},                     // peer → přijatý součet nasbíraných kg
  dk: {},                     // peer → přijaté součty vysypaného prachu po depech
  sv: 0,                      // verze snímku mapy v db
  applied: {},                // peer → poslední aplikovaný tah (pro snímek)
  lastPk: {},
  timer: 0, snapTimer: null, snapping: false,
};

export async function startHost() {
  const s = game.s;
  if (!net.room) return false;
  s.netCode = s.netCode || Math.random().toString(36).slice(2, 7).replace(/[^a-z0-9]/g, 'x').padEnd(5, '0');
  net.code = s.netCode;
  net.mode = 'host';
  net.lobbyStatus = 'game';
  try {
    net.world = await net.room.join('svet-' + net.code);
  } catch {
    net.mode = 'off';
    return false;
  }
  net.world.onPeers(onWorldPeers);
  net.me = net.me || net.room.peers().find(p => p.isMe && p.sameTab)?.peer || null;
  net.hostPeer = net.me;
  pushHostState();
  return true;
}

// Hostitel: robot dočistil hexy → oznámit ostatním.
export function hostRobotCompleted(cells) {
  if (net.mode !== 'host') return;
  for (const c of cells) host.rc.push(c);
  while (host.rc.length > 40) { host.rc.shift(); host.rcBase++; }
}

function hostReadPeer(r, pr) {
  const s = game.s;
  const key = statKeyOf(r);
  // výdělky (součet od připojení)
  if (isNum(pr.e) && pr.e >= 0) {
    const before = host.ep[r.peer] || 0;
    if (pr.e > before) {
      const add = Math.min(pr.e - before, 1e7);
      s.money += add;
      addStat(key, r.name, 'e', add);
      host.ep[r.peer] = pr.e;
    }
  }
  // nasbíraný prach (jen statistika)
  if (isNum(pr.kg) && pr.kg > (host.kp[r.peer] || 0)) {
    addStat(key, r.name, 'kg', Math.min(pr.kg - (host.kp[r.peer] || 0), 1e7));
    host.kp[r.peer] = pr.kg;
  }
  // prach vysypaný do dep (prodá se, až ho pás doveze do Výkupu; do statistiky se připíše hned)
  if (Array.isArray(pr.dk)) {
    const seen = host.dk[r.peer] || (host.dk[r.peer] = []);
    pr.dk.forEach((kg, i) => {
      if (!isNum(kg) || kg <= (seen[i] || 0)) return;
      const add = Math.min(kg - (seen[i] || 0), 1e7);
      seen[i] = kg;
      if (depositToDepot(i, add)) addStat(key, r.name, 'e', add * PRICE_PER_KG);
    });
  }
  // žádosti o nákup
  if (Array.isArray(pr.b)) {
    for (const q of pr.b) {
      if (!Array.isArray(q) || typeof q[0] !== 'string' || r.done.has(q[0])) continue;
      r.done.add(q[0]);
      const before = s.money;
      const ok = hostRequest(q[1], Array.isArray(q[2]) ? q[2] : [], Number(q[3]) || 0, r);
      if (s.money < before) addStat(key, r.name, 'sp', before - s.money);
      else if (s.money > before) addStat(key, r.name, 'e', s.money - before);    // prodej vozidla
      host.acks.push([q[0].slice(0, 12), ok ? 1 : 0]);
      if (host.acks.length > 24) host.acks.shift();
    }
  }
  // zaparkované (nebo přivolané) vozidlo
  const pk = pr.pk;
  if (okVec(pk, 0, 9) && pk[0] !== host.lastPk[r.peer]) {
    host.lastPk[r.peer] = pk[0];
    const v = s.vehicles[pk[1]];
    if (v && s.driving !== pk[1] && !vehicleTakenBy(pk[1])) {
      v.p = decU(pk, 2);
      v.f = decF(pk, 5);
      v.load = Math.max(0, pk[8] / 10);
      v.moved = true;
    }
  }
  host.applied[r.peer] = r.lastSeq;
}

function hostRequest(kind, a, cost, r) {
  const s = game.s;
  switch (kind) {
    case 'tool': case 'tup': case 'boots': case 'gbelt': case 'jet':
      if (!(cost >= 0) || s.money < cost) return false;
      s.money -= cost;
      return true;
    case 'garage': return buildGarage();
    case 'veh': return buyVehicle(String(a[0]));
    case 'vup': return upgradeVehicle(a[0] | 0, String(a[1]));
    case 'st': return okVec(a, 0) ? placeStation(decU(a)) : false;
    case 'stmove': return okVec(a, 1) ? moveStation(a[0] | 0, decU(a, 1)) : false;
    case 'call': return !vehicleTakenBy(a[0] | 0) && callBackVehicle(a[0] | 0);
    case 'vsell': return s.driving !== (a[0] | 0) && !vehicleTakenBy(a[0] | 0) && !seatsTaken(a[0] | 0).size && vehicleUid(a[0] | 0) === String(a[1]) && sellVehicle(a[0] | 0);
    case 'dep': return okVec(a, 0) ? placeDepot(decU(a)) : false;
    case 'belt': return buildBelt(a[0] | 0, Number.isInteger(a[1]) ? a[1] : -1);
    case 'drone': return buyDrone();
    default: return false;
  }
}

// Prodej se potvrzuje i podle uid, aby se po posunu indexů neprodalo jiné vozidlo.
const vehicleUid = i => game.s.vehicles[i]?.uid || '';

function botEnc(st) {
  const c = cellDir(st.hex), e1 = anyTangent(c), e2 = cross(c, e1);
  const d = st.robot.p;
  return [Math.round(dot(d, e1) * R * 10), Math.round(dot(d, e2) * R * 10), st.robot.mode === 'work' ? 1 : 0];
}

function hostState() {
  const s = game.s;
  return {
    code: net.code,
    pub: s.netPublic === false ? 0 : 1,
    t: cleanText(s.title).slice(0, 40),
    pl: 1 + net.remotes.size,
    m: Math.round(s.money * 100) / 100,
    wp: Math.round(s.warp || 0),
    ts: Date.now(),
    g: s.garage ? 1 : 0,
    won: s.won ? 1 : 0,
    v: s.vehicles.map((v, i) => [VEHICLES.findIndex(x => x.id === v.type), v.lv.width, v.lv.speed, v.spot ?? i, ...enc(v.p), ...encF(v.f), Math.round(v.load * 10), v.uid || '', v.lv.boost | 0]),
    st: s.stations.map(st => st.hex),
    b: s.stations.map(botEnc),
    dr: s.drones.map(d => [...enc(d.p), d.mode === 'work' ? 1 : 0]),
    dp: s.depots.map(d => [d.hex, Math.round(d.store), d.belt ? 1 : 0, Math.round(beltLoad(d)), d.to ?? -1]),
    ps: presentStats(),
    rc: [host.rcBase, ...host.rc],
    ack: host.acks,
    ep: host.ep,
    sv: host.sv,
  };
}

// Statistiky hráčů, kteří jsou právě ve světě: [[klíč, jméno, kg, vyděláno, utraceno]].
function presentStats() {
  const ps = game.s.pstats || {};
  const keys = [myStatKey(), ...[...net.remotes.values()].map(statKeyOf)];
  return [...new Set(keys)].filter(k => ps[k]).map(k => {
    const st = ps[k];
    return [k, cleanText(st.n).slice(0, 16), Math.round(st.kg || 0), Math.round(st.e || 0), Math.round(st.sp || 0)];
  });
}

function pushHostState() {
  setLobby({ scr: 'game', w: net.code, H: hostState() });
}

function scheduleSnapshot() {
  clearTimeout(host.snapTimer);
  host.snapTimer = setTimeout(writeSnapshot, 1200);
}

// Snímek mapy prachu do db pro nově příchozí hráče.
async function writeSnapshot() {
  if (!net.db || net.mode !== 'host') return;
  if (host.snapping) { scheduleSnapshot(); return; }
  host.snapping = true;
  try {
    const sv = host.sv + 1;
    const seqs = { ...host.applied, [net.me]: strokes.seq };
    const rc = host.rcBase + host.rc.length - 1;
    const packed = await packDust();
    const b64 = toBase64(packed.bytes);
    const parts = Math.max(1, Math.ceil(b64.length / PART));
    for (let i = 0; i < parts; i++) {
      await net.db.doc(`worlds/${net.code}/parts/p${i}`).set({ sv, d: b64.slice(i * PART, (i + 1) * PART) });
    }
    await net.db.doc(`worlds/${net.code}`).set({ sv, parts, gz: packed.gz, seqs, rc, at: Date.now() });
    host.sv = sv;
    pushHostState();
  } catch (e) {
    console.warn('Snímek mapy se nepodařilo zapsat', e);
  } finally {
    host.snapping = false;
  }
}

// ---------- KLIENT ----------

let lastH = null;
let lastRc = 0;
const vehSig = [];                      // podpis polohy vozidel z H (aby se poloha přepsala jen při změně)
const botPrev = [];
const dronePrev = [];

// Připojí se ke světu: počká na snímek mapy od hostitele, převezme stav. Vrací text chyby nebo null.
export async function joinWorld(w, onStatus) {
  if (!net.room) return 'Multiplayer tu není dostupný.';
  net.mode = 'client';
  net.code = w.code;
  net.hostPeer = w.hostPeer;
  net.lobbyStatus = 'game';
  const joinSv = hostPresence()?.sv || 0;
  try {
    net.world = await net.room.join('svet-' + w.code);
  } catch {
    return 'Do světa se nepodařilo připojit. Zkus to znovu.';
  }
  net.world.onPeers(onWorldPeers);
  setLobby({ scr: 'game', w: w.code });
  newGame('Multiplayer');
  loadPersonal();
  pushWorldPresence({ speed: 0, alt: 0, vr: 0, swept: 0, airborne: 0, toolWidth: 0.3, body: null }, 0);

  onStatus?.('Čekám na mapu od hostitele…');
  const t0 = Date.now();
  let H = null;
  while (Date.now() - t0 < 20000) {
    H = hostPresence();
    if (!H && Date.now() - t0 > 5000) return 'Hostitel světa už není online.';
    if (H && H.sv > joinSv) break;
    await new Promise(r => setTimeout(r, 250));
  }
  let snap = null;
  if (H && H.sv > joinSv && net.db) {
    onStatus?.('Stahuji mapu Měsíce…');
    try {
      const head = (await net.db.doc(`worlds/${w.code}`).get()).data();
      if (head && head.sv >= H.sv) {
        let b64 = '';
        for (let i = 0; i < head.parts; i++) {
          const part = (await net.db.doc(`worlds/${w.code}/parts/p${i}`).get()).data();
          if (!part || part.sv !== head.sv) throw new Error('part');
          b64 += part.d;
        }
        if (await unpackDust({ gz: !!head.gz, bytes: fromBase64(b64) })) snap = head;
      }
    } catch (e) {
      console.warn('Snímek mapy se nepodařilo načíst', e);
    }
  }
  // tahy, které přišly během čekání a nejsou ve snímku
  const seqs = snap?.seqs || {};
  for (const r of net.remotes.values()) {
    r.buffer.sort((a, b) => a[0] - b[0]);
    const from = seqs[r.peer] ?? 0;
    for (const k of r.buffer) if (k[0] > from) sweepStroke(r, k);
    r.buffer = [];
  }
  lastRc = snap ? snap.rc : 0;
  net.ready = true;
  if (H) applyHostState(H);
  return snap || !net.db ? null : 'nomap';
}

function watchHost() {
  const H = hostPresence();
  if (!H) return;
  if (H !== lastH && net.ready) applyHostState(H);
}

function applyHostState(H) {
  lastH = H;
  const s = game.s;
  if (isNum(H.m)) s.money = H.m + Math.max(0, earned - (Number(H.ep?.[net.me]) || 0));
  if (isNum(H.wp)) s.warp = H.wp;
  if (isNum(H.ts)) {
    const off = H.ts - Date.now();
    game.clockOffset = Math.abs(off - game.clockOffset) > 3000 ? off : game.clockOffset + (off - game.clockOffset) * 0.1;
  }
  s.garage = !!H.g;
  s.won = !!H.won;
  if (typeof H.t === 'string') s.title = cleanText(H.t).slice(0, 40);

  // flotila (Firebase prázdné pole neuloží → chybějící H.v = žádná vozidla, třeba po prodeji posledního)
  const hv = Array.isArray(H.v) ? H.v : [];
  {
    syncFleet(s, hv);
    hv.forEach((e, i) => {
      if (!okVec(e, 0, 11) || !VEHICLES[e[0]]) return;
      let v = s.vehicles[i];
      if (!v) {
        v = { type: VEHICLES[e[0]].id, spot: e[3], p: decU(e, 4), f: decF(e, 7), load: e[10] / 10, lv: { width: e[1], speed: e[2], boost: e[12] | 0 }, moved: true };
        s.vehicles[i] = v;
        vehSig[i] = '';
      }
      v.type = VEHICLES[e[0]].id;
      v.lv = { width: e[1] | 0, speed: e[2] | 0, boost: e[12] | 0 };
      v.spot = e[3];
      if (s.driving === i) return;                   // řídím ho já → poloha je moje
      const sig = e.slice(4, 11).join(',');
      if (sig !== vehSig[i]) {
        vehSig[i] = sig;
        v.p = decU(e, 4);
        v.f = decF(e, 7);
        v.load = e[10] / 10;
        v.moved = true;
      }
    });
  }

  // stanice a roboti (roboty simuluje hostitel; tady jen poloha a „vizuální“ zametání)
  if (Array.isArray(H.st)) {
    H.st.forEach((hex, i) => {
      if (!Number.isInteger(hex) || hex < 0 || hex >= grid.cells) return;
      if (!s.stations[i] || s.stations[i].hex !== hex) {     // nová, nebo přesunutá stanice
        const home = cellDir(hex);
        s.stations[i] = { hex, robot: { p: home, t: home, hex: -1, k: -1, load: 0, mode: 'idle' } };
        botPrev[i] = null;
      }
      const st = s.stations[i], b = H.b?.[i];
      if (!okVec(b, 0)) return;
      const c = cellDir(st.hex), e1 = anyTangent(c), e2 = cross(c, e1);
      const p = norm([c[0] + (e1[0] * b[0] + e2[0] * b[1]) / 10 / R, c[1] + (e1[1] * b[0] + e2[1] * b[1]) / 10 / R, c[2] + (e1[2] * b[0] + e2[2] * b[1]) / 10 / R]);
      const prev = botPrev[i] || p;
      if (b[2] === 1 && dot(prev, p) > Math.cos(4 / R)) sweepCapsule(prev, p, STATION.width / 2, STATION.power * 3, 1e12);
      botPrev[i] = p;
      st.robot.t = dot(prev, p) < 0.9999999999 ? norm([p[0] * 2 - prev[0], p[1] * 2 - prev[1], p[2] * 2 - prev[2]]) : st.robot.t;
      st.robot.p = p;
      st.robot.mode = b[2] === 1 ? 'work' : 'idle';
    });
  }

  // UFO drony: [poloha ×3, čistí]; ve „vizuální“ mapě prachu zametají jako roboti
  // (Firebase prázdné pole neuloží → chybějící H.dr = žádné drony)
  const hd = Array.isArray(H.dr) ? H.dr : [];
  s.drones.length = Math.min(s.drones.length, hd.length);
  hd.forEach((e, i) => {
    if (!okVec(e, 0, 4)) return;
    const p = decU(e);
    const dr = s.drones[i] || (s.drones[i] = { p, t: p, hex: -1, k: -1, load: 0, mode: 'idle' });
    const prev = dronePrev[i] || p;
    const work = e[3] === 1;
    if (work && dot(prev, p) > Math.cos(6 / R)) sweepCapsule(prev, p, DRONE.width / 2, DRONE.power * 3, 1e12);
    dronePrev[i] = p;
    if (dot(prev, p) < 0.9999999999) dr.t = norm([p[0] * 2 - prev[0], p[1] * 2 - prev[1], p[2] * 2 - prev[2]]);
    dr.p = p;
    dr.mode = work ? 'work' : 'fly';
  });

  // depa a pásy: [hex, sklad kg, pás, kg na pásu, cíl pásu (hex depa, −1 = Výkup)]
  if (Array.isArray(H.dp)) {
    s.depots = H.dp
      .filter(e => okVec(e, 0, 4) && Number.isInteger(e[0]) && e[0] >= 0 && e[0] < grid.cells)
      .map((e, i) => {
        const d = s.depots[i]?.hex === e[0] ? s.depots[i] : { hex: e[0], transit: [] };
        d.store = Math.max(0, e[1]);
        d.belt = !!e[2];
        d.tk = Math.max(0, e[3]);
        d.to = Number.isInteger(e[4]) ? e[4] : -1;
        return d;
      });
  }

  // hexy dočištěné roboty
  if (Array.isArray(H.rc) && H.rc.length) {
    const base = H.rc[0] | 0;
    for (let k = 1; k < H.rc.length; k++) {
      const seq = base + k - 1, hex = H.rc[k];
      if (seq <= lastRc) continue;
      lastRc = seq;
      if (Number.isInteger(hex) && hex >= 0 && hex < grid.cells && !hexes.done[hex]) clearHex(hex);
    }
  }

  // potvrzení nákupů
  if (Array.isArray(H.ack)) {
    for (const [id, ok] of H.ack) {
      const p = pending.get(id);
      if (!p) continue;
      pending.delete(id);
      const i = requests.findIndex(q => q[0] === id);
      if (i >= 0) requests.splice(i, 1);
      p.resolve(!!ok);
    }
  }
  net.onState?.();
}

// Flotila od hostitele podle uid vozidel: po prodeji se indexy posunou, takže se pole postaví znovu
// (existující vozidla se zachovají) a vozidlo, ve kterém sedím, dostane nový index.
function syncFleet(s, list) {
  const uids = list.map(e => (Array.isArray(e) ? String(e[11] ?? '') : ''));
  if (uids.length === s.vehicles.length && uids.every((u, i) => (s.vehicles[i]?.uid || '') === u)) return;
  const old = new Map(s.vehicles.filter(v => v?.uid).map(v => [v.uid, v]));
  const drivenUid = s.driving >= 0 ? s.vehicles[s.driving]?.uid : null;
  if (s.driving >= 0 && !(drivenUid && uids.includes(drivenUid))) exitVehicle();   // vozidlo zmizelo
  s.vehicles = list.map((e, i) => {
    let v = uids[i] && old.get(uids[i]);
    if (!v) {
      if (!okVec(e, 0, 11) || !VEHICLES[e[0]]) return null;
      v = { type: VEHICLES[e[0]].id, spot: e[3], p: decU(e, 4), f: decF(e, 7), load: e[10] / 10, lv: { width: e[1], speed: e[2], boost: e[12] | 0 } };
    }
    v.uid = uids[i];
    v.moved = true;
    return v;
  }).filter(Boolean);
  if (drivenUid && s.driving >= 0) s.driving = s.vehicles.findIndex(v => v.uid === drivenUid);
  remapRide();                                       // cestující: přepravník má nový index, nebo zmizel
  vehSig.length = 0;
}

// Žádost o nákup za společné peníze. Vrací Promise<boolean>.
export function request(kind, args, cost) {
  const id = (net.me || 'x').slice(0, 4) + Math.random().toString(36).slice(2, 8);
  requests.push([id, kind, args, cost]);
  if (requests.length > 6) requests.shift();
  return new Promise(resolve => {
    pending.set(id, { resolve, t: Date.now() });
    setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      resolve(false);
    }, 10000);
  });
}

export const hasPending = () => pending.size > 0;

export function addEarned(amount) {
  if (amount > 0) earned += amount;
}

// Klient: nasbíraný prach (statistika) a náklad vysypaný do depa (hostitel ho přidá do skladu).
export function addCollected(kg) {
  if (kg > 0) kgTotal += kg;
}
export function reportDeposit(i, kg) {
  if (!(kg > 0) || i < 0) return;
  while (deposits.length <= i) deposits.push(0);
  deposits[i] += kg;
}

// Klient vystoupil z vozidla → nahlásit, kde stojí.
export function reportParked(i) {
  const v = game.s.vehicles[i];
  if (!v) return;
  parkSeq++;
  parkReport = [parkSeq, i, ...enc(v.p), ...encF(v.f), Math.round(v.load * 10)];
}

// Osobní postup klienta v cizím světě (nástroje, boty, poloha) – v prohlížeči hráče.
const personalKey = () => `ms2_mp_${net.code}`;
export function savePersonal() {
  if (net.mode !== 'client' || !game.s) return;
  const s = game.s;
  try {
    localStorage.setItem(personalKey(), JSON.stringify({
      tools: s.tools, tool: s.tool, boots: s.boots, belt: s.belt, jetpack: s.jetpack, hotbar: s.hotbar, sel: s.sel, p: s.p, f: s.f,
    }));
  } catch { /* nic */ }
}
function loadPersonal() {
  try {
    const d = JSON.parse(localStorage.getItem(personalKey()));
    if (!d) return;
    const s = game.s;
    if (d.tools && typeof d.tools === 'object') s.tools = d.tools;
    if (d.tool && s.tools[d.tool]) s.tool = d.tool;
    s.boots = Math.min(3, Math.max(0, d.boots | 0));
    s.belt = Math.min(2, Math.max(0, d.belt | 0));
    s.jetpack = d.jetpack ? 1 : 0;
    s.hotbar = Array.isArray(d.hotbar) ? d.hotbar : [s.tool];
    s.sel = d.sel | 0;
    if (okVec(d.p, 0) && okVec(d.f, 0)) { s.p = norm(d.p); s.f = tangentTo(s.p, d.f); }
  } catch { /* nic */ }
  ensureHotbar(game.s);
}

// ---------- každý snímek ----------

export function netTick(dt, fx, vehicleSpeed) {
  if (!net.world) return;
  smoothRemotes(dt);
  presenceTimer -= dt;
  if (presenceTimer <= 0) {
    presenceTimer = 1 / 12;
    pushWorldPresence(fx, vehicleSpeed);
  }
  if (net.mode === 'host') {
    host.timer -= dt;
    if (host.timer <= 0) { host.timer = 0.25; pushHostState(); }
  }
}

export const isClient = () => net.mode === 'client';
export const isOnline = () => net.mode !== 'off';
export { HEX_BONUS };
