// Ukládání do herního účtu (3.3, fáze U2 – Update 3.3/PREDAVKA-UCTY-A-UKLADANI.md, část 4).
// Přihlášený hráč má v cloudu profil, uložené hry a osobní postup ve sdílených světech; místní kopie (IndexedDB,
// localStorage) zůstává jako mezipaměť a pro hru bez připojení. Bez účtu se nic z toho nespouští.
//   ucty/<uid>/profil                 { look, ach, achStats, rank }            (jméno je v ucty/<uid>/jmeno)
//   ucty/<uid>/sloty/<id>/meta        { nazev, ulozeno, rev, verze, v, velikost, dilu, dh, gz, prach, planeta, done, total, money, playMs }
//   ucty/<uid>/sloty/<id>/stav        game.s jako JSON text (Firebase by jinak zahodil prázdná pole)
//   ucty/<uid>/sloty/<id>/dily/d<i>   mapa prachu (gzip rozdílu) v base64 po PART znacích – stejně jako svět v cloudu
//   ucty/<uid>/svety/<klíč>           osobní postup ve světě (JSON text, dnešní ms2_mp_<kód>[_mars])
// Pořadí zápisu slotu: díly (jen když se mapa změnila) → stav + meta jedním zápisem. Meta = potvrzení celého slotu.
// Kdy: ruční uložení, odchod do menu, skrytí karty (flushSlot) a z automatického ukládání nejvýš 1× za 2 min.
// Výběr verze (F-10 rev): ms2_sync = { uid: { slot: rev } } = revize, která byla naposledy v účtu i tady (společný stav).
import { account, onAccount } from './account.js';
import { firebaseApp } from './platform/fbase.js';
import { storageHooks, getSlotRecord, putSlotRecord, SLOTS, BACKUP_SLOT, toBase64, fromBase64 } from './storage.js';
import { profile, saveProfile, profileHooks, validLook } from './profile.js';
import { personalHooks } from './net.js';
import { VERSION } from './version.js';

export const PART = 400000;                   // znaků base64 v jednom dílu (= cloud.js PART)
const AUTO_MS = 120000;                       // automatické ukládání do účtu nejvýš 1× za 2 min
const PROFILE_MS = 10000;                     // profil nejvýš 1× za 10 s
const TIMEOUT = 15000;
const ALL = [...SLOTS, BACKUP_SLOT];

const on = () => !!account.user && !!firebaseApp();
const db = () => firebaseApp().database();
const TS = () => window.firebase.database.ServerValue.TIMESTAMP;
const root = () => `ucty/${account.user.uid}`;
const withTimeout = (p, ms = TIMEOUT) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

// Stav pro UI (seznam slotů): { slot: 'ok' | 'up' | 'down' | 'local' | 'cloud' | 'conflict' }
export const cloudState = { metas: {}, busy: false, error: '' };
const listeners = new Set();
export const onCloudState = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => { for (const fn of listeners) fn(cloudState); };

// ---------- společný stav (poslední synchronizovaná revize) ----------

function syncMap() { try { return JSON.parse(localStorage.getItem('ms2_sync')) || {}; } catch { return {}; } }
export function syncedRev(slot) { const v = syncMap()[account.user?.uid]?.[slot]; return Number.isFinite(v) ? v : null; }
function setSynced(slot, rev) {
  if (!account.user) return;
  const m = syncMap();
  (m[account.user.uid] ||= {})[slot] = rev;
  try { localStorage.setItem('ms2_sync', JSON.stringify(m)); } catch { /* nic */ }
}

// Krátký otisk textu (FNV-1a po krocích) – jestli se mapa od posledního nahrání změnila
function hash(text) {
  let h = 0x811c9dc5;
  const step = Math.max(1, Math.floor(text.length / 200000));
  for (let i = 0; i < text.length; i += step) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return `${text.length.toString(36)}-${(h >>> 0).toString(36)}`;
}

// ---------- sloty: nahrání ----------

const lastUp = {};                            // slot → čas posledního nahrání (automatické ukládání)
let queue = Promise.resolve();                // nahrávání jedno po druhém

async function upload(slot, rec) {
  if (!on() || !rec?.s) return false;
  const base = `${root()}/sloty/${slot}`;
  const b64 = rec.dust ? toBase64(rec.dust.bytes) : '';
  const dh = hash(b64);
  const old = cloudState.metas[slot] ?? (await withTimeout(db().ref(`${base}/meta`).get()).then(s => s.val(), () => null));
  const dilu = Math.ceil(b64.length / PART);
  if (!old || old.dh !== dh || old.dilu !== dilu) {             // mapa se změnila: celé díly (set nahradí i staré navíc)
    const dily = {};
    for (let i = 0; i < dilu; i++) dily[`d${i}`] = b64.slice(i * PART, (i + 1) * PART);
    await withTimeout(db().ref(`${base}/dily`).set(dilu ? dily : null), 60000);
  }
  const meta = {
    nazev: String(rec.meta?.title || rec.s.title || 'Hra').slice(0, 40), ulozeno: TS(), rev: Number(rec.s.rev) || 0,
    verze: VERSION, v: rec.v || 3, velikost: b64.length, dilu, dh, gz: !!rec.dust?.gz, prach: !!rec.dust,
    planeta: rec.s.planet === 'mars' ? 'mars' : 'moon', done: rec.meta?.done || 0, total: rec.meta?.total || 0,
    money: Math.round(rec.s.money || 0), playMs: Math.round(rec.s.playMs || 0),
  };
  await withTimeout(db().ref(base).update({ stav: JSON.stringify(rec.s), meta }));
  cloudState.metas[slot] = { ...meta, ulozeno: Date.now() };
  setSynced(slot, meta.rev);
  lastUp[slot] = Date.now();
  emit();
  return true;
}

function enqueue(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

// Po každém místním uložení (storage.js): do účtu nejvýš 1× za 2 min
function afterLocalSave(slot, rec) {
  if (!on() || !ALL.includes(slot)) return;
  if (Date.now() - (lastUp[slot] || 0) < AUTO_MS) return;
  lastUp[slot] = Date.now();
  enqueue(() => upload(slot, rec)).catch(e => console.warn('[účet] slot se nenahrál', slot, e?.code || e?.message || e));
}

// Hned (ruční uložení, odchod do menu, skrytí karty): nahraje místní záznam slotu
export function flushSlot(slot) {
  if (!on() || !ALL.includes(slot)) return Promise.resolve(false);
  return enqueue(async () => upload(slot, await getSlotRecord(slot))).catch(e => { console.warn('[účet] slot se nenahrál', slot, e?.code || e?.message || e); return false; });
}

// ---------- sloty: stažení ----------

export async function cloudSlotMeta(slot) {
  if (!on()) return null;
  const meta = (await withTimeout(db().ref(`${root()}/sloty/${slot}/meta`).get())).val();
  cloudState.metas[slot] = meta || null;
  return meta || null;
}

// Meta všech slotů v účtu (po jednom – celý uzel sloty by stáhl i mapy)
export async function refreshCloudSlots() {
  if (!on()) { cloudState.metas = {}; emit(); return cloudState.metas; }
  cloudState.busy = true; emit();
  try {
    await Promise.all(ALL.map(s => cloudSlotMeta(s).catch(() => undefined)));
    cloudState.error = '';
  } catch { cloudState.error = 'Účet teď neodpovídá – ukazuji jen uložení v tomto zařízení.'; }
  cloudState.busy = false; emit();
  return cloudState.metas;
}

// Stáhne slot z účtu do místního úložiště (jako = pod jiným id, např. záloha)
async function download(slot, meta, as = slot) {
  const base = `${root()}/sloty/${slot}`;
  const stav = (await withTimeout(db().ref(`${base}/stav`).get(), 30000)).val();
  if (!stav) throw new Error('stav');
  let dust = null;
  if (meta.prach && meta.dilu) {
    const parts = await Promise.all(Array.from({ length: meta.dilu }, (_, i) => withTimeout(db().ref(`${base}/dily/d${i}`).get(), 60000).then(s => s.val() || '')));
    const b64 = parts.join('');
    if (b64.length !== meta.velikost || hash(b64) !== meta.dh) throw new Error('mapa'); // nedokončený zápis / jiný díl
    dust = { gz: !!meta.gz, bytes: fromBase64(b64) };
  }
  const s = JSON.parse(stav);
  await putSlotRecord({
    id: as, v: meta.v || s.v || 3,
    meta: { title: meta.nazev, savedAt: meta.ulozeno || Date.now(), money: meta.money, done: meta.done, total: meta.total, playMs: meta.playMs, planet: meta.planeta, ver: meta.verze },
    s, dust,
  });
  if (as === slot) setSynced(slot, Number(meta.rev) || 0);
  return true;
}

// Před načtením slotu (main.js launch): vybere novější verzi. ask(local, cloud) → Promise<'cloud' | 'local' | null>
// při sporu (hrál jsi na obou zařízeních od poslední synchronizace). Vrací 'ok', 'cancel' (hráč zavřel dotaz)
// nebo 'offline' (účet neodpovídá – hraje se z místní kopie).
export async function syncSlotForLoad(slot, ask) {
  if (!on()) return 'ok';
  let meta;
  try { meta = await cloudSlotMeta(slot); } catch { return 'offline'; }
  const local = await getSlotRecord(slot);
  const lrev = local ? Number(local.s.rev) || 0 : -1;
  try {
    if (!meta) { if (local) await flushSlot(slot); return 'ok'; }            // v účtu není: nahrát
    if (!local) { await download(slot, meta); return 'ok'; }                // jen v účtu: stáhnout
    const crev = Number(meta.rev) || 0;
    if (crev === lrev) { setSynced(slot, crev); return 'ok'; }
    const base = syncedRev(slot);
    const cloudChanged = base === null || crev !== base;
    const localChanged = base === null || lrev !== base;
    if (cloudChanged && !localChanged) { await download(slot, meta); return 'ok'; }
    if (localChanged && !cloudChanged) { await flushSlot(slot); return 'ok'; }
    // obě se změnily: zeptat se; druhá verze půjde do zálohy (místně i v účtu)
    const pick = await ask({ title: local.meta?.title, savedAt: local.meta?.savedAt, done: local.meta?.done, total: local.meta?.total },
      { title: meta.nazev, savedAt: meta.ulozeno, done: meta.done, total: meta.total });
    if (!pick) return 'cancel';
    if (pick === 'cloud') {
      await putSlotRecord({ ...local, id: BACKUP_SLOT });
      await download(slot, meta);
    } else {
      await download(slot, meta, BACKUP_SLOT);
      await flushSlot(slot);
    }
    await flushSlot(BACKUP_SLOT);
    return 'ok';
  } catch (e) {
    console.warn('[účet] synchronizace slotu', slot, e?.message || e);
    return 'offline';
  }
}

// Smazání slotu i v účtu (menu: Smazat, když je hráč přihlášený)
export async function deleteCloudSlot(slot) {
  if (!on() || !ALL.includes(slot)) return;
  await withTimeout(db().ref(`${root()}/sloty/${slot}`).remove());
  cloudState.metas[slot] = null;
  const m = syncMap();
  if (m[account.user.uid]) { delete m[account.user.uid][slot]; try { localStorage.setItem('ms2_sync', JSON.stringify(m)); } catch { /* nic */ } }
  emit();
}

// Stav slotu pro seznam: 'ok' (stejné), 'up' (tady novější), 'down' (v účtu novější), 'local' (jen tady),
// 'cloud' (jen v účtu), 'conflict' (změněné na obou), null (bez účtu)
export function slotSyncState(slot, localRev) {
  if (!account.user) return null;
  const meta = cloudState.metas[slot];
  if (meta === undefined) return null;                                       // ještě nezjištěno
  if (!meta) return localRev == null ? null : 'local';
  if (localRev == null) return 'cloud';
  const crev = Number(meta.rev) || 0;
  if (crev === localRev) return 'ok';
  const base = syncedRev(slot);
  if (base === null) return 'conflict';
  if (crev !== base && localRev !== base) return 'conflict';
  return crev !== base ? 'down' : 'up';
}

// ---------- profil ----------

let profileTimer = 0, profileAt = 0;
function pushProfile() {
  if (!on()) return;
  clearTimeout(profileTimer);
  const wait = Math.max(0, PROFILE_MS - (Date.now() - profileAt));
  profileTimer = setTimeout(() => {
    if (!on()) return;                                      // mezitím odhlášen / účet smazán
    profileAt = Date.now();
    // transakcí se sloučením – jiné zařízení mohlo mezitím přidat úspěch (prosté přepsání by ho smazalo)
    db().ref(`${root()}/profil`).transaction(cur => ({ ...mergeProfile(cur, profile), look: profile.look, at: TS() }))
      .catch(e => console.warn('[účet] profil se nenahrál', e?.code || e));
  }, wait);
}

// Sloučení dvou profilů: úspěchy sjednotit (dřívější čas), statistiky = maximum, hodnost = vyšší. Vzhled řeší volající.
function mergeProfile(a, b) {
  const ach = { ...(a?.ach || {}) };
  for (const [k, t] of Object.entries(b?.ach || {})) if (Number.isFinite(t)) ach[k] = Number.isFinite(ach[k]) ? Math.min(ach[k], t) : t;
  const st = { ...(a?.achStats || {}) };
  for (const [k, v] of Object.entries(b?.achStats || {})) if (Number.isFinite(v)) st[k] = Math.max(Number(st[k]) || 0, v);
  const ra = Number.isInteger(a?.rank) && a.rank >= 0 ? a.rank : -1, rb = Number.isInteger(b?.rank) && b.rank >= 0 ? b.rank : -1;
  return {
    ach: Object.fromEntries(Object.entries(ach).filter(([, t]) => Number.isFinite(t))),
    achStats: Object.fromEntries(Object.entries(st).filter(([, v]) => Number.isFinite(v))),
    rank: Math.max(ra, rb),
  };
}

// Po přihlášení: vzhled z účtu (když v něm je), úspěchy a statistiky sloučit s tímto zařízením
async function pullProfile() {
  const p = (await withTimeout(db().ref(`${root()}/profil`).get())).val();
  if (p) {
    if (p.look) profile.look = validLook(p.look);
    const m = mergeProfile(p, profile);
    profile.ach = m.ach;
    profile.achStats = m.achStats;
    profile.rank = m.rank >= 0 ? m.rank : profile.rank;
  }
  profileAt = 0;
  saveProfile();                                            // místně + (háček) zpět do účtu se sloučenými úspěchy
}

// ---------- osobní postup ve světech ----------

const personalAt = {};
const worldKey = key => key.replace(/^ms2_mp_/, '').replace(/[.#$/[\]]/g, '_');
function pushPersonal(key, text, force = false) {
  if (!on()) return;
  if (!force && Date.now() - (personalAt[key] || 0) < AUTO_MS) return;
  personalAt[key] = Date.now();
  db().ref(`${root()}/svety/${worldKey(key)}`).set(text).catch(e => console.warn('[účet] postup ve světě', e?.code || e));
}
async function pullPersonal(key) {
  if (!on()) return;
  try {
    const text = (await withTimeout(db().ref(`${root()}/svety/${worldKey(key)}`).get(), 6000)).val();
    if (!text) return;
    const cloud = JSON.parse(text);
    let local = null;
    try { local = JSON.parse(localStorage.getItem(key)); } catch { /* nic */ }
    if (!local || (Number(cloud.at) || 0) > (Number(local.at) || 0)) localStorage.setItem(key, text);
  } catch (e) { console.warn('[účet] postup ve světě se nestáhl', e?.message || e); }
}
// Všechny dnešní ms2_mp_* (registrace / první přihlášení na zařízení)
function pushAllPersonal() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith('ms2_mp_')) pushPersonal(k, localStorage.getItem(k), true);
    }
  } catch { /* nic */ }
}

// Odchod ze hry / skrytí karty (main.js): osobní postup hned
export function flushPersonal(key) {
  try { const text = localStorage.getItem(key); if (text) pushPersonal(key, text, true); } catch { /* nic */ }
}

// ---------- přihlášení a registrace ----------

// Po přihlášení / registraci: profil, sloty z tohoto zařízení, které v účtu ještě nejsou, osobní postup ve světech.
// „Kdo už hraje bez účtu, při registraci o nic nepřijde“ – sloty se nahrají, sloučí se úspěchy.
async function onLogin() {
  try { await pullProfile(); } catch (e) { console.warn('[účet] profil', e?.message || e); }
  const metas = await refreshCloudSlots();
  for (const slot of ALL) {
    if (metas[slot] !== null) continue;                     // v účtu je, nebo nejde zjistit → rozhodne se při načtení
    const rec = await getSlotRecord(slot);
    if (rec) await flushSlot(slot);
  }
  pushAllPersonal();
}

let lastUid = null;
export function initCloudSave() {
  storageHooks.afterSave = afterLocalSave;
  profileHooks.afterSave = pushProfile;
  personalHooks.saved = (key, text) => pushPersonal(key, text);
  personalHooks.pull = pullPersonal;
  onAccount(user => {
    const uid = user?.uid || null;
    if (uid === lastUid) return;
    lastUid = uid;
    cloudState.metas = {};
    if (uid) onLogin().catch(e => console.warn('[účet] synchronizace po přihlášení', e?.message || e));
    else emit();
  });
}
