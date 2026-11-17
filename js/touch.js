// Dotykové ovládání (3.3, fáze M2 – předávka Update 3.3/PREDAVKA-MOBILNI-OVLADANI.md, části 3–6).
// Prsty sledujeme přes Pointer Events podle pointerId (funguje i s perem). Myš dál obsluhuje input.js.
//   levá polovina: plovoucí joystick (input.axis), pravá: klepnutí = jdi sem, tah = kamera, dva prsty = zoom a otočení,
//   podržení 0,5 s = jdi a drž (cíl jde za prstem). Tlačítka volají akce z registru (actions.js).
// Zapnutí: nastavení „ovladani“ (auto / dotyk / klavesnice), auto = hrubý ukazatel + dotyková obrazovka. Třída body.is-touch.
import { input } from './input.js';
import { holdAction, runAction, actionAvailable, actionInfo } from './actions.js';
import { settings } from './settings.js';

const JOY_R = 60;              // poloměr joysticku v px
const DEAD = 0.12;             // mrtvá zóna (podíl poloměru)
const TAP_MOVE = 10;           // klepnutí = prst se pohnul méně než o tolik px…
const HOLD_MS = 500;           // …a podržení po této době = jdi a drž
const CAM_SPEED = 0.006;       // otáčení kamery na px (stejně jako myš)

export const touch = { on: false, portrait: false };

const pointers = new Map();    // pointerId → { role: 'joy' | 'look', x, y, sx, sy, t, moved }
let joy = null;                // { id, cx, cy } – střed joysticku
let look = null;               // { id, hold, timer } – jeden prst vpravo
let pinch = null;              // { a, b, dist, ang } – dva prsty
let el = {};                   // prvky vrstvy
let canvas = null;
let altByKey = false;          // Alt drží klávesnice (ne přepínač Zlom na dotyku)

// Má být dotykové ovládání zapnuté? (volba v nastavení, jinak podle zařízení)
export function wantsTouch() {
  const v = settings.ovladani;
  if (v === 'dotyk') return true;
  if (v === 'klavesnice') return false;
  return matchMedia('(pointer: coarse)').matches && (navigator.maxTouchPoints || 0) > 0;
}

// Nastavení ovládání (M4): velikost a průhlednost tlačítek, strana joysticku. Volá se při startu a po změně nastavení.
const SIZES = { mala: 0.85, stredni: 1, velka: 1.2 };
export function applyTouchSettings() {
  const on = wantsTouch();
  if (!el.root) { document.body.classList.toggle('is-touch', on); refreshFullUi(); return; }   // menu před startem hry: jen třída
  el.root.style.setProperty('--touch-scale', SIZES[settings.btnSize] || 1);
  el.root.style.setProperty('--touch-opacity', Math.max(0.4, Math.min(1, (settings.btnOpacity || 70) / 100)));
  el.root.classList.toggle('touch--lefty', settings.joySide === 'right');
  document.body.classList.toggle('is-lefty', on && settings.joySide === 'right');
  if (on !== touch.on) setTouch(on);
}

// Krátká vibrace (jen Android; iPhone navigator.vibrate nemá). Plný zásobník, náraz, postavení stavby.
export function vibrate(ms) {
  if (!touch.on || !settings.vibrace) return;
  try { navigator.vibrate?.(ms); } catch { /* nic */ }
}

export function setTouch(on) {
  touch.on = !!on;
  input.touch = touch.on;
  document.body.classList.toggle('is-touch', touch.on);
  refreshFullUi();
  if (!touch.on) resetAll();
  checkOrientation();
}

// ---------- vrstva s prvky ----------

// Tlačítka vpravo nad tlačítkem akce, ukazují se podle actionAvailable (pravidla v main.js). [id, obsah, zpoždění podržení ms]
// Se zpožděním: klepnutí = jeden krok akce (otočení o 15°), podržení déle = drží klávesu (plynulé otáčení).
const SIDE = [
  ['nastroj', '🔨'], ['skok', '⤒'],
  ['stavet', 'Stavět'], ['bourat', 'Bourat'],
  ['otocit-vlevo', '⟲', 300], ['otocit-vpravo', '⟳', 300], ['zlom', 'Zlom'], ['zrusit', '✗'],
  ['nahoru', '▲'], ['dolu', '▼'],
  ['boost', 'Boost'], ['autopilot', 'Auto'], ['rezim', 'Ramena'], ['objednat-baterii', '🔋'],
  ['lano-minus', 'Lano −'], ['lano-plus', 'Lano +'],
  ['jiny-cil', 'Vylepšit'],
];
const sideButton = ([id, text, delay]) => {
  const long = text.length > 2 ? ' touch__btn--text' : '';
  return `<button class="touch__btn${long}" type="button" data-act="${id}"${delay ? ` data-delay="${delay}"` : ''} aria-label="${actionInfo(id)?.nazev || id}" hidden>${text}</button>`;
};

function build() {
  const root = document.createElement('div');
  root.className = 'touch';
  root.innerHTML = `
    <div class="touch__joy" hidden><div class="touch__knob"></div></div>
    <nav class="touch__top" aria-label="Dotykové ovládání">
      <button class="touch__btn touch__btn--top" type="button" data-act="menu" aria-label="Menu">≡</button>
      <button class="touch__btn touch__btn--top" type="button" data-act="mapa" aria-label="Mapa">🗺</button>
      <button class="touch__btn touch__btn--top" type="button" data-act="uspechy" aria-label="Úspěchy">🏆</button>
      <button class="touch__btn touch__btn--top" type="button" data-act="chat" aria-label="Chat">💬</button>
      <button class="touch__btn touch__btn--top" type="button" data-act="svetla" aria-label="Světla">💡</button>
      <button class="touch__btn touch__btn--top touch__btn--map" type="button" data-zoom="0.8" aria-label="Přiblížit">+</button>
      <button class="touch__btn touch__btn--top touch__btn--map" type="button" data-zoom="1.25" aria-label="Oddálit">−</button>
    </nav>
    <div class="touch__side">
      <div class="touch__group">${SIDE.map(sideButton).join('')}</div>
      <button class="touch__btn touch__btn--action" type="button" data-act="akce"></button>
    </div>
    <div class="touch__rotate" hidden>
      <div class="touch__rotate-icon" aria-hidden="true">📱↻</div>
      <p class="touch__rotate-text">Otoč telefon naležato</p>
    </div>`;
  document.body.appendChild(root);
  el = {
    root,
    joy: root.querySelector('.touch__joy'),
    knob: root.querySelector('.touch__knob'),
    action: root.querySelector('.touch__btn--action'),
    rotate: root.querySelector('.touch__rotate'),
    buttons: [...root.querySelectorAll('[data-act]')],
    prompt: document.getElementById('prompt'),
    promptText: document.getElementById('prompt-text'),
    mapBtn: document.getElementById('map-toggle'),
  };
  // tlačítka: stisk = akce (držené akce drží klávesu, dokud je prst dole)
  for (const b of el.buttons) {
    const id = b.dataset.act;
    const delay = Number(b.dataset.delay) || 0, key = actionInfo(id)?.drz;
    let timer = 0;
    const up = e => {
      e.preventDefault();
      if (!b.dataset.down) return;
      delete b.dataset.down;
      if (delay) { clearTimeout(timer); if (key) input.keys[key] = false; }
      else holdAction(id, false);
    };
    b.addEventListener('pointerdown', e => {
      e.preventDefault();
      try { b.setPointerCapture(e.pointerId); } catch { /* nic */ }
      b.dataset.down = '1';
      if (delay) {                                        // klepnutí = krok, podržení = plynule
        runAction(id);
        timer = setTimeout(() => { if (b.dataset.down && key) input.keys[key] = true; }, delay);
      } else holdAction(id, true);
    });
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('contextmenu', e => e.preventDefault());
  }
  for (const b of root.querySelectorAll('[data-zoom]')) {
    b.addEventListener('click', () => input.view?.zoom(Number(b.dataset.zoom)));
  }
}

// Výzvy jsou psané pro klávesnici – na dotyku je ✗ / ⟲ ⟳ / Zlom tlačítko a tlačítko akce je samo potvrzení
const TOUCH_TEXT = [
  [/ · (Esc zruší|Esc = zpět|Esc = zrušit|X \/ Esc = konec)/g, ''],
  [/ · klik \/ E/g, ''],
  [/podrž E nebo levé tlačítko/g, 'podrž toto tlačítko'],
  [/namiř kurzor na/g, 'klepni na'],
  [/Namiř kurzor na terén/g, 'Klepni na terén'],
  [/Klikni na/g, 'Klepni na'],
  [/R \+ kolečko = plošina na jiný sousední hex/g, '⟲ ⟳ = plošina na jiný hex'],
  [/klik = ohyb \(s Alt = ostrý zlom\), klik na vstupní zásuvku \(modrá\) = dokončit/g, 'klepnutí = ohyb (Zlom = ostrý), klepni na vstupní zásuvku (modrá)'],
];
const touchText = s => TOUCH_TEXT.reduce((a, [re, to]) => a.replace(re, to), s);

// Každý snímek (main.js): text tlačítka akce, která tlačítka platí, otočení telefonu
export function updateTouch() {
  if (!touch.on || !el.root) return;
  const prompt = el.prompt && !el.prompt.hidden ? touchText(el.promptText.textContent) : '';
  if (el.action.textContent !== prompt) el.action.textContent = prompt;
  el.action.hidden = !prompt;
  el.action.classList.toggle('touch__btn--off', !!prompt && el.prompt.disabled);   // nejde potvrdit (důvod je v textu); držení dál funguje (bourání)
  const zlom = actionAvailable('zlom');
  if (!zlom && input.keys.alt && !altByKey) input.keys.alt = false;                // konec pásu: přepínač zlomu se vypne
  el.root.classList.toggle('touch--alt', zlom && !!input.keys.alt);
  for (const b of el.buttons) {
    if (b === el.action) continue;
    const ok = actionAvailable(b.dataset.act);
    if (b.hidden === ok) b.hidden = !ok;
  }
  const mapOn = el.mapBtn?.getAttribute('aria-pressed') === 'true';
  el.root.classList.toggle('touch--map', mapOn);
  if (!input.enabled && (joy || look || pinch)) resetAll();       // otevřelo se okno / mapa: pustit joystick a kameru
}

// ---------- otočení telefonu ----------

const portraitQuery = matchMedia('(orientation: portrait)');
function checkOrientation() {
  touch.portrait = touch.on && portraitQuery.matches;
  if (el.rotate) el.rotate.hidden = !touch.portrait;
  if (touch.portrait) resetAll();
}

// ---------- prsty na plátně ----------

function resetAll() {
  if (look?.timer) clearTimeout(look.timer);
  if (look?.hold) input.touchPoint?.(0, 0, 'up');
  pointers.clear();
  joy = look = pinch = null;
  input.axis = null;
  if (el.joy) el.joy.hidden = true;
}

function joyMove(p) {
  let dx = p.x - joy.cx, dy = p.y - joy.cy;
  const d = Math.hypot(dx, dy);
  if (d > JOY_R) {                                       // palec vyjel ven: střed jde za ním
    joy.cx += dx * (1 - JOY_R / d); joy.cy += dy * (1 - JOY_R / d);
    dx = p.x - joy.cx; dy = p.y - joy.cy;
    el.joy.style.transform = `translate(${joy.cx - JOY_R}px, ${joy.cy - JOY_R}px)`;
  }
  el.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  const m = Math.min(1, Math.hypot(dx, dy) / JOY_R);
  if (m <= DEAD) { input.axis = { fwd: 0, turn: 0 }; return; }
  const k = (m - DEAD) / (1 - DEAD) / (m * JOY_R);       // kruhový výstup: směr × síla za mrtvou zónou
  input.axis = { fwd: -dy * k, turn: -dx * k };
}

const sens = () => Math.max(0.5, Math.min(2, settings.camSens || 1));

function startPinch() {
  const [a, b] = [...pointers.entries()].filter(([, p]) => p.role === 'look');
  if (!a || !b) return;
  if (look?.timer) clearTimeout(look.timer);
  if (look?.hold) input.touchPoint?.(0, 0, 'up');
  look = null;
  pinch = { a: a[0], b: b[0], dist: dist2(a[1], b[1]), ang: ang2(a[1], b[1]) };
}
const dist2 = (a, b) => Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
const ang2 = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);

function onDown(e) {
  if (!touch.on || e.pointerType === 'mouse' || touch.portrait) return;
  e.preventDefault();
  if (!input.enabled) {                          // mapa: tah obsluhuje mapa sama, druhý prst = zoom
    pointers.set(e.pointerId, { role: 'look', x: e.clientX, y: e.clientY });
    if (pointers.size === 2) startPinch();
    return;
  }
  try { canvas.setPointerCapture(e.pointerId); } catch { /* prst už není aktivní */ }
  const left = settings.joySide === 'right' ? e.clientX > innerWidth / 2 : e.clientX < innerWidth / 2;
  const p = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: 0 };
  if (left && !joy) {
    p.role = 'joy';
    pointers.set(e.pointerId, p);
    joy = { id: e.pointerId, cx: p.x, cy: p.y };
    el.joy.hidden = false;
    el.joy.style.transform = `translate(${p.x - JOY_R}px, ${p.y - JOY_R}px)`;
    el.knob.style.transform = 'translate(0, 0)';
    input.axis = { fwd: 0, turn: 0 };
    return;
  }
  p.role = 'look';
  pointers.set(e.pointerId, p);
  const lookers = [...pointers.values()].filter(q => q.role === 'look').length;
  if (lookers === 2) { startPinch(); return; }
  if (lookers > 2) return;
  if (input.buildDrag?.()) {                             // stavění (M3): prst posouvá hologram / konec pásu, kamera stojí
    look = { id: e.pointerId, build: true, hold: false, timer: 0 };
    input.cursor = { x: p.x, y: p.y };
    return;
  }
  look = { id: e.pointerId, hold: false, timer: setTimeout(() => {
    if (look?.id !== e.pointerId || p.moved >= TAP_MOVE) return;
    look.hold = true;                                    // podržení: jdi sem a drž, cíl jde za prstem
    input.touchPoint?.(p.x, p.y, 'hold');
  }, HOLD_MS) };
}

function onMove(e) {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  e.preventDefault();
  const px = p.x, py = p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (p.sx !== undefined) p.moved = Math.max(p.moved, Math.hypot(p.x - p.sx, p.y - p.sy));
  if (p.role === 'joy') { joyMove(p); return; }
  if (pinch) {
    const a = pointers.get(pinch.a), b = pointers.get(pinch.b);
    if (!a || !b) return;
    const d = dist2(a, b), g = ang2(a, b);
    input.view?.zoom(pinch.dist / d);                   // roztažení = přiblížit (zoom < 1)
    let da = g - pinch.ang;
    if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI;
    if (input.enabled) input.view?.rotate(-da);          // otočení dvou prstů = otočení kamery
    pinch.dist = d; pinch.ang = g;
    return;
  }
  if (!input.enabled || look?.id !== e.pointerId) return;
  if (look.build) { input.cursor = { x: p.x, y: p.y }; return; }
  if (look.hold) { input.touchPoint?.(p.x, p.y, 'move'); return; }
  if (p.moved >= TAP_MOVE) {                             // tah jedním prstem = kamera (jako pravé tlačítko myši)
    if (look.timer) { clearTimeout(look.timer); look.timer = 0; }
    input.view?.rotate(-(p.x - px) * CAM_SPEED * sens());
    input.view?.tilt?.((p.y - py) * sens());
  }
}

function onUp(e) {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  pointers.delete(e.pointerId);
  if (p.role === 'joy') {
    joy = null;
    input.axis = null;
    el.joy.hidden = true;
    return;
  }
  if (pinch && (e.pointerId === pinch.a || e.pointerId === pinch.b)) { pinch = null; return; }
  if (look?.id !== e.pointerId) return;
  if (look.timer) clearTimeout(look.timer);
  if (look.hold) input.touchPoint?.(p.x, p.y, 'up');
  else if (p.moved < TAP_MOVE && e.type === 'pointerup') input.touchPoint?.(p.x, p.y, 'tap');   // klepnutí = jdi sem
  look = null;
}

// ---------- nápověda dlouhým stiskem ----------
// Na počítači se nápověda (atribut title) ukáže po najetí myší. Na dotyku: podržet prvek 0,5 s → bublina na 3 s.
let tip = null, tipTimer = 0, tipHide = 0, tipStart = null;
function tipDown(e) {
  if (!touch.on || e.pointerType === 'mouse') return;
  const t = e.target.closest?.('[title]');
  clearTimeout(tipTimer);
  if (!t || !t.title) return;
  tipStart = { x: e.clientX, y: e.clientY };
  tipTimer = setTimeout(() => {
    tip ||= Object.assign(document.createElement('div'), { className: 'touch__tip', hidden: true });
    if (!tip.isConnected) document.body.append(tip);
    tip.textContent = t.title;
    tip.hidden = false;
    const r = t.getBoundingClientRect();
    const w = Math.min(320, innerWidth - 32);
    tip.style.left = `${Math.max(16, Math.min(innerWidth - w - 16, r.left))}px`;
    tip.style.top = `${r.bottom + 8 + 60 < innerHeight ? r.bottom + 8 : Math.max(8, r.top - 60)}px`;
    clearTimeout(tipHide);
    tipHide = setTimeout(() => { tip.hidden = true; }, 3000);
  }, HOLD_MS);
}
function tipCancel(e) {
  if (tipStart && e.type === 'pointermove' && Math.hypot(e.clientX - tipStart.x, e.clientY - tipStart.y) < TAP_MOVE) return;
  clearTimeout(tipTimer);
  tipStart = null;
}

// ---------- celá obrazovka (M5) ----------
// Android Chrome: Fullscreen API + zámek naležato. iPhone Safari celou obrazovku neumí → návod „Přidat na plochu“
// (manifest.webmanifest, display: fullscreen). Spuštěné z plochy (standalone) už nic nenabízí.
const canFull = () => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
const isFull = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone === true;

export async function toggleFullscreen(on = !isFull()) {
  try {
    if (!on) { await (document.exitFullscreen?.() || document.webkitExitFullscreen?.()); return; }
    const root = document.documentElement;
    await (root.requestFullscreen?.({ navigationUI: 'hide' }) || root.webkitRequestFullscreen?.());
    await screen.orientation?.lock?.('landscape').catch(() => {});    // jen Android; jinde tiše nic
  } catch { /* prohlížeč odmítl (bez gesta uživatele, iframe…) */ }
}

function refreshFullUi() {
  const btn = document.getElementById('pause-full');
  if (btn) {
    btn.hidden = !touch.on || !canFull() || standalone();
    btn.textContent = isFull() ? 'Ukončit celou obrazovku' : 'Celá obrazovka';
  }
  for (const p of document.querySelectorAll('[data-ios-hint]')) p.hidden = !(document.body.classList.contains('is-touch') && isIos && !canFull() && !standalone());
}

// ---------- zapnutí ----------

export function initTouch(cv) {
  canvas = cv;
  build();
  canvas.addEventListener('pointerdown', onDown, { passive: false });
  canvas.addEventListener('pointermove', onMove, { passive: false });
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  // ochrana proti prohlížeči: Safari gesta (zvětšení stránky), dvojklepnutí
  for (const t of ['gesturestart', 'gesturechange']) document.addEventListener(t, e => { if (touch.on) e.preventDefault(); });
  portraitQuery.addEventListener?.('change', checkOrientation);
  document.addEventListener('pointerdown', tipDown, true);
  for (const t of ['pointerup', 'pointercancel', 'pointermove']) document.addEventListener(t, tipCancel, true);
  addEventListener('keydown', e => { if (e.key === 'Alt') altByKey = true; });
  addEventListener('keyup', e => { if (e.key === 'Alt') altByKey = false; });
  const media = matchMedia('(pointer: coarse)');
  media.addEventListener?.('change', () => setTouch(wantsTouch()));
  setTouch(wantsTouch());
  applyTouchSettings();
  // celá obrazovka: tlačítko v menu pauzy; při prvním doteku ve hře se zapne sama (prohlížeč ji povolí jen po gestu)
  document.getElementById('pause-full')?.addEventListener('click', () => toggleFullscreen());
  for (const t of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(t, refreshFullUi);
  const first = e => {
    if (!touch.on || e.pointerType === 'mouse') return;
    document.removeEventListener('pointerdown', first, true);
    if (canFull() && !isFull() && !standalone()) toggleFullscreen(true);
  };
  document.addEventListener('pointerdown', first, true);
}

