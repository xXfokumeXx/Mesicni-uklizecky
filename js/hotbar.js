// Hotbar: políčka dole na obrazovce, co astronaut drží po ruce. Na začátku jedno políčko,
// opasek (Dílna → Astronaut) přidá druhé a třetí. Políčko drží id nástroje (string),
// stavební sadu { kit: 'station' | 'depot' | 'move' | 'dmove', i, prev } nebo null (prázdné).
// move = sebraná stanice robota i, dmove = přesouvané depo i.
// Sada = stanice / depo, které se právě staví (E = postavit), nebo sebraná stanice robota;
// prev = nástroj, který v políčku byl předtím a po postavení se do něj vrátí.
import { TOOLS, BELT } from './catalog.js';
import { game } from './state.js';

const KITS = ['station', 'depot', 'move', 'dmove'];
export const KIT_NAMES = { station: 'Stanice robota', depot: 'Depo na prach', move: 'Sebraná stanice', dmove: 'Přesun depa' };

export const hotbarSlots = (s = game.s) => BELT.levels[s.belt || 0].slots;

const isKit = e => !!e && typeof e === 'object' && KITS.includes(e.kit);

function validEntry(s, e) {
  if (typeof e === 'string') return !!s.tools[e];
  return isKit(e) && (e.kit !== 'move' || !!s.stations[e.i]) && (e.kit !== 'dmove' || !!s.depots[e.i]);
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
  if (typeof e === 'string') s.tool = e;
}

// Srovná hotbar s počtem políček a vlastněnými nástroji (po načtení hry a po koupi opasku).
// Nástroji se doplní jen úplně nový hotbar – políčko, které hráč vyprázdnil (X), zůstane prázdné.
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
  s.hotbar = bar;
  s.sel = Math.min(n - 1, Math.max(0, s.sel | 0));
  syncTool(s);
}

export const heldEntry = () => game.s.hotbar?.[game.s.sel] ?? null;
export const heldTool = () => (typeof heldEntry() === 'string' ? heldEntry() : null);
export const heldKit = () => (isKit(heldEntry()) ? heldEntry() : null);

// Nese hráč stanici robota i (v kterémkoli políčku)?
export const carriedStation = i => (game.s.hotbar || []).some(e => isKit(e) && e.kit === 'move' && e.i === i);

export function selectSlot(k) {
  const s = game.s;
  if (k < 0 || k >= hotbarSlots() || s.driving >= 0) return false;
  s.sel = k;
  syncTool(s);
  return true;
}

// Nástroj do ruky: když už v hotbaru je, jen se vybere; jinak do prázdného, nebo vybraného políčka.
export function putTool(id) {
  const s = game.s;
  ensureHotbar(s);
  let k = s.hotbar.indexOf(id);
  if (k < 0) {
    k = s.hotbar.indexOf(null);
    if (k < 0) k = s.sel;
    s.hotbar[k] = id;
  }
  s.sel = k;
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
  s.sel = k;
}

// Vyprázdní políčko k (klávesa X / pravé tlačítko): nástroj zůstává koupený a vrátí se do ruky
// tlačítkem v Obchodě nebo Dílně; stavební sada se zahodí (sebraná stanice zůstane, kde byla).
export function dropSlot(k = game.s.sel) {
  const s = game.s;
  if (k < 0 || k >= hotbarSlots() || s.driving >= 0 || s.hotbar[k] == null) return false;
  s.hotbar[k] = null;
  return true;
}

// Sada ve vybraném políčku se spotřebovala (postaveno) nebo zrušila (Esc).
export function clearKit() {
  const s = game.s;
  const e = s.hotbar[s.sel];
  if (!isKit(e)) return false;
  s.hotbar[s.sel] = e.prev && s.tools[e.prev] && !s.hotbar.includes(e.prev) ? e.prev : null;
  ensureHotbar(s);
  return true;
}
