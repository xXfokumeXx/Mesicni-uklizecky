// Svět v cloudu (Firebase Realtime Database, tarif Spark): aby se dalo hrát i bez zapnutého počítače
// hostitele. Hostitel průběžně ukládá stav světa a mapu prachu; když odejde, převezme hostování další
// hráč ve světě, a když nikdo nehostuje, může svět otevřít kdokoli z party (s heslem, pokud ho svět má).
//
// Cesty v databázi (pravidla v database.rules.json):
//   w/<kód>/meta     { t: název, pn: planeta, at: kdy uloženo, lk: 1 = s heslem, d: dočištěné hexy v uložené mapě }
//                    – vidí každý (seznam, menu); d se zapisuje jen s mapou → podle něj se vybírá lepší mapa
//   w/<kód>/state    stav světa game.s jako JSON text (Firebase by jinak zahodil prázdná pole)
//   w/<kód>/head     hlavička snímku mapy prachu { sv, parts, gz, seqs, rc, at }
//   w/<kód>/parts/pN kousky snímku mapy (base64)
//   w/<kód>/host     zámek hostitele { p: peer, u: uid, n: jméno } – po odpojení ho Firebase sám smaže
//   secrets/<kód>    { h: SHA-256(kód:heslo), o: { uid vlastníka: true } } – nikdo ho nepřečte
//   members/<kód>/<uid>  hash hesla, které hráč zadal (pravidla ho pustí, jen když sedí)
// Data světa (w/<kód>/…, rooms/svet-<kód>) smí s heslem číst a zapisovat jen členové.
import { game, migrateState, canLoadVersion } from './state.js';
import './structures.js';                                     // registruje převod v2 → v3 (MIGRATE[2])
import { profile } from './profile.js';
import { PLANET } from './config.js';
import { net } from './net.js';
import { packDust, unpackDust, toBase64, fromBase64 } from './storage.js';
import { hexes } from './planet/dustmap.js';
import { VERSION, cmpVersion } from './version.js';

export const PART = 400000;                     // velikost kousku snímku mapy (znaků base64)
const w = code => `w/${code}`;
const ok = () => !!net.fb;

// ---------- heslo ----------

export async function passwordHash(code, password) {
  const bytes = new TextEncoder().encode(`${code}:${password}`);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

// Smí tento prohlížeč do světa? 'ok' = bez hesla nebo už heslo zadal, 'need' = potřeba heslo.
export async function checkAccess(code) {
  if (!ok()) return 'ok';
  try {
    const meta = (await net.fb.ref(`${w(code)}/meta`).get()).val();
    if (!meta?.lk) return 'ok';
    const mine = await net.fb.ref(`members/${code}/${net.uid}`).get();
    return mine.exists() ? 'ok' : 'need';
  } catch {
    return 'ok';                                               // nejde přečíst → rozhodnou pravidla při vstupu
  }
}

// Zadané heslo: zapíše členství; pravidla Firebase ho přijmou, jen když hash sedí. Vrací true / false.
export async function enterPassword(code, password) {
  if (!ok()) return true;
  try {
    await net.fb.ref(`members/${code}/${net.uid}`).set(await passwordHash(code, password));
    return true;
  } catch {
    return false;
  }
}

// Hostitel nastaví (password = text) nebo zruší (password = '') heslo svého světa. Všechno jedním
// zápisem: hráči, kteří jsou právě ve světě (keep = jejich uid), se rovnou zapíšou mezi členy, takže jim
// Firebase nezruší spojení. Ostatní (i dřívější členové) musí nové heslo zadat.
export async function setWorldPassword(code, password, keep = []) {
  if (!ok()) return false;
  try {
    if (!password) {
      await net.fb.ref().update({ [`members/${code}`]: null, [`secrets/${code}`]: null, [`${w(code)}/meta/lk`]: 0 });
      return true;
    }
    const h = await passwordHash(code, password);
    const members = { [net.uid]: h };
    for (const uid of keep) if (uid) members[uid] = h;
    await net.fb.ref().update({
      [`secrets/${code}`]: { h, o: { [net.uid]: true } },
      [`members/${code}`]: members,
      [`${w(code)}/meta/lk`]: 1,
    });
    return true;
  } catch (e) {
    console.warn('Heslo světa', e);
    return false;
  }
}

// ---------- zámek hostitele ----------

// Zkusí se stát hostitelem světa. Vrací true, nebo jméno toho, kdo už hostuje.
export async function claimHost(code) {
  if (!ok()) return true;
  const ref = net.fb.ref(`${w(code)}/host`);
  try {
    const res = await ref.transaction(cur => {
      if (cur && cur.u !== net.uid) return undefined;          // hostuje někdo jiný → nechat
      return { p: net.me || '', u: net.uid, n: String(profile.name).slice(0, 16), at: Date.now() };
    });
    if (!res.committed) return res.snapshot.val()?.n || 'jiný hráč';
    await ref.onDisconnect().remove();
    return true;
  } catch (e) {
    console.warn('Zámek hostitele', e);
    return true;                                               // bez zámku hrát dál (horší než nehrát)
  }
}

export function releaseHost(code) {
  if (!ok() || !code) return Promise.resolve();
  return net.fb.ref(`${w(code)}/host`).remove().catch(() => {});
}

export async function hostOf(code) {
  if (!ok()) return null;
  try { return (await net.fb.ref(`${w(code)}/host`).get()).val(); } catch { return null; }
}

// ---------- stav světa ----------

export async function cloudMeta(code) {
  if (!ok() || !code) return null;
  try { return (await net.fb.ref(`${w(code)}/meta`).get()).val(); } catch { return null; }
}

// Uloží stav světa (rychlé, každých ~20 s) a s full = true i mapu prachu (pomalejší, ~1× za minutu).
// sv = číslo snímku mapy, extra = { seqs, rc } pro hráče, kteří se právě připojují.
// Pojistka: když je svět v cloudu novější a na jiné planetě než to, co hraju, nesmím ho přepsat.
//
// F-10 (10. 11.): každý zápis zvýší revizi světa s.rev a zapíše ji do meta/rv (+ meta/wu = kdo zapsal).
// Podle revize (ne podle hodin různých počítačů) se při otevření vybírá novější stav. Před zápisem se
// přečte meta a zápis se odmítne, když by snížil revizi (zapsal mezitím jiný hostitel), a mapa se nezapíše,
// když by počet dočištěných hexů klesl o víc než 5 % proti uložené mapě (dp = planeta té mapy).
// Zápisy jdou za sebou (fronta), výsledek posledního je v cloudStatus (net.js podle něj hlásí chybu a zkouší znovu).
let blocked = false;
export const blockCloud = on => { blocked = !!on; };
export const cloudBlocked = () => blocked;
export const cloudStatus = { ok: true, reason: '', at: 0, fails: 0 };
const SESSION = Math.random().toString(36).slice(2, 10);       // tahle karta (rozliší vlastní zápisy od cizích)
const WRITE_TIMEOUT = 30000;
let chain = Promise.resolve();

const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout:${what}`)), ms))]);

export function saveCloud(code, opts = {}) {
  if (opts.quick) return writeCloud(code, { ...opts, full: false });   // zavírání karty: odeslat hned, ne až po frontě
  const run = chain.then(() => writeCloud(code, opts));
  chain = run.catch(() => {});
  return run;
}

async function writeCloud(code, { full = false, sv = 0, extra = {}, quick = false } = {}) {
  if (!ok() || !code || !game.s || blocked) return false;
  const s = game.s;
  const fail = (reason, e) => {
    cloudStatus.ok = false; cloudStatus.reason = reason; cloudStatus.at = Date.now(); cloudStatus.fails++;
    console.warn(`[svět] zápis do cloudu se nepovedl (${reason})`, e || '');
    return false;
  };
  try {
    let mapOk = full;
    if (!quick) {                                               // quick = zavírání karty: hned odeslat, bez čtení
      const meta = (await withTimeout(net.fb.ref(`${w(code)}/meta`).get(), WRITE_TIMEOUT, 'meta')).val();
      if (meta && Number(meta.rv) > (Number(s.rev) || 0) && meta.ws !== SESSION) {
        blocked = true;                                         // novější svět zapsal někdo jiný – nepřepisovat
        console.warn(`[svět] zápis odmítnut: v cloudu je revize ${meta.rv}, hraju ${s.rev} (zapsal ${meta.wu || '?'})`);
        return fail('conflict');
      }
      if (meta && cmpVersion(meta.ver, VERSION) > 0) {          // L-60: svět uložila novější verze hry – starší ho nepřepíše
        blocked = true;
        console.warn(`[svět] zápis odmítnut: svět je uložený novější verzí ${meta.ver}`);
        return fail('newer');
      }
      if (full && meta && meta.dp === PLANET.id && Number(meta.d) > 20 && hexes.doneCount < Number(meta.d) * 0.95) {
        mapOk = false;                                          // mapa by se „zasypala“ – stav ano, mapa ne
        console.warn(`[svět] mapa prachu se nezapíše: v cloudu ${meta.d} hotových hexů, tady jen ${hexes.doneCount} (pokles o víc než 5 %)`);
        cloudStatus.reason = 'map-guard';
      }
    }
    const rv = (Number(s.rev) || 0) + 1;
    s.rev = rv;
    s.crv = rv;
    s.last = Date.now();
    const updates = {
      state: JSON.stringify(s),
      'meta/t': String(s.title || 'Svět').slice(0, 40),
      'meta/pn': PLANET.id,
      'meta/at': s.last,
      'meta/rv': rv,
      'meta/wu': net.uid || '',
      'meta/ws': SESSION,
      'meta/ver': VERSION,                                       // L-60: kterou verzí hry uloženo
    };
    if (mapOk) {
      const packed = await packDust();
      const b64 = toBase64(packed.bytes);
      const parts = Math.max(1, Math.ceil(b64.length / PART));
      for (let i = 0; i < parts; i++) updates[`parts/p${i}`] = { sv, d: b64.slice(i * PART, (i + 1) * PART) };
      updates.head = { sv, parts, gz: packed.gz, seqs: extra.seqs || {}, rc: extra.rc ?? 0, at: Date.now(), rv };
      updates['meta/d'] = hexes.doneCount;                     // kolik hexů je v téhle mapě hotových
      updates['meta/dp'] = PLANET.id;                          // …a na které planetě
    }
    const send = net.fb.ref(w(code)).update(updates);          // jeden zápis = stav i mapa najednou (atomicky)
    if (quick) { send.catch(e => fail('error', e)); return true; }
    await withTimeout(send, WRITE_TIMEOUT, 'write');
    cloudStatus.ok = true; cloudStatus.at = Date.now(); cloudStatus.fails = 0;
    if (cloudStatus.reason !== 'map-guard') cloudStatus.reason = '';
    return true;
  } catch (e) {
    return fail(String(e?.message || '').startsWith('timeout') ? 'offline' : String(e?.code || e?.message || '').includes('PERMISSION') ? 'denied' : 'error', e);
  }
}

// Po odletu na jinou planetu: stará mapa prachu do nové nepatří → smazat snímek a uložit nový stav.
export async function resetCloudMap(code) {
  if (!ok() || !code) return false;
  try {
    await net.fb.ref(w(code)).update({ head: null, parts: null, 'meta/d': null, 'meta/dp': null });
    return saveCloud(code);
  } catch { return false; }
}

// Je v cloudu uložená mapa prachu? (bez ní by se svět načetl se zasypaným Měsícem)
export async function cloudHasMap(code) {
  if (!ok() || !code) return false;
  try { return !!(await net.fb.ref(`${w(code)}/head`).get()).val()?.parts; } catch { return false; }
}

// Načte svět z cloudu do čerstvě vygenerované planety (game.dust). Vrací true / false.
// map = false → jen stav světa (mapa prachu zůstane, jak je – třeba ze slotu hostitele).
// merge = true → mapa z cloudu se sloučí do už načtené mapy (v každém bodě méně prachu z obou, F-10).
// state = false → jen mapa (stav světa zůstane).
export async function loadCloud(code, { map = true, merge = false, state = true } = {}) {
  if (!ok()) return false;
  try {
    const [stateSnap, headSnap] = await Promise.all([net.fb.ref(`${w(code)}/state`).get(), net.fb.ref(`${w(code)}/head`).get()]);
    const raw = stateSnap.val();
    if (typeof raw !== 'string') return false;
    const s = JSON.parse(raw);
    if (!s || typeof s !== 'object' || (s.planet === 'mars' ? 'mars' : 'moon') !== PLANET.id) return false;
    if (!canLoadVersion(s)) return false;                         // svět z novější verze hry
    const head = map ? headSnap.val() : null;
    if (head?.parts) {
      let b64 = '';
      for (let i = 0; i < head.parts; i++) {
        const part = (await net.fb.ref(`${w(code)}/parts/p${i}`).get()).val();
        if (!part || part.sv !== head.sv) throw new Error('part');
        b64 += part.d;
      }
      if (!(await unpackDust({ gz: !!head.gz, bytes: fromBase64(b64) }, merge))) return false;
    }
    if (!state) return true;
    game.s = s;
    migrateState(s);
    s.netCode = code;
    s.crv = s.rev;                                                // tohle je teď stav cloudu
    return true;
  } catch (e) {
    console.warn('Načtení světa z cloudu', e);
    return false;
  }
}
