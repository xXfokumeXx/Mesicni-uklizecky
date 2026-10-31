// Klávesnice, myš a dotyk.
// W/S = vpřed/vzad (plyn/brzda ve vozidle), A/D = otáčení, mezerník = skok (ve vzduchu jetpack),
// Shift = boost vozidla, E = akce, R = jiný cíl pásu, G = přesunout depo, 1–3 = políčko hotbaru, X = vyprázdnit políčko, T = zrychlit čas.
export const input = {
  keys: {},
  target: null,        // cíl chůze: jednotkový vektor na kouli
  pointerDown: false,
  enabled: true,       // false, když je otevřené menu

  release() {
    for (const k in this.keys) this.keys[k] = false;
    this.pointerDown = false;
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
// onMove = G (přesunout depo)
export function bindInput(canvas, { pickDir, rotate, zoom, onAction, onCancel, onJump, onAlt, onSlot, onDrop, onMove }) {
  addEventListener('keydown', e => {
    if (!input.enabled) return;
    const key = e.key.toLowerCase();
    if (key === 'e' && !e.repeat) { onAction(); return; }
    if (key === 'escape') { onCancel(); return; }
    if (key === ' ' && !e.repeat) onJump?.();
    if (key === 'r' && !e.repeat) { onAlt?.(); return; }
    if ((key === 'x' || key === 'delete') && !e.repeat) { onDrop?.(); return; }
    if (key === 'g' && !e.repeat) { onMove?.(); return; }
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
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  canvas.addEventListener('pointerdown', e => {
    if (!input.enabled) return;                // mapa / otevřené okno
    canvas.setPointerCapture(e.pointerId);
    if (e.button === 2) {                // pravé tlačítko = otáčení kamery
      rotating = true;
      return;
    }
    input.pointerDown = true;
    const d = pickDir(e.clientX, e.clientY);
    if (d) input.target = d;
  });

  canvas.addEventListener('pointermove', e => {
    if (!input.enabled) return;
    if (rotating) {
      rotate(-e.movementX * 0.006);
    } else if (input.pointerDown) {
      const d = pickDir(e.clientX, e.clientY);
      if (d) input.target = d;
    }
  });

  const release = () => {
    rotating = false;
    input.pointerDown = false;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    zoom(e.deltaY > 0 ? 1.1 : 1 / 1.1);
  }, { passive: false });
}
