// Multiplayer – co nejjednodušší řešení, které funguje přímo v artefaktu na claude.ai.
//
// Stavební kameny (schopnosti artefaktu):
//  • room  = všichni, kdo mají stránku právě otevřenou. Každý hráč má „presence“ – jeden malý
//            objekt (max 4 KiB), který platforma rozesílá ostatním ~30× za s.
//  • join(název) = pojmenovaná místnost pro jeden svět („svet-abc12“).
//  • db    = trvalé úložiště; hostitel do něj zapíše mapu prachu pro nově příchozí.
//
// Role:
//  • HOSTITEL je autorita: drží peníze, garáž, flotilu, stanice a roboty, ukládá svět do svého slotu
//    a do cloudu (cloud.js). Celý sdílený stav vysílá ve své presence ve SVĚTĚ (pole H, 2× za s, jen
//    změněná pole) – čtou ho jen hráči toho světa; do lobby dává jen krátký popis světa (kód, název, hráči).
//  • Výdělky klientů hostitel ověřuje: připíše jen prach, který klient opravdu sebral (jeho tahy přehrané
//    do hostitelovy mapy), a prodej jen u Výkupu (hostCredit). Když hostitel odejde, převezme svět další hráč.
//  • HRÁČ posílá ve své presence ve světě: pozici a animaci, posledních 32 tahů koštětem,
//    poslední zprávy chatu, kolik celkem vydělal (e), žádosti o nákup (b) a kam zaparkoval vozidlo (pk).
//  • Všichni aplikují tahy ostatních na svou mapu prachu → vidí změny v reálném čase.
//  • Peníze jsou společné: výdělky hráčů přičítá hostitel, nákupy schvaluje hostitel (ack).
//  • Čas: všichni počítají denní dobu z hodin počítače + posunu hostitele → stejná denní doba.
//
// Vše jde přes presence (ne přes události), takže hrát může i pozvaný hráč s právem jen ke čtení.
import { MOON, HEX_BONUS, PLANET, UNITS_PER_KG } from './config.js';
import { inBuyback } from './base.js';
import { game, newGame, addStat, dustPrice, hexBonus } from './state.js';
import { profile, sanitizeName, validLook } from './profile.js';
import { strokes, exitVehicle, riding, remapRide, playerFx, currentVehicleSpeed, vehicleBody } from './player.js';
import { carrying } from './carry.js';
import { hexes, sweepCapsule, clearHex } from './planet/dustmap.js';
import { grid, cellDir } from './planet/hexgrid.js';
import { norm, cross, anyTangent, dot, tangentTo, angleBetween, madd } from './planet/vec.js';
import { VEHICLES, STATION, DRONE, isAirType } from './catalog.js';
import { unpackDust, fromBase64, savesLocked } from './storage.js';
import { saveCloud, claimHost, cloudStatus, cloudBlocked } from './cloud.js';
import { buyVehicle, upgradeVehicle, callBackVehicle, sellVehicle, upgradeMarket, upgradeHexup, rehomeVehicle, toolSellMax, powerRefundMax } from './equipment.js';
import { TYPE_IDS, demolishStructure, moveStructure, chargerAddSlot, chargerFaster, swapperAddRack, dronportBuy } from './structures.js';
import { orderDrone, encodeDronports, dronportSig, applyDronports, missionsForNet, applyMissions, PHASES } from './dronport.js';
import { placeLaac, addPad, removePad } from './laac.js';
import { dirToCell } from './planet/hexgrid.js';
import { placeAndWire } from './build.js';
import { encodeLive, applyLive, addCable, removeCable, autoConnect } from './energy.js';
import { batteryCap } from './catalog.js';
import { placeStation, moveStation, upgradeStation } from './robots.js';
import { breakRockHost, applyRocks } from './rocks.js';
import { myRank } from './ranks.js';
import { depositToDepot, takeFromDepot, addBelt, removeBelt, cutBelt, encodeBelts, applyBelts, encodeLogistics, applyLogistics, upgradeSinter, sellBricks } from './logistics.js';
import { buyDrone } from './drones.js';
import { startResearch, unqueueResearch, encodeResearch, applyResearch, techById } from './research.js';
import { ensureHotbar } from './hotbar.js';
import { connectPlatform } from './platform/platform.js';
import { VERSION, NET_PROTOCOL, cmpVersion } from './version.js';

const R = MOON.radius;
let researchSeen = false;                  // první H.rs po připojení nehlásí staré hotové výzkumy
export const NET_VERSION = NET_PROTOCOL;    // protokol (version.js): ve světě se presence jiné verze ignoruje; 4 = 3.0.1–3.0.4 (mosty pásů v H.bl), 5 = 3.1
const PRESENCE_HZ = 8;                     // moje presence ve světě (poloha, tahy…) – ostatní dopočítávají pohyb
const HOST_HZ = 2;                         // sdílený stav světa od hostitele
const CLOUD_STATE_S = 20, CLOUD_MAP_S = 60; // hostitel ukládá svět do cloudu (stav / i mapu prachu)
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
  kind: null,               // 'firebase'
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
  onDepart: null,           // hostitel odlétá s celým světem na jinou planetu (planeta) → odletová scéna
  onDepartRequest: null,    // hostitel: klient u rakety chce odletět → true / false
  onKicked: null,           // klient: Firebase mu přestal posílat svět (změnilo se heslo)
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
  net.fb = p.fb || null;                   // Firebase databáze (cloud.js), v artefaktu null
  net.uid = p.uid || null;
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
  net.room.presence({ v: NET_VERSION, ver: VERSION, scr: net.lobbyStatus, n: profile.name, a: lookArr(), rk: myRank(), w: net.code, ...extra }).catch(() => {});
}
// Nová hodnost → hned do lobby (hostitel ji tam posílá sám 2×/s s H)
export function refreshLobbyRank() {
  if (net.mode !== 'host') setLobby({});
}

export function setLobbyStatus(scr) {
  net.lobbyStatus = scr;
  setLobby({});
}

const lookArr = () => [profile.look.color, profile.look.top, profile.look.face, profile.look.skin];   // [barva, helma, hledí, oblečení (3.1)]

// Lidé na stránce: [{ peer, name, look, scr, world, me, hosting }]
export function lobbyPeers() {
  if (!net.room) return [];
  return net.room.peers()
    .filter(p => p.kind === 'viewer' && p.presence?.v === NET_VERSION)
    .map(p => ({
      peer: p.peer,
      name: sanitizeName(p.presence.n) || 'Astronaut',
      look: validLook({ color: p.presence.a?.[0], top: p.presence.a?.[1], face: p.presence.a?.[2], skin: p.presence.a?.[3] }),
      rank: Number.isInteger(p.presence.rk) ? p.presence.rk : -1,          // hodnost (ranks.js)
      scr: p.presence.scr,
      world: typeof p.presence.w === 'string' ? p.presence.w : null,
      me: p.isMe && p.sameTab,
      hosting: !!p.presence.H,
      guest: p.guest,
    }));
}

// Otevřené světy: [{ code, title, hostPeer, hostName, players, ver, compatible }]
// Soukromé světy (pub = 0) se v seznamu neukazují – připojí se k nim jen ten, kdo zná kód.
// L-60 (3.1): v seznamu jsou i světy jiné verze hry (compatible = false → připojit nejde, jen se ukáže verze).
// Verze 3.0.x posílá jen protokol v = 4 (bez ver).
const peerVer = pr => (typeof pr.ver === 'string' && /^\d+\.\d+\.\d+$/.test(pr.ver) ? pr.ver : pr.v === 4 ? '3.0' : pr.v === 3 ? '2.4' : '?');
export function openWorlds(includePrivate = false) {
  if (!net.room) return [];
  return net.room.peers()
    .filter(p => Number.isInteger(p.presence?.v) && p.presence.v >= 3 && p.presence.H && /^[a-z0-9]{3,12}$/.test(p.presence.H.code || ''))
    .filter(p => includePrivate || p.presence.H.pub !== 0)
    .map(p => ({
      code: p.presence.H.code,
      title: cleanText(p.presence.H.t).slice(0, 40) || 'Svět',
      hostPeer: p.peer,
      hostName: sanitizeName(p.presence.n) || 'Hostitel',
      players: p.presence.H.pl | 0,
      locked: p.presence.H.lk === 1,
      done: Number.isFinite(p.presence.H.d) ? p.presence.H.d / 10 : null,     // % uklizených hexů
      planet: p.presence.H.pn === 'mars' ? 'mars' : 'moon',
      me: p.isMe && p.sameTab,
      ver: peerVer(p.presence),
      compatible: p.presence.v === NET_VERSION,
      newer: cmpVersion(peerVer(p.presence), VERSION) > 0,      // hostitel má novější verzi → obnovit stránku musím já
    }));
}
// Text tlačítka u světa jiné verze (L-60).
export const versionMismatchText = w => `Jiná verze hry (${w.ver}) – ${w.newer ? 'obnov stránku' : 'hostitel musí obnovit stránku'}`;

// Svět podle kódu (i soukromý).
export const findWorld = code => openWorlds(true).find(w => w.code === String(code || '').toLowerCase().trim()) || null;

// Odkaz pro kamarády: adresa hry + #kód světa.
export const inviteLink = () => (net.code ? `${location.origin}${location.pathname}#${net.code}` : '');

// Krátký popis světa od hostitele v lobby (kód, název, počet hráčů, verze snímku mapy)…
const hostSummary = () => net.room?.peers().find(p => p.peer === net.hostPeer)?.presence?.H || null;
// …a celý sdílený stav v jeho presence ve světě (f = 1 označuje úplný stav).
const hostFull = () => {
  const H = net.world?.peers().find(p => p.peer === net.hostPeer)?.presence?.H;
  return H && H.f === 1 ? H : null;
};

// ---------- společné: světová presence ----------

const sent = {};                      // naposledy odeslané hodnoty polí (JSON)
const chatOut = [];                   // moje poslední zprávy [[seq, text]]
let chatSeq = 0;
let earned = 0;                       // klient: kolik jsem celkem vydělal (přičte hostitel)
const requests = [];                  // klient: [[id, druh, argumenty, cena]]
const pending = new Map();            // id → { resolve, t }
let parkReport = null;                // klient: [seq, i, ...pozice, ...směr, náplň]
let parkSeq = 0;
let ragdollEnc = { g: null, gc: null };          // ragdoll: začátek letu + korekce (player.js ragdollNet)
let kgTotal = 0;                      // klient: kolik kg prachu jsem celkem nasbíral (pro statistiky)
const deposits = {};                  // klient: kolik kg jsem celkem vysypal do depa (id stavby → kg)

// Klíč hráče pro statistiky: uid přihlášení (stejný prohlížeč) + jméno postavy.
const uidOf = peer => String(peer || '').split('_')[0];
export const myStatKey = () => `${net.me ? uidOf(net.me) : 'me'}|${profile.name}`;
const statKeyOf = r => `${uidOf(r.peer)}|${r.name}`;

export function setRagdollPresence(r) { ragdollEnc = r; }

// Nesené vozidlo (3.1, L-69/O-26): [letoun, vozidlo, režim 0 lano / 1 ruka, rozložení ruky ×100, p ×3 (1e6), r (cm), nahoru ×3 (1e3),
// směr ×3 (1e3), hák ×3 (1e6), hák r (cm)]. Lano si ostatní kreslí jako prověšenou křivku mezi hákem a vozidlem.
function carryNet() {
  const c = carrying();
  if (!c) return null;
  const s = game.s, v = s.vehicles[c.i];
  if (!v) return null;
  const b = vehicleBody(c.i);
  const hook = c.hookNow || c.veh;
  const hr = Math.hypot(...hook);
  return [s.driving, c.i, c.mode === 'arm' ? 1 : 0, Math.round((c.armK || 0) * 100), ...enc(v.p), Math.round((b ? b.r : R) * 100),
    ...encF(v.carriedUp || v.p), ...encF(v.f), ...enc(hook.map(x => x / hr)), Math.round(hr * 100)];
}
function decodeCarry(a) {
  if (!Array.isArray(a) || !okVec(a, 0, 18)) return null;           // 18 čísel (carryNet); 11. 11.: dřív 21 → nesení ostatní neviděli
  const p = decU(a, 4), r = a[7] / 100, hd = decU(a, 14), hr = a[17] / 100;
  return { a: a[0] | 0, 1: a[1] | 0, i: a[1] | 0, mode: a[2] ? 'arm' : 'rope', armK: (a[3] | 0) / 100, p, r, up: decF(a, 8), f: decF(a, 11), hook: hd.map(x => x * hr) };
}

function myWorldPresence(fx, vehicleSpeed) {
  const s = game.s;
  const b = fx.body;
  return {
    v: NET_VERSION,
    n: profile.name,
    a: lookArr(),
    rk: myRank(),                                                    // hodnost (ranks.js) nad jménem
    sq: net.mode === 'client' ? mapAsk : null,                       // žádost o snímek mapy prachu (mění se = nová žádost)
    p: enc(s.p),
    r: Math.round((b ? b.r : R) * 100),
    f: encF(s.f),
    m: [Math.round(fx.speed * 10), Math.round(fx.alt * 100), Math.round(fx.vr * 10), fx.swept ? 1 : 0, fx.airborne ? 1 : 0],
    d: s.driving,
    vs: s.driving >= 0 ? Math.round(vehicleSpeed * 10) : 0,
    bt: s.driving >= 0 && batteryCap(s.vehicles[s.driving]) ? Math.round(s.vehicles[s.driving].charge * 10) / 10 : null,   // baterie řízeného vozidla (L-51)
    tl: s.tool,
    tw: Math.round(fx.toolWidth * 100),
    s: strokes.list.map(k => [k.seq, ...enc(k.p), Math.round(k.w * 100), k.pw, k.cont ? 1 : 0]),
    c: chatOut,
    e: Math.round(earned * 100) / 100,
    kg: Math.round(kgTotal * 10) / 10,
    tk: Object.keys(takes).length ? Object.fromEntries(Object.entries(takes).map(([k, x]) => [k, Math.round(x * 10) / 10])) : null,
    cv: carryNet(),                                                  // nesené vozidlo (Mula / Kondor, 3.1)
    dk: Object.keys(deposits).length ? Object.fromEntries(Object.entries(deposits).map(([k, x]) => [k, Math.round(x * 10) / 10])) : null,
    b: requests,
    pk: parkReport,
    g: ragdollEnc.g,
    gc: ragdollEnc.gc,
    rd: riding() ? [riding().i, riding().seat] : null,        // cestující v přepravníku [vozidlo, sedadlo]
    jp: s.jetpack ? (performance.now() - playerFx.jet < 700 ? 2 : 1) : 0,   // jetpack: 1 = na zádech, 2 = právě hoří
    lo: net.lightsOff ? 1 : 0,                                       // světla vypnutá klávesou L
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
  if (!pr || pr.v !== NET_VERSION) return r;
  r.name = sanitizeName(pr.n) || r.name;
  r.look = validLook({ color: pr.a?.[0], top: pr.a?.[1], face: pr.a?.[2], skin: pr.a?.[3] });
  r.rank = Number.isInteger(pr.rk) ? pr.rk : -1;
  if (okVec(pr.p, 0)) { r.p = decU(pr.p); r.pAt = performance.now(); }
  if (isNum(pr.r)) r.r = Math.min(R + 400, Math.max(R - 60, pr.r / 100));
  if (okVec(pr.f, 0)) r.f = decF(pr.f);
  if (okVec(pr.m, 0, 5)) r.m = pr.m;
  r.d = Number.isInteger(pr.d) ? pr.d : -1;
  r.vs = isNum(pr.vs) ? pr.vs / 10 : 0;
  r.bt = isNum(pr.bt) ? pr.bt : null;
  if (net.mode === 'host' && r.d >= 0 && r.bt !== null && game.s.vehicles[r.d] && Math.abs(r.vs) > 0.3) {   // za jízdy platí nabití od řidiče (ve stání nabíjí hostitel)
    const v = game.s.vehicles[r.d];
    v.charge = Math.max(0, Math.min(batteryCap(v), r.bt));
  }
  r.tool = typeof pr.tl === 'string' ? pr.tl : r.tool;
  r.tw = isNum(pr.tw) ? pr.tw : r.tw;
  r.rag = pr.g && typeof pr.g === 'object' && !Array.isArray(pr.g) ? pr.g : null;   // začátek letu (ragdoll.js)
  r.ragFix = Array.isArray(pr.gc) ? pr.gc : null;
  r.lo = pr.lo === 1;
  r.rd = okVec(pr.rd, 0, 2) && Number.isInteger(pr.rd[0]) && Number.isInteger(pr.rd[1]) ? [pr.rd[0], pr.rd[1]] : null;
  r.jp = pr.jp | 0;
  r.cv = decodeCarry(pr.cv);
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
  const got = sweepCapsule(from, p, w / 2, pw, 1e12);
  if (net.mode === 'host' && got) {
    host.creditKg += got.got / UNITS_PER_KG;
    host.creditBonus += (got.completed?.length || 0) * hexBonus();
  }
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
  if (net.mode === 'host' && ch.joined.some(p => !(p.isMe && p.sameTab))) {
    scheduleSnapshot();
    for (const p of ch.joined) if (!(p.isMe && p.sameTab)) host.creditKg += JOIN_GRACE_KG;   // co si přinesl v nástrojích
  }
  if (net.mode === 'client') watchHost();
}

// Vyhlazení pohybu vzdálených hráčů (volá se každý snímek).
// Presence chodí jen PRESENCE_HZ× za sekundu → cíl se dopočítá z poslední rychlosti a směru
// (nejvýš o ~1,5 intervalu dopředu), aby pohyb mezi zprávami plynul a nezastavoval se.
function smoothRemotes(dt) {
  const k = 1 - Math.exp(-dt * 10);
  const now = performance.now();
  for (const r of net.remotes.values()) {
    if (!r.p) continue;
    if (!r.sp) { r.sp = r.p.slice(); r.sr = r.r; continue; }
    const far = dot(r.sp, r.p) < Math.cos(15 / R);   // skok o víc než 15 m → přesunout hned
    if (far) { r.sp = r.p.slice(); r.sr = r.r; continue; }
    const ahead = Math.min((now - (r.pAt || now)) / 1000, 1.5 / PRESENCE_HZ);
    const speed = r.d >= 0 ? r.vs : (r.m?.[0] || 0) / 10;
    const goal = speed && r.f ? norm(madd(r.p, tangentTo(r.p, r.f), speed * ahead / R)) : r.p;
    r.sp = norm([r.sp[0] + (goal[0] - r.sp[0]) * k, r.sp[1] + (goal[1] - r.sp[1]) * k, r.sp[2] + (goal[2] - r.sp[2]) * k]);
    r.sr += (r.r - r.sr) * k;
  }
}

// Vozidlo, které řídí jiný hráč → poloha z jeho presence.
export function vehicleOverride(i) {
  for (const r of net.remotes.values()) {
    if (r.d === i && r.sp) return { p: r.sp, r: r.sr, f: r.f, speed: Math.abs(r.vs), peer: r.peer };
    if (r.cv && r.cv[1] === i) return { p: r.cv.p, r: r.cv.r, f: r.cv.f, up: r.cv.up, speed: 0, peer: r.peer, carried: true };   // nese ho letoun jiného hráče
  }
  return null;
}
// Nesená vozidla ostatních hráčů (pro lano a ruku ve scéně): [{ a: letoun, i, mode, armK, hook: [3] svět, top: [3] svět }]
export function remoteCarries() {
  const out = [];
  for (const r of net.remotes.values()) if (r.cv) out.push(r.cv);
  return out;
}

// Jede vozidlo i, které řídí jiný hráč? (nabíjení na slotu jen ve stání)
export function vehicleRemoteMoving(i) {
  for (const r of net.remotes.values()) if (r.d === i) return Math.abs(r.vs || 0) > 0.3;
  return false;
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
    if (isAirType(game.s.vehicles[r.d]?.type)) continue;              // letoun hráče nesrazí (L-66)
    const pos = [r.sp[0] * r.sr, r.sp[1] * r.sr, r.sp[2] * r.sr];
    const dir = tangentTo(r.sp, r.f);
    const v = r.vs;
    out.push({ pos, radius: radiusOf(r.d), vel: [dir[0] * v, dir[1] * v, dir[2] * v], speed: Math.abs(v) });
  }
  return out;
}

export function players() {
  const list = [{ name: profile.name, color: profile.look.color, me: true, host: net.mode === 'host', stats: statsFor(myStatKey()), rank: myRank() }];
  for (const r of net.remotes.values()) {
    list.push({ name: r.name, color: r.look.color, me: false, host: r.peer === net.hostPeer, stats: statsFor(statKeyOf(r)), rank: r.rank });
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
  tk: {},                     // peer → součty prachu nabraného Kondorem ze sil (3.1)
  sv: 0,                      // verze snímku mapy v db
  applied: {},                // peer → poslední aplikovaný tah (pro snímek)
  lastPk: {},
  timer: 0, snapTimer: null, snapping: false,
  cloudTimer: CLOUD_STATE_S, mapTimer: CLOUD_MAP_S,
  refund31: new Set(),        // L-71: uid hráčů, kterým se v této hře už vrátila Síla nástrojů
  ts: 0, ps: [], psAt: 0,     // hodiny pro klienty a statistiky hráčů se posílají jen občas
  creditKg: 0,                // kontrola: kolik kg prachu klienti opravdu sebrali a ještě neprodali
  creditBonus: 0,             // …a kolik $ prémií za hexy, které jejich tahy dočistily
  warned: 0,
};
const JOIN_GRACE_KG = 300;    // nový hráč může mít prach v nástrojích z minula (hostitel ho neviděl sbírat)
const SLACK_KG = 3;           // tolerance zaokrouhlení

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
  const lock = await claimHost(net.code);                     // hostitel může být jen jeden (i ze cloudu)
  if (lock !== true) {
    net.world.leave?.();
    net.world = null;
    net.mode = 'off';
    return `taken:${lock}`;
  }
  pushHostState();
  scheduleSnapshot();                                         // mapa prachu do cloudu hned na začátku
  return true;
}

// Hostitel: uložit svět do cloudu hned (odchod do menu, skrytá karta). quick = zavírání karty (bez čtení, hned odeslat).
export function saveWorldNow(full = false, quick = false) {
  if (net.mode !== 'host' || savesLocked()) return Promise.resolve(false);
  return saveCloud(net.code, { full, sv: host.sv, extra: snapExtra(), quick }).then(cloudResult);
}

// Skrytá karta (přepnutí / zavírání): i mapu prachu, když poslední snímek je starší než 10 s (F-10 – dřív jen stav,
// takže po zavření karty chyběla v cloudu až minuta zametání).
export function saveWorldOnHide() {
  if (net.mode !== 'host') return Promise.resolve(false);
  if (CLOUD_MAP_S - host.mapTimer > 10 && !host.snapping) { clearTimeout(host.snapTimer); return writeSnapshot(); }
  return saveWorldNow(false);
}

// F-10: chyba zápisu do cloudu je vidět – hláška hráči (nejvýš 1× za 2 min) a nový pokus za 15 s.
// net.onCloud(text) nastaví main.js (toast).
let cloudWarnAt = 0, cloudWasFailing = false;
const CLOUD_RETRY_S = 15;
const CLOUD_TEXT = {
  offline: 'Svět se nedaří uložit do cloudu – asi vypadlo připojení. Zkouším to znovu, hraj dál; tvůj slot se ukládá normálně.',
  denied: 'Firebase odmítla uložení světa do cloudu (pravidla databáze). Zkouším to znovu – když to nepůjde, uložte si hru do slotu.',
  error: 'Svět se nepodařilo uložit do cloudu. Zkouším to znovu.',
  newer: 'Svět v cloudu uložila novější verze hry. Tahle hra ho nepřepíše – obnov stránku (Ctrl+F5).',
  conflict: 'Svět v cloudu mezitím uložil někdo jiný (novější revize). Tahle hra ho už do cloudu nepřepíše – odejdi do menu a otevři svět znovu.',
};
function cloudResult(ok) {
  if (ok) {
    if (cloudWasFailing) { cloudWasFailing = false; net.onCloud?.('Uložení světa do cloudu zase funguje.'); }
    if (cloudStatus.reason === 'map-guard' && Date.now() - cloudWarnAt > 120000) {
      cloudWarnAt = Date.now();
      net.onCloud?.('Pozor: mapa prachu v cloudu je dál než tvoje (víc vyčištěných hexů) – nepřepíšu ji. Stav světa se ukládá dál.');
    }
    return ok;
  }
  const hard = cloudStatus.reason === 'conflict' || cloudStatus.reason === 'newer';
  if (cloudBlocked() && !hard) return ok;   // pojistka planety – hlásí main.js
  cloudWasFailing = true;
  if (!hard) {
    host.cloudTimer = Math.min(host.cloudTimer, CLOUD_RETRY_S);
  }
  if (hard || Date.now() - cloudWarnAt > 120000) {
    cloudWarnAt = Date.now();
    net.onCloud?.(CLOUD_TEXT[cloudStatus.reason] || CLOUD_TEXT.error);
  }
  return ok;
}
const snapExtra = () => ({ seqs: { ...host.applied, [net.me]: strokes.seq }, rc: host.rcBase + host.rc.length - 1 });

// Hostitel: robot dočistil hexy → oznámit ostatním.
export function hostRobotCompleted(cells) {
  if (net.mode !== 'host') return;
  for (const c of cells) host.rc.push(c);
  while (host.rc.length > 40) { host.rc.shift(); host.rcBase++; }
}

function hostReadPeer(r, pr) {
  const s = game.s;
  const key = statKeyOf(r);
  // klient chce snímek mapy prachu (4. 11.: připojení / nový pokus – dřív jen podle „přišel nový hráč“)
  if (isNum(pr.sq) && pr.sq !== r.sq) { r.sq = pr.sq; scheduleSnapshot(); }
  // výdělky (součet od připojení)
  if (isNum(pr.e) && pr.e >= 0) {
    const before = host.ep[r.peer] || 0;
    if (pr.e > before) {
      const add = Math.min(pr.e - before, 1e7);
      host.ep[r.peer] = pr.e;
      const okAdd = verifyEarning(r, add);
      s.money += okAdd;
      addStat(key, r.name, 'e', okAdd);
      if (add - okAdd > 25) warnCheat(r, `výdělek $${Math.round(add - okAdd)}`);
    }
  }
  // nasbíraný prach (jen statistika)
  if (isNum(pr.kg) && pr.kg > (host.kp[r.peer] || 0)) {
    addStat(key, r.name, 'kg', Math.min(pr.kg - (host.kp[r.peer] || 0), 1e7));
    host.kp[r.peer] = pr.kg;
  }
  // prach vysypaný do dep (prodá se, až ho pás doveze do Výkupu; do statistiky se připíše hned)
  if (pr.dk && typeof pr.dk === 'object') {
    const seen = host.dk[r.peer] || (host.dk[r.peer] = {});
    Object.entries(pr.dk).forEach(([i, kg]) => {
      if (!isNum(kg) || kg <= (seen[i] || 0)) return;
      const want = Math.min(kg - (seen[i] || 0), 1e7);
      seen[i] = kg;
      const add = Math.min(want, host.creditKg + SLACK_KG);         // do depa jen prach, který opravdu sebral
      host.creditKg = Math.max(0, host.creditKg - add);
      if (want - add > 10) warnCheat(r, `${Math.round(want - add)} kg do depa`);
      if (add > 0) depositToDepot(i, add);                         // peníze přinese až pás do Výkupu
    });
  }
  // Kondor klienta nabral prach ze sila (3.1): odečíst ze skladu, prach se počítá jako nasbíraný (kredit pro prodej)
  if (pr.tk && typeof pr.tk === 'object') {
    const seen = host.tk[r.peer] || (host.tk[r.peer] = {});
    Object.entries(pr.tk).forEach(([i, kg]) => {
      if (!isNum(kg) || kg <= (seen[i] || 0)) return;
      const want = Math.min(kg - (seen[i] || 0), 1e5);
      seen[i] = kg;
      host.creditKg += takeFromDepot(i, want);
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

// Kontrola výdělku klienta: prémie za hexy z jeho skutečně dočištěných hexů, prodej prachu jen u Výkupu
// a jen do množství, které jeho tahy opravdu sebraly z mé mapy. Vrací, kolik $ uznat.
function verifyEarning(r, add) {
  const bonus = Math.min(add, host.creditBonus + hexBonus() * 2);
  host.creditBonus = Math.max(0, host.creditBonus - bonus);
  const rest = add - bonus;
  if (rest <= 0.01) return add;
  const atDepot = r.p && inBuyback(r.p, 4);
  if (!atDepot) return bonus;
  const price = dustPrice();
  const kg = Math.min(rest / price, host.creditKg + SLACK_KG);
  host.creditKg = Math.max(0, host.creditKg - kg);
  return bonus + kg * price;
}

// Hostitel sám: jeho prach patří do stejné bilance (vozidlo, které naplnil on, může prodat klient a naopak).
export function hostOwnDust(sweptKg, soldKg) {
  if (net.mode !== 'host') return;
  host.creditKg = Math.max(0, host.creditKg + (sweptKg || 0) - (soldKg || 0));
}

function warnCheat(r, what) {
  if (performance.now() - host.warned < 30000) return;
  host.warned = performance.now();
  net.onChat?.({ system: true, text: `⚠ ${r.name}: hra neuznala ${what} – neodpovídá prachu, který opravdu nasbíral(a).` });
}

function hostRequest(kind, a, cost, r) {
  const s = game.s;
  switch (kind) {
    case 'tool': case 'tup': case 'boots': case 'gbelt': case 'jet': case 'hammer':
      if (!(cost >= 0) || s.money < cost) return false;
      s.money -= cost;
      return true;
    case 'tsell': {                                                   // [id nástroje, výnos] – nástroj je osobní, hostitel jen ověří strop
      const v = Number(a[1]);
      if (!(v >= 0) || v > toolSellMax(String(a[0]))) return false;
      s.money += v;
      return true;
    }
    case 'refund31': {                                                // L-71: vrácení za zrušenou Sílu nástrojů [částka] – jednou za hráče
      const v = Math.round(Number(a[0]));
      const who = String(r?.peer || '').split('_')[0];
      if (!(v > 0) || v > powerRefundMax() || host.refund31.has(who)) return false;
      host.refund31.add(who);
      s.money += v;
      return true;
    }
    case 'build': {                                                   // [typ, poloha ×3 (1e6), yaw (mrad)]
      const type = TYPE_IDS[a[0] | 0];
      return !!type && okVec(a, 1) && isNum(a[4]) && !!placeAndWire(type, decU(a, 1), a[4] / 1000);
    }
    case 'demolish': return demolishStructure(String(a[0]));
    case 'dmove3': return okVec(a, 1) && isNum(a[4]) && !!moveStructure(String(a[0]), decU(a, 1), a[4] / 1000);   // přesun depa (3.1)
    case 'cable': return addCable(String(a[0]), String(a[1]));
    case 'uncable': return removeCable(String(a[0]), String(a[1]));
    case 'chslot': return chargerAddSlot(String(a[0]));
    case 'chfast': return chargerFaster(String(a[0]));
    case 'swrack': return swapperAddRack(String(a[0]));
    case 'dport': return dronportBuy(String(a[0]));
    case 'laac': { const id = placeLaac(a[0] | 0, a[1] | 0); if (id) autoConnect(id); return !!id; }   // [hex, otočení] (3.1, L-64)
    case 'lpad': return addPad(String(a[0]), a[1] | 0);                 // [id LAAC, strana 1–6]
    case 'lpadx': return removePad(String(a[0]), a[1] | 0);                     // dronport / 2. dron (3.1, L-62)
    case 'dorder': return vehicleUid(a[0] | 0) === String(a[1]) && orderDrone(a[0] | 0, !!a[2]);   // [vozidlo, uid, 1 objednat / 0 zrušit]
    case 'veh': return buyVehicle(String(a[0]), a[1] ? String(a[1]) : null);
    case 'vhome': return vehicleUid(a[0] | 0) === String(a[1]) && rehomeVehicle(a[0] | 0, String(a[2]));
    case 'vup': return upgradeVehicle(a[0] | 0, String(a[1]));
    case 'st': return okVec(a, 0) ? placeStation(decU(a), a[3] | 0) : false;
    case 'stup': return upgradeStation(a[0] | 0);
    case 'stmove': return okVec(a, 1) ? moveStation(a[0] | 0, decU(a, 1)) : false;
    case 'call': return !vehicleTakenBy(a[0] | 0) && callBackVehicle(a[0] | 0);
    case 'vsell': return s.driving !== (a[0] | 0) && !vehicleTakenBy(a[0] | 0) && !seatsTaken(a[0] | 0).size && vehicleUid(a[0] | 0) === String(a[1]) && sellVehicle(a[0] | 0);
    case 'beltadd': {                                                 // [zIdStavby, zZásuvky, doIdStavby, doZásuvky, zlomy „1,3“, ohyby ×3 (1e6)…]
      const bends = [];
      for (let k = 5; k + 2 < a.length && bends.length < 40; k += 3) if (okVec(a, k)) bends.push(decU(a, k));
      const corners = String(a[4] || '').split(',').filter(x => x !== '').map(Number).filter(Number.isInteger);
      return !!addBelt([String(a[0]), String(a[1])], [String(a[2]), String(a[3])], bends, corners);
    }
    case 'beltdel': return removeBelt(String(a[0]));
    case 'rock': return breakRockHost(a[0] | 0);                         // řidič rozbil kámen (lunar / mega)
    case 'beltcut': return cutBelt(String(a[0]), a[1] | 0);              // [id pásu, úsek] – zbourat úsek od kloubu ke kloubu
    case 'sinterup': return upgradeSinter(String(a[0]));             // vylepšení slinovny Rychlejší lis
    case 'brickmode': s.brickMode = a[0] === 'store' ? 'store' : 'sell'; return true;
    case 'bricksell': return sellBricks(a[0] | 0);                       // [počet] – prodej cihel ze zásoby (11. 11.)
    case 'drone': return buyDrone();
    case 'research': return startResearch(String(a[0]));
    case 'unqueue': return unqueueResearch(String(a[0]));
    case 'market': return upgradeMarket();
    case 'hexup': return upgradeHexup();
    case 'depart': return !!net.onDepartRequest?.();
    default: return false;
  }
}

// Prodej se potvrzuje i podle uid, aby se po posunu indexů neprodalo jiné vozidlo.
const vehicleUid = i => game.s.vehicles[i]?.uid || '';

function botEnc(st) {
  const c = cellDir(st.hex), e1 = anyTangent(c), e2 = cross(c, e1);
  const d = st.robot.p;
  return [Math.round(dot(d, e1) * R * 10), Math.round(dot(d, e2) * R * 10), st.robot.mode === 'work' ? 1 : 0, Math.round(st.store || 0)];   // 3 = zásobník kg (11. 11.)
}

function hostState() {
  const s = game.s;
  const now = Date.now();
  if (now - host.ts > 5000) host.ts = now;                    // hodiny pro klienty stačí jednou za 5 s
  if (now - host.psAt > 5000) { host.psAt = now; host.ps = presentStats(); }
  return {
    f: 1,
    code: net.code,
    pub: s.netPublic === false ? 0 : 1,
    t: cleanText(s.title).slice(0, 40),
    pl: 1 + net.remotes.size,
    m: Math.round(s.money),
    wp: Math.round(s.warp || 0),
    ts: host.ts,
    gf: s.gfree ? 1 : 0,
    bd: (s.buildings || []).map(b => [b.id, TYPE_IDS.indexOf(b.type), ...enc(b.p), Math.round(b.yaw * 1000), b.lv | 0, Math.round(b.paid || 0), b.type === 'laac' ? b.data?.rot | 0 : b.data?.slots | 0, b.type === 'laac' ? (b.data?.pads || []).reduce((m, x) => m | (1 << x), 0) : b.data?.fast | 0, b.data?.swap?.at || 0, b.data?.swap?.i ?? -1]),
    cb: s.cables || [],
    rk: s.rocks || [],                                         // rozbité kameny (rocks.js)
    pw: livePacket(),
    dp: dronportPacket(),                                      // dronporty: stav dronů (3.1)
    dn: missionsPacket(),                                      // letící drony (3.1) – klient je mezi pakety posouvá sám
    rs: encodeResearch(),
    won: s.won ? 1 : 0,
    pn: PLANET.id,
    go: s.go || 0,
    mk: s.market | 0,
    hu: s.hexup | 0,
    v: s.vehicles.map((v, i) => [VEHICLES.findIndex(x => x.id === v.type), v.lv.width, v.lv.speed, v.spot ?? i, ...enc(v.p), ...encF(v.f), Math.round(v.load * 10), v.uid || '', v.lv.boost | 0, v.lv.hopper | 0, v.garage || '', Math.round(v.charge || 0), v.lv.battery | 0, v.lv.solar | 0, v.lv.cruise | 0, v.lv.edge | 0, v.lv.motor | 0, v.lv.abatt | 0, v.lv.special | 0]),   // 20–22: letouny (3.1)
    st: s.stations.map(st => st.hex),
    sm: s.stations.map(st => st.mk | 0).join(''),            // úroveň stanic (MK1 / MK2) jako řetězec číslic
    b: s.stations.map(botEnc),
    dr: s.drones.map(d => [...enc(d.p), d.mode === 'work' ? 1 : 0]),
    bl: encodeBelts(),                                         // pásy 3.0 (mění se jen při stavbě / bourání)
    lg: logisticsPacket(),                                     // depa, slinovny, náklad na pásech, cihly (nejvýš 1× za 2 s)
    ps: host.ps,
    rc: [host.rcBase, ...host.rc],
    ack: host.acks,
    ep: host.ep,
    sv: host.sv,
  };
}

// Živé hodnoty sítě (nabití baterií, výkon solárů, stav slotů) jen jednou za 2 s (O-17).
let liveAt = 0, liveCache = [];
// O-17: náklad na pásech se mění pořád (každý paket by nesl celé lg, ~2,5 kB při 250 pytlích) – klient si pytle mezi
// pakety posouvá sám (logisticsClientTick), takže stačí stav jednou za 2 s; při stavbě / bourání pásu hned (bl se změní).
let lgAt = 0, lgCache = null, lgBeltSig = '', lgSeen = null;
function logisticsPacket() {
  const now = Date.now(), sig = (game.s.belts || []).map(b => b.id).join();
  if (!lgCache || now - lgAt > 2000 || sig !== lgBeltSig) { lgAt = now; lgBeltSig = sig; lgCache = { ...encodeLogistics(), t: now }; }   // t: klient použije každý paket jen jednou
  return lgCache;
}
// Dronporty: při změně stavu hned, odpočet nabíjení nejvýš 1× za 2 s.
let dpAt = 0, dpCache = [], dpSig = '';
function dronportPacket() {
  const now = Date.now(), sig = dronportSig();
  if (sig !== dpSig || now - dpAt > 2000) { dpAt = now; dpSig = sig; dpCache = encodeDronports(); }
  return dpCache;
}
// Lety: [id výměníku, dron, fáze, p ×3 (1e6), výška ×10, směr ×3 (1e3), vozidlo, uid, nese (0 nabitou / 1 vybitou), začátek fáze (ms), eta s]
function missionsPacket() {
  return missionsForNet().map(({ id, k, m }) => [id, k, PHASES.indexOf(m.ph), ...enc(m.p), Math.round(m.h * 10), ...encF(m.f), m.v, m.uid || '', m.carry === 'full' ? 0 : 1, Math.round(m.at), Math.round(m.eta || 0)]);
}
function livePacket() {
  const now = Date.now();
  if (now - liveAt > 2000) { liveAt = now; liveCache = encodeLive(); }
  return liveCache;
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
  const H = hostState();
  net.world?.presence({ H }).catch(() => {});                 // celý stav jen hráčům světa (posílají se jen změny)
  // d = uklizeno ‰ hexů (lobby: „0,4 % hexů“)
  setLobby({ scr: 'game', w: net.code, H: { code: H.code, pub: H.pub, t: H.t, pl: H.pl, pn: H.pn, sv: H.sv, lk: lockedWorld ? 1 : 0, d: hexes.total ? Math.round(hexes.doneCount / hexes.total * 1000) : 0 } });
}
let lockedWorld = false;
export function setWorldLocked(on) { lockedWorld = !!on; if (net.mode === 'host') pushHostState(); }
export const worldLocked = () => lockedWorld;

function scheduleSnapshot() {
  clearTimeout(host.snapTimer);
  host.snapTimer = setTimeout(writeSnapshot, 1200);
}

// Snímek mapy prachu do db pro nově příchozí hráče.
async function writeSnapshot() {
  if (!net.db || net.mode !== 'host' || savesLocked()) return;
  if (host.snapping) { scheduleSnapshot(); return; }
  host.snapping = true;
  try {
    const sv = host.sv + 1;
    if (!cloudResult(await saveCloud(net.code, { full: true, sv, extra: snapExtra() }))) {
      host.mapTimer = Math.min(host.mapTimer, CLOUD_RETRY_S);   // mapa znovu za 15 s
      throw new Error('cloud');
    }
    host.sv = sv;
    host.mapTimer = CLOUD_MAP_S;
    host.cloudTimer = CLOUD_STATE_S;
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
let lastTs = 0;
let departing = false;
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
  const joinSv = hostSummary()?.sv || 0;
  try {
    net.world = await net.room.join('svet-' + w.code);
  } catch {
    return 'Do světa se nepodařilo připojit. Zkus to znovu.';
  }
  net.world.onPeers(onWorldPeers);
  net.world.onCancel?.(() => net.onKicked?.());
  setLobby({ scr: 'game', w: w.code });
  newGame('Multiplayer');
  loadPersonal();
  mapAsk = Date.now() % 1e9; mapWanted = false; mapBusy = false;   // hostitel udělá snímek mapy hned (žádost sq)
  pushWorldPresence({ speed: 0, alt: 0, vr: 0, swept: 0, airborne: 0, toolWidth: 0.3, body: null }, 0);

  onStatus?.('Čekám na mapu od hostitele…');
  const t0 = Date.now();
  let H = null;
  while (Date.now() - t0 < 45000) {                    // 4. 11.: dřív 20 s – velká mapa se u hostitele nestihla nahrát
    H = hostSummary();
    if (!H && Date.now() - t0 > 5000) return 'Hostitel světa už není online.';
    if (H && H.sv > joinSv) break;
    if (Date.now() - t0 > 8000) onStatus?.(`Čekám na mapu od hostitele… ${Math.round((Date.now() - t0) / 1000)} s`);
    await new Promise(r => setTimeout(r, 250));
  }
  let snap = null;
  if (H && H.sv > joinSv && net.db) {
    onStatus?.('Stahuji mapu Měsíce…');
    snap = await fetchSnapshot(w.code, H.sv, false);
  }
  mapSeenSv = H?.sv || joinSv;
  mapWanted = !snap && !!net.db;                     // nepovedlo se → zkouší se dál během hry (mapRetry)
  mapAskAt = Date.now();
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
  console.info(`[svět] prach z: ${snap ? `snímek hostitele (sv ${snap.sv}${snap.rv ? `, rev ${snap.rv}` : ''})` : 'nový – snímek hostitele zatím chybí'}, vyčištěno ${hexes.doneCount} / ${hexes.total} hexů, svět ${w.code}`);
  const full = hostFull();
  if (full) applyHostState(full);
  return snap || !net.db ? null : 'nomap';
}

// Stáhne snímek mapy prachu (head + díly). Když ho mezitím hostitel přepíše novějším (díly mají jiné sv),
// zkusí to znovu s novým (nejvýš 3×). merge = sloučit do hrané mapy (jinak použít na čerstvou). Vrací head nebo null.
async function fetchSnapshot(code, minSv, merge) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const head = (await net.db.doc(`w/${code}/head`).get()).data();
      if (!head || !(head.sv >= minSv) || !(head.parts > 0)) return null;
      let b64 = '', stale = false;
      for (let i = 0; i < head.parts; i++) {
        const part = (await net.db.doc(`w/${code}/parts/p${i}`).get()).data();
        if (!part || part.sv !== head.sv) { stale = true; break; }
        b64 += part.d;
      }
      if (stale) { console.warn('Snímek mapy se během stahování změnil – znovu', attempt + 1); continue; }
      if (await unpackDust({ gz: !!head.gz, bytes: fromBase64(b64) }, merge)) return head;
      console.warn('Snímek mapy nejde použít (jiná velikost mapy?)');
      return null;
    } catch (e) {
      console.warn('Snímek mapy se nepodařilo načíst', e);
    }
  }
  return null;
}

// Klient bez mapy od hostitele (4. 11.): dřív zůstal Měsíc zasypaný až do odchodu. Teď se během hry zkouší dál –
// každý nový snímek hostitele (H.sv) se stáhne a sloučí do hrané mapy; bez nového snímku se žádost sq zopakuje po 30 s.
let mapAsk = 0, mapWanted = false, mapBusy = false, mapSeenSv = 0, mapAskAt = 0;
function mapRetry() {
  if (!mapWanted || mapBusy || net.mode !== 'client' || !net.db) return;
  const H = hostSummary(), now = Date.now();
  if (H && H.sv > mapSeenSv) {
    mapBusy = true;
    const sv = H.sv;
    fetchSnapshot(net.code, sv, true).then(head => {
      mapBusy = false;
      mapSeenSv = sv;
      if (head && net.mode === 'client') {
        mapWanted = false;
        console.info(`[svět] prach z: snímek hostitele (sloučeno do hrané mapy, sv ${head.sv}), vyčištěno ${hexes.doneCount} / ${hexes.total} hexů`);
        net.onMapLoaded?.();
      }
    });
  } else if (now - mapAskAt > 30000) {
    mapAskAt = now;
    mapAsk++;                                        // nová žádost o snímek (presence sq)
  }
}

function watchHost() {
  mapRetry();
  const H = hostFull();
  if (!H) return;
  if (H !== lastH && net.ready) applyHostState(H);
}

function applyHostState(H) {
  lastH = H;
  const s = game.s;
  if (isNum(H.m)) s.money = H.m + Math.max(0, earned - (Number(H.ep?.[net.me]) || 0));
  if (isNum(H.wp)) s.warp = H.wp;
  if (isNum(H.ts) && H.ts !== lastTs) {                       // hodiny hostitele chodí jednou za 5 s
    lastTs = H.ts;
    const off = H.ts - Date.now();
    game.clockOffset = Math.abs(off - game.clockOffset) > 3000 ? off : game.clockOffset + (off - game.clockOffset) * 0.1;
  }
  s.gfree = !!H.gf;
  {                                                  // stavby (Firebase prázdné pole neuloží → chybějící H.bd = žádné stavby)
    const old = new Map((s.buildings || []).map(b => [b.id, b]));
    s.buildings = (Array.isArray(H.bd) ? H.bd : []).filter(e => okVec(e, 2, 4) && TYPE_IDS[e[1]]).map(e => {
      const b = old.get(String(e[0])) || { id: String(e[0]), data: {} };
      b.type = TYPE_IDS[e[1]];
      b.p = decU(e, 2);
      b.yaw = e[5] / 1000;
      b.lv = e[6] | 0;
      b.paid = e[7] | 0;
      if (b.type === 'charger') { b.data.slots = Math.max(1, e[8] | 0); b.data.fast = e[9] | 0; }
      if (b.type === 'laac') {                        // LAAC (3.1): otočení a plošiny (bity 1–6), hex z polohy
        b.data.cell = dirToCell(b.p);
        b.data.rot = (e[8] | 0) % 6;
        b.data.pads = [1, 2, 3, 4, 5, 6].filter(x => (e[9] | 0) & (1 << x));
      }
      if (b.type === 'swapper') {                     // výměna: začátek (hodiny hostitele, ms) – animaci si přehraje každý sám (A-06)
        b.data.slots = Math.max(2, e[8] | 0);
        b.data.swap = isNum(e[10]) && e[10] > 0 ? { at: e[10], i: e[11] | 0 } : null;
      }
      return b;
    });
  }
  s.cables = (Array.isArray(H.cb) ? H.cb : []).filter(c => Array.isArray(c) && c.length === 2).map(c => [String(c[0]), String(c[1])]);
  if (Array.isArray(H.pw)) applyLive(H.pw);
  applyDronports(Array.isArray(H.dp) ? H.dp : []);              // dronporty a lety dronů (3.1, L-62)
  applyMissions((Array.isArray(H.dn) ? H.dn : []).filter(e => Array.isArray(e) && okVec(e, 3) && okVec(e, 7) && PHASES[e[2]]).map(e => ({
    id: String(e[0]), k: e[1] | 0, ph: PHASES[e[2]], p: decU(e, 3), h: e[6] / 10, f: decF(e, 7), v: e[10] | 0, uid: String(e[11] || ''), carry: e[12] ? 'empty' : 'full', at: Number(e[13]) || 0, eta: Number(e[14]) || 0,
  })));
  if (typeof H.rs === 'string') {                         // výzkum (L-30): hotové, aktuální s průběhem, fronta
    const before = new Set(s.research?.done || []);
    applyResearch(H.rs);
    const fresh = s.research.done.filter(id => !before.has(id));
    if (fresh.length && researchSeen) net.onResearchDone?.(fresh);
    researchSeen = true;
  }
  s.won = !!H.won;
  s.market = Math.max(0, H.mk | 0);
  if (H.go && !departing) { departing = true; net.onDepart?.(String(H.go)); }
  s.hexup = Math.max(0, H.hu | 0);
  if (typeof H.t === 'string') s.title = cleanText(H.t).slice(0, 40);

  // flotila (Firebase prázdné pole neuloží → chybějící H.v = žádná vozidla, třeba po prodeji posledního)
  const hv = Array.isArray(H.v) ? H.v : [];
  {
    syncFleet(s, hv);
    hv.forEach((e, i) => {
      if (!okVec(e, 0, 11) || !VEHICLES[e[0]]) return;
      let v = s.vehicles[i];
      if (!v) {
        v = { type: VEHICLES[e[0]].id, spot: e[3], garage: e[14] ? String(e[14]) : null, p: decU(e, 4), f: decF(e, 7), load: e[10] / 10, charge: e[15] | 0, lv: { width: e[1], speed: e[2], boost: e[12] | 0, hopper: e[13] | 0, battery: e[16] | 0, solar: e[17] | 0, cruise: e[18] | 0, edge: e[19] | 0 }, moved: true };
        s.vehicles[i] = v;
        vehSig[i] = '';
      }
      v.type = VEHICLES[e[0]].id;
      v.lv = { width: e[1] | 0, speed: e[2] | 0, boost: e[12] | 0, hopper: e[13] | 0, battery: e[16] | 0 };
      v.spot = e[3];
      v.garage = e[14] ? String(e[14]) : null;
      v.lv.battery = e[16] | 0;
      v.lv.solar = e[17] | 0;
      v.lv.cruise = e[18] | 0;                       // autopilot (L-40, L-41)
      v.lv.edge = e[19] | 0;
      v.lv.motor = e[20] | 0;                        // letouny (3.1): Motory, Baterie, Speciální
      v.lv.abatt = e[21] | 0;
      v.lv.special = e[22] | 0;
      if (s.driving === i) {                         // řídím ho já → poloha i baterie jsou moje; ve stání (nabíjení) vyšší od hostitele
        if (isNum(e[15]) && e[15] > v.charge + 0.5 && Math.abs(currentVehicleSpeed()) < 0.3) v.charge = e[15];
        return;
      }
      if (isNum(e[15])) v.charge = e[15];
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
      st.mk = Math.max(1, Math.min(2, Number(String(H.sm || '')[i]) || 1));
      if (!okVec(b, 0)) return;
      const c = cellDir(st.hex), e1 = anyTangent(c), e2 = cross(c, e1);
      const p = norm([c[0] + (e1[0] * b[0] + e2[0] * b[1]) / 10 / R, c[1] + (e1[1] * b[0] + e2[1] * b[1]) / 10 / R, c[2] + (e1[2] * b[0] + e2[2] * b[1]) / 10 / R]);
      const prev = botPrev[i] || p;
      if (b[2] === 1 && dot(prev, p) > Math.cos(4 / R)) sweepCapsule(prev, p, STATION.width / 2, STATION.power * 3, 1e12);
      botPrev[i] = p;
      st.robot.t = dot(prev, p) < 0.9999999999 ? norm([p[0] * 2 - prev[0], p[1] * 2 - prev[1], p[2] * 2 - prev[2]]) : st.robot.t;
      st.robot.p = p;
      st.robot.mode = b[2] === 1 ? 'work' : 'idle';
      st.store = Math.max(0, Number(b[3]) || 0);
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

  // pásy a logistika 3.0 (Firebase prázdné pole neuloží → chybějící H.bl = žádné pásy)
  applyBelts(H.bl);
  applyRocks(H.rk);
  if (!H.lg || H.lg.t !== lgSeen) { lgSeen = H.lg?.t ?? null; applyLogistics(H.lg); }   // stejný paket znovu = pytle by cukaly zpět

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
      v = { type: VEHICLES[e[0]].id, spot: e[3], garage: e[14] ? String(e[14]) : null, p: decU(e, 4), f: decF(e, 7), load: e[10] / 10, charge: e[15] | 0, lv: { width: e[1], speed: e[2], boost: e[12] | 0, hopper: e[13] | 0, battery: e[16] | 0, solar: e[17] | 0 } };
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
// Kondor nabral prach ze sila (3.1): kumulativně po depech, hostitel odečte ze skladu (tk)
const takes = {};
export function reportTake(id, kg) {
  if (!(kg > 0) || !id) return;
  takes[id] = (takes[id] || 0) + kg;
}
export function reportDeposit(id, kg) {
  if (!(kg > 0) || !id) return;
  deposits[id] = (deposits[id] || 0) + kg;
}

// Klient vystoupil z vozidla → nahlásit, kde stojí.
export function reportParked(i) {
  const v = game.s.vehicles[i];
  if (!v) return;
  parkSeq++;
  parkReport = [parkSeq, i, ...enc(v.p), ...encF(v.f), Math.round(v.load * 10)];
}

// Osobní postup klienta v cizím světě (nástroje, boty, poloha) – v prohlížeči hráče.
// Ukládá se u klienta i u hostitele: kdo svět převezme (nebo se k němu vrátí jako hráč), dostane své
// vlastní vybavení a polohu, ne ty, které jsou ve stavu světa po předchozím hostiteli.
const personalKey = (code = net.code) => `ms2_mp_${code}${PLANET.id === 'moon' ? '' : `_${PLANET.id}`}`;   // na Marsu od nuly
export function savePersonal() {
  if (net.mode === 'off' || !game.s || !net.code) return;
  const s = game.s;
  try {
    localStorage.setItem(personalKey(), JSON.stringify({
      tools: s.tools, tool: s.tool, boots: s.boots, belt: s.belt, jetpack: s.jetpack, hammer: s.hammer ? 1 : 0, hotbar: s.hotbar, sel: s.sel, p: s.p, f: s.f,
    }));
  } catch { /* nic */ }
}
// Moje osobní část světa code z prohlížeče do game.s. Vrací true, když jsem ji tu měl uloženou.
export function loadPersonal(code = net.code) {
  // místo za volantem není osobní část: ve stavu světa z cloudu je vozidlo předchozího hostitele – kdo svět převezme,
  // nesmí se objevit v jeho vozidle (na jeho souřadnicích), stojí pěšky na své uložené poloze
  if (game.s) game.s.driving = -1;
  try {
    const d = JSON.parse(localStorage.getItem(personalKey(code)));
    if (!d) { ensureHotbar(game.s); return false; }
    const s = game.s;
    if (d.tools && typeof d.tools === 'object') s.tools = d.tools;
    if (d.tool && s.tools[d.tool]) s.tool = d.tool;
    s.boots = Math.min(3, Math.max(0, d.boots | 0));
    s.belt = Math.min(2, Math.max(0, d.belt | 0));
    s.jetpack = d.jetpack ? 1 : 0;
    s.hammer = d.hammer ? 1 : 0;
    s.hotbar = Array.isArray(d.hotbar) ? d.hotbar : [s.tool];
    s.sel = d.sel | 0;
    if (okVec(d.p, 0) && okVec(d.f, 0)) { s.p = norm(d.p); s.f = tangentTo(s.p, d.f); }
  } catch { ensureHotbar(game.s); return false; }
  ensureHotbar(game.s);
  return true;
}

// ---------- každý snímek ----------

export function netTick(dt, fx, vehicleSpeed) {
  if (!net.world) return;
  smoothRemotes(dt);
  presenceTimer -= dt;
  if (presenceTimer <= 0) {
    presenceTimer = 1 / PRESENCE_HZ;
    pushWorldPresence(fx, vehicleSpeed);
  }
  if (net.mode === 'host') {
    host.timer -= dt;
    if (host.timer <= 0) { host.timer = 1 / HOST_HZ; pushHostState(); }
    host.cloudTimer -= dt;
    host.mapTimer -= dt;
    if (host.mapTimer <= 0) { host.mapTimer = CLOUD_MAP_S; scheduleSnapshot(); }   // i mapa prachu do cloudu (1× za minutu)
    else if (host.cloudTimer <= 0) { host.cloudTimer = CLOUD_STATE_S; saveWorldNow(false); }
  }
}

export const isClient = () => net.mode === 'client';
export const isOnline = () => net.mode !== 'off';
export { HEX_BONUS };
