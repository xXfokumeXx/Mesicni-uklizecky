// Okno „Nastavení grafiky“: propojení ovládacích prvků s objektem settings.
import { settings, saveSettings, matchPreset, PRESETS, PRESET_LABELS, GRAPHICS_DEFAULTS } from './settings.js';
import { wantsTouch, touchLayerReady, previewTouchLayout } from './touch.js';

const $ = id => document.getElementById(id);

const PRESET_HINTS = {
  low: 'Pro slabší notebooky: nižší rozlišení, kratší dohled, bez stínů objektů, 30 snímků za sekundu.',
  medium: 'Vyvážená kvalita. Výchozí volba.',
  high: 'Ostrý obraz, daleký dohled a stíny z čelovky a světlometů. Pro výkonnější grafiku.',
  mobile: 'Pro telefon a tablet: bez stínů objektů a částic, krátký dohled, 30 snímků za sekundu. Když hra nestíhá, sama sníží rozlišení.',
  custom: 'Vlastní kombinace nastavení.',
};

// onChange(nové, předchozí) – aplikuje změny ve hře
// onOpen / onClose – pozastaví ovládání postavy
// onReload – uloží hru před znovunačtením stránky
export function initSettingsMenu({ onChange, onOpen, onClose, onReload, antialiasAtStart }) {
  const modal = $('settings');
  const presetButtons = [...modal.querySelectorAll('[data-preset]')];
  const scale = $('set-scale');
  const view = $('set-view');
  const fps = $('set-fps');
  const antialias = $('set-antialias');
  const particles = $('set-particles');
  const shadows = $('set-shadows');
  const lightShadows = $('set-lightshadows');
  const showFps = $('set-showfps');
  const ctlButtons = [...modal.querySelectorAll('[data-ctl]')];
  const sizeButtons = [...modal.querySelectorAll('[data-btnsize]')];
  const joyModeButtons = [...modal.querySelectorAll('[data-joymode]')];
  const joySide = $('set-joyside'), camSens = $('set-camsens'), btnOpacity = $('set-btnopacity'), vibrace = $('set-vibrace');
  const canVibrate = typeof navigator.vibrate === 'function';      // iPhone vibrace z webu neumí → volba se neukáže
  let lastFocus = null;

  function render() {
    const preset = matchPreset();
    for (const btn of presetButtons) {
      const active = btn.dataset.preset === preset;
      btn.classList.toggle('segmented__option--active', active);
      btn.setAttribute('aria-pressed', String(active));
    }
    $('preset-hint').textContent = PRESET_HINTS[preset];
    $('preset-badge').textContent = PRESET_LABELS[preset];
    scale.value = String(settings.scale);
    view.value = String(settings.view);
    fps.value = String(settings.fpsCap);
    antialias.checked = settings.antialias;
    particles.checked = settings.particles;
    shadows.checked = settings.shadows;
    lightShadows.checked = settings.lightShadows;
    showFps.checked = settings.showFps;
    // ovládání (3.3, M4)
    const seg = (buttons, key, val) => buttons.forEach(b => { const on = b.dataset[key] === val; b.classList.toggle('segmented__option--active', on); b.setAttribute('aria-pressed', String(on)); });
    seg(ctlButtons, 'ctl', settings.ovladani);
    seg(sizeButtons, 'btnsize', settings.btnSize);
    seg(joyModeButtons, 'joymode', settings.joyMode);
    joySide.value = settings.joySide;
    camSens.value = String(settings.camSens);
    $('set-camsens-out').textContent = `${String(settings.camSens).replace('.', ',')}×`;
    btnOpacity.value = String(settings.btnOpacity);
    $('set-btnopacity-out').textContent = `${settings.btnOpacity} %`;
    vibrace.checked = settings.vibrace;
    const touchOn = wantsTouch();
    for (const f of modal.querySelectorAll('[data-touch-only]')) f.hidden = !touchOn || (f.hasAttribute('data-vibrate') && !canVibrate) || (f.hasAttribute('data-touch-layer') && !touchLayerReady());
    $('settings-reload').hidden = settings.antialias === antialiasAtStart;
  }

  function change(patch) {
    const before = { ...settings };
    Object.assign(settings, patch);
    saveSettings();
    render();
    onChange(settings, before);
  }

  function open() {
    lastFocus = document.activeElement;
    render();
    modal.hidden = false;
    onOpen();
    presetButtons[0].focus();
  }

  function close() {
    if (modal.hidden) return;
    modal.hidden = true;
    onClose();
    lastFocus?.focus?.();
  }

  for (const btn of presetButtons) {
    btn.addEventListener('click', () => change(PRESETS[btn.dataset.preset]));
  }
  scale.addEventListener('change', () => change({ scale: Number(scale.value) }));
  view.addEventListener('change', () => change({ view: Number(view.value) }));
  fps.addEventListener('change', () => change({ fpsCap: Number(fps.value) }));
  antialias.addEventListener('change', () => change({ antialias: antialias.checked }));
  particles.addEventListener('change', () => change({ particles: particles.checked }));
  shadows.addEventListener('change', () => change({ shadows: shadows.checked }));
  lightShadows.addEventListener('change', () => change({ lightShadows: lightShadows.checked }));
  showFps.addEventListener('change', () => change({ showFps: showFps.checked }));
  for (const b of ctlButtons) b.addEventListener('click', () => change({ ovladani: b.dataset.ctl }));
  for (const b of sizeButtons) b.addEventListener('click', () => change({ btnSize: b.dataset.btnsize }));
  for (const b of joyModeButtons) b.addEventListener('click', () => change({ joyMode: b.dataset.joymode }));
  $('set-touchpreview').addEventListener('click', () => previewTouchLayout());
  joySide.addEventListener('change', () => change({ joySide: joySide.value }));
  camSens.addEventListener('input', () => change({ camSens: Number(camSens.value) }));
  btnOpacity.addEventListener('input', () => change({ btnOpacity: Number(btnOpacity.value) }));
  vibrace.addEventListener('change', () => change({ vibrace: vibrace.checked }));

  $('settings-open').addEventListener('click', open);
  $('settings-close').addEventListener('click', close);
  $('settings-done').addEventListener('click', close);
  $('settings-backdrop').addEventListener('click', close);
  $('settings-reset').addEventListener('click', () => change({ ...GRAPHICS_DEFAULTS }));
  $('settings-reload').addEventListener('click', async () => {
    await onReload();                     // uložení je asynchronní (komprese mapy)
    location.reload();
  });
  addEventListener('keydown', e => {
    if (e.key === 'Escape') close();
  });

  render();
  return { open };
}
