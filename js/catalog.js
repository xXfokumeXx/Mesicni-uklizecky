// Katalog: nástroje, vozidla, jejich vylepšení, stavby a stanice robotů.
// width = šířka zametaného pásu (m), hopper = zásobník na prach (kg), power = prachu z bodu za tick (pevná, od 3.1 bez vylepšení – L-71).

export const TOOLS = [
  { id: 'toothbrush', name: 'Zubní kartáček', width: 0.3, hopper: 4,  power: 20, price: 0,
    desc: 'Startovní výbava úklidové služby. Malý, ale poctivý.' },
  { id: 'handbrush',  name: 'Smetáček',       width: 0.6, hopper: 10, power: 25, price: 60,
    desc: 'Dvakrát širší pás a víc místa na prach.' },
  { id: 'broom',      name: 'Koště',          width: 1.0, hopper: 20, power: 30, price: 250,
    desc: 'Metr široký pás. Klasika, která nezklame.' },
  { id: 'handvac',    name: 'Ruční vysavač',  width: 1.4, hopper: 45, power: 40, price: 900,
    desc: 'Sací hubice nasaje i hlubší vrstvu regolitu.' },
  { id: 'squeegee',   name: 'Široká stěrka',  width: 2.0, hopper: 70, power: 40, price: 2400,
    desc: 'Dvoumetrový záběr pro ty, kdo už nechtějí jezdit.' },
];

// L-71 (3.1): vylepšení Síla (power) zrušeno – koupené úrovně vrací equipment.js powerRefund (5 úrovní, podíl 0,45).
export const POWER_LEVELS_31 = 5;
export const TOOL_UPGRADES = {
  width:  { name: 'Šířka',     max: 5, step: 0.12, unit: 'm',  desc: '+12 % šířky pásu za úroveň' },
  hopper: { name: 'Zásobník',  max: 5, step: 0.3,  unit: 'kg', desc: '+30 % kapacity za úroveň' },
};

// kind: 'push' = jdeš za ním, 'drive' = sedíš za volantem, 'transport' = jen rychlý přesun.
export const VEHICLES = [
  { id: 'push',  name: 'Ruční zametací vozík',  kind: 'push',      width: 1.35, hopper: 100,  speed: 4,  power: 60,  price: 1500,
    desc: 'Tlačíš ho před sebou: pás 1,35 m a zásobník 100 kg.', front: 1.0, camera: 12 },
  { id: 'rideon', name: 'Zametač se sedačkou',  kind: 'drive',     width: 2.0,  hopper: 250,  speed: 6,  power: 70,  price: 6000,
    desc: 'Sedneš a jedeš. Dva rotační kartáče vpředu.', front: 1.3, camera: 14 },
  { id: 'lunar', name: 'Měsíční zametací vůz',  kind: 'drive',     width: 3.0,  hopper: 600,  speed: 7, power: 80,  price: 20000,
    desc: 'Komunální zametač upravený pro vakuum. Čtyři kartáče.', front: 2.6, camera: 18 },
  { id: 'mega',  name: 'Mega vysávací rover',   kind: 'drive',     width: 5.0,  hopper: 2000, speed: 6,  power: 100, price: 75000,
    desc: 'Pětimetrová sací hlava. Hex za pár průjezdů.', front: 3.4, camera: 22 },
  { id: 'crew',  name: 'Přepravník posádky',    kind: 'transport', width: 0,    hopper: 0,    speed: 12, power: 0,   price: 4000,
    desc: 'Nezametá, ale odveze řidiče a až 5 cestujících rychle na druhou stranu Měsíce.', front: 0, camera: 16, seats: 5,
    body: [1.2, 5, 3] },
  // ---------- letouny (3.1, L-65, D-17): kind 'air', domov = plošina LAAC, pilotují se jako vozidla (player.js fly) ----------
  // sweepSpeed = nejvyšší rychlost při zametání, sell = podíl ceny při prodeji (60 %), scan = dosah skeneru (m)
  { id: 'prachovka', name: 'Prachovka', kind: 'air', width: 4.0, hopper: 600, speed: 12, sweepSpeed: 6, power: 80, price: 45000, research: 'aviation',
    desc: 'Zametá ze vzduchu: sací lišta 4 m pod trupem v 1,5 m nad zemí, zásobník 600 kg. Vysype se ve Výkupu nebo do depa jako vozidlo.', front: 0, camera: 20, sell: 0.6 },
  { id: 'kolibrik', name: 'Kolibřík', kind: 'air', width: 0, hopper: 0, speed: 30, power: 0, price: 30000, research: 'aviation',
    desc: 'Rychlý dvoumístný letoun na přesuny a průzkum. Skener prachu ukáže na mapě (M) 5 nejšpinavějších hexů do 300 m.', front: 0, camera: 20, seats: 1, scan: 300, sell: 0.6 },
  // fáze 8 (L-67): carry = převoz vozidel (rope = lano 12 m, arm = robotická ruka), loadSpeed = rychlost s nákladem
  // carryFits = co unese (11. 11., rozhodl hráč): Mula nejvýš Měsíční zametací vůz, Kondor všechna pozemní vozidla i Mega rover
  { id: 'mula', name: 'Mula', kind: 'air', width: 0, hopper: 0, speed: 14, loadSpeed: 9, power: 0, price: 70000, research: 'heavyLift', carry: 'rope', rope: 12, carryFits: ['push', 'rideon', 'lunar', 'crew'],
    desc: 'Těžký nosič s navijákem: na 12m laně unese vozidla až po Měsíční zametací vůz (Mega rover jen Kondor). Náklad se pomalu houpe – kyv tlumíš protipohybem.', front: 0, camera: 24, sell: 0.6 },
  { id: 'kondor', name: 'Kondor', kind: 'air', width: 0, hopper: 2000, speed: 20, loadSpeed: 14, power: 0, price: 90000, research: 'roboticArm', carry: 'arm', carryFits: ['push', 'rideon', 'lunar', 'crew', 'mega'],
    desc: 'Nákladní letoun: robotická ruka unese jakékoli pozemní vozidlo, i Mega rover, nákladový prostor 2 000 kg prachu se plní ze sila depa shora.', front: 0, camera: 22, sell: 0.6 },
];
export const AIR_TYPES = VEHICLES.filter(v => v.kind === 'air').map(v => v.id);
export const GROUND_TYPES = VEHICLES.filter(v => v.kind !== 'air').map(v => v.id);
export const isAirType = type => AIR_TYPES.includes(type);

// Fyzika vozidla (physics.js createBody): [maxVr, grip, airG] – jak prudce vyletí z hřebene,
// jak drží na zemi a kolikrát gravitace planety táhne vozidlo dolů ve vzduchu.
// Bez „body“ drží vozidlo pevně u země (zametače). Přepravník z hřebenů vyskočí a letí
// (ve vzduchu ~3× víc než dřív); úplně skutečná gravitace by ho při boostu vynesla na oběžnou dráhu.
export const VEHICLE_BODY = [0.5, 8];

// Měsíční boty (Dílna → Astronaut): rychlejší chůze, 3 úrovně. speed = násobek chůze na dané úrovni.
export const BOOTS = {
  name: 'Měsíční boty',
  desc: 'Pružné podrážky s mikrohroty: delší krok a lepší odraz, a přitom drží na svahu.',
  levels: [
    { name: 'Standardní boty skafandru', speed: 1 },
    { name: 'Odpružené boty', speed: 1.25, price: 900 },
    { name: 'Boty s pružinovým odrazem', speed: 1.5, price: 4500 },
    { name: 'Raketové boty', speed: 1.8, price: 18000 },
  ],
};

// Opasek (Dílna → Astronaut): víc políček v hotbaru dole na obrazovce.
export const BELT = {
  name: 'Opasek na nářadí',
  desc: 'Víc políček v hotbaru dole: nástroje, stanice i depo máš po ruce a přepínáš klávesami 1–3.',
  levels: [
    { name: 'Bez opasku', slots: 1 },
    { name: 'Opasek na nářadí', slots: 2, price: 1500 },
    { name: 'Taktický opasek', slots: 3, price: 6000 },
  ],
};

// Jetpack (Dílna → Astronaut): mezerník ve vzduchu vystřelí astronauta ve směru kamery.
// Nabije se znovu, jakmile astronaut dopadne na zem.
export const JETPACK = {
  name: 'Jetpack',
  desc: 'Mezerník ve vzduchu = výstřel vpřed ve směru kamery (mírně vzhůru). Po dopadu na zem se jetpack znovu nabije.',
  price: 12000,
  speed: 16,                    // rychlost výstřelu (m/s)
  lift: 30,                     // nejmenší úhel nad obzor (°), aby astronaut nezaryl do země
};

// only = jen pro tyto typy vozidel. Boost: Shift = skokové zrychlení na 200 / 250 / 300 % rychlosti.
// Baterie vozidel (L-01): cap = kapacita ⚡, drive = spotřeba jízdy ⚡/s při plné rychlosti, sweep = + při zametání.
// Spotřeba P = drive × (0,3 + 0,7 × |v| / vmax) + (zametá ? sweep : 0), stojící vozidlo nespotřebovává nic.
// Ruční vozík baterii nemá (tlačí ho astronaut).
// 4. 11.: kapacita i spotřeba 2× – doba jízdy stejná, nabíjení trvá dvakrát déle (víc energie ze sítě)
export const VEHICLE_BATTERY = {
  rideon: { cap: 800, drive: 1.4, sweep: 0.6 },
  lunar: { cap: 1800, drive: 2.8, sweep: 1.2 },
  mega: { cap: 4800, drive: 7.0, sweep: 3.6 },
  crew: { cap: 2400, drive: 4.0, sweep: 0 },
  // letouny (L-65): hover = spotřeba ve vznášení, drive = při plné rychlosti
  prachovka: { cap: 2200, hover: 3, drive: 5, sweep: 2 },
  kolibrik: { cap: 1200, hover: 2, drive: 6, sweep: 0 },
  mula: { cap: 4000, hover: 6, drive: 10, sweep: 0, load: 6 },          // load = + s vozidlem na laně
  kondor: { cap: 5000, hover: 7, drive: 12, sweep: 0, load: 5 },         // load = + s vozidlem nebo nákladem
};
export const EMERGENCY_SPEED = 0.15;           // vybitá baterie: nouzový režim 15 % rychlosti, nezametá (L-02)
// Kapacita baterie vozidla v ⚡ (0 = bez baterie) včetně vylepšení „Větší baterie“ (+25 % za úroveň).
export const batteryCap = v => (VEHICLE_BATTERY[v?.type]?.cap || 0) * (1 + 0.25 * ((v?.lv?.battery | 0) + (v?.lv?.abatt | 0)));   // abatt = Baterie letounu

export const VEHICLE_UPGRADES = {
  width: { name: 'Šířka sání',    max: 5, step: 0.1,  unit: 'm',   desc: '+10 % šířky sání za úroveň', only: ['push', 'rideon', 'lunar', 'mega'] },
  speed: { name: 'Rychlost vozu', max: 5, step: 0.12, unit: 'm/s', desc: '+12 % rychlosti za úroveň', only: ['push', 'rideon', 'lunar', 'mega', 'crew'] },
  // letouny (3.1, L-65): 3 úrovně, cena podle upgradeCost
  motor: { name: 'Motory', max: 3, step: 0.15, unit: 'm/s', desc: '+15 % rychlosti za úroveň', only: ['prachovka', 'kolibrik', 'mula', 'kondor'] },
  abatt: { name: 'Baterie', max: 3, step: 0.25, unit: '⚡', desc: '+25 % kapacity baterie za úroveň', only: ['prachovka', 'kolibrik', 'mula', 'kondor'] },
  special: { name: 'Speciální', max: 3, step: 0.2, unit: '', desc: 'Prachovka: sací lišta +20 % · Kolibřík: dosah skeneru +150 m · Mula: naviják (kolečko 8–20 m) · Kondor: náklad +50 %', only: ['prachovka', 'kolibrik', 'mula', 'kondor'],
    names: { prachovka: 'Sací lišta', kolibrik: 'Dosah skeneru', mula: 'Naviják', kondor: 'Nákladový prostor' } },
  hopper: { name: 'Kapacita zásobníku', max: 5, step: 0.25, unit: 'kg', desc: '+25 % kapacity zásobníku za úroveň', only: ['push', 'rideon', 'lunar', 'mega'] },
  boost: { name: 'Boost (Shift)', max: 3, step: 0.5,  unit: '×',   desc: 'Shift = skokově 200 % rychlosti, každá další úroveň +50 %', only: ['crew'] },
  // L-03: úrovně 1–2 hned, 3–4 až po výzkumu „Baterie T3“ (research.from = od které úrovně je potřeba výzkum)
  battery: { name: 'Větší baterie', max: 4, step: 0.25, unit: '⚡', desc: '+25 % kapacity baterie za úroveň', only: ['rideon', 'lunar', 'mega', 'crew'], research: { from: 2, id: 'batteryT3' } },
  // L-04: celá střecha až po výzkumu „Solární střecha“ (from 0)
  solar: { name: 'Solární střecha', max: 3, step: 1, unit: '%', desc: 'Na přímém Slunci pokryje část spotřeby, ve stání dobíjí', only: ['rideon', 'lunar', 'mega', 'crew'], research: { from: 0, id: 'solarRoof' } },
  // L-40 / L-41: autopilot (autopilot.js), klávesa C. share = podíl ceny vozidla (autocruise 0,3 podle zadání),
  // needs = vylepšení, které vozidlo už musí mít
  cruise: { name: 'Autocruise', max: 1, step: 1, unit: '', share: 0.3, desc: 'C = jede samo vpřed nastavenou rychlostí, zastaví před překážkou', only: ['rideon', 'lunar', 'mega', 'crew'], research: { from: 0, id: 'cruise' } },
  edge: { name: 'Sledování hrany prachu', max: 1, step: 1, unit: '', share: 0.5, desc: 'C 2× = asistent drží vozidlo podél hrany prachu, kterou už máš (jako asistent jízdy v pruhu)', only: ['rideon', 'lunar', 'mega'], research: { from: 0, id: 'edgeFollow' }, needs: 'cruise' },
};
// Solární střecha podle úrovně (L-04): cover = podíl spotřeby při jízdě, rest = dobíjení ve stání ⚡/s (vše × sin výšky Slunce)
export const SOLAR_ROOF = [null, { cover: 0.15, rest: 0.2 }, { cover: 0.3, rest: 0.4 }, { cover: 0.5, rest: 0.8 }];
export const BOOST = { duration: 4, recharge: 10 };   // plný boost vydrží 4 s, z nuly se nabije za 10 s
export const boostFactor = lv => (lv > 0 ? 1.5 + VEHICLE_UPGRADES.boost.step * lv : 1);

export const GARAGE_PRICE = 2000;

// Ekonomická vylepšení ve Výkupu (sdílená pro celý svět, hráče, roboty, drony i pásy).
// market = burzovní cena prachu (+6 % za úroveň), hexup = prémie za dočištěný hex (+50 % za úroveň).
export const MARKET = {
  name: 'Burzovní cena prachu',
  desc: 'Smlouva s pozemskou burzou: Výkup platí za každý kilogram prachu víc. Platí pro celý svět – pro hráče, roboty, drony i pásy.',
  max: 5, step: 0.06,
  price: 20000, priceMult: 2,   // 20 000 → 40 000 → 80 000 → 160 000 → 320 000
};
export const HEXUP = {
  name: 'Prémie za dočištěný hex',
  desc: 'Kontrakt s úklidovou agenturou: za každý dočištěný hexový sektor přijde vyšší prémie. Platí i pro hexy, které dočistí roboti a drony.',
  max: 5, step: 0.5,
  price: 20000, priceMult: 2,   // 20 000 → 40 000 → 80 000 → 160 000 → 320 000 (do 3.0.4: od 30 000)
};
const exchCost = (u, lv) => (lv >= u.max ? null : Math.round(u.price * u.priceMult ** lv));
export const marketCost = lv => exchCost(MARKET, lv);
export const hexupCost = lv => exchCost(HEXUP, lv);

// Stanice robota = Vysavač MK1 (rozhodnutí 3. 11.: původní robot za $800 zrušen, MK1 je základ bez výzkumu).
export const STATION = {
  price: 3800, priceMult: 1.6,  // cena další stanice (MK1); MK2 = + příplatek
  rings: 2,                     // robot čistí hexy do vzdálenosti 2 hexů od stanice
  hopper: 60, speed: 3.5, width: 1.0, power: 40, rowGap: 0.9,
  kgPerSec: 0.1,                // průměrný výkon pro offline výpočet
};
// Úrovně stanice (L-31): 1 = Vysavač MK1 (základ), 2 = Vysavač MK2 (po výzkumu). Index 0 se nepoužívá (stará uložení → MK1).
// extra = příplatek k ceně stanice; vylepšení na místě stojí rozdíl příplatků. kgPerSec ~ rychlost (offline).
export const STATION_MK = [
  null,
  // store = zásobník stanice (kg, 11. 11.): robot do něj vykládá, prach odveze jen pás ze stanice (prodej ve Výkupu)
  { name: 'Vysavač MK1', speed: 3.5, hopper: 60, rings: 2, kgPerSec: 0.1, extra: 0, store: 80 },
  { name: 'Vysavač MK2', speed: 5, hopper: 120, rings: 3, kgPerSec: 0.14, extra: 9000, research: 'vacuumMk2', store: 200 },
];
export const stationMk = st => STATION_MK[Math.max(1, Math.min(2, st?.mk | 0))];

// UFO dron: létá nad terénem, sám si hledá nedočištěné hexy kdekoli na Měsíci a čistí je
// 4× rychleji než robot ze stanice (2× širší pás při 2× vyšší rychlosti). Plný se vyloží
// ve Výkupu nebo v nejbližším depu s pásem. Startuje nad Výkupem, žádnou stanici nepotřebuje.
export const DRONE = {
  price: 150000, priceMult: 1.6,
  hopper: 150, speed: 5, cruise: 10, width: 2.0, power: 45, rowGap: 1.8, alt: 3.2,
  kgPerSec: 0.28,               // průměrný výkon pro offline výpočet (4× robot)
};

// Depo: sklad prachu mimo základnu. Prach se do něj vysype jako do Výkupu, ale peníze přinese
// až nadzemní pás, který ho odveze do Výkupu uprostřed základny.
export const SILO = {
  price: 2000,
  moveCost: 1000,               // přesun depa na jiné místo (pásy se samy přestaví)
  beltPerHex: 25,               // cena pásu za každý hex, přes který vede
  zone: 4.5,                    // poloměr vysýpací zóny kolem depa (m)
  beltRate: 12,                 // kolik kg za sekundu pás odebere z depa
  beltSpeed: 3,                 // rychlost pásu (m/s) → jak dlouho prach jede do základny
  beltHeight: 6.5,              // výška pásu nad terénem (pod ním projede i Mega rover)
};

// Prodej vozidla: vrátí se 75 % kupní ceny včetně zaplacených vylepšení.
export const SELL_REFUND = 0.75;
export const TOOL_SELL = 0.3;                    // prodej ručního nástroje v Obchodě: 30 % ceny a zaplacených vylepšení

export const toolById = id => TOOLS.find(t => t.id === id);
export const vehicleById = id => VEHICLES.find(v => v.id === id);

// Cena vylepšení: z ceny předmětu, ×1,8 za každou další úroveň.
export function upgradeCost(itemPrice, level, share) {
  return Math.round(Math.max(30, itemPrice * share) * 1.8 ** level);
}

// ---------- šatna (Dílna → Šatna) ----------

// Základní paleta 16 barev skafandru.
export const SUIT_COLORS = [
  { hex: 0xeceae3, name: 'Bílá NASA' },      { hex: 0xb9bcc4, name: 'Stříbrná' },
  { hex: 0x4a4f5c, name: 'Grafitová' },      { hex: 0x22252c, name: 'Noční' },
  { hex: 0xd9533d, name: 'Hasičská' },       { hex: 0xe8742a, name: 'Oranžová' },
  { hex: 0xf2b33d, name: 'Reflexní žlutá' }, { hex: 0xc9b98a, name: 'Písková' },
  { hex: 0x7fbf5a, name: 'Trávová' },        { hex: 0x3f8f6f, name: 'Smaragdová' },
  { hex: 0x5fb8d9, name: 'Nebeská' },        { hex: 0x3b5fb0, name: 'Královská modrá' },
  { hex: 0x7a5cc2, name: 'Fialová' },        { hex: 0xe58bbd, name: 'Růžová žvýkačka' },
  { hex: 0x8a5a3c, name: 'Čokoládová' },     { hex: 0x9e2a3c, name: 'Vínová' },
];

// Rekvizity na helmu (slot „top“) a na hledí (slot „face“). Modely: scene/props.js.
export const HELMET_PROPS = [
  { id: 'none',    slot: 'top',  name: 'Nic',                  desc: 'Čistá helma, čistá hlava.' },
  { id: 'horns',   slot: 'top',  name: 'Čertovské rohy',       desc: 'Pro ty, kdo zametají s ďábelským nasazením.' },
  { id: 'mohawk',  slot: 'top',  name: 'Punkové číro',         desc: 'Vakuum ho drží v dokonalém tvaru.' },
  { id: 'cowboy',  slot: 'top',  name: 'Kovbojský klobouk',    desc: 'Šerif Moře klidu.' },
  { id: 'tophat',  slot: 'top',  name: 'Cylindr',              desc: 'Úklid se dělá v gala.' },
  { id: 'crown',   slot: 'top',  name: 'Královská korunka',    desc: 'Vládce prachu a regolitu.' },
  { id: 'propeller', slot: 'top', name: 'Čepice s vrtulkou',   desc: 'Ve vakuu nefunguje. Točí se stejně.' },
  { id: 'antennae', slot: 'top', name: 'Mimozemská tykadla',   desc: 'Přijímá signál ze základny i z jiných galaxií.' },
  { id: 'catears', slot: 'top',  name: 'Kočičí uši',           desc: 'Mňau v bezvzduší nikdo neuslyší.' },
  { id: 'halo',    slot: 'top',  name: 'Svatozář',             desc: 'Za každý dočištěný hex jeden bod do nebe.' },
  { id: 'chef',    slot: 'top',  name: 'Kuchařská čepice',     desc: 'Dnes podáváme prach na tisíc způsobů.' },
  { id: 'duck',    slot: 'top',  name: 'Gumová kachnička',     desc: 'Věrný parťák do každé směny.' },
  { id: 'cone',    slot: 'top',  name: 'Dopravní kužel',       desc: 'Pozor, úklid! Objeďte zametače.' },
  { id: 'noface',  slot: 'face', name: 'Nic',                  desc: 'Zlaté hledí bez ozdob.' },
  { id: 'moustache', slot: 'face', name: 'Knír',               desc: 'Kartáčový knír, ladí ke smetáčku.' },
  { id: 'glasses', slot: 'face', name: 'Brýle s nosem',        desc: 'Dokonalé inkognito.' },
  { id: 'whiskers', slot: 'face', name: 'Kočičí vousky',       desc: 'Ke kočičím uším jako dělané.' },
];

// Hotová oblečení (AST-04, 3.1): sada barev pro materiály astronauta (barvy z postav předávky postavy/postava-*.glb,
// sRGB). Co v pal chybí, zůstane jako na modelu. color = barva ze SUIT_COLORS, ke které oblečení patří (barva hráče
// v chatu, jmenovce a na mapě) – jiná barva ze šatny oblek dobarví (scene/astronaut.js applyPalette).
export const SKINS = [
  { id: 'vychozi', name: 'Výchozí', color: 0, pal: null },
  { id: 'rez', name: 'Rezavý', color: 14, pal: { lem: 0x4a2c1c, oblek: 0xa4552a, 'oblek-stin': 0x7c3413, doplnek: 0xd9c096, svetlo: 0xffc04a, stit: 0xd9a441, jetpack: 0x9a6c3e, 'jetpack-kov': 0x6f4a29 } },
  { id: 'reflex', name: 'Reflexní', color: 5, pal: { lem: 0x2b2725, oblek: 0xec7a1c, 'oblek-stin': 0xb85c12, doplnek: 0xf7e27a, svetlo: 0xffc04a, stit: 0x2a3346, jetpack: 0x3b3431, 'jetpack-kov': 0x2b2725 } },
  { id: 'mech', name: 'Mechanik', color: 1, pal: { lem: 0x3a4238, oblek: 0x8f9a8a, 'oblek-stin': 0x5c6a5a, doplnek: 0xd9a441, svetlo: 0xff8a5c, stit: 0xff8a5c, jetpack: 0x5c6a5a, 'jetpack-kov': 0x8f8c88 } },
  { id: 'krystal', name: 'Krystal', color: 10, pal: { lem: 0x23465a, oblek: 0xeaf6f6, 'oblek-stin': 0xb9d3d6, doplnek: 0x6fd8f2, svetlo: 0xa8efff, stit: 0x3fb7d9, jetpack: 0xeaf6f6, 'jetpack-kov': 0x23465a } },
  { id: 'nocni', name: 'Noční', color: 3, pal: { lem: 0x141a28, oblek: 0x26324c, 'oblek-stin': 0x3a4763, doplnek: 0x6fd8f2, svetlo: 0x6fd8f2, stit: 0x6fd8f2, jetpack: 0x26324c, 'jetpack-kov': 0x141a28 } },
];
export const skinById = id => SKINS.find(k => k.id === id) || SKINS[0];

// Výchozí vzhled nového hráče = jako model (číro, fousky, čumák – rozhodnutí 5 v README 3.1). Stávající hráči si nechají svůj.
export const DEFAULT_LOOK = { skin: 'vychozi', color: 0, top: 'mohawk', face: 'whiskers' };
export const propById = id => HELMET_PROPS.find(p => p.id === id);
