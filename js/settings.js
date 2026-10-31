// Nastavení grafiky: předvolby, uložení do prohlížeče (odděleně od postupu ve hře).
const KEY = 'moonsweep_settings_v2';

// scale = rozlišení vykreslování (1 = jeden pixel na pixel stránky)
// view = dohled v metrech (jak daleko se kreslí krajina a roboti)
// fpsCap = 0 znamená bez limitu
// shadows = stíny objektů (stíny kopců a kráterů jsou vždy zapnuté)
export const PRESETS = {
  low:    { scale: 0.7,  view: 120,  fpsCap: 30, antialias: false, particles: false, shadows: false },
  medium: { scale: 1,    view: 200,  fpsCap: 60, antialias: false, particles: true,  shadows: true },
  high:   { scale: 1.25, view: 320, fpsCap: 0,  antialias: true,  particles: true,  shadows: true },
};

export const PRESET_LABELS = { low: 'Nízká', medium: 'Střední', high: 'Vysoká', custom: 'Vlastní' };

export const DEFAULTS = { ...PRESETS.medium, showFps: false };

export const settings = { ...DEFAULTS };

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (!saved) return;
    for (const k in DEFAULTS) {
      if (typeof saved[k] === typeof DEFAULTS[k]) settings[k] = saved[k];
    }
  } catch { /* poškozené nebo nedostupné úložiště – zůstanou výchozí */ }
}

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* nic */ }
}

// Která předvolba odpovídá aktuálnímu nastavení (jinak „custom“).
export function matchPreset() {
  for (const [name, p] of Object.entries(PRESETS)) {
    if (Object.keys(p).every(k => p[k] === settings[k])) return name;
  }
  return 'custom';
}
