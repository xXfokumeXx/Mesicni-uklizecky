// Klávesnice, myš a dotyk.
// W/S = vpřed/vzad (plyn/brzda ve vozidle), A/D = otáčení, mezerník = skok (ve vzduchu jetpack),
// Shift = boost vozidla, E = akce, R = jiný cíl pásu, G = přesunout depo, L = světla, 1–3 = políčko hotbaru, X = vyprázdnit políčko, T = zrychlit čas.
// 3.0: Q = kladivo, V = stavební lišta, X s kladivem = bourání, R + kolečko / , . = otočit stavbu, C = autopilot vozidla.
export const input = {
  keys: {},
  target: null,        // cíl chůze: jednotkový vektor na kouli
  pointerDown: false,
  cursor: null,        // { x, y } poslední poloha kurzoru nad plátnem (i bez stisku – hologram stavby)
  clicks: 0,           // počet kliknutí levým (ukazatel kliknutí D-09)
  capture: null,       // (e) => true: klik si vzal stavební režim (nepohne astronautem)
  pick: null,          // (x, y) => místo na povrchu, nebo null
  enabled: true,       // false, když je otevřené menu

  release() {
    for (const k in this.keys) this.keys[k] = false;
    this.pointerDown = false;
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

  // { fwd } v rozsahu −1…1, nebo null
  move() {
    const k = this.keys;
    const fwd = ((k.w || k.arrowup) ? 1 : 0) - ((k.s || k.arrowdown) ? 1 : 0);
    return fwd ? { fwd } : null;
  },

  // Otáčení: kladné = doleva
  turn() {
    const k = this.keys;
    return ((k.a || k.arrowleft) ? 1 : 0) - ((k.d || k.arrowright) ? 1 : 0);
  },

  get jump() { return !!this.keys[' ']; },
  get boost() { return !!this.keys.shift; },
};

// onAction = klávesa E (jednorázově), onCancel = Esc, onJump = nový stisk mezerníku (jetpack),
// onAlt = R (jiný cíl pásu), onSlot(k) = klávesa 1–3 (políčko hotbaru), onDrop = X / Delete (vyprázdnit políčko)
// onMove = G (přesunout depo), onLights = L (světla zapnout / vypnout)
// tilt(dy) = tažení pravým tlačítkem nahoru / dolů (náklon kamery)
export function bindInput(canvas, { pickDir, rotate, tilt, zoom, onAction, onCancel, onJump, onAlt, onSlot, onDrop, onMove, onLights, onHammer, onBuildMenu, onAuto }) {
  input.pick = (x, y) => pickDir(x, y);
  addEventListener('keydown', e => {
    if (!input.enabled) return;
    const key = e.key.toLowerCase();
    if (key === 'e') { input.keys.e = true; if (!e.repeat) onAction(); return; }      // držení E = bourání (build.js)
    if (key === 'q' && !e.repeat) { onHammer?.(); return; }
    if (key === 'v' && !e.repeat) { onBuildMenu?.(); return; }
    if (key === 'escape') { onCancel(); return; }
    if (key === ' ' && !e.repeat) onJump?.();
    if (key === 'r' && !e.repeat) { onAlt?.(); return; }
    if ((key === 'x' || key === 'delete') && !e.repeat) { onDrop?.(); return; }
    if (key === 'g' && !e.repeat) { onMove?.(); return; }
    if (key === 'l' && !e.repeat) { onLights?.(); return; }
    if (key === 'c' && !e.repeat) { onAuto?.(); return; }
    // klávesy 1–9 podle polohy (česká klávesnice má nahoře +ěščř…)
    if (/^(Digit|Numpad)[1-9]$/.test(e.code) && !e.repeat) { onSlot?.(Number(e.code.slice(-1)) - 1); return; }
    input.keys[key] = true;
    if (e.key.startsWith('Arrow') || e.key === ' ') e.preventDefault();
  });
  addEventListener('keyup', e => {
    input.keys[e.key.toLowerCase()] = false;
    if (e.key === ' ' && input.enabled) e.preventDefault();
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

  canvas.addEventListener('pointerdown', e => {
    if (!input.enabled) return;                // mapa / otevřené okno
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
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    zoom(e.deltaY > 0 ? 1.1 : 1 / 1.1);
  }, { passive: false });
}
