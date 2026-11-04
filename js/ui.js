// HUD: peníze a zásobník, výzva k akci (E), vzdálenost k základně (3D šipku kreslí scene/compass.js),
// plovoucí „+$“ a oznámení (toast). Počty hexů, robotů a dronů jsou ve Výkupu (záložka Statistiky).
import { BASE } from './config.js';
import { game, currentHexPct, baseDistance } from './state.js';
import { activeEquipment } from './equipment.js';
import { playerFx, boostCharge } from './player.js';
import { fmt } from './format.js';
import { SUIT_COLORS, VEHICLE_BATTERY, batteryCap } from './catalog.js';
import { roofCover } from './solarRoof.js';
import { nearestCharger, energyTotals } from './energy.js';
import { autopilotStatus } from './autopilot.js';

const $ = id => document.getElementById(id);
const kg = v => (v < 10 ? v.toFixed(1) : Math.round(v)) + ' kg';

// „Tento hex“ ukázat jen při pohybu (a chvíli po něm), pak plynule schovat.
const HERE_HOLD_MS = 1800;
let movedAt = 0;

export function updateUi() {
  const s = game.s;
  const eq = activeEquipment();
  const dist = baseDistance();

  $('stat-money').textContent = '$' + fmt(s.money);
  // zásoba cihel (L-24): ukáže se, jakmile nějaké cihly jsou nebo stojí slinovna
  const bricksOn = (s.bricks | 0) > 0 || (s.buildings || []).some(b => b.type === 'sinter');
  $('row-bricks').hidden = !bricksOn;
  if (bricksOn) $('stat-bricks').textContent = `🧱 ${(s.bricks | 0).toLocaleString('cs-CZ')}`;

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

  if (playerFx.moving) movedAt = performance.now();
  const here = currentHexPct();
  $('row-here').classList.toggle('stats__row--gone', performance.now() - movedAt > HERE_HOLD_MS);
  $('stat-here').textContent = here >= 99 ? 'hotovo' : `${Math.floor(here)} %`;
  $('meter-here').style.width = `${here}%`;
  const boost = s.driving >= 0 && eq.stats.boost > 1;
  $('row-boost').hidden = !boost;
  if (boost) {
    const k = boostCharge();
    $('stat-boost').textContent = `${Math.round(k * 100)} % · ×${eq.stats.boost}`;
    $('meter-boost').style.width = `${k * 100}%`;
  }
  // baterie vozidla (L-01): „64 % · ≈ 4 min“, pod 20 % oranžová, při 5 % bliká, 0 % = nouzový režim
  const bcap = s.driving >= 0 ? batteryCap(eq.item) : 0;
  $('row-battery').hidden = !bcap;
  if (bcap) {
    const v = eq.item, k = Math.max(0, v.charge) / bcap;
    const B = VEHICLE_BATTERY[v.type];
    const cover = roofCover(v);                                   // solární střecha na Slunci (L-04)
    const mins = (v.charge / ((B.drive + B.sweep) * (1 - cover))) / 60;
    $('stat-battery').textContent = k <= 0 ? 'vybitá · nouzový režim' : `${Math.round(k * 100)} % · ≈ ${mins >= 1 ? Math.round(mins) + ' min' : Math.max(1, Math.round(mins * 60)) + ' s'}${cover > 0.01 ? ' · ☀' : ''}`;
    // ikona baterie: 5 článků, poslední částečně; blesk, když nabití roste (nabíječka / výměník / střecha)
    const icon = $('battery-icon');
    icon.querySelectorAll('.batt__cell').forEach((c, i) => c.style.setProperty('--fill', `${Math.max(0, Math.min(1, k * 5 - i)) * 100}%`));
    icon.classList.toggle('batt--mid', k >= 0.2 && k < 0.5);
    icon.classList.toggle('batt--low', k < 0.2);
    icon.classList.toggle('batt--empty', k <= 0);
    const now = performance.now();
    if (battSeen.uid !== v.uid) battSeen = { uid: v.uid, charge: v.charge, at: now, up: false };
    else if (now - battSeen.at > 600) { battSeen.up = v.charge > battSeen.charge + 0.05; battSeen.charge = v.charge; battSeen.at = now; }
    icon.classList.toggle('batt--charging', battSeen.up && k < 1);
    $('row-battery').classList.toggle('stats__row--blink', k <= 0.05);
  }
  // energie celé soustavy (panel vpravo): In = výroba, Out = spotřeba, obnova 1× za 2 s
  const now2 = performance.now();
  if (now2 - powerAt > 2000) {
    powerAt = now2;
    const t = energyTotals();
    $('power').hidden = !t;
    if (t) {
      const f = v => `${v.toFixed(1).replace('.', ',')} ⚡/s`;
      const d = t.prod - t.use;
      $('power-in').textContent = f(t.prod);
      $('power-out').textContent = f(t.use);
      $('power-out').classList.toggle('power__value--deficit', d < -0.05);   // bere se z baterií
      $('power-diff').textContent = `${d > 0.05 ? '+' : d < -0.05 ? '−' : ''}${f(Math.abs(d))}`;
      $('power-diff').classList.toggle('power__value--deficit', d < -0.05);
      $('power-diff').classList.toggle('power__value--surplus', d > 0.05);
      $('power-store').textContent = t.cap ? `${Math.round(t.stored).toLocaleString('cs-CZ')} / ${Math.round(t.cap).toLocaleString('cs-CZ')} ⚡` : 'žádné';
    }
  }
  // autopilot (L-40, L-41): „Autocruise · 75 %“ / „Hrana · 75 % · drží hranu vlevo“
  const auto = s.driving >= 0 ? autopilotStatus() : null;
  $('row-auto').hidden = !auto;
  if (auto) $('stat-auto').textContent = auto;
  const charger = bcap && eq.item.charge / bcap < 0.2 ? nearestCharger(s.p) : null;
  $('base-nav').hidden = charger ? false : dist < BASE.clean;
  $('base-nav').querySelector('.base-nav__label').textContent = charger ? 'Nabíječka' : 'Základna';
  $('stat-base').textContent = Math.round(charger ? charger.dist : dist) + ' m';
}

let battSeen = { uid: null, charge: 0, at: 0, up: false };
let powerAt = -1e9;

// Kam má mířit šipka nahoře (compass): k nabíječce pod 20 % baterie, jinak null = k základně.
export function navTarget() {
  const s = game.s;
  if (s.driving < 0) return null;
  const v = s.vehicles[s.driving], cap = batteryCap(v);
  return cap && v.charge / cap < 0.2 ? nearestCharger(s.p)?.dir || null : null;
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

// Oznámení o odemčeném úspěchu (pruh nahoře na 6 s).
let achTimer;
export function showAchievement(a) {
  $('ach-icon').textContent = a.icon;
  $('ach-name').textContent = a.name;
  $('ach-desc').textContent = a.desc;
  const el = $('ach-banner');
  el.hidden = true;
  void el.offsetWidth;
  el.hidden = false;
  clearTimeout(achTimer);
  achTimer = setTimeout(() => { el.hidden = true; }, 6500);
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
