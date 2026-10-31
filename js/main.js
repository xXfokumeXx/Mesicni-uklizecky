// Vstupní bod: hlavní menu → příprava Měsíce → hra (sám, jako hostitel, nebo připojený hráč).
// Propojí logiku, 3D scénu, budovy, síť, chat a nastavení; spustí smyčku a ukládání.
import { TICK_MS, WIN_LEFT, OFFLINE_CAP_S, SUN, CAMERA } from './config.js';
import { game, newGame, gameTime } from './state.js';
import { activeEquipment } from './equipment.js';
import { robotTick, simulateOffline } from './robots.js';
import {
  initPlayer, movePlayer, collect, playerFx, rotateHeading, tryJump, activeBody,
  checkVehicleHits, isRagdoll, ragdollEncoded, currentVehicleSpeed,
} from './player.js';
import { currentAction, placing, startPlacing, cancelPlacing, updatePlacing } from './interact.js';
import { initFacility, openFacility, facilityOpen, refreshFacility } from './facility.js';
import { input, bindInput } from './input.js';
import { updateUi, setPrompt, flashMoney, floatText, toast, updatePlayers } from './ui.js';
import { saveGame, loadGame, importV1 } from './storage.js';
import { fmt } from './format.js';
import { settings, loadSettings, matchPreset } from './settings.js';
import { initSettingsMenu } from './settingsMenu.js';
import { loadProfile, profile } from './profile.js';
import {
  net, initLobby, startHost, joinWorld, netTick, addEarned, sendChat, players, movingVehicles,
  vehicleOverride, hostRobotCompleted, setRagdollPresence, savePersonal, inviteLink,
} from './net.js';
import { initChat, showChat, addMessage, openChat, chatOpen } from './chat.js';
import { initMenu, initPause, showLoading, hideMenu, setMoonStatus } from './menu.js';
import { sunElevationDeg, sunAngle } from './planet/sun.js';
import { sunVisible } from './planet/sunwindow.js';
import { initGrid } from './planet/hexgrid.js';
import { hexes, generateDust, adoptGenerated } from './planet/dustmap.js';
import { createWorld } from './scene/world.js';
import { createTerrain } from './scene/terrain.js';
import { createActors } from './scene/actors.js';
import { createParticles } from './scene/particles.js';
import { createFollowCamera } from './scene/camera.js';
import { createPicker } from './scene/picking.js';
import { createThumbs } from './scene/thumbs.js';
import { createMoonMap } from './scene/moonMap.js';
import { createRemotes } from './scene/remotes.js';
import { createWardrobe } from './scene/wardrobe.js';

const canvas = document.getElementById('scene-canvas');
const fpsEl = document.getElementById('fps-counter');
const BOOT_KEY = 'ms2_boot';
let world, terrain, actors, particles, cam, map, remotes, pause, settingsUi;
let running = false;

// ---------- příprava Měsíce (mapa prachu ve Web Workeru) ----------

function prepareMoon() {
  initGrid();
  return new Promise(resolve => {
    const fallback = () => { game.dust = generateDust(); resolve(); };
    try {
      const w = new Worker(new URL('./planet/moonWorker.js', import.meta.url), { type: 'module' });
      w.onmessage = e => { game.dust = adoptGenerated(e.data.dust, e.data.init); w.terminate(); resolve(); };
      w.onerror = () => { w.terminate(); setTimeout(fallback, 0); };
      w.postMessage(1);
    } catch {
      setTimeout(fallback, 30);
    }
  });
}

// ---------- herní logika ----------

// Pracovní tick 10× za s: zametání, výkup, roboti, kontrola výhry.
function work(dt) {
  const s = game.s;
  const before = s.money;
  const earned = collect();
  if (net.mode === 'client') addEarned(s.money - before);    // výdělek se přičte do společných peněz
  if (earned) {
    flashMoney();
    floatAtTool(`+$${fmt(earned)}`, 'sale');
  }
  if (playerFx.bonus) {
    const n = playerFx.completed.length;
    floatAtTool(n > 1 ? `+$${playerFx.bonus} · ${n} hexy hotové` : `+$${playerFx.bonus} · hex hotový`, 'bonus');
  }
  if (settings.particles && playerFx.swept) {
    particles.emit(actors.toolTip(), 3, activeEquipment().stats.width * 0.7);
  }
  if (net.mode !== 'client') {                               // roboty simuluje jen hostitel / hráč sám
    for (const st of s.stations) {
      const done = robotTick(st, dt);
      if (done.length) hostRobotCompleted(done);
    }
    if (!s.won && hexes.doneCount >= hexes.total * (1 - WIN_LEFT)) {
      s.won = true;
      toast('Měsíc je čistý. Směna skončila!', 8000);
    }
  }
}

// Plovoucí „+$“ – výkup nad hlavou astronauta, bonus za hex nad nástrojem.
function floatAtTool(text, kind) {
  const v = actors.toolTip().clone().project(world.camera);
  if (v.z > 1) return;
  const lift = kind === 'sale' ? 110 : 40;
  floatText(text, (v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight - lift, kind);
}

// ---------- akce (E) ----------

let action = null;

function doAction() {
  if (!action?.run) return;
  const result = action.run();
  const done = r => {
    if (r === 'placed') toast('Stanice postavena. Robot začíná uklízet okolní hexy.');
    else if (r === 'denied') toast('Hostitel nákup neschválil (nejspíš došly společné peníze).');
    updateUi();
  };
  if (result && typeof result.then === 'function') result.then(done);
  else done(result);
  action = null;
}

function cancel() {
  if (placing.active) {
    cancelPlacing();
    toast('Stavba stanice zrušena.');
  }
}

// ---------- měření výkonu ----------

const perf = { frames: 0, since: 0, samples: [], warned: false };

function trackFps(now) {
  perf.frames++;
  if (now - perf.since < 500) return;
  const fps = perf.frames * 1000 / (now - perf.since);
  perf.frames = 0;
  perf.since = now;
  fpsEl.textContent = `${Math.round(fps)} FPS`;
  if (perf.warned || document.hidden) return;
  perf.samples.push(fps);
  if (perf.samples.length < 16) return;
  const avg = perf.samples.slice(-10).reduce((a, b) => a + b, 0) / 10;
  const target = settings.fpsCap || 60;
  if (avg < target * 0.7 && matchPreset() !== 'low') {
    perf.warned = true;
    toast(`Hra běží jen na ${Math.round(avg)} FPS. V menu Grafika zkus předvolbu Nízká.`, 9000);
  }
  if (perf.samples.length > 40) perf.warned = true;
}

// ---------- smyčka ----------

let workAcc = 0;
let prev = performance.now();
let lastRender = 0;
let promptTimer = 0;
let shadeTimer = 0, sunTarget = 1, sunHere = 1;
let lampPos = null;
let warpWarned = false;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - prev) / 1000, 0.25);
  prev = now;
  const s = game.s;
  const eq = activeEquipment();
  const paused = pause.isOpen && net.mode === 'sp';             // sám hráč může hru pozastavit

  if (!paused) {
    const turn = input.turn();
    const turnRate = s.driving >= 0 ? (eq.base.kind === 'push' ? 2.0 : 1.4) : 2.2;
    if (turn && !isRagdoll()) rotateHeading(turn * dt * turnRate);
    if (input.jump) tryJump();
    if (input.keys.t) {
      if (net.mode === 'client') {
        if (!warpWarned) { warpWarned = true; toast('Čas může zrychlit jen hostitel světa – denní doba je pro všechny stejná.'); }
      } else s.warp += dt * 1000 * SUN.warpSpeed;
    }

    movePlayer(input, dt);
    if (playerFx.landed) {
      if (settings.particles) particles.emit(actors.feetPosition(), Math.min(30, 8 + playerFx.landed * 6), 1.0);
      playerFx.landed = 0;
    }
    // srážka s vozidlem jiného hráče → ragdoll
    if (net.mode !== 'off' && checkVehicleHits(movingVehicles(actors.vehicleRadius), actors.ragdollPose)) {
      toast('Srazilo tě vozidlo! Letíš měsíční gravitací…', 4000);
    }
    updatePlacing();
    workAcc += dt * 1000;
    while (workAcc >= TICK_MS) {
      work(TICK_MS / 1000);
      workAcc -= TICK_MS;
    }
  }
  if (net.mode !== 'off') {
    setRagdollPresence(ragdollEncoded());
    netTick(dt, {
      speed: playerFx.speed, alt: playerFx.alt, vr: playerFx.vr, swept: playerFx.swept, airborne: playerFx.airborne,
      toolWidth: eq.stats.width, body: activeBody(),
    }, currentVehicleSpeed());
  }

  promptTimer -= dt;
  if (promptTimer <= 0) {
    promptTimer = 0.12;
    action = facilityOpen() || map.active || pause.isOpen ? null : currentAction(openFacility);
    setPrompt(action);
  }

  const minGap = settings.fpsCap ? 1000 / settings.fpsCap - 2 : 0;
  if (now - lastRender < minGap) return;
  const rdt = Math.min((now - lastRender) / 1000, 0.25);
  lastRender = now;

  const t = gameTime();
  const elev = sunElevationDeg(s.p, t);
  actors.setLamp(Math.min(1, Math.max(0, (4 - elev) / 10)));

  shadeTimer -= rdt;
  const focus = actors.focusPosition();
  if (shadeTimer <= 0) {
    shadeTimer = 0.15;
    const l = focus.length();
    const lift = (l + 1.2) / l;
    sunTarget = sunVisible([focus.x * lift, focus.y * lift, focus.z * lift], sunAngle(t)) ? 1 : 0;
  }
  sunHere += (sunTarget - sunHere) * Math.min(1, rdt * 4);
  const light = world.updateSky(t, s.p, rdt, focus, sunHere);
  terrain.setLighting({
    ...light,
    lampPos: actors.lampPosition(lampPos),
    lampIntensity: actors.lampIntensity(),
    shadow: world.shadowInfo(),
  });

  terrain.updateDust();
  terrain.setFocus(focus);
  terrain.updateVisibility(world.camera.position);
  actors.update(rdt, now / 1000, playerFx, 45 + cam.distance * 2.5);
  if (remotes) remotes.update(rdt, now / 1000, map.active);
  particles.update(rdt);
  cam.setBaseDistance(s.driving >= 0 ? eq.base.camera : isRagdoll() ? 16 : CAMERA.distance);
  cam.update(rdt, actors.focusPosition(), s.p, s.f);
  map.update(rdt, focus);
  world.renderer.render(world.scene, world.camera);
  trackFps(now);
}

// Skrytá karta: prohlížeč zastaví snímky. Hostitel ale musí dál vést roboty a vysílat stav.
function backgroundStep() {
  if (!running || !document.hidden || net.mode !== 'host') return;
  for (let i = 0; i < 10; i++) work(TICK_MS / 1000);
  netTick(1, { speed: 0, alt: 0, vr: 0, swept: 0, airborne: 0, toolWidth: 0.3, body: activeBody() }, 0);
}

// ---------- nastavení grafiky ----------

function applySettings(next, before) {
  if (!world) return;
  if (next.scale !== before.scale) world.setPixelRatio(next.scale);
  if (next.view !== before.view) terrain.setViewDistance(next.view);
  if (!next.particles && before.particles) particles.clear();
  if (next.shadows !== before.shadows) {
    world.setShadows(next.shadows);
    actors.setShadows(next.shadows);
  }
  fpsEl.hidden = !next.showFps;
  perf.samples = [];
}

// ---------- mapa celého Měsíce (M) ----------

const settingsOpen = () => !document.getElementById('settings').hidden;
const modalOpen = () => facilityOpen() || settingsOpen() || pause?.isOpen;
const mapButton = () => document.getElementById('map-toggle');

function toggleMap(on = !map.active) {
  if (on === map.active || (on && modalOpen())) return;
  if (on) {
    if (placing.active) cancelPlacing();
    input.enabled = false;
    input.release();
    input.target = null;
    terrain.setHidden(true);
    map.open(game.s.p, game.s.f);
    toast('Mapa Měsíce: táhni myší = otáčení, kolečko = přiblížení, M nebo Esc = zpět.', 5000);
  } else {
    map.close();
    terrain.setHidden(false);
    input.enabled = true;
  }
  mapButton().setAttribute('aria-pressed', String(on));
  mapButton().classList.toggle('controls__button--active', on);
}

// ---------- ukládání a menu ----------

const canSave = () => net.mode !== 'client' && !!game.slot;

async function saveNow(slot) {
  if (net.mode === 'client') { savePersonal(); return true; }
  const ok = await saveGame(slot, toast);
  if (ok) toast(slot && slot !== game.slot ? 'Uloženo.' : `Uloženo do slotu ${String(game.slot).replace('slot', '')}.`, 2500);
  return ok;
}

async function toMenu() {
  if (net.mode === 'client') savePersonal();
  else await saveGame(game.slot);
  try { sessionStorage.removeItem(BOOT_KEY); history.replaceState(null, '', location.pathname); } catch { /* nic */ }
  location.reload();
}

function loadFrom(slot) {
  try { sessionStorage.setItem(BOOT_KEY, JSON.stringify({ mode: 'sp', slot, action: 'load' })); } catch { /* nic */ }
  location.reload();
}

// Doplní práci robotů za dobu, kdy hra neběžela (zavřená stránka / skrytá karta).
function catchUp(since) {
  const sec = Math.min((Date.now() - since) / 1000, OFFLINE_CAP_S) | 0;
  if (sec < 10 || !game.s.stations.length) return;
  const earned = simulateOffline(sec);
  toast(`Za ${Math.max(1, Math.round(sec / 60))} min tvé nepřítomnosti roboti vydělali $${fmt(earned)}.`, 6000);
}

// Odkaz pro kamarády do schránky (když schránka nejde, ukáže se v poli k ručnímu zkopírování).
function copyInvite(field) {
  const link = inviteLink();
  if (!link) return;
  const fallback = () => {
    if (field) { field.hidden = false; field.value = link; field.focus(); field.select(); }
    toast(`Odkaz do světa: ${link}`, 10000);
  };
  try {
    navigator.clipboard.writeText(link).then(
      () => toast(`Odkaz zkopírovaný. Pošli ho kamarádům – kód světa je ${net.code}.`, 6000),
      fallback,
    );
  } catch { fallback(); }
}

// ---------- ovládání ----------

function bindButtons() {
  const on = (id, fn) => document.getElementById(id).addEventListener('click', fn);
  on('cam-left', () => (map.active ? map.rotate(-120, 0) : rotateHeading(Math.PI / 4)));
  on('cam-right', () => (map.active ? map.rotate(120, 0) : rotateHeading(-Math.PI / 4)));
  on('zoom-in', () => (map.active ? map.zoom(1 / 1.25) : cam.zoom(1 / 1.25)));
  on('zoom-out', () => (map.active ? map.zoom(1.25) : cam.zoom(1.25)));
  on('map-toggle', () => toggleMap());
  on('menu-open', () => pause.open());
  on('chat-open', () => openChat());
  on('players-invite', () => copyInvite(null));
  // Esc: zavře to, co je otevřené; když nic, otevře menu pauzy. (Fáze zachycení = stav před zavřením.)
  addEventListener('keydown', e => {
    if (!running || e.repeat) return;
    if (e.key === 'Escape') {
      if (pause.isOpen) { pause.close(); e.stopImmediatePropagation(); return; }
      if (chatOpen() || facilityOpen() || settingsOpen() || map.active || placing.active) return;
      pause.open();
      e.stopImmediatePropagation();
      return;
    }
    if (e.target.matches?.('input, textarea, select')) return;
    if (e.key === 'Enter' && net.mode !== 'off' && !modalOpen() && !map.active) {
      e.preventDefault();
      input.release();
      openChat();
      return;
    }
    if (e.key.toLowerCase() === 'm' && !modalOpen() && !chatOpen()) toggleMap();
    else if (e.key === 'Escape' && map.active && !modalOpen()) toggleMap(false);
  }, true);
  addEventListener('keydown', e => {
    if (running && e.key === 'Escape' && map.active && !modalOpen()) toggleMap(false);
  });
  on('prompt', doAction);
}

function bindVisibility() {
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      if (net.mode === 'client') savePersonal();
      else saveGame(game.slot, toast);
    } else if (hiddenAt) {
      if (net.mode === 'sp') catchUp(hiddenAt);
      hiddenAt = 0;
      prev = performance.now();
      perf.samples = [];
    }
  });
}

// ---------- stavba scény ----------

function build() {
  lampPos = new window.THREE.Vector3();
  initPlayer();
  world = createWorld(canvas, { antialias: settings.antialias, pixelRatio: settings.scale, shadows: settings.shadows });
  terrain = createTerrain(world.scene, world.renderer, settings.view);
  actors = createActors(world.scene, settings.shadows, profile.look, { vehicleOverride: i => (net.mode === 'off' ? null : vehicleOverride(i)) });
  particles = createParticles(world.scene);
  cam = createFollowCamera(world.camera);
  map = createMoonMap(world.scene, world.camera, canvas, terrain.texture);
  terrain.linkUniforms(map.uniforms);
  if (net.mode !== 'off') remotes = createRemotes(world.scene, world.camera, actors, document.getElementById('nametag-layer'));
  actors.update(0.016, 0, playerFx, 120);
  cam.update(1, actors.focusPosition(), game.s.p, game.s.f);
  terrain.updateVisibility(world.camera.position, Infinity);

  const pauseInput = () => { input.enabled = false; input.release(); };
  const resumeInput = () => { input.enabled = !map.active && !modalOpen() && !chatOpen(); };

  bindInput(canvas, {
    pickDir: createPicker(canvas, world.camera),
    rotate: a => { if (!isRagdoll()) rotateHeading(a); },
    zoom: f => (map.active ? map.zoom(f) : cam.zoom(f)),
    onAction: doAction,
    onCancel: cancel,
  });
  const thumbs = createThumbs(world.renderer);
  const wardrobe = createWardrobe(thumbs);
  initFacility(thumbs, {
    onOpen: pauseInput,
    onClose: resumeInput,
    onChange: () => { flashMoney(); updateUi(); },
    onDenied: () => toast('Hostitel nákup neschválil (nejspíš došly společné peníze).'),
    onPlaceStation: () => {
      startPlacing();
      toast('Vyber místo mimo základnu: robot uklidí hexy do vzdálenosti 2 od stanice. E = postavit, Esc = zrušit.', 7000);
    },
    onLook: look => actors.setLook(look),
    wardrobe,
    headThumb: id => wardrobe.headThumb(id),
  });
  pause = initPause({
    canSave, canLoad: () => net.mode === 'sp',
    save: () => saveNow(game.slot),
    saveTo: slot => saveNow(slot),
    loadFrom,
    toMenu,
    invite: () => !!inviteLink(),
    copyInvite,
    openSettings: () => settingsUi.open(),
    onOpen: pauseInput,
    onClose: resumeInput,
    info: () => {
      if (net.mode === 'host') return `Hostuješ svět ${net.code} · hráčů ${1 + net.remotes.size}. Svět se ukládá do tvého slotu.`;
      if (net.mode === 'client') return `Hraješ ve světě ${net.code}. Svět ukládá hostitel, tvé vybavení zůstává v tomto prohlížeči.`;
      return game.slot ? `Hraješ ve slotu ${game.slot.replace('slot', '')} · hra se ukládá každých 30 s.` : '';
    },
  });
  initChat({ send: sendChat, onOpen: pauseInput, onClose: resumeInput });
  bindButtons();
  bindVisibility();
  document.querySelector('.hud').addEventListener('click', e => e.target.closest('button')?.blur());
  updateUi();
  fpsEl.hidden = !settings.showFps;
}

// ---------- spuštění hry ----------

let moonReady = null;
let launching = false;

function launchError(text) {
  showLoading(text);
  document.getElementById('menu-loading-back').hidden = false;
}

async function launch(spec) {
  if (launching) return;
  launching = true;
  showLoading('Připravuji Měsíc…');
  await moonReady;
  let fresh = false;
  game.mode = spec.mode;

  if (spec.mode === 'client') {
    showLoading('Připojuji se ke světu…');
    if (!(await initLobby())) { launchError('Multiplayer tu nejde připojit.'); return; }
    const err = await joinWorld(spec.world, showLoading);
    if (err && err !== 'nomap') { launchError(err); return; }
    try { history.replaceState(null, '', `#${spec.world.code}`); } catch { /* nic */ }
    if (err === 'nomap') setTimeout(() => toast('Mapu od hostitele se nepodařilo stáhnout – vyčištěná místa se ukážou, jak je kdo projede.', 8000), 1500);
    game.slot = null;
  } else {
    if (spec.action === 'load') {
      showLoading('Načítám uloženou hru…');
      if (!(await loadGame(spec.slot))) { launchError('Uloženou hru se nepodařilo načíst.'); return; }
    } else {
      if (spec.action === 'v1') importV1(spec.title);
      else newGame(spec.title);
      game.slot = spec.slot;
      fresh = true;
    }
    if (spec.mode === 'host') game.s.netPublic = spec.public !== false;
  }

  showLoading('Stavím scénu…');
  await new Promise(r => setTimeout(r, 30));
  build();
  hideMenu();
  game.started = Date.now();
  running = true;

  if (spec.mode === 'host') {
    const ok = (await initLobby()) && (await startHost());
    if (ok) {
      try { history.replaceState(null, '', `#${net.code}`); } catch { /* nic */ }
      toast(`Svět je otevřený, kód ${net.code}. Odkaz pro kamarády zkopíruješ tlačítkem Pozvat vpravo nahoře.`, 9000);
    }
    else { net.mode = 'off'; game.mode = 'sp'; toast('Svět se nepodařilo otevřít ostatním – hraješ sám.', 6000); }
  }
  if (net.mode !== 'off') {
    showChat(true);
    net.onChat = addMessage;
    net.onHostLeft = () => {
      savePersonal();
      toast('Hostitel svět zavřel. Vracím tě do menu…', 6000);
      setTimeout(() => { try { history.replaceState(null, '', location.pathname); } catch { /* nic */ } location.reload(); }, 3500);
    };
    addMessage({ system: true, text: 'Chat: Enter = napsat zprávu, Esc = zavřít.' });
  }

  if (fresh) {
    await saveGame(game.slot, toast);
    toast(spec.action === 'v1'
      ? 'Vybavení a peníze z verze 1 jsou převedené. Vítej na větším Měsíci!'
      : 'Vítej na Měsíci! Zametej zubním kartáčkem a prach odnes do Výkupu uprostřed základny.', 8000);
  } else if (spec.mode !== 'client') {
    catchUp(game.s.last);
  }

  setInterval(() => {
    updateUi();
    refreshFacility();
    updatePlayers(net.mode !== 'off' ? players() : null, net.code);
    backgroundStep();
  }, 250);
  setInterval(() => {
    if (net.mode === 'client') savePersonal();
    else saveGame(game.slot, toast);
  }, 30000);
  addEventListener('beforeunload', () => {
    if (net.mode === 'client') savePersonal();
    else saveGame(game.slot);
  });

  prev = perf.since = performance.now();
  requestAnimationFrame(frame);
}

function start() {
  if (!window.THREE) {
    toast('3D knihovnu se nepodařilo načíst. Zkontroluj připojení k internetu a obnov stránku.', 600000);
    return;
  }
  loadSettings();
  loadProfile();
  settingsUi = initSettingsMenu({
    onChange: applySettings,
    onOpen: () => { input.enabled = false; input.release(); },
    onClose: () => { input.enabled = running && !map?.active && !facilityOpen() && !pause?.isOpen; },
    onReload: () => (running ? saveNow(game.slot) : Promise.resolve()),
    antialiasAtStart: settings.antialias,
  });
  document.getElementById('menu-loading-back').addEventListener('click', () => location.reload());
  initMenu({ onLaunch: launch, openSettings: () => settingsUi.open() });
  setMoonStatus('Připravuji Měsíc…', false);
  moonReady = prepareMoon().then(() => setMoonStatus(`Měsíc připraven · ${hexes.total.toLocaleString('cs-CZ')} sektorů`, true));

  let boot = null;
  try { boot = JSON.parse(sessionStorage.getItem(BOOT_KEY)); sessionStorage.removeItem(BOOT_KEY); } catch { /* nic */ }
  if (boot?.slot) launch(boot);
}

start();
