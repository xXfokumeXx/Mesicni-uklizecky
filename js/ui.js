// HUD: statistiky, výzva k akci (E), šipka k základně, plovoucí „+$“ a oznámení (toast).
import { BASE } from './config.js';
import { game, hexPct, currentHexPct, baseDistance, gameTime } from './state.js';
import { activeEquipment } from './equipment.js';
import { hexes } from './planet/dustmap.js';
import { playerRight } from './player.js';
import { sunElevationDeg } from './planet/sun.js';
import { dot, tangentTo } from './planet/vec.js';
import { fmt } from './format.js';
import { SUIT_COLORS } from './catalog.js';

const $ = id => document.getElementById(id);
const fmtInt = n => n.toLocaleString('cs-CZ');
const kg = v => (v < 10 ? v.toFixed(1) : Math.round(v)) + ' kg';

// Výška Slunce v místě hráče + slovní fáze dne.
function sunLabel() {
  const t = gameTime();
  const elev = sunElevationDeg(game.s.p, t);
  let phase;
  if (elev > 6) phase = 'den';
  else if (elev < -6) phase = 'noc';
  else phase = sunElevationDeg(game.s.p, t + 5000) > elev ? 'svítání' : 'soumrak';
  return `${Math.round(elev)}° · ${phase}`;
}

// Šipka k základně relativně ke směru pohledu (nahoru = rovně).
function updateBaseArrow(dist) {
  const arrow = $('base-arrow');
  if (dist < BASE.clean) {
    arrow.hidden = true;
    return;
  }
  arrow.hidden = false;
  const s = game.s;
  const to = tangentTo(s.p, BASE.dir);
  const deg = Math.atan2(dot(to, playerRight()), dot(to, s.f)) * 180 / Math.PI;
  arrow.style.transform = `rotate(${deg.toFixed(0)}deg)`;
}

export function updateUi() {
  const s = game.s;
  $('stat-eyebrow').textContent = `${s.title || 'Měsíční úklidová služba'} · ${fmtInt(hexes.total)} sektorů`;
  const eq = activeEquipment();
  const dist = baseDistance();

  $('stat-money').textContent = '$' + fmt(s.money);
  $('stat-gear').textContent = eq.name;

  const cap = eq.stats.hopper;
  const hopper = $('meter-hopper');
  if (cap > 0) {
    $('stat-hopper').textContent = `${kg(eq.item.load)} / ${kg(cap)}`;
    hopper.style.width = Math.min(100, eq.item.load / cap * 100) + '%';
    hopper.classList.toggle('meter__fill--full', eq.item.load >= cap - 0.01);
  } else {
    $('stat-hopper').textContent = 'bez zásobníku';
    hopper.style.width = '0%';
  }

  const here = currentHexPct();
  $('stat-here').textContent = here >= 99 ? 'hotovo' : `${Math.floor(here)} %`;
  $('meter-here').style.width = `${here}%`;
  $('stat-hexes').textContent = `${fmtInt(hexes.doneCount)} / ${fmtInt(hexes.total)}`;
  $('meter-hexes').style.width = Math.max(hexPct(), hexes.doneCount ? 0.4 : 0) + '%';
  $('stat-stations').textContent = s.stations.length;
  $('stat-sun').textContent = sunLabel();
  $('stat-base').textContent = dist < BASE.clean ? 'jsi doma' : Math.round(dist) + ' m';
  updateBaseArrow(dist);
}

// Výzva k akci nad ovládáním (klávesa E / klepnutí).
export function setPrompt(action) {
  const el = $('prompt');
  if (!action) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.disabled = !action.run;
  $('prompt-key').textContent = action.key;
  $('prompt-text').textContent = action.label;
}

// Krátké rozsvícení částky po výkupu.
export function flashMoney() {
  const el = $('stat-money');
  el.classList.remove('stats__money-value--pulse');
  void el.offsetWidth;
  el.classList.add('stats__money-value--pulse');
}

// Plovoucí text nad místem ve scéně (x, y v pixelech okna). kind = 'bonus' | 'sale'
export function floatText(text, x, y, kind = 'bonus') {
  const layer = $('float-layer');
  // výkup jen jednou naráz, bonusů nejvýš 3 – aby čísla nezakryla astronauta
  const same = layer.querySelectorAll(`.float-text--${kind}`);
  const keep = kind === 'sale' ? 0 : 2;
  for (let i = 0; i < same.length - keep; i++) same[i].remove();
  const el = document.createElement('span');
  el.className = `float-text float-text--${kind}`;
  el.textContent = text;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  layer.append(el);
  // odstranit vždy po 1,4 s – animationend nemusí přijít (vypnuté animace v systému, skrytá karta)
  setTimeout(() => el.remove(), 1400);
}

let toastTimer;
export function toast(message, ms = 4000) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

// Panel hráčů v multiplayeru (jména, barvy, kdo je hostitel) a kód světa.
// Pod jménem: kolik kg prachu hráč nasbíral, kolik vydělal a kolik utratil ze společných peněz.
export function updatePlayers(list, code) {
  const el = $('players');
  if (!list) { el.hidden = true; return; }
  el.hidden = false;
  $('players-code').textContent = code ? `Svět ${code}` : '';
  const html = list.map(p => {
    const c = '#' + SUIT_COLORS[p.color].hex.toString(16).padStart(6, '0');
    const name = p.name.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const st = p.stats || { kg: 0, e: 0, sp: 0 };
    const stats = `<span class="players__stats">`
      + `<span title="Nasbíraný prach">${fmtKg(st.kg)}</span>`
      + `<span class="players__earn" title="Vydělal(a)">+$${fmtStat(st.e)}</span>`
      + `<span class="players__spent" title="Utratil(a)">−$${fmtStat(st.sp)}</span></span>`;
    return `<li class="players__item"><span class="players__head"><span class="players__dot" style="--suit:${c}"></span>${name}${p.me ? ' <span class="players__tag">ty</span>' : ''}${p.host ? ' <span class="players__tag players__tag--host">hostitel</span>' : ''}</span>${stats}</li>`;
  }).join('');
  if (el.dataset.html !== html) { el.dataset.html = html; $('players-list').innerHTML = html; }
}

const fmtStat = v => (v < 1000 ? String(Math.round(v)) : fmt(v));
const fmtKg = v => (v < 1e4 ? `${Math.round(v).toLocaleString('cs-CZ')} kg` : `${(v / 1000).toFixed(v < 1e5 ? 1 : 0).replace('.', ',')} t`);
