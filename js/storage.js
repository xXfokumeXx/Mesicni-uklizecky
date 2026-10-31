// Ukládání a načítání her do slotů (IndexedDB, náhradně localStorage).
// Mapa prachu (9,2 mil. bodů) se neukládá celá: Měsíc se při startu vždy vygeneruje stejně
// (pevné semínko) a uloží se jen ROZDÍL = kolik prachu kde ubylo. Rozdíl je skoro všude nula,
// takže ho gzip v prohlížeči (CompressionStream) zmenší na desítky až stovky kB.
import { SAVE_KEY, PLANET } from './config.js';
import { game, newGame, upgradeState, newUid } from './state.js';
import { hexes, dustDiff, applyDustDiff } from './planet/dustmap.js';
import { VEHICLES, STATION } from './catalog.js';
import { parkingSpot } from './base.js';
import { tangentTo } from './planet/vec.js';

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

export async function unpackDust({ gz, bytes }) {
  const diff = gz ? await pipe(bytes, new DecompressionStream('gzip')) : bytes;
  return applyDustDiff(diff);
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
  return list.filter(r => SLOTS.includes(r.id) && r.meta).map(r => ({ id: r.id, ...r.meta }));
}

let saving = false;
let warned = false;

// Po odletu na jinou planetu se už nesmí uložit starý stav přes nový (main.js switchPlanet).
let locked = false;
export const lockSaves = () => { locked = true; };

// Planeta uložené hry ve slotu ('moon' / 'mars'), null = slot je prázdný.
export async function savePlanet(slot) {
  const rec = await getRecord(slot);
  return rec?.s ? (rec.s.planet === 'mars' ? 'mars' : 'moon') : null;
}

// Uloží nový stav světa na jiné planetě bez mapy prachu (ta se po načtení vygeneruje čistá).
export async function saveFresh(slot, s) {
  const rec = {
    id: slot,
    v: 2,
    meta: { title: s.title, savedAt: Date.now(), money: s.money, done: 0, total: 0, playMs: s.playMs || 0, planet: s.planet },
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
    const rec = {
      id: slot,
      v: 2,
      meta: {
        title: game.s.title, savedAt: now, money: game.s.money,
        done: hexes.doneCount, total: hexes.total, playMs: game.s.playMs, planet: game.s.planet,
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
    if (!rec?.s || rec.v !== 2) return false;
    if ((rec.s.planet === 'mars' ? 'mars' : 'moon') !== PLANET.id) return false;
    if (rec.dust && !(await unpackDust(rec.dust))) return false;      // bez mapy = čerstvě vygenerovaná planeta
    game.s = rec.s;
    upgradeState(game.s);
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
      const spot = parkingSpot(i);
      s.vehicles.push({ uid: newUid(), type: v.type, spot: i, p: spot.dir, f: tangentTo(spot.dir, spot.facing), load: 0, lv: v.lv || { width: 0, speed: 0 } });
    });
    const n = (old.stations || []).length;
    for (let k = 0; k < n; k++) s.money += Math.round(STATION.price * STATION.priceMult ** k);
    return true;
  } catch {
    return false;
  }
}
