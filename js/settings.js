// Nastavení grafiky: předvolby, uložení do prohlížeče (odděleně od postupu ve hře).
const KEY = 'moonsweep_settings_v2';

// scale = rozlišení vykreslování (1 = jeden pixel na pixel stránky)
// view = dohled v metrech (jak daleko se kreslí krajina a roboti)
// fpsCap = 0 znamená bez limitu
// shadows = stíny objektů (stíny kopců a kráterů jsou vždy zapnuté), lightShadows = stíny z mé čelovky / světlometů
export const PRESETS = {
  low:    { scale: 0.7,  view: 120,  fpsCap: 30, antialias: false, particles: false, shadows: false, lightShadows: false },
  medium: { scale: 1,    view: 200,  fpsCap: 60, antialias: false, particles: true,  shadows: true,  lightShadows: false },
  high:   { scale: 1.25, view: 320, fpsCap: 0,  antialias: true,  particles: true,  shadows: true,  lightShadows: true },
  // 3.3 (M5): výchozí na telefonu a tabletu. scale je v pixelech stránky (ne zařízení), 1 = na telefonu s hustým
  // displejem asi polovina jeho rozlišení – víc nepotřebuje. 30 FPS šetří baterii; hra pak rozlišení sama ubírá (main.js adaptScale).
  mobile: { scale: 1,    view: 120,  fpsCap: 30, antialias: false, particles: false, shadows: false, lightShadows: false },
};

export const PRESET_LABELS = { low: 'Nízká', medium: 'Střední', high: 'Vysoká', mobile: 'Mobil', custom: 'Vlastní' };

// ovladani (3.3): 'auto' | 'dotyk' | 'klavesnice', joySide = strana joysticku, camSens = citlivost kamery prstem (0,5–2)
// btnSize 'mala' | 'stredni' | 'velka', btnOpacity 40–100 (%), vibrace = jen Android (navigator.vibrate)
export const DEFAULTS = { ...PRESETS.medium, showFps: false, ovladani: 'auto', joySide: 'left', camSens: 1, btnSize: 'stredni', btnOpacity: 70, vibrace: true };
// „Obnovit výchozí“ v okně nastavení vrací jen grafiku – ovládání si hráč nastavuje zvlášť
export const GRAPHICS_DEFAULTS = { ...PRESETS.medium, showFps: false };

export const settings = { ...DEFAULTS };

// Vrací true, když bylo v prohlížeči něco uložené (jinak je to první spuštění – main.js pak na dotyku zvolí Mobil).
export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (!saved) return false;
    for (const k in DEFAULTS) {
      if (typeof saved[k] === typeof DEFAULTS[k]) settings[k] = saved[k];
    }
    return true;
  } catch { return false; /* poškozené nebo nedostupné úložiště – zůstanou výchozí */ }
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
