// Ukládání a načítání her do slotů (IndexedDB, náhradně localStorage).
// Mapa prachu (9,2 mil. bodů) se neukládá celá: Měsíc se při startu vždy vygeneruje stejně
// (pevné semínko) a uloží se jen ROZDÍL = kolik prachu kde ubylo. Rozdíl je skoro všude nula,
// takže ho gzip v prohlížeči (CompressionStream) zmenší na desítky až stovky kB.
import { SAVE_KEY, PLANET } from './config.js';
import { game, newGame, newUid, pickPersonal, migrateState, canLoadVersion, SAVE_VERSION } from './state.js';
import { hexes, dustDiff, applyDustDiff, mergeDustDiff } from './planet/dustmap.js';
import { VEHICLES, STATION } from './catalog.js';
import { legacyGarages, homeSpot } from './structures.js';    // (zároveň registruje převod v2 → v3, MIGRATE[2])
import { tangentTo } from './planet/vec.js';
import { VERSION, cmpVersion } from './version.js';

export const SLOTS = ['slot1', 'slot2', 'slot3', 'slot4', 'slot5'];
const DB_NAME = 'moonsweepers2', STORE = 'saves';
const LAST_KEY = 'ms2_last_slot';
const LS_PREFIX = 'ms2_save_';

const canCompress = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

// ---------- binární pomocníci ----------

export function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(bin);
}
export const fromBase64 = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

// Komprimovaný rozdíl mapy prachu: { gz, bytes }.
export async function packDust() {
  const diff = dustDiff();
  if (!canCompress) return { gz: false, bytes: diff };
  return { gz: true, bytes: await pipe(diff, new CompressionStream('gzip')) };
}

export async function unpackDust({ gz, bytes }, merge = false) {
  const diff = gz ? await pipe(bytes, new DecompressionStream('gzip')) : bytes;
  return merge ? mergeDustDiff(diff) : applyDustDiff(diff);
}

// ---------- IndexedDB (s náhradou) ----------

let dbPromise = null;
function openDb() {
  if (dbPromise) return dbPromise;
  // Otevře databázi v její stávající verzi. Jen když v ní chybí úložiště (prázdná databáze), otevře ji
  // znovu o verzi výš a úložiště založí – uložené hry ani jiné otevřené karty to neovlivní.
  const tryOpen = version => new Promise((resolve) => {
    try {
      const req = version ? indexedDB.open(DB_NAME, version) : indexedDB.open(DB_NAME);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  dbPromise = tryOpen(0).then(db => {
    if (!db || db.objectStoreNames.contains(STORE)) return db;
    const next = db.version + 1;
    db.close();
    return tryOpen(next);
  });
  return dbPromise;
}

async function idb(mode, fn) {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result ?? true);
      tx.onerror = tx.onabort = () => resolve(undefined);
    } catch { resolve(undefined); }
  });
}

async function putRecord(rec) {
  const ok = await idb('readwrite', st => st.put(rec));
  if (ok !== undefined) return true;
  try {                                            // náhrada: localStorage (base64)
    localStorage.setItem(LS_PREFIX + rec.id, JSON.stringify({ ...rec, dust: rec.dust && { gz: rec.dust.gz, b64: toBase64(rec.dust.bytes) } }));
    return true;
  } catch { return false; }
}

async function getRecord(id) {
  const rec = await idb('readonly', st => st.get(id));
  if (rec) return rec;
  try {
    const raw = JSON.parse(localStorage.getItem(LS_PREFIX + id));
    if (raw) return { ...raw, dust: raw.dust && { gz: raw.dust.gz, bytes: fromBase64(raw.dust.b64) } };
  } catch { /* nic */ }
  return null;
}

async function allRecords() {
  const list = (await idb('readonly', st => st.getAll())) || [];
  const ids = new Set(list.map(r => r.id));
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(LS_PREFIX) || ids.has(k.slice(LS_PREFIX.length))) continue;
      const raw = JSON.parse(localStorage.getItem(k));
      if (raw?.meta) list.push({ id: raw.id, meta: raw.meta });
    }
  } catch { /* nic */ }
  return list;
}

// ---------- veřejné API ----------

// Seznam uložených her (jen popisy, bez map): [{ id, title, savedAt, money, done, total, playMs }]
export async function listSaves() {
  const list = await allRecords();
  return list.filter(r => SLOTS.includes(r.id) && r.meta).map(r => ({ id: r.id, ...r.meta, v: r.v || 2 }));
}

// ---------- export / import slotu (L-50) ----------
// Soubor .json: { format, fv, v, exportedAt, meta, s, dust: { gz, b64 } } – stav i zkomprimovaný rozdíl mapy prachu.
// Slouží k lokálnímu testu (localhost má jiné úložiště než GitHub Pages) a jako záloha před nasazením nové verze.
const EXPORT_FORMAT = 'mesicni-zametacky-slot';

export async function exportSlot(slot) {
  const rec = await getRecord(slot);
  if (!rec?.s) return null;
  const data = {
    format: EXPORT_FORMAT, fv: 1, v: rec.v || 2, exportedAt: Date.now(),
    meta: rec.meta, s: rec.s,
    dust: rec.dust ? { gz: !!rec.dust.gz, b64: toBase64(rec.dust.bytes) } : null,
  };
  const name = `${(rec.meta?.title || slot).replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 40)}-${new Date().toISOString().slice(0, 10)}.json`;
  return { name, text: JSON.stringify(data) };
}

// Nahraje soubor do PRÁZDNÉHO slotu. Vrací { ok, error }.
export async function importSlot(slot, text) {
  let data;
  try { data = JSON.parse(text); } catch { return { ok: false, error: 'Soubor není platný JSON.' }; }
  if (data?.format !== EXPORT_FORMAT || !data.s || typeof data.s !== 'object') return { ok: false, error: 'Tohle není uložená hra Měsíčních zametaček.' };
  if (!canLoadVersion({ v: data.s.v ?? data.v })) return { ok: false, error: `Hra je z novější verze (${data.s.v ?? data.v}) – tahle verze ji neotevře.` };
  if (cmpVersion(data.meta?.ver, VERSION) > 0) return { ok: false, error: `Hra je uložená ve verzi ${data.meta.ver} – obnov stránku (Ctrl+F5).` };
  if ((await getRecord(slot))?.s) return { ok: false, error: 'Slot není prázdný – nejdřív ho smaž, nebo vyber jiný.' };   // (getRecord vrací u prázdného slotu true)
  let dust = null;
  try { if (data.dust) dust = { gz: !!data.dust.gz, bytes: fromBase64(data.dust.b64) }; } catch { return { ok: false, error: 'Mapa prachu v souboru je poškozená.' }; }
  const s = data.s;
  const meta = { ...(data.meta || {}), title: data.meta?.title || s.title || 'Importovaná hra', planet: s.planet === 'mars' ? 'mars' : 'moon' };
  const ok = await putRecord({ id: slot, v: data.v || s.v || 2, meta, s, dust });
  return ok ? { ok: true } : { ok: false, error: 'Do prohlížeče se nepodařilo uložit (plné úložiště?).' };
}

let saving = false;
let warned = false;

// Po odletu na jinou planetu se už nesmí uložit starý stav přes nový (main.js switchPlanet).
let locked = false;
export const lockSaves = () => { locked = true; };
export const savesLocked = () => locked;

// Planeta uložené hry ve slotu ('moon' / 'mars'), null = slot je prázdný.
export async function savePlanet(slot) {
  return (await peekSave(slot))?.planet || null;
}

// Krátký pohled do uložené hry bez načtení mapy: { planet, netCode, last, done (hotové hexy) } nebo null.
export async function peekSave(slot) {
  const rec = await getRecord(slot);
  if (!rec?.s) return null;
  return {
    planet: rec.s.planet === 'mars' ? 'mars' : 'moon', netCode: rec.s.netCode || null, last: rec.s.last || 0, done: rec.meta?.done ?? 0,
    rev: Number(rec.s.rev) || 0, crv: Number(rec.s.crv) || 0,  // F-10: revize světa ve slotu a v cloudu při poslední synchronizaci
    personal: pickPersonal(rec.s),                             // moje vybavení a poloha z vlastního slotu
  };
}

// ---------- předávka mapy při převzetí hostitele (F-10) ----------
// Hráč, který po odchodu hostitele převezme svět, načte stránku znovu a svět stáhne z cloudu. Mapa v cloudu
// ale může být až minutu stará – jeho vlastní mapa (snímek + tahy všech) je novější. Před znovunačtením ji
// proto uloží sem a po načtení z cloudu ji do mapy sloučí (nic zameteného se nezasype).
const HANDOFF_ID = 'handoff';

export async function stashHandoff(code) {
  try {
    return await putRecord({ id: HANDOFF_ID, code, planet: PLANET.id, at: Date.now(), done: hexes.doneCount, dust: await packDust() });
  } catch { return false; }
}

// Vrátí počet hotových hexů po sloučení, nebo -1 (žádná / stará / jiný svět).
export async function takeHandoff(code) {
  try {
    const rec = await idb('readonly', st => st.get(HANDOFF_ID));
    if (!rec || rec === true) return -1;
    await idb('readwrite', st => st.delete(HANDOFF_ID));         // jednorázová
    if (rec.code !== code || rec.planet !== PLANET.id || Date.now() - rec.at > 10 * 60000 || !rec.dust) return -1;
    return (await unpackDust(rec.dust, true)) ? hexes.doneCount : -1;
  } catch { return -1; }
}

// Řádek do konzole při každém načtení světa (F-10): odkud je mapa prachu, revize a kolik hexů je hotových.
export function logWorldLoad(source, extra = '') {
  const s = game.s;
  console.info(`[svět] prach z: ${source}, rev ${s?.rev ?? '?'} (cloud ${s?.crv ?? '?'}), vyčištěno ${hexes.doneCount} / ${hexes.total} hexů${s?.netCode ? `, svět ${s.netCode}` : ''}${extra ? ` · ${extra}` : ''}`);
}

// Uloží nový stav světa na jiné planetě bez mapy prachu (ta se po načtení vygeneruje čistá).
export async function saveFresh(slot, s) {
  const rec = {
    id: slot,
    v: SAVE_VERSION,
    meta: { title: s.title, savedAt: Date.now(), money: s.money, done: 0, total: 0, playMs: s.playMs || 0, planet: s.planet, ver: VERSION },
    s,
    dust: null,
  };
  return putRecord(rec);
}

// Uloží aktuální hru do slotu (výchozí = slot, ze kterého se hraje). Vrací true/false.
export async function saveGame(slot = game.slot, onFail) {
  if (saving || locked || !game.s || !slot || game.mode === 'client') return false;
  saving = true;
  try {
    const now = Date.now();
    game.s.playMs = (game.s.playMs || 0) + (game.started ? now - game.started : 0);
    game.started = now;
    game.s.last = now;
    game.s.rev = (Number(game.s.rev) || 0) + 1;                  // F-10: revize roste s každým uložením
    const rec = {
      id: slot,
      v: SAVE_VERSION,
      meta: {
        title: game.s.title, savedAt: now, money: game.s.money,
        done: hexes.doneCount, total: hexes.total, playMs: game.s.playMs, planet: game.s.planet,
        ver: VERSION,                                            // L-60: kterou verzí hry uloženo
      },
      s: game.s,
      dust: await packDust(),
    };
    const ok = await putRecord(rec);
    if (ok) {
      game.slot = slot;
      try { localStorage.setItem(LAST_KEY, slot); } catch { /* nic */ }
    } else throw new Error('save');
    return true;
  } catch {
    if (!warned && onFail) {
      warned = true;
      onFail('Hru se nepodařilo uložit do prohlížeče (plné nebo blokované úložiště).');
    }
    return false;
  } finally {
    saving = false;
  }
}

// Načte hru ze slotu do čerstvě vygenerovaného Měsíce. Vrací true/false.
export async function loadGame(slot) {
  try {
    const rec = await getRecord(slot);
    if (!rec?.s || !canLoadVersion({ v: rec.s.v ?? rec.v })) return false;      // novější verze hry se neotevře
    if (cmpVersion(rec.meta?.ver, VERSION) > 0) return false;                     // L-60: uloženo novější verzí (3.2 …)
    if ((rec.s.planet === 'mars' ? 'mars' : 'moon') !== PLANET.id) return false;
    if (rec.dust && !(await unpackDust(rec.dust))) return false;      // bez mapy = čerstvě vygenerovaná planeta
    game.s = rec.s;
    if (game.s.v == null) game.s.v = rec.v;
    migrateState(game.s);
    game.slot = slot;
    try { localStorage.setItem(LAST_KEY, slot); } catch { /* nic */ }
    return true;
  } catch {
    return false;
  }
}

export async function deleteSave(slot) {
  await idb('readwrite', st => st.delete(slot));
  try { localStorage.removeItem(LS_PREFIX + slot); } catch { /* nic */ }
}

export function lastSlot() {
  try { return localStorage.getItem(LAST_KEY); } catch { return null; }
}

// Je v prohlížeči hra z verze 1? (mapa je jiná, převede se jen vybavení a peníze)
export function hasV1Save() {
  try { return !!JSON.parse(localStorage.getItem(SAVE_KEY))?.s; } catch { return false; }
}

// Nová hra s vybavením a penězi z verze 1. Stanice robotů stály na hexech staré mapy,
// proto se jejich cena vrátí v penězích.
export function importV1(title) {
  newGame(title);
  try {
    const old = JSON.parse(localStorage.getItem(SAVE_KEY)).s;
    const s = game.s;
    s.money = Number(old.money) || 0;
    if (old.tools && typeof old.tools === 'object') s.tools = old.tools;
    if (old.tool && s.tools[old.tool]) s.tool = old.tool;
    s.boots = Math.min(3, Math.max(0, old.boots | 0));
    s.garage = !!old.garage;
    (old.vehicles || []).forEach((v, i) => {
      if (!VEHICLES.some(x => x.id === v.type)) return;
      s.vehicles.push({ uid: newUid(), type: v.type, spot: i, p: s.p, f: s.f, load: 0, lv: { width: 0, speed: 0, boost: 0, hopper: 0, ...(v.lv || {}) } });
    });
    legacyGarages(s);                                 // garáž z v1 → stavba garáže, vozidla na její místa
    for (const v of s.vehicles) { const h = homeSpot(v); v.p = h.dir; v.f = tangentTo(h.dir, h.facing); }
    const n = (old.stations || []).length;
    for (let k = 0; k < n; k++) s.money += Math.round(800 * STATION.priceMult ** k);   // v1: stanice stála $800
    return true;
  } catch {
    return false;
  }
}
