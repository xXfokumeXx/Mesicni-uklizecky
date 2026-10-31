// Úspěchy hráče. Patří profilu v prohlížeči (jako jméno a vzhled), takže platí ve všech světech
// i v multiplayeru – každý hráč sbírá své vlastní. Kontroluje je main.js (achTick + události).
import { profile, saveProfile } from './profile.js';

// goal + stat = úspěch s postupem (profile.achStats[stat] / goal).
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
