// Katalog: nástroje, vozidla, jejich vylepšení, stavby a stanice robotů.
// width = šířka zametaného pásu (m), hopper = zásobník na prach (kg), power = prachu z bodu za tick.

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

export const TOOL_UPGRADES = {
  width:  { name: 'Šířka',     max: 5, step: 0.12, unit: 'm',  desc: '+12 % šířky pásu za úroveň' },
  hopper: { name: 'Zásobník',  max: 5, step: 0.3,  unit: 'kg', desc: '+30 % kapacity za úroveň' },
  power:  { name: 'Síla',      max: 5, step: 10,   unit: '',   desc: '+10 prachu z bodu za tick' },
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
];

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
export const VEHICLE_UPGRADES = {
  width: { name: 'Šířka sání',    max: 5, step: 0.1,  unit: 'm',   desc: '+10 % šířky sání za úroveň' },
  speed: { name: 'Rychlost vozu', max: 5, step: 0.12, unit: 'm/s', desc: '+12 % rychlosti za úroveň' },
  hopper: { name: 'Kapacita zásobníku', max: 5, step: 0.25, unit: 'kg', desc: '+25 % kapacity zásobníku za úroveň', only: ['push', 'rideon', 'lunar', 'mega'] },
  boost: { name: 'Boost (Shift)', max: 3, step: 0.5,  unit: '×',   desc: 'Shift = skokově 200 % rychlosti, každá další úroveň +50 %', only: ['crew'] },
};
export const BOOST = { duration: 4, recharge: 10 };   // plný boost vydrží 4 s, z nuly se nabije za 10 s
export const boostFactor = lv => (lv > 0 ? 1.5 + VEHICLE_UPGRADES.boost.step * lv : 1);

export const GARAGE_PRICE = 2000;

// Ekonomická vylepšení ve Výkupu (sdílená pro celý svět, hráče, roboty, drony i pásy).
// market = burzovní cena prachu (+6 % za úroveň), hexup = prémie za dočištěný hex (+50 % za úroveň).
export const MARKET = {
  name: 'Burzovní cena prachu',
  desc: 'Smlouva s pozemskou burzou: Výkup platí za každý kilogram prachu víc. Platí pro celý svět – pro hráče, roboty, drony i pásy.',
  max: 5, step: 0.06,
  price: 30000, priceMult: 2,   // 30 000 → 60 000 → 120 000 → 240 000 → 480 000
};
export const HEXUP = {
  name: 'Prémie za dočištěný hex',
  desc: 'Kontrakt s úklidovou agenturou: za každý dočištěný hexový sektor přijde vyšší prémie. Platí i pro hexy, které dočistí roboti a drony.',
  max: 5, step: 0.5,
  price: 30000, priceMult: 2,
};
const exchCost = (u, lv) => (lv >= u.max ? null : Math.round(u.price * u.priceMult ** lv));
export const marketCost = lv => exchCost(MARKET, lv);
export const hexupCost = lv => exchCost(HEXUP, lv);

export const STATION = {
  price: 800, priceMult: 1.6,   // cena další stanice
  rings: 2,                     // robot čistí hexy do vzdálenosti 2 hexů od stanice
  hopper: 30, speed: 2.5, width: 1.0, power: 40, rowGap: 0.9,
  kgPerSec: 0.07,               // průměrný výkon pro offline výpočet
};

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

export const DEFAULT_LOOK = { color: 0, top: 'none', face: 'noface' };
export const propById = id => HELMET_PROPS.find(p => p.id === id);
