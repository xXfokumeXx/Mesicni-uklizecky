// Registr akcí (3.3, mobilní ovládání M1): jeden seznam všeho, co hráč může udělat tlačítkem nebo klávesou.
// Klávesnice (input.js) i dotyková tlačítka (touch.js, fáze M2) volají stejné akce podle id, logika hry se nezdvojí.
// Popis akce:
//   id        – název akce v kódu
//   nazev     – text pro tlačítko a nápovědu
//   ikona     – znak na dotykové tlačítko
//   klavesa   – e.key malými písmeny (jen jednorázové akce z input.js)
//   drz       – klíč v input.keys, který akce drží, dokud je tlačítko dole (hra ho čte každý snímek: E = bourání, Shift = boost…)
// Obsluhu (proved, kdyPlati) dodá main.js přes setActionHandlers – tady jsou jen data, aby šly použít i v nápovědě.
import { input } from './input.js';

export const ACTIONS = [
  { id: 'akce', nazev: 'Akce', ikona: 'E', klavesa: 'e', drz: 'e' },                 // držení E = bourání, nouzové uvolnění lana
  { id: 'skok', nazev: 'Skok', ikona: '⤒', klavesa: ' ', drz: ' ' },                 // ve vzduchu jetpack, letoun stoupá
  { id: 'boost', nazev: 'Boost', ikona: '»', drz: 'shift' },                         // vozidlo boost, letoun klesá, stavba po 15°
  { id: 'nahoru', nazev: 'Nahoru', ikona: '▲', drz: ' ' },                          // letoun: stoupat (na PC mezerník)
  { id: 'dolu', nazev: 'Dolů', ikona: '▼', drz: 'shift' },                           // letoun: klesat (na PC Shift)
  { id: 'nastroj', nazev: 'Kladivo', ikona: '🔨', klavesa: 'q' },
  { id: 'stavet', nazev: 'Stavět', ikona: '▦', klavesa: 'v' },
  { id: 'bourat', nazev: 'Bourat', ikona: '✕', klavesa: 'x' },
  { id: 'jiny-cil', nazev: 'Vylepšit stanici', ikona: '⇧', klavesa: 'r', drz: 'r' },  // R = vylepšení stanice robota; s kladivem + kolečko = otáčení stavby
  { id: 'otocit-vlevo', nazev: 'Otočit doleva', ikona: '⟲', drz: ',' },
  { id: 'otocit-vpravo', nazev: 'Otočit doprava', ikona: '⟳', drz: '.' },
  { id: 'zlom', nazev: 'Zlom pásu', ikona: '∠' },                                   // na PC držet Alt, na dotyku přepínač (input.keys.alt)
  { id: 'svetla', nazev: 'Světla', ikona: '💡', klavesa: 'l' },
  { id: 'autopilot', nazev: 'Autopilot', ikona: 'A', klavesa: 'c' },
  { id: 'objednat-baterii', nazev: 'Objednat baterii', ikona: '🔋', klavesa: 'b' },
  { id: 'rezim', nazev: 'Ramena', ikona: 'F', klavesa: 'f' },                       // Prachocuc: jízda ↔ sběr
  { id: 'lano-minus', nazev: 'Lano −', ikona: '−' },                                 // Mula s navijákem (na PC kolečko)
  { id: 'lano-plus', nazev: 'Lano +', ikona: '+' },
  { id: 'slot', nazev: 'Políčko hotbaru', ikona: '#' },                              // argument = index políčka (klávesy 1–9)
  { id: 'zrusit', nazev: 'Zrušit', ikona: '✗' },                                     // Esc: zrušit stavbu / umisťování
  { id: 'mapa', nazev: 'Mapa', ikona: '🗺', klavesa: 'm' },
  { id: 'uspechy', nazev: 'Úspěchy', ikona: '🏆', klavesa: 'u' },
  { id: 'chat', nazev: 'Chat', ikona: '💬' },                                        // Enter (main.js, jen v multiplayeru)
  { id: 'menu', nazev: 'Menu', ikona: '≡' },                                         // Esc, když není co zavřít
];

const byId = new Map(ACTIONS.map(a => [a.id, a]));
const byKey = new Map(ACTIONS.filter(a => a.klavesa).map(a => [a.klavesa, a.id]));
const handlers = new Map();          // id → { proved(arg), kdyPlati() }

export const actionForKey = key => byKey.get(key) || null;
export const actionInfo = id => byId.get(id) || null;

// main.js: { id: funkce } nebo { id: { proved, kdyPlati } }
export function setActionHandlers(map) {
  for (const [id, h] of Object.entries(map)) {
    if (!byId.has(id)) { console.warn(`[akce] neznámá akce ${id}`); continue; }
    handlers.set(id, typeof h === 'function' ? { proved: h } : h);
  }
}

// Jen pravidla „kdy platí“ k obsluze, kterou už zapsal někdo jiný (input.js zná funkce, main.js stav hry)
export function setActionRules(map) {
  for (const [id, kdyPlati] of Object.entries(map)) {
    const h = handlers.get(id);
    if (h) h.kdyPlati = kdyPlati;
    else console.warn(`[akce] pravidlo bez obsluhy: ${id}`);
  }
}

// Jde akci teď použít? (dotyk podle toho ukazuje tlačítka; bez pravidla = vždy)
export function actionAvailable(id) {
  const h = handlers.get(id);
  if (!h?.proved) return false;
  try { return h.kdyPlati ? !!h.kdyPlati() : true; } catch { return false; }
}

// Jednorázové provedení. Vrací true, když akce má obsluhu.
export function runAction(id, arg) {
  const h = handlers.get(id);
  if (!h?.proved) return false;
  h.proved(arg);
  return true;
}

// Držená akce (dotykové tlačítko dole / nahoře): nastaví input.keys[drz]; při stisku navíc proběhne proved.
export function holdAction(id, on) {
  const a = byId.get(id);
  if (!a) return;
  if (a.drz) {
    const was = !!input.keys[a.drz];
    input.keys[a.drz] = !!on;
    if (on && !was) runAction(id);
  } else if (on) runAction(id);
}
