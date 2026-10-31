// Úspěchy hráče. Patří profilu v prohlížeči (jako jméno a vzhled), takže platí ve všech světech
// i v multiplayeru – každý hráč sbírá své vlastní. Kontroluje je main.js (achTick + události).
import { profile, saveProfile } from './profile.js';

// goal + stat = úspěch s postupem (profile.achStats[stat] / goal); rec = stat je rekord (nejvyšší hodnota),
// ne součet – ukazuje se jako „Rekord“.
export const ACHIEVEMENTS = [
  { id: 'orbit',     icon: '🛰️', name: 'Houstone, máme oběžnou dráhu', desc: 'Vyletěl(a) jsi 150 m nad povrch. Satelity ti mávaly.',
    hint: 'Dostaň se 150 m nad povrch Měsíce. Jak, to je tvoje věc… (vozidlo s boostem umí zázraky).' },
  { id: 'toothbrush', icon: '🪥', name: 'Zubař roku', desc: 'Zubním kartáčkem jsi vyčistil(a) 50 kg prachu. Měsíc má konečně bílé zuby.',
    hint: 'Nasbírej 50 kg prachu zubním kartáčkem.', goal: 50, stat: 'tb', unit: 'kg' },
  { id: 'bowling',   icon: '🎳', name: 'Lidská kuželka', desc: 'Srazilo tě vozidlo. Strike!',
    hint: 'Nech se srazit rozjetým vozidlem.' },
  { id: 'roadkill',  icon: '🚨', name: 'Řidičák z automatu', desc: 'Srazil(a) jsi kolegu vozidlem. Pojišťovna už volá.',
    hint: 'Sraz jiného hráče vozidlem.' },
  { id: 'bus',       icon: '🚌', name: 'Příští zastávka: kráter', desc: 'Vezl(a) jsi v přepravníku aspoň dva cestující. Jízdenky prosím!',
    hint: 'Řiď přepravník posádky aspoň se dvěma cestujícími.' },
  { id: 'speed',     icon: '💨', name: 'Rychle a zběsile', desc: 'Jel(a) jsi 30 m/s. Měsíční radar tě vyfotil.',
    hint: 'Rozjeď vozidlo na 30 m/s.' },
  { id: 'darkside',  icon: '🌑', name: 'Temná strana Měsíce', desc: 'Došel(a) jsi na úplně opačnou stranu Měsíce, než je základna. Pink Floyd by byli hrdí.',
    hint: 'Dostaň se na opačnou stranu Měsíce, než je základna.' },
  { id: 'millionaire', icon: '💰', name: 'Prachový milionář', desc: 'Vydělal(a) jsi $1 000 000. Z prachu. Doslova.',
    hint: 'Vydělej sám (sama) $1 000 000.', goal: 1e6, stat: 'earn', unit: '$' },
  { id: 'nightshift', icon: '🌙', name: 'Noční směna', desc: 'Prodal(a) jsi prach ve Výkupu za tmy. Příplatek za noční se nevyplácí.',
    hint: 'Prodej prach ve Výkupu v noci.' },
  { id: 'hexorcist', icon: '⬡', name: 'Hexorcista', desc: 'Sám (sama) jsi dočistil(a) 100 hexů. Prach z nich vymítán.',
    hint: 'Dočisti sám (sama) 100 hexů.', goal: 100, stat: 'hex', unit: '' },
  // verze 2.3
  { id: 'longjump',  icon: '🦘', name: 'Klokan v skafandru', desc: 'Doskočil(a) jsi 140 m daleko jedním skokem. Olympijský výbor podává protest.',
    hint: 'Skoč 140 m daleko jedním skokem (jetpack se počítá, vozidlo ne – zkus to z kopce).', goal: 140, stat: 'jumpLen', unit: 'm', rec: true },
  { id: 'highjump',  icon: '🎈', name: 'Kde je strop?', desc: 'Vyskočil(a) jsi 18 m nad povrch. Strop nenalezen, helma v pořádku.',
    hint: 'Vyskoč 18 m nad povrch (skok + jetpack v nejvyšším bodě).', goal: 18, stat: 'jumpHigh', unit: 'm', rec: true },
  { id: 'strike100', icon: '🎯', name: 'Kuželkový velmistr', desc: 'Srazil(a) jsi vozidlem 100 kolegů. Dopravní inspektorát má tvou fotku na nástěnce.',
    hint: 'Sraz vozidlem 100× jiného hráče.', goal: 100, stat: 'hits', unit: '×' },
  { id: 'dummy100',  icon: '🩹', name: 'Figurína na crash testy', desc: 'Srazilo tě vozidlo stokrát. Automobilky ti nabízejí smlouvu.',
    hint: 'Nech se 100× srazit vozidlem.', goal: 100, stat: 'knocked', unit: '×' },
  { id: 'marathon',  icon: '🏃', name: 'Měsíční maraton', desc: 'Ušel (ušla) jsi pěšky 42,195 km. Cílová páska se ve vakuu nevlní.',
    hint: 'Ujdi pěšky 42,195 km (vozidla se nepočítají).', goal: 42.195, stat: 'walk', unit: 'km' },
  { id: 'stowaway',  icon: '🎫', name: 'Černý pasažér', desc: 'Strávil(a) jsi 10 minut jako cestující v přepravníku. Jízdenku nikdo nechtěl.',
    hint: 'Jezdi 10 minut jako cestující v přepravníku posádky.', goal: 10, stat: 'ride', unit: 'min' },
  { id: 'rocketman', icon: '🔥', name: 'Rocket Man', desc: 'Vystřelil(a) ses jetpackem stokrát. Elton John tleská.',
    hint: 'Použij jetpack 100×.', goal: 100, stat: 'jets', unit: '×' },
  { id: 'stunt',     icon: '🤸', name: 'Kaskadér z kráteru', desc: 'Vozidlo letělo 3 sekundy vzduchem. Tohle pojišťovna neproplatí.',
    hint: 'Proleť s vozidlem 3 s vzduchem (přepravník s boostem přes hřeben).', goal: 3, stat: 'vehAir', unit: 's', rec: true },
  { id: 'wallstreet', icon: '📈', name: 'Vlk z Měsíční ulice', desc: 'Výkup platí za prach nejvyšší burzovní cenu. Prach je nové zlato.',
    hint: 'Vylepši burzu ve Výkupu prachu na nejvyšší úroveň.' },
  { id: 'vacuum',    icon: '🌀', name: 'Lidský vysavač', desc: 'Sám (sama) jsi nasbíral(a) 10 tun prachu. Výrobci vysavačů tě studují.',
    hint: 'Nasbírej sám (sama) 10 000 kg prachu (nástrojem nebo vozidlem).', goal: 10000, stat: 'kg', unit: 'kg' },
  { id: 'liftoff',   icon: '🚀', name: 'Poslední zhasne', desc: 'Měsíc je na 100 % čistý a ty jsi odletěl(a) domů raketou. Nezapomněl(a) jsi zhasnout?',
    hint: 'Ukliďte celý Měsíc na 100 % a nastup do obrovské rakety na odvrácené straně.' },
  { id: 'marsdone',  icon: '🔴', name: 'Marťan roku', desc: 'Uklidil(a) jsi i celý Mars a odletěl(a) domů na Zemi. Babička už peče buchty.',
    hint: 'Ukliďte na 100 % i Mars a nastupte do rakety.' },
];

export const achById = id => ACHIEVEMENTS.find(a => a.id === id);
export const hasAch = id => !!profile.ach[id];
export const achCount = () => ACHIEVEMENTS.filter(a => profile.ach[a.id]).length;

let onUnlock = null;                     // (achievement) → oznámení (main.js)
export function initAchievements(cb) { onUnlock = cb; }

export function unlock(id) {
  if (profile.ach[id] || !achById(id)) return false;
  profile.ach[id] = Date.now();
  saveProfile();
  onUnlock?.(achById(id));
  return true;
}

// Přičte k postupu (stat) a odemkne úspěchy, které na něm závisí.
export function addAchStat(stat, amount) {
  if (!(amount > 0)) return;
  profile.achStats[stat] = (profile.achStats[stat] || 0) + amount;
  for (const a of ACHIEVEMENTS) if (a.stat === stat && profile.achStats[stat] >= a.goal) unlock(a.id);
  saveSoon();
}

// Rekord: uloží hodnotu, jen když je vyšší než dosavadní (nejdelší skok, nejvyšší skok…).
export function recordAchStat(stat, value) {
  if (!(value > (profile.achStats[stat] || 0))) return;
  profile.achStats[stat] = value;
  for (const a of ACHIEVEMENTS) if (a.stat === stat && value >= a.goal) unlock(a.id);
  saveSoon();
}

let saveTimer = 0;
function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = 0; saveProfile(); }, 5000);
}

// Ikona úspěchu jako obrázek (SVG) pro karty v okně Úspěchy.
export function achIcon(a) {
  const on = hasAch(a.id);
  const bg = on ? '#f2b33d' : '#2d313b', ring = on ? '#ffe2a0' : '#4a4f5c';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="170" viewBox="0 0 240 170">`
    + `<circle cx="120" cy="85" r="62" fill="${bg}" stroke="${ring}" stroke-width="6"/>`
    + `<text x="120" y="108" font-size="64" text-anchor="middle" ${on ? '' : 'opacity="0.35"'}>${a.icon}</text>`
    + (on ? '' : '<text x="182" y="146" font-size="34" text-anchor="middle">🔒</text>')
    + '</svg>';
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
