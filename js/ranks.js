// Hodnosti hráče (4. 11.): 20 hodností podle celkem nasbíraného prachu hráče (profile.achStats.kg – napříč všemi
// světy, stejně jako úspěchy). Hranice rostou logaritmicky (každá další ≈ 1,62× víc), od 0 do 1 500 000 kg,
// zaokrouhleno na 2 platné číslice. Hodnost se ukazuje nad jménem ve hře (jmenovky ostatních) a v lobby;
// po síti jde jen číslo hodnosti (presence `rk` ve světě i v lobby). Postup se oznámí do chatu (main.js checkRank).
import { profile } from './profile.js';

export const RANKS = [
  ['Nováček s kartáčkem', 0],
  ['Učeň smetáčku', 100],
  ['Juniorní zametač', 260],
  ['Zametač', 520],
  ['Seniorní zametač', 950],
  ['Desátník prachovky', 1600],
  ['Četař vysavače', 2700],
  ['Rotmistr regolitu', 4500],
  ['Praporčík pytlů', 7400],
  ['Poručík lopatky', 12000],
  ['Nadporučík násypky', 20000],
  ['Kapitán koštěte', 32000],
  ['Major zametač', 52000],
  ['Podplukovník prachu', 84000],
  ['Plukovník kráterů', 140000],
  ['Brigádní generál zametání', 220000],
  ['Generálmajor regolitu', 350000],
  ['Generál zametač', 570000],
  ['Maršál měsíčního prachu', 930000],
  ['Velmistr vesmírného koštěte', 1500000],
].map(([name, kg]) => ({ name, kg }));

// Index hodnosti pro kg prachu (0–19)
export function rankIndex(kg) {
  let i = 0;
  while (i + 1 < RANKS.length && (kg || 0) >= RANKS[i + 1].kg) i++;
  return i;
}
// Hodnost z presence ostatních (číslo) → název, nebo '' (neplatné / starší data)
export const rankName = i => (Number.isInteger(i) && RANKS[i] ? RANKS[i].name : '');
export const myKg = () => profile.achStats?.kg || 0;
export const myRank = () => rankIndex(myKg());
// Další hodnost: { name, kg, left } nebo null (nejvyšší)
export function nextRank() {
  const n = RANKS[myRank() + 1];
  return n ? { name: n.name, kg: n.kg, left: Math.max(0, n.kg - myKg()) } : null;
}
