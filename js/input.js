// Klávesnice, myš a dotyk.
// W/S = vpřed/vzad (plyn/brzda ve vozidle), A/D = otáčení, mezerník = skok (ve vzduchu jetpack),
// Shift = boost vozidla, E = akce, R = jiný cíl pásu, L = světla, 1–3 = políčko hotbaru, X = bourání (s kladivem v ruce), Q = kladivo.
// 3.0: Q = kladivo, V = stavební lišta, X s kladivem = bourání, R + kolečko / , . = otočit stavbu, C = autopilot vozidla.
// 3.3 (M1): jednorázové klávesy jdou přes registr akcí (actions.js), aby dotyková tlačítka volala totéž; T (čas) zrušená ve 3.1.
import { actionForKey, runAction, setActionHandlers } from './actions.js';

export const input = {
  keys: {},
  target: null,        // cíl chůze: jednotkový vektor na kouli
  pointerDown: false,
  cursor: null,        // { x, y } poslední poloha kurzoru nad plátnem (i bez stisku – hologram stavby)
  clicks: 0,           // počet kliknutí levým (ukazatel kliknutí D-09)
  capture: null,       // (e) => true: klik si vzal stavební režim (nepohne astronautem)
  pick: null,          // (x, y) => místo na povrchu, nebo null
  enabled: true,       // false, když je otevřené menu
  touch: false,        // 3.3 (M2): dotykové ovládání zapnuté – prsty a pero na plátně obsluhuje touch.js, myš dál tady
  view: null,          // { rotate, tilt, zoom } – kamera pro touch.js (stejné funkce jako myš)
  touchPoint: null,    // (x, y, fáze) – klepnutí / podržení prstem jako levé tlačítko myši (touch.js)
  touchTap: null,      // (x, y) => true: klepnutí si vzalo stavění (main.js, M3)
  buildDrag: null,     // () => true: jeden prst vpravo posouvá hologram místo kamery (main.js, M3)

  release() {
    for (const k in this.keys) this.keys[k] = false;
    this.pointerDown = false;
    this.axis = null;
  },

  // Při podrženém tlačítku se cíl přepočítává z poslední polohy kurzoru i bez pohybu myši
  // (kamera se s hráčem hýbe, kurzor tedy ukazuje jinam). Volá se každý snímek, přepočet 15× za sekundu.
  repick: null,
  repickTimer: 0,
  tick(dt) {
    if (!this.pointerDown || !this.repick) return;
    this.repickTimer -= dt;
    if (this.repickTimer > 0) return;
    this.repickTimer = 1 / 15;
    this.repick();
  },

  // Analogové osy (3.3, M1): joystick na dotyku zapisuje −1…1 (mrtvá zóna už odečtená), jinak null.
  // fwd = dopředu (+) / dozadu (−), turn = doleva (+) / doprava (−). Když je osa aktivní, přebije klávesnici.
  axis: null,

  // { fwd } v rozsahu −1…1, nebo null
  move() {
    if (this.axis) return this.axis.fwd ? { fwd: this.axis.fwd } : null;
    const k = this.keys;
    const fwd = ((k.w || k.arrowup) ? 1 : 0) - ((k.s || k.arrowdown) ? 1 : 0);
    return fwd ? { fwd } : null;
  },

  // Otáčení: kladné = doleva
  turn() {
    if (this.axis) return this.axis.turn || 0;
    const k = this.keys;
    return ((k.a || k.arrowleft) ? 1 : 0) - ((k.d || k.arrowright) ? 1 : 0);
  },

  get jump() { return !!this.keys[' ']; },
  get boost() { return !!this.keys.shift; },
};

// onAction = klávesa E (jednorázově), onCancel = Esc, onJump = nový stisk mezerníku (jetpack),
// onAlt = R (jiný cíl pásu), onSlot(k) = klávesa 1–3 (políčko hotbaru), onDrop = X (s kladivem = bourání; nástroj se ničí jen × v políčku hotbaru)
// onLights = L (světla zapnout / vypnout), onBattery = B (baterie dronem, 3.1)
// tilt(dy) = tažení pravým tlačítkem nahoru / dolů (náklon kamery)
export function bindInput(canvas, { pickDir, rotate, tilt, zoom, onAction, onCancel, onJump, onAlt, onSlot, onDrop, onLights, onHammer, onBuildMenu, onAuto, onBattery, onMode }) {
  input.pick = (x, y) => pickDir(x, y);
  // obsluha akcí z registru (actions.js) – stejné funkce volá klávesnice i dotyk
  setActionHandlers(Object.fromEntries(Object.entries({
    akce: onAction, skok: onJump, nastroj: onHammer, stavet: onBuildMenu, bourat: onDrop, 'jiny-cil': onAlt,
    svetla: onLights, autopilot: onAuto, 'objednat-baterii': onBattery, rezim: onMode,
    slot: onSlot, zrusit: onCancel,
  }).filter(([, fn]) => fn)));
  addEventListener('keydown', e => {
    if (!input.enabled) return;
    const key = e.key.toLowerCase();
    if (key === 'escape') { runAction('zrusit'); return; }
    // klávesy 1–9 podle polohy (česká klávesnice má nahoře +ěščř…)
    if (/^(Digit|Numpad)[1-9]$/.test(e.code)) { if (!e.repeat) runAction('slot', Number(e.code.slice(-1)) - 1); return; }
    const id = actionForKey(key);                                     // M a U obsluhuje main.js (platí i při otevřené mapě)
    if (id && id !== 'mapa' && id !== 'uspechy') {
      if (key === 'e' || key === ' ' || key === 'r') input.keys[key] = true;   // držené: E = bourání, mezerník = stoupání, R + kolečko = otáčení stavby
      if (!e.repeat) runAction(id);
      if (key !== ' ') return;
    }
    input.keys[key] = true;
    if (e.key.startsWith('Arrow') || e.key === ' ' || key === 'alt') e.preventDefault();   // Alt = zlom pásu (prohlížeč by jinak skočil do menu)
  });
  addEventListener('keyup', e => {
    input.keys[e.key.toLowerCase()] = false;
    if ((e.key === ' ' || e.key === 'Alt') && input.enabled) e.preventDefault();
  });
  addEventListener('blur', () => input.release());

  let rotating = false;
  let lastX = 0, lastY = 0;                    // poslední poloha kurzoru (pro přepočet cíle bez pohybu myši)
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  // held = tlačítko je už dole (tažení / přepočet): nad obzorem se jede dál ve směru kurzoru, nezůstává starý cíl
  const pickAt = (x, y, held = false) => {
    lastX = x; lastY = y;
    const d = pickDir(x, y, held);
    if (d) input.target = d;
    if (!held) input.miss = !d;                // klik mimo terén (obloha) – ukazatel krátce zčervená
  };
  input.repick = () => { if (input.enabled && !rotating) pickAt(lastX, lastY, true); };
  input.view = { rotate, tilt, zoom };
  const fromTouch = e => input.touch && e.pointerType !== 'mouse';   // prst / pero při dotykovém ovládání → touch.js

  // Prst (touch.js): 'tap' = klik (jdi sem, stavění), 'hold' = podržení = jdi a drž (cíl jde za prstem), 'move', 'up'
  input.touchPoint = (x, y, phase) => {
    if (phase === 'up') { release(); return; }
    if (!input.enabled) return;
    input.cursor = { x, y };
    if (phase === 'tap') {
      if (input.touchTap?.(x, y)) return;                     // stavění prstem (main.js): jen posun hologramu / bod pásu
      if (input.capture?.({ button: 0, clientX: x, clientY: y, pointerType: 'touch' })) { input.onRelease?.(); return; }
      input.clicks++;
      pickAt(x, y);
    } else if (phase === 'hold') {
      input.pointerDown = true;
      input.clicks++;
      input.repickTimer = 1 / 15;
      pickAt(x, y);
    } else if (phase === 'move' && input.pointerDown) pickAt(x, y, true);
  };

  canvas.addEventListener('pointerdown', e => {
    if (!input.enabled || fromTouch(e)) return;   // mapa / otevřené okno; prsty obsluhuje touch.js
    input.cursor = { x: e.clientX, y: e.clientY };
    if (input.capture?.(e)) return;            // stavění / bourání si klik vzalo
    canvas.setPointerCapture(e.pointerId);
    if (e.button === 2) {                // pravé tlačítko = otáčení kamery (do stran i nahoru / dolů)
      rotating = true;
      return;
    }
    input.pointerDown = true;
    input.clicks++;
    input.repickTimer = 1 / 15;
    pickAt(e.clientX, e.clientY);
  });

  canvas.addEventListener('pointermove', e => {
    if (fromTouch(e)) return;
    input.cursor = { x: e.clientX, y: e.clientY };
    if (!input.enabled) return;
    if (rotating) {
      rotate(-e.movementX * 0.006);
      tilt?.(e.movementY);
    } else if (input.pointerDown) {
      pickAt(e.clientX, e.clientY, true);
    }
  });

  const release = () => {
    rotating = false;
    input.pointerDown = false;
    input.onRelease?.();
  };
  canvas.addEventListener('pointerup', e => { if (!fromTouch(e)) release(); });
  canvas.addEventListener('pointercancel', e => { if (!fromTouch(e)) release(); });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    zoom(e.deltaY > 0 ? 1.1 : 1 / 1.1);
  }, { passive: false });
}
