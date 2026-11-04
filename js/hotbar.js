// Hotbar: políčka dole na obrazovce, co astronaut drží po ruce. Na začátku jedno políčko,
// opasek (Dílna → Astronaut) přidá druhé a třetí. Políčko drží id nástroje (string),
// kladivo ('hammer' – zabírá políčko stejně jako nástroj), stavební sadu { kit: 'station' | 'depot' | 'move' | 'dmove', i, prev }
// nebo null (prázdné). move = sebraná stanice robota i, dmove = přesouvané depo i.
// Sada = stanice / depo, které se právě staví (E = postavit), nebo sebraná stanice robota;
// prev = nástroj (kladivo), který v políčku byl předtím a po postavení se do něj vrátí.
// × v políčku = nástroj nebo kladivo se zničí: nástroj se znovu koupí v Obchodě, kladivo v Dílně.
import { TOOLS, BELT } from './catalog.js';
import { game } from './state.js';

const KITS = ['station', 'depot', 'move', 'dmove'];
export const HAMMER_ID = 'hammer';
export const KIT_NAMES = { station: 'Stanice robota', depot: 'Depo na prach', move: 'Sebraná stanice', dmove: 'Přesun depa' };

export const hotbarSlots = (s = game.s) => BELT.levels[s.belt || 0].slots;

const isKit = e => !!e && typeof e === 'object' && KITS.includes(e.kit);
const isTool = e => typeof e === 'string' && e !== HAMMER_ID;

function validEntry(s, e) {
  if (e === HAMMER_ID) return !!s.hammer;
  if (typeof e === 'string') return !!s.tools[e];
  return isKit(e) && (e.kit === 'station' || (e.kit === 'move' && !!s.stations[e.i]));   // sady dep z v2 (depot, dmove) ve 3.0 neplatí
}

// Nejlepší vlastněný nástroj, který ještě není v hotbaru.
function freeTool(s, bar) {
  for (let k = TOOLS.length - 1; k >= 0; k--) {
    const id = TOOLS[k].id;
    if (s.tools[id] && !bar.includes(id)) return id;
  }
  return null;
}

// Nástroj ve vybraném políčku = nástroj v ruce (s.tool používá zbytek hry).
function syncTool(s) {
  const e = s.hotbar[s.sel];
  if (isTool(e)) s.tool = e;
}

// s.tool ukazuje na zničený / prodaný nástroj → první nástroj z hotbaru, jinak jakýkoli vlastněný, jinak null.
function fixTool(s) {
  if (s.tool && s.tools[s.tool]) return;
  s.tool = s.hotbar.find(e => isTool(e) && s.tools[e]) || Object.keys(s.tools)[0] || null;
}

// Srovná hotbar s počtem políček a vlastněnými nástroji (po načtení hry a po koupi opasku).
// Nástroji se doplní jen úplně nový hotbar – políčko, které hráč vyprázdnil (×), zůstane prázdné.
// Koupené kladivo bez políčka (uložení z 3.0.1, kdy bylo „v kapse“) dostane první prázdné políčko.
export function ensureHotbar(s = game.s) {
  const n = hotbarSlots(s);
  const fresh = !Array.isArray(s.hotbar) || !s.hotbar.length;
  const seen = new Set();
  let bar = (Array.isArray(s.hotbar) ? s.hotbar.slice(0, n) : []).map(e => {
    if (!validEntry(s, e)) return null;
    if (typeof e === 'string') {
      if (seen.has(e)) return null;
      seen.add(e);
    }
    return e;
  });
  while (bar.length < n) bar.push(null);
  if (fresh) for (let k = 0; k < n; k++) if (bar[k] === null) bar[k] = freeTool(s, bar);
  if (s.hammer && !bar.includes(HAMMER_ID) && bar.includes(null)) bar[bar.indexOf(null)] = HAMMER_ID;
  s.hotbar = bar;
  s.sel = Math.min(n - 1, Math.max(0, s.sel | 0));
  syncTool(s);
  fixTool(s);
}

export const heldEntry = () => game.s.hotbar?.[game.s.sel] ?? null;
export const heldTool = () => (isTool(heldEntry()) ? heldEntry() : null);
export const heldKit = () => (isKit(heldEntry()) ? heldEntry() : null);
export const heldHammer = () => heldEntry() === HAMMER_ID;
export const hammerSlot = () => (game.s.hotbar || []).indexOf(HAMMER_ID);

// Políčko vybrané před posledním přepnutím (Q od kladiva = zpátky sem).
let prevSel = 0;
export const previousSlot = () => prevSel;
function setSel(s, k) {
  if (k !== s.sel) prevSel = s.sel;
  s.sel = k;
}

// Nese hráč stanici robota i (v kterémkoli políčku)?
export const carriedStation = i => (game.s.hotbar || []).some(e => isKit(e) && e.kit === 'move' && e.i === i);

export function selectSlot(k) {
  const s = game.s;
  if (k < 0 || k >= hotbarSlots() || s.driving >= 0) return false;
  setSel(s, k);
  syncTool(s);
  return true;
}

// Nástroj (nebo kladivo) do ruky: když už v hotbaru je, jen se vybere; jinak do prázdného, nebo vybraného políčka.
export function putTool(id) {
  const s = game.s;
  ensureHotbar(s);
  let k = s.hotbar.indexOf(id);
  if (k < 0) {
    k = s.hotbar.indexOf(null);
    if (k < 0) k = s.sel;
    s.hotbar[k] = id;
  }
  setSel(s, k);
  syncTool(s);
}

// Stavební sada do ruky: do prázdného políčka, jinak místo vybraného (nástroj se pak vrátí).
export function putKit(kit) {
  const s = game.s;
  ensureHotbar(s);
  let k = s.hotbar.findIndex(e => isKit(e) && e.kit === kit.kit && ((kit.kit !== 'move' && kit.kit !== 'dmove') || e.i === kit.i));
  if (k < 0) {
    k = s.hotbar.indexOf(null);
    if (k < 0) {
      k = s.sel;
      const cur = s.hotbar[k];
      kit.prev = typeof cur === 'string' ? cur : null;
    }
    s.hotbar[k] = { ...kit };
  }
  setSel(s, k);
}

// Nástroj pryč (zničený nebo prodaný): už ho nevlastníš – ani vylepšení, ani prach v zásobníku; políčko zůstane prázdné.
export function forgetTool(id, s = game.s) {
  if (!s.tools[id]) return false;
  delete s.tools[id];
  s.hotbar = (s.hotbar || []).map(e => (e === id ? null : e));
  fixTool(s);
  return true;
}

// × v políčku k (jen myší v hotbaru, klávesa X ani pravé tlačítko ne): nástroj se zničí (znovu se koupí v Obchodě), kladivo taky
// (znovu v Dílně); stavební sada se zahodí (sebraná stanice zůstane, kde byla). Vrací zahozenou položku, nebo null.
export function dropSlot(k = game.s.sel) {
  const s = game.s;
  if (k < 0 || k >= hotbarSlots() || s.driving >= 0) return null;
  const e = s.hotbar[k];
  if (e == null) return null;
  if (e === HAMMER_ID) { s.hammer = 0; s.hotbar[k] = null; }
  else if (typeof e === 'string') forgetTool(e, s);
  else s.hotbar[k] = null;
  return e;
}

// Sada ve vybraném políčku se spotřebovala (postaveno) nebo zrušila (Esc).
export function clearKit() {
  const s = game.s;
  const e = s.hotbar[s.sel];
  if (!isKit(e)) return false;
  s.hotbar[s.sel] = e.prev && validEntry(s, e.prev) && !s.hotbar.includes(e.prev) ? e.prev : null;
  ensureHotbar(s);
  return true;
}
