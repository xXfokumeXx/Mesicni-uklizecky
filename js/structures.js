// Stavby 3.0 (L-11 až L-14): katalog typů, pravidla umístění, stavění a bourání, garáže a jejich parkovací místa.
// Bez three.js – počítá to hostitel (autorita) i hráč sám. Vzhled je v scene/structures.js.
//
// Stavba ve stavu hry: s.buildings[] = { id, type, p: [x,y,z] (jednotkový vektor), yaw (rad), lv, paid, data }.
// Místní souřadnice stavby: x = vpravo, z = vpřed (čelo / vjezd, +Z modelu), v metrech od středu.
// Obdélníky v katalogu jsou [x0, x1, z0, z1]:
//   pad   = rozměr modelu včetně betonové plochy (výška podstavce, sklon terénu, nožky)
//   foot  = zabraná plocha pro pravidla umístění (u garáže i řada parkovacích míst před vraty)
//   solid = pevné části, do kterých se nedá vejít ani vjet (kolize)
//   use   = kde jde stavbu otevřít klávesou E
import { MOON, BASE } from './config.js';
import { game, newUid, MIGRATE } from './state.js';
import { BUILDINGS, baseDir, distanceToBase, onPlaza } from './base.js';
import { norm, madd, cross, dot, anyTangent, angleBetween, tangentTo } from './planet/vec.js';
import { heightAt, rawHeightAt, terrainVersion, setTerrainPatches } from './planet/height.js';
import { cellDir, dirToCell } from './planet/hexgrid.js';
import { hexes } from './planet/dustmap.js';
import { siteDir } from './rocket.js';
import { setGroundHook } from './physics.js';

const R = MOON.radius;

export const CATEGORIES = [
  { id: 'energy', name: 'Energie' },
  { id: 'vehicles', name: 'Vozidla' },
  { id: 'logistics', name: 'Logistika' },
  { id: 'production', name: 'Výroba' },
  { id: 'research', name: 'Výzkum' },
];

export const HAMMER = {
  name: 'Kladivo', price: 500,
  desc: 'Stavební kladivo se žlutou rukojetí. Q = vzít do ruky / odložit, V = stavební menu, X = bourání. Kladivem se nezametá.',
};
export const REFUND = 0.6;                 // bourání vrátí 60 % ceny stavby i rozšíření (L-14)
// m výškového rozdílu pod podstavcem. L-12 chtěl 1,5 m, ale mimo rovnou základnu to splní jen ~1 % míst
// pro 25 m budovu (měřeno 3. 11.) → 4 m (~21 % míst); deska stojí na nožkách (O-07).
// 4. 11.: terén pod stavbou se srovná (terrainPatchFor) → povolené převýšení původního terénu pod deskou 16 m
// (250 m od Výkupu tak projde přes 97 % míst i pro slinovnu; dřív se 4 m jen 10–22 % pro velké stavby).
export const MAX_SLOPE = 16;
export const BUILD_REACH = 25;             // m – hologram na místě kurzoru jen do této vzdálenosti
export const AHEAD = 6;                    // m – jinak hologram před hráčem
export const GARAGE_SLOTS = 6;

// Katalog staveb (L-11). Stavby dalších fází se sem přidají spolu se svou logikou (ready: true).
export const STRUCTURES = {
  garage: {
    name: 'Garáž', cat: 'vehicles', model: 'garage-3', price: 2000, inBase: true, ready: true,
    padTop: 0.412,                                   // horní plocha betonové desky nad počátkem modelu (m)
    desc: 'Hangár pro 6 vozidel. Vozidla koupíš v okně garáže, parkují v řadě před vraty. První garáž je zdarma.',
    pad: [-11.25, 11.25, -10.13, 10.13],
    foot: [-14.5, 14.5, -10.13, 17],
    solid: [[-7, 10.6, -8.6, 3.8]],
    use: [-9, 9, 3.6, 16],
    slots: Array.from({ length: GARAGE_SLOTS }, (_, k) => [-13.75 + k * 5.5, 13.5]),   // řada před vraty, čelem od garáže
  },
};

// ---------- energetické stavby (fáze 2: L-05 až L-08, D-01 až D-03, D-13) ----------
// energy.role: source (zdroj) · storage (baterie) · load (spotřebič) · node (kotva vedení)
// out = výkon ⚡/s (solár při Slunci v zenitu / RTG stále), tracker = natáčí se za Sluncem (plný výkon nad obzorem),
// cap / rate = kapacita ⚡ a nejvyšší nabíjení / vybíjení ⚡/s, research = potřebný výzkum (fáze 4), bricks = cihly (fáze 3).
// anchor = místo pro kabel vedení v souřadnicích modelu [x, y, z] (README zipů: kotevni_body; jinak horní část modelu).
export const POLE_HOVER = 6.5;                    // m – o kolik výš se kotva vznáší než v modelu (tělo ~7–9 m nad zemí)
const box = (b, m = 0.25) => [b[0] - m, b[1] + m, b[2] - m, b[3] + m];
function small(name, model, price, pad, h, extra) {
  const ax = (pad[0] + pad[1]) / 2, az = (pad[2] + pad[3]) / 2;
  return {
    name, cat: 'energy', model, price, inBase: true, ready: true, padTop: 0, instanced: true,   // opakované stavby = InstancedMesh (O-03)
    pad, foot: box(pad, 0.3), solid: [box(pad, -0.15)], anchors: [[ax, h * 0.62, az]], ...extra,
  };
}
Object.assign(STRUCTURES, {
  rtg: small('RTG generátor', 'rtg', 1500, [-1.1, 1.1, -1.1, 1.1], 2.4, {
    desc: 'Radioizotopový generátor: slabý 1 ⚡/s ve dne i v noci – pojistka na první noc. Hlavním zdrojem jsou soláry s bateriemi.',
    energy: { role: 'source', out: 1, rtg: true }, anchors: [[0, 2.15, 0]],
  }),
  'solar-t1': small('Solár Záplata', 'solar-t1', 960, [-2.06, 1.84, -0.84, 1.10], 2.52, { desc: 'Starý panel na dřevěné bedně. Až 3 ⚡/s na přímém Slunci.', energy: { role: 'source', out: 3 } }),
  'solar-t2': small('Solár Kozlík', 'solar-t2', 2640, [-2.19, 2.19, -1.51, 1.51], 2.61, { desc: 'Dva panely na stojanu. Až 7 ⚡/s na přímém Slunci.', energy: { role: 'source', out: 7 } }),
  'solar-t3': small('Solár Sledovač', 'solar-t3', 7200, [-2.94, 2.94, -0.90, 0.94], 2.46, { desc: 'Natáčí se za Sluncem, vyrábí plně i při nízkém Slunci. 10 ⚡/s.', energy: { role: 'source', out: 10, tracker: true }, research: 'solarT3' }),
  'solar-t4': small('Solár Slunečnice', 'solar-t4', 18000, [-2.67, 2.67, -1.75, 1.75], 5.32, { desc: 'Dvouosý hexagonální květ. 16 ⚡/s.', energy: { role: 'source', out: 16, tracker: true }, research: 'solarT4' }),
  'solar-t5': small('Solár Koruna', 'solar-t5', 42000, [-2.67, 2.67, -3.08, 3.08], 6.11, { desc: 'Zrcadla soustředí Slunce do věže s jádrem. 25 ⚡/s.', energy: { role: 'source', out: 25, tracker: true }, research: 'solarT5', bricks: 100 }),
  'battery-t1': small('Baterie Bedna', 'battery-t1', 1440, [-1.46, 2.13, -0.83, 1.67], 1.41, { desc: 'Autobaterie v dřevěné bedně. 525 ⚡, nabíjení 15 ⚡/s.', energy: { role: 'storage', cap: 525, rate: 15 } }),
  'battery-t2': small('Baterie Skříň', 'battery-t2', 4200, [-1.72, 1.23, -0.72, 0.92], 2.90, { desc: 'Skříň se stavovou LED lištou. 1 400 ⚡, 30 ⚡/s.', energy: { role: 'storage', cap: 1400, rate: 30 } }),
  'battery-t3': small('Baterie Kontejner', 'battery-t3', 10800, [-2.60, 3.10, -1.10, 1.54], 2.64, { desc: 'Průmyslové úložiště s chlazením. 3 500 ⚡, 60 ⚡/s.', energy: { role: 'storage', cap: 3500, rate: 60 }, research: 'batteryT3' }),
  'battery-t4': small('Baterie Trojčata', 'battery-t4', 28800, [-2.42, 2.42, -2.80, 3.15], 4.37, { desc: 'Tři tlakové články. 8 750 ⚡, 120 ⚡/s.', energy: { role: 'storage', cap: 8750, rate: 120 }, research: 'batteryT4' }),
  'battery-t5': small('Baterie Jádro', 'battery-t5', 48000, [-2.67, 2.67, -3.08, 3.08], 5.70, { desc: 'Plazma v gyroskopu. 21 000 ⚡, 250 ⚡/s.', energy: { role: 'storage', cap: 21000, rate: 250 }, research: 'batteryT5', bricks: 200 }),
  pole: {
    name: 'Kotva vedení', cat: 'energy', model: 'power-pole', ground: 'power-pole-ground', price: 150, inBase: true, ready: true, padTop: 0,
    desc: 'Vznášedlo ve výšce 6,5 m, které nese kabely jako elektrické vedení. Samo se spojí s nejbližšími 3 kotvami a stavbami v dosahu (kotva–kotva 30 m, ke stavbě 12 m).',
    // tělo se vznáší POLE_HOVER m nad terénem (rozhodnutí 3. 11.: 6–8 m jako vedení), pod ním se dá projít – bez pevné části
    pad: [-1.78, 1.78, -1.95, 1.25], foot: [-1.9, 1.9, -2.05, 1.35], solid: [],
    anchors: [[-0.77, 2.765 + POLE_HOVER, 0], [0.77, 2.765 + POLE_HOVER, 0]], hover: POLE_HOVER, instanced: true,
    energy: { role: 'node' },
  },
  charger: {
    name: 'Nabíječka vozidel', cat: 'vehicles', model: 'charger', price: 2500, inBase: true, ready: true, padTop: 0.5,
    desc: 'Vozidlo zastaví na slotu a nabíjí se 10 ⚡/s. Začíná s 1 slotem, další sloty a rychlonabíjení přikoupíš v jejím okně (E).',
    pad: [-11.5, 11.5, -8, 8], foot: [-11.8, 11.8, -8.3, 8.3],
    solid: [[5.8, 10.6, -4.4, 1.2]], use: [-10, 6, -1, 7.5],
    anchors: [[9.4, 3.17, -5.8]],
    energy: { role: 'load' },
    slots: [[-5, 2.2], [1, 2.2], [-11, 2.2], [-17, 2.2]],          // místa pro vozidla (3. a 4. = modul vlevo)
    stands: [[-1.95, 1], [4.15, 1], [-7.95, 1], [-13.95, 1]],      // stojany s kontrolkou a kabelem
    slotPrices: [1500, 2500, 4000],                                  // 2., 3., 4. slot
    fastPrices: [3000, 8000],                                        // rychlonabíjení II (20 ⚡/s), III (40 ⚡/s, výzkum)
    fastResearch: [null, 'fastCharge3'],
    footFor: b => {                                                  // moduly 3. a 4. slotu rozšíří plochu vlevo
      const n = b?.data?.slots || 1;
      return [-11.8 - (n >= 3 ? 2.7 : 0) - (n >= 4 ? 6 : 0), 11.8, -8.3, 8.3];
    },
  },
  // ---------- výzkum (fáze 4: L-30, D-10) ----------
  research: {
    name: 'Výzkumné centrum', cat: 'research', model: 'research', price: 10000, inBase: false, ready: true, unique: true,
    padTop: 0.412,
    desc: 'Vyvíjí nové technologie (strom technologií v okně – E). Během výzkumu bere 5 ⚡/s, bez energie se výzkum zastaví. Jen jedno, mimo základnu.',
    pad: [-12.38, 12.38, -10.13, 10.13], foot: [-12.7, 12.7, -10.45, 10.45],
    solid: [[-7.6, 11.6, -9.2, 5.6]], use: [-11, 11, 4.5, 12],
    plugs: [[-11.3, -9.1]],                                          // přípojka vedení (model power-plug) v rohu desky
    anchors: [[-11.3, 0.412 + 2.67, -9.1]],
    energy: { role: 'load' },
  },
  // ---------- výměník baterií (fáze 4: L-09, D-04, A-06) ----------
  swapper: {
    name: 'Výměník baterií', cat: 'vehicles', model: 'swapper', price: 15000, inBase: true, ready: true, research: 'batterySwap',
    padTop: 0.5,
    desc: 'Zajeď vozidlem doprostřed a zastav: jeřáb za 3 s vymění vybitou baterii za nabitou z regálu. Regál (2 baterie, rozšíření na 4) se nabíjí ze sítě 15 ⚡/s na baterii.',
    pad: [-13.5, 13.5, -10, 10], foot: [-13.8, 13.8, -10.3, 10.3],
    solid: [[-8, 8.2, -10, -4.6], [8.2, 13.2, -9.6, -4.3], [-12, -10, -8, -6]], use: [6.5, 13.5, -4.3, 0],
    anchors: [[-11, 3.17, -7]],
    energy: { role: 'load' },
    bay: [0, 0],                                                     // místo pro vozidlo (jede po ose X)
    rack: [[-2.6, 1.245], [2.6, 1.245], [-2.6, 3.445], [2.6, 3.445]], // pozice baterií regálu (x, y; z = −5,57) s kontrolkou hry
    rackPrices: [4000, 6000],                                        // 3. a 4. baterie regálu
  },
  // ---------- logistika (fáze 3: L-20 až L-24, D-05, D-06, D-11) ----------
  // sockets = zásuvky pásů { id, dir: in | out, goods: dust | brick | any, x, z, yaw (směr ven) } v místních souřadnicích
  depot: {
    name: 'Depo', cat: 'logistics', model: 'silo', price: 3000, inBase: false, ready: true, padTop: 0.25, labelY: 6.4,
    desc: 'Sklad 5 000 kg prachu daleko od základny: vysyp do něj zásobník (kruh kolem depa). Prach neprodává – odveze ho pás z výstupu (oranžový) do Výkupu, slinovny nebo jiného depa.',
    pad: [-2.6, 2.6, -2.6, 2.6], foot: [-2.9, 2.9, -2.9, 2.9], solid: [[-1.6, 1.6, -1.6, 1.6]],
    sockets: [{ id: 'in', dir: 'in', goods: 'dust', x: -2.6, z: 0, yaw: -Math.PI / 2 }, { id: 'out', dir: 'out', goods: 'dust', x: 2.6, z: 0, yaw: Math.PI / 2 }],
  },
  sinter: {
    name: 'Slinovna', cat: 'production', model: 'sinter', price: 12000, inBase: false, ready: true, padTop: 0.5,
    desc: 'Lis na regolitové cihly: 20 kg prachu → 1 cihla za 6 s (15 ⚡/s, vylepšení Rychlejší lis až 4 s). Prach přiveze pás do násypky (vlevo), cihly odvádí pás z výstupu (vpravo) do Výkupu.',
    pad: [-16.5, 16.5, -10.5, 10.5], foot: [-16.8, 16.8, -10.8, 10.8],
    solid: [[-15.5, -10, -2, 3.5], [-9.5, 14, -2.6, 2.6], [5, 14, 4, 8.6], [-14, -8, -8, -4.5]], use: [-6, 6, 3, 10.5],
    anchors: [[-3.5, 3.17, -8]],
    energy: { role: 'load' },
    sockets: [{ id: 'in', dir: 'in', goods: 'dust', x: -16.5, z: 0.5, yaw: -Math.PI / 2 }, { id: 'out', dir: 'out', goods: 'brick', x: 16.5, z: 6.3, yaw: Math.PI / 2 }],
  },
  // pás se nestaví hologramem, ale klikáním ze zásuvky do zásuvky (build.js, mode 'belt')
  belt: {
    name: 'Pás', cat: 'logistics', model: 'belt-piece', price: 15, inBase: true, ready: true, kind: 'belt', perMeter: true,
    desc: 'Pásový dopravník $15/m: klikni na výstupní zásuvku (oranžová), klikáním přidávej ohyby, dokonči kliknutím na vstupní zásuvku (modrá). Nejvýš 300 m a 25°.',
    pad: [-0.5, 0.5, -0.5, 0.5], foot: [-0.5, 0.5, -0.5, 0.5], solid: [],
  },
});
// Rozdělovač a spojovač pásů (4. 11.): na jednom konci 2 zásuvky, na druhém 1. Zboží převezmou od připojených pásů.
// Nové typy na konec (pořadí = číslo typu v síti, TYPE_IDS).
const NODE = { cat: 'logistics', inBase: true, ready: true, padTop: 0.12, pad: [-1.6, 1.6, -1.4, 1.4], foot: [-1.9, 1.9, -1.7, 1.7], solid: [[-1.1, 1.1, -0.9, 0.9]] };
Object.assign(STRUCTURES, {
  splitter: {
    ...NODE, name: 'Rozdělovač pásu', model: 'belt-splitter', price: 400,
    desc: 'Jeden pás dovnitř (modrá zásuvka vzadu), dva ven (oranžové vpředu): náklad střídavě posílá do obou výstupů; když jeden nebere, jde vše do druhého. Výstupní pás postavíš, až na vstup vede pás.',
    sockets: [{ id: 'in', dir: 'in', goods: 'any', x: 0, z: -1.4, yaw: Math.PI }, { id: 'a', dir: 'out', goods: 'any', x: -0.8, z: 1.4, yaw: 0 }, { id: 'b', dir: 'out', goods: 'any', x: 0.8, z: 1.4, yaw: 0 }],
  },
  merger: {
    ...NODE, name: 'Spojovač pásů', model: 'belt-merger', price: 400,
    desc: 'Dva pásy dovnitř (modré zásuvky vzadu), jeden ven (oranžová vpředu): náklad z obou vstupů střídavě pouští na jeden pás. Oba vstupy musí vézt stejné zboží.',
    sockets: [{ id: 'a', dir: 'in', goods: 'any', x: -0.8, z: -1.4, yaw: Math.PI }, { id: 'b', dir: 'in', goods: 'any', x: 0.8, z: -1.4, yaw: Math.PI }, { id: 'out', dir: 'out', goods: 'any', x: 0, z: 1.4, yaw: 0 }],
  },
});
export const SWAP = { dur: 3, rate: 15, cap: 1000, bayR: 1.8 };   // s výměny, ⚡/s na baterii, „univerzální“ kapacita ⚡, m od středu
export const CHARGER_RATE = [10, 20, 40];          // ⚡/s na slot podle úrovně rychlonabíjení
for (const [k, d] of Object.entries(STRUCTURES)) d.id = k;
export const TYPE_IDS = Object.keys(STRUCTURES);   // pořadí = číslo typu v síti (nové typy jen přidávat na konec)
export const structureDef = type => STRUCTURES[type] || null;
export const footOf = b => STRUCTURES[b.type]?.footFor?.(b) || STRUCTURES[b.type]?.foot;
export const isEnergy = b => !!STRUCTURES[b?.type]?.energy;

// Výzkum (fáze 4): zatím nic vyzkoumáno → stavby s research jsou v liště zamčené 🔒.
export const hasResearch = id => !id || !!game.s?.research?.done?.includes(id);
export const lockReason = def => (def.research && !hasResearch(def.research) ? 'chybí výzkum'
  : def.bricks && (game.s?.bricks || 0) < def.bricks ? `chybí ${def.bricks} cihel`
  : def.unique && (game.s?.buildings || []).some(b => b.type === def.id) ? 'už stojí' : '');

// Počáteční data stavby podle typu
export function initData(type) {
  const e = STRUCTURES[type]?.energy;
  if (e?.role === 'storage') return { charge: 0 };
  if (type === 'charger') return { slots: 1, fast: 0 };
  if (type === 'swapper') return { slots: 2, rack: [1, 1], swap: null };
  if (type === 'depot') return { store: 0 };
  if (type === 'sinter') return { hopper: 0, out: 0, t: 0, state: 'idle' };   // regál: nabití baterií 0–1 (při stavbě nabité)
  if (type === 'splitter' || type === 'merger') return { buf: 0 };             // zásobník rozdělovače / spojovače (položky)
  return {};
}

// Háky logistiky (logistics.js se sem neimportuje – kruh): kontrola pásu pod stavbou a úklid pásů při zboření
let beltCheck = () => '';
export const setBeltCheck = fn => { beltCheck = fn; };
let demolishHook = () => 0;
export const setDemolishHook = fn => { demolishHook = fn; };

// Pevné budovy základny (Výkup, Dílna, Obchod) mají obdélníky pad / solid jako stavby (base.js, b.yaw).
const STATION_R = 3.6, SILO_R = 4, ROCKET_R = 28;
const VEHICLE_R = { push: 1.2, rideon: 1.6, lunar: 2.8, mega: 3.8, crew: 3 };

// ---------- místní souřadnice ----------

// Osy stavby: X = vpravo, Z = vpřed (podle yaw v rovině tečné ke kouli v bodě p).
export function axes(p, yaw) {
  const e1 = anyTangent(p), e2 = cross(p, e1);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const Z = norm([e1[0] * c + e2[0] * s, e1[1] * c + e2[1] * s, e1[2] * c + e2[2] * s]);
  const X = norm(cross(p, Z));
  return { X, Z };
}
// yaw, při kterém míří čelo stavby (Z) ve směru f
export function yawFor(p, f) {
  const e1 = anyTangent(p), e2 = cross(p, e1);
  return Math.atan2(dot(f, e2), dot(f, e1));
}
export function localToDir(p, yaw, x, z, ax = axes(p, yaw)) {
  return norm(madd(madd(p, ax.X, x / R), ax.Z, z / R));
}
export function dirToLocal(p, yaw, q, ax = axes(p, yaw)) {
  const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
  return [dot(d, ax.X) * R, dot(d, ax.Z) * R];
}

const corners = r => [[r[0], r[2]], [r[1], r[2]], [r[1], r[3]], [r[0], r[3]]];
const inRect = (r, x, z, m = 0) => x >= r[0] - m && x <= r[1] + m && z >= r[2] - m && z <= r[3] + m;
const rectRadius = r => Math.max(...corners(r).map(([x, z]) => Math.hypot(x, z)));

// Výška terénu pod obdélníkem → [min, max]: mřížka vzorků nejvýš po 2 m včetně okrajů (4. 11.: dřív jen 9 vzorků –
// u velkých desek byly 13 m od sebe a hrbol mezi nimi prostrčil terén skrz desku). Deska stavby leží vodorovně
// na nejvyšším bodě (padTopHeight), nižší místa podepřou nožky (scene/structures.js buildLegs).
export function heightRange(p, yaw, rect) {
  const ax = axes(p, yaw);
  const nx = Math.max(2, Math.ceil((rect[1] - rect[0]) / 2)), nz = Math.max(2, Math.ceil((rect[3] - rect[2]) / 2));
  const xs = Array.from({ length: nx + 1 }, (_, i) => rect[0] + (rect[1] - rect[0]) * i / nx);
  const zs = Array.from({ length: nz + 1 }, (_, i) => rect[2] + (rect[3] - rect[2]) * i / nz);
  let lo = Infinity, hi = -Infinity;
  for (const x of xs) for (const z of zs) {
    const h = heightAt(localToDir(p, yaw, x, z, ax));
    if (h < lo) lo = h;
    if (h > hi) hi = h;
  }
  return [lo, hi];
}

// Kolik různých nedočištěných hexů leží pod obdélníkem (vzorky po ~2,5 m včetně okrajů).
export function dustyHexes(p, yaw, rect, ax = axes(p, yaw)) {
  if (!hexes.done) return 0;
  const nx = Math.max(2, Math.ceil((rect[1] - rect[0]) / 2.5)), nz = Math.max(2, Math.ceil((rect[3] - rect[2]) / 2.5));
  const seen = new Set();
  for (let i = 0; i <= nx; i++) for (let k = 0; k <= nz; k++) {
    const x = rect[0] + (rect[1] - rect[0]) * i / nx, z = rect[2] + (rect[3] - rect[2]) * k / nz;
    const c = dirToCell(localToDir(p, yaw, x, z, ax));
    if (hexes.init?.[c] > 0 && !hexes.done[c]) seen.add(c);          // hexy bez prachu od začátku (pod budovami) jsou čisté
  }
  return seen.size;
}

// ---------- pravidla umístění (L-12) ----------

// Protínají se dva obdélníky (SAT ve 2D)? A v místních souřadnicích kandidáta, B jako 4 rohy v týchž souřadnicích.
function polysOverlap(a, b) {
  for (const poly of [a, b]) {
    for (let i = 0; i < 4; i++) {
      const [x1, z1] = poly[i], [x2, z2] = poly[(i + 1) % 4];
      const nx = z2 - z1, nz = x1 - x2;
      let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
      for (const [x, z] of a) { const v = x * nx + z * nz; aMin = Math.min(aMin, v); aMax = Math.max(aMax, v); }
      for (const [x, z] of b) { const v = x * nx + z * nz; bMin = Math.min(bMin, v); bMax = Math.max(bMax, v); }
      if (aMax <= bMin || bMax <= aMin) return false;
    }
  }
  return true;
}

// Kruh (střed q, poloměr r) zasahuje do obdélníku rect stavby (p, yaw)?
function circleHits(p, yaw, rect, q, r, ax) {
  const [x, z] = dirToLocal(p, yaw, q, ax);
  const cx = Math.max(rect[0], Math.min(rect[1], x)), cz = Math.max(rect[2], Math.min(rect[3], z));
  return Math.hypot(x - cx, z - cz) < r;
}

// Jde stavbu postavit? Vrací { ok, reason }. ignoreId = stavba, která se nepočítá (přesun).
// footOverride = jiná zabraná plocha (rozšíření stavby, např. modul nabíječky).
export function canPlace(type, p, yaw, ignoreId = null, footOverride = null) {
  const def = STRUCTURES[type];
  if (!def) return { ok: false, reason: 'Neznámá stavba' };
  const s = game.s;
  const ax = axes(p, yaw);
  const foot = footOverride || def.foot;
  const reach = rectRadius(foot) / R;

  if (def.unique && (s.buildings || []).some(b => b.type === type && b.id !== ignoreId)) return { ok: false, reason: `${def.name} může stát jen jedno` };
  const inBase = distanceToBase(p) < BASE.flat;
  if (inBase && !def.inBase) return { ok: false, reason: 'Do základny se staví jen garáž, nabíječka, výměník, solár, baterie, kotva, pás, rozdělovač a spojovač' };

  // pevné budovy základny
  const mineB = corners(foot);
  for (const b of BUILDINGS) {
    if (angleBetween(p, b.dir) > reach + b.r / R) continue;
    const bax = axes(b.dir, b.yaw);
    const theirs = corners(b.pad).map(([x, z]) => dirToLocal(p, yaw, localToDir(b.dir, b.yaw, x, z, bax), ax));
    if (polysOverlap(mineB, theirs)) return { ok: false, reason: `Překáží ${b.name}` };
  }
  // náměstí kolem Výkupu (D-12) – vzorky plochy stavby po ~2 m
  if (inBase || distanceToBase(p) < 60) {
    const nx = Math.max(2, Math.ceil((foot[1] - foot[0]) / 2)), nz = Math.max(2, Math.ceil((foot[3] - foot[2]) / 2));
    for (let i = 0; i <= nx; i++) for (let k = 0; k <= nz; k++) {
      const q = localToDir(p, yaw, foot[0] + (foot[1] - foot[0]) * i / nx, foot[2] + (foot[3] - foot[2]) * k / nz, ax);
      const x = q[0] * R, y = q[1] * R;                                  // základna je kolem [0, 0, 1]
      if (onPlaza(x, y)) return { ok: false, reason: 'Na náměstí kolem Výkupu se nestaví' };
    }
  }
  // ostatní stavby (otočené obdélníky)
  const mine = corners(foot);
  for (const o of s.buildings || []) {
    if (o.id === ignoreId) continue;
    const od = STRUCTURES[o.type];
    const ofoot = footOf(o);
    if (!od || angleBetween(p, o.p) > reach + rectRadius(ofoot) / R) continue;
    const oax = axes(o.p, o.yaw);
    const theirs = corners(ofoot).map(([x, z]) => dirToLocal(p, yaw, localToDir(o.p, o.yaw, x, z, oax), ax));
    if (polysOverlap(mine, theirs)) return { ok: false, reason: `Překáží ${od.name}` };
  }
  // zaparkovaná vozidla, stanice robotů, depa z v2, raketa
  for (const v of s.vehicles) {
    if (angleBetween(p, v.p) > reach + 5 / R) continue;
    if (circleHits(p, yaw, foot, v.p, VEHICLE_R[v.type] || 2, ax)) return { ok: false, reason: 'Překáží zaparkované vozidlo' };
  }
  for (const st of s.stations) {
    const c = cellDir(st.hex);
    if (angleBetween(p, c) < reach + STATION_R / R && circleHits(p, yaw, foot, c, STATION_R, ax)) return { ok: false, reason: 'Překáží hex se stanicí robota' };
  }
  for (const d of s.depots) {
    const c = cellDir(d.hex);
    if (angleBetween(p, c) < reach + SILO_R / R && circleHits(p, yaw, foot, c, SILO_R, ax)) return { ok: false, reason: 'Překáží depo' };
  }
  if (angleBetween(p, siteDir(0, 0)) * R < ROCKET_R + rectRadius(foot)) return { ok: false, reason: 'Příliš blízko rakety' };

  // jen na vyčištěných hexech (rozhodnutí 3. 11.): pod deskou nesmí zůstat hex s prachem
  const dusty = dustyHexes(p, yaw, def.pad, ax);
  if (dusty) return { ok: false, reason: `Nejdřív vyčisti hex${dusty > 1 ? 'y' : ''} pod stavbou (${dusty} s prachem)` };

  const onBelt = beltCheck(p, yaw, foot);
  if (onBelt) return { ok: false, reason: onBelt };

  // svah pod podstavcem
  const [lo, hi] = heightRange(p, yaw, def.pad);
  if (hi - lo > MAX_SLOPE) return { ok: false, reason: `Příliš strmý svah (${(hi - lo).toFixed(1).replace('.', ',')} m, nejvýš ${MAX_SLOPE.toString().replace('.', ',')} m)` };
  return { ok: true, reason: '' };
}

// ---------- cena, stavění, bourání ----------

export const structuresOf = type => (game.s.buildings || []).filter(b => b.type === type);
export const structureById = id => (game.s.buildings || []).find(b => b.id === id) || null;

// Cena stavby právě teď (první garáž je zdarma – L-13).
export function buildPrice(type) {
  const def = STRUCTURES[type];
  if (!def) return Infinity;
  if (type === 'garage' && !game.s.gfree && !structuresOf('garage').length) return 0;
  return def.price;
}

// Postaví stavbu (sám / hostitel). Vrací id stavby, nebo false.
export function placeStructure(type, p, yaw, id = null) {
  const s = game.s;
  const def = STRUCTURES[type];
  if (!def?.ready || lockReason(def) || def.kind === 'belt') return false;
  const price = buildPrice(type);
  if (s.money < price || !canPlace(type, p, yaw).ok) return false;
  s.money -= price;
  if (def.bricks) s.bricks = (s.bricks || 0) - def.bricks;
  if (type === 'garage' && price === 0) s.gfree = true;
  const b = { id: id || newUid(), type, p: norm(p), yaw: normYaw(yaw), lv: 0, paid: price, data: initData(type) };
  (s.buildings ||= []).push(b);
  return b.id;
}
const normYaw = y => { const t = Math.PI * 2; return ((y % t) + t) % t; };
const vozidel = n => `${n} ${n === 1 ? 'vozidlo' : n >= 2 && n <= 4 ? 'vozidla' : 'vozidel'}`;

// Co by se stalo při zboření: { refund, warn, blocked } (L-14).
export function demolishInfo(id) {
  const b = structureById(id);
  if (!b) return { refund: 0, warn: '', blocked: 'Stavba už neexistuje' };
  const refund = Math.round((b.paid || 0) * REFUND);
  if (b.type === 'garage') {
    const homed = game.s.vehicles.filter(v => v.garage === id);
    if (homed.length) {
      const others = structuresOf('garage').filter(g => g.id !== id);
      if (!others.length) return { refund, warn: '', blocked: `V garáži má domov ${vozidel(homed.length)} – nejdřív postav jinou garáž` };
      const free = others.reduce((n, g) => n + freeSlots(g.id).length, 0);
      if (free < homed.length) return { refund, warn: '', blocked: `V ostatních garážích je volných jen ${free} míst (potřeba ${homed.length})` };
      return { refund, warn: `${vozidel(homed.length)} se přeřadí do jiné garáže`, blocked: '' };
    }
  }
  const belts = (game.s.belts || []).filter(bl => bl.from?.[0] === id || bl.to?.[0] === id).length;
  if (b.type === 'depot' && (b.data.store || 0) > 0) return { refund, warn: `${Math.round(b.data.store)} kg prachu ve skladu se ztratí${belts ? ` · zbourá se i ${belts} ${belts === 1 ? 'pás' : 'pásy'}` : ''}`, blocked: '' };
  return { refund, warn: belts ? `zbourá se i ${belts} ${belts === 1 ? 'napojený pás' : 'napojené pásy'}` : '', blocked: '' };
}

// Zboří stavbu (sám / hostitel). Vrací true / false.
export function demolishStructure(id) {
  const s = game.s;
  const info = demolishInfo(id);
  if (info.blocked) return false;
  const i = s.buildings.findIndex(b => b.id === id);
  if (i < 0) return false;
  const b = s.buildings[i];
  s.buildings.splice(i, 1);
  if (s.cables?.length) s.cables = s.cables.filter(c => c[0] !== id && c[1] !== id);   // s ní zmizí i její kabely (L-06)
  s.money += demolishHook(id);                       // a pásy napojené na její zásuvky (60 % zpět)
  if (b.type === 'garage') {
    for (const v of s.vehicles) {                    // vozidla zůstanou stát, jen dostanou nový domov
      if (v.garage !== id) continue;
      const slot = freeGarageSlot();
      v.garage = slot?.garage || null;
      v.spot = slot?.spot ?? 0;
    }
  }
  s.money += info.refund;
  return true;
}

// ---------- nabíječka: rozšíření (L-05) ----------

// Další slot: { price, reason } (reason = proč nejde). 3. a 4. slot přistaví modul vlevo → musí tam být volno.
export function chargerSlotOffer(b) {
  const def = STRUCTURES.charger;
  const n = b?.data?.slots || 1;
  if (!b || n >= 4) return { price: null, reason: 'Nabíječka má všechny 4 sloty' };
  const price = def.slotPrices[n - 1];
  if (n >= 2) {
    const chk = canPlace('charger', b.p, b.yaw, b.id, def.footFor({ data: { slots: n + 1 } }));
    if (!chk.ok) return { price, reason: `Modul slotu se nevejde: ${chk.reason}` };
  }
  if (game.s.money < price) return { price, reason: 'Chybí peníze' };
  return { price, reason: '' };
}
export function chargerAddSlot(id) {
  const b = structureById(id);
  const o = chargerSlotOffer(b);
  if (o.reason) return false;
  game.s.money -= o.price;
  b.data.slots = (b.data.slots || 1) + 1;
  b.paid = (b.paid || 0) + o.price;
  return true;
}
// Výměník: další baterie do regálu (3. a 4.), přijde vybitá a nabije se ze sítě.
export function swapperRackOffer(b) {
  const n = b?.data?.slots || 2;
  if (!b || n >= 4) return { price: null, reason: 'Regál je plný (4 baterie)' };
  const price = STRUCTURES.swapper.rackPrices[n - 2];
  return { price, reason: game.s.money < price ? 'Chybí peníze' : '' };
}
export function swapperAddRack(id) {
  const b = structureById(id);
  if (b?.type !== 'swapper') return false;
  const o = swapperRackOffer(b);
  if (o.reason) return false;
  game.s.money -= o.price;
  b.data.slots = (b.data.slots || 2) + 1;
  b.data.rack = [...(b.data.rack || []), 0].slice(0, b.data.slots);
  b.paid = (b.paid || 0) + o.price;
  return true;
}
// Rychlonabíjení: II (20 ⚡/s) bez výzkumu, III (40 ⚡/s) po výzkumu.
export function chargerFastOffer(b) {
  const def = STRUCTURES.charger;
  const f = b?.data?.fast | 0;
  if (!b || f >= 2) return { price: null, reason: 'Nejrychlejší nabíjení' };
  const price = def.fastPrices[f];
  if (!hasResearch(def.fastResearch[f])) return { price, reason: 'Chybí výzkum „Rychlonabíjení III“' };
  if (game.s.money < price) return { price, reason: 'Chybí peníze' };
  return { price, reason: '' };
}
export function chargerFaster(id) {
  const b = structureById(id);
  const o = chargerFastOffer(b);
  if (o.reason) return false;
  game.s.money -= o.price;
  b.data.fast = (b.data.fast | 0) + 1;
  b.paid = (b.paid || 0) + o.price;
  return true;
}

// ---------- garáže a parkovací místa (L-13) ----------

export const garages = () => structuresOf('garage');
export const fleetCapacity = () => garages().length * GARAGE_SLOTS;
export const fleetFull = () => game.s.vehicles.length >= fleetCapacity();

export function freeSlots(gid) {
  const used = new Set(game.s.vehicles.filter(v => v.garage === gid).map(v => v.spot));
  return Array.from({ length: GARAGE_SLOTS }, (_, k) => k).filter(k => !used.has(k));
}
// První volné místo: v garáži gid (když jde), jinak v kterékoli jiné. { garage, spot } nebo null.
export function freeGarageSlot(gid = null) {
  const list = garages();
  if (gid) list.sort((a, b) => (a.id === gid ? -1 : b.id === gid ? 1 : 0));
  for (const g of list) {
    const k = freeSlots(g.id)[0];
    if (k !== undefined) return { garage: g.id, spot: k };
  }
  return null;
}

// Parkovací místo k ve garáži g: { dir, facing } (vozidlo čelem od garáže).
export function garageSlot(g, k) {
  const def = STRUCTURES.garage;
  const [x, z] = def.slots[Math.max(0, Math.min(def.slots.length - 1, k | 0))];
  const ax = axes(g.p, g.yaw);
  const dir = localToDir(g.p, g.yaw, x, z, ax);
  return { dir, facing: tangentTo(dir, ax.Z) };
}

// Kam patří vozidlo (domovská garáž a místo v ní). Bez garáže = u Výkupu.
export function homeSpot(v) {
  const g = v.garage && structureById(v.garage);
  if (g) return garageSlot(g, v.spot);
  return { dir: baseDir(0, -14), facing: [0, -1, 0] };
}
export function isParkedHome(v) {
  return angleBetween(v.p, homeSpot(v).dir) * R < 3;
}
export const garageName = id => {
  const i = garages().findIndex(g => g.id === id);
  return i < 0 ? 'bez garáže' : `Garáž ${i + 1}`;
};

// ---------- výška podstavce a povrch desky ----------

// Horní plocha desky stavby (m nad poloměrem): nejvyšší bod terénu pod padem + 3 cm. Model se posadí tak,
// aby jeho deska (padTop nad počátkem modelu) lícovala s touto výškou; nižší místa podepřou nožky.
const topCache = new WeakMap();
export function padTopHeight(b) {
  const key = `${b.p[0]},${b.p[1]},${b.p[2]},${b.yaw},${terrainVersion()}`;
  const c = topCache.get(b);
  if (c && c.key === key) return c.top;
  const top = heightRange(b.p, b.yaw, STRUCTURES[b.type].pad)[1] + 0.03;
  topCache.set(b, { key, top });
  return top;
}

// ---------- srovnaný terén pod stavbami (4. 11.) ----------
// Každá stavba (mimo malé opakované – soláry, baterie, RTG – a kotvy) srovná terén pod deskou na průměrnou výšku
// původního terénu (vzorky po 2 m) a okolí plynule napojí přechodem 4–16 m podle převýšení – stavba nepropadá,
// nepotřebuje nožky a dá se k ní dojet. Plochy se odvozují ze staveb → u hostitele i klientů stejné.
const FLAT_EDGE = 0.5;                                 // m – plocha přesahuje desku
const patchCache = new Map();                          // id → { key, patch }
export const flattens = def => !!def && !def.instanced && !def.hover && def.kind !== 'belt';
export function terrainPatchFor(type, p, yaw) {
  const pad = STRUCTURES[type].pad, ax = axes(p, yaw);
  const nx = Math.max(2, Math.ceil((pad[1] - pad[0]) / 2)), nz = Math.max(2, Math.ceil((pad[3] - pad[2]) / 2));
  let sum = 0, n = 0, lo = Infinity, hi = -Infinity;
  for (let i = 0; i <= nx; i++) for (let k = 0; k <= nz; k++) {
    const h = rawHeightAt(localToDir(p, yaw, pad[0] + (pad[1] - pad[0]) * i / nx, pad[2] + (pad[3] - pad[2]) * k / nz, ax));
    sum += h; n++; lo = Math.min(lo, h); hi = Math.max(hi, h);
  }
  const rect = [pad[0] - FLAT_EDGE, pad[1] + FLAT_EDGE, pad[2] - FLAT_EDGE, pad[3] + FLAT_EDGE];
  const margin = Math.max(4, Math.min(16, (hi - lo) * 1.2 + 2));
  const reach = (rectRadius(rect) + margin + 1) / R;
  return { c: norm(p), X: ax.X, Z: ax.Z, rect, level: sum / n, margin, cos: Math.cos(reach), span: hi - lo, ang: reach };
}
let patchSig = '';
// Volá main.js každý snímek: podle staveb nastaví srovnané plochy (jen když se stavby změnily).
export function syncTerrainPatches() {
  const list = (game.s?.buildings || []).filter(b => flattens(STRUCTURES[b.type]));
  const sig = list.map(b => `${b.id}:${b.p[0].toFixed(7)},${b.p[1].toFixed(7)},${b.yaw.toFixed(4)}`).join('|');
  if (sig === patchSig) return false;
  patchSig = sig;
  const before = new Map(patchCache);
  const patches = [], changed = [];
  patchCache.clear();
  for (const b of list) {
    const key = `${b.type}|${b.p.join(',')}|${b.yaw}`;
    const old = before.get(b.id);
    const patch = old && old.key === key ? old.patch : terrainPatchFor(b.type, b.p, b.yaw);
    if (!old || old.key !== key) changed.push({ c: patch.c, ang: patch.ang });
    patchCache.set(b.id, { key, patch });
    patches.push(patch);
  }
  for (const [id, o] of before) if (!patchCache.has(id) || patchCache.get(id).key !== o.key) changed.push({ c: o.patch.c, ang: o.patch.ang });
  setTerrainPatches(patches, changed);
  return true;
}

// Zem na desce stavby (pro fyziku): v padu = horní plocha desky, jinak null.
export function padGround(p) {
  const list = game.s?.buildings;
  if (!list?.length) return null;
  let best = null;
  for (const b of list) {
    const def = STRUCTURES[b.type];
    if (!def || angleBetween(p, b.p) * R > rectRadius(def.pad) + 1) continue;
    const [x, z] = dirToLocal(b.p, b.yaw, p);
    if (!inRect(def.pad, x, z)) continue;
    const top = padTopHeight(b);
    if (best === null || top > best) best = top;
  }
  return best;
}
setGroundHook(padGround);

// ---------- interakce a kolize ----------

// Stavba, v jejíž zóně „use“ hráč stojí (E otevře její okno). { b, def } nebo null.
export function structureToUse(p) {
  for (const b of game.s.buildings || []) {
    const def = STRUCTURES[b.type];
    if (!def?.use || angleBetween(p, b.p) * R > rectRadius(def.use) + 2) continue;
    const [x, z] = dirToLocal(b.p, b.yaw, p);
    if (inRect(def.use, x, z)) return { b, def };
  }
  return null;
}

// Stavba pod bodem q (pro bourání): nejbližší, jejíž pad obsahuje q.
export function structureAt(q) {
  let best = null, bestD = Infinity;
  for (const b of game.s.buildings || []) {
    const def = STRUCTURES[b.type];
    if (!def) continue;
    const d = angleBetween(q, b.p) * R;
    if (d > rectRadius(def.pad) + 1 || d >= bestD) continue;
    const [x, z] = dirToLocal(b.p, b.yaw, q);
    if (inRect(def.pad, x, z, 0.5)) { best = b; bestD = d; }
  }
  return best;
}

// Kolize těla (p, poloměr r) s pevnými částmi staveb v okolí 30 m (O-07).
// Vrací { p, n } = vytlačená poloha a normála (tečný vektor ven ze stavby), nebo null.
// Pevné jsou i budovy základny (Výkup, Dílna, Obchod – base.js solid).
export function pushOut(p, r) {
  let out = null;
  const push = (b, solid) => {
    if (!solid || angleBetween(p, b.p) * R > 30) return;
    const ax = axes(b.p, b.yaw);
    for (const box of solid) {
      const q = out ? out.p : p;
      const [x, z] = dirToLocal(b.p, b.yaw, q, ax);
      if (!inRect(box, x, z, r)) continue;
      // nejkratší cesta ven
      const opts = [[box[0] - r - x, 0], [box[1] + r - x, 0], [0, box[2] - r - z], [0, box[3] + r - z]];
      const [dx, dz] = opts.reduce((a, c) => (Math.abs(c[0] + c[1]) < Math.abs(a[0] + a[1]) ? c : a));
      const np = norm(madd(madd(q, ax.X, dx / R), ax.Z, dz / R));
      const len = Math.hypot(dx, dz) || 1;
      const n = norm([(ax.X[0] * dx + ax.Z[0] * dz) / len, (ax.X[1] * dx + ax.Z[1] * dz) / len, (ax.X[2] * dx + ax.Z[2] * dz) / len]);
      out = { p: np, n };
    }
  };
  for (const b of game.s.buildings || []) push(b, STRUCTURES[b.type]?.solid);
  for (const b of BUILDINGS) push(b, b.solid);
  return out;
}

// ---------- převod uložené hry v2 → v3 (L-50, L-13) ----------

// Garáž z v2 stála v základně (x 0, y 19) vraty ke středu. Ve v3 je to obyčejná stavba, kousek dál od středu,
// aby se řada parkovacích míst nepletla s Výkupem, Dílnou a Obchodem. Vozidla navíc (v2 dovolila 10) → druhá garáž zdarma.
export function legacyGarages(s) {
  s.buildings ||= [];
  if (!s.garage) return;
  const make = (x, y, faceX, faceY) => {
    const p = baseDir(x, y);
    const f = tangentTo(p, [faceX, faceY, 0]);
    const b = { id: newUid(), type: 'garage', p, yaw: normYaw(yawFor(p, f)), lv: 0, paid: STRUCTURES.garage.price, data: {} };
    s.buildings.push(b);
    return b;
  };
  const first = make(0, 24, 0, -1);
  s.gfree = true;
  const extra = s.vehicles.length > GARAGE_SLOTS ? make(34, 24, -1, 0) : null;
  s.vehicles.forEach((v, i) => {
    v.garage = i < GARAGE_SLOTS ? first.id : extra.id;
    v.spot = i % GARAGE_SLOTS;
  });
  s.garage = false;
}

MIGRATE[2] = s => {
  legacyGarages(s);
  s.hammer = 0;
};
