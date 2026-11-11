// Vstupní bod: hlavní menu → příprava Měsíce → hra (sám, jako hostitel, nebo připojený hráč).
// Propojí logiku, 3D scénu, budovy, síť, chat a nastavení; spustí smyčku a ukládání.
import { TICK_MS, WIN_LEFT, OFFLINE_CAP_S, SUN, CAMERA, UNITS_PER_KG, MOON, BASE, PLANET, PLANET_KEY } from './config.js';
import { game, newGame, gameTime, addStat, dustPrice, pickPersonal, putPersonal, resetPersonal } from './state.js';
import { activeEquipment, powerRefund, stripPower } from './equipment.js';
import { robotTick, simulateOffline } from './robots.js';
import { droneTick, dronesOffline } from './drones.js';
import { logisticsTick, logisticsClientTick, logisticsOffline, depositToDepot } from './logistics.js';
import {
  initPlayer, movePlayer, collect, playerFx, rotateHeading, tryJump, tryJet, activeBody, vehicleBody,
  unloadToDepot,
  checkVehicleHits, isRagdoll, ragdollNet, currentVehicleSpeed, riding, followRide, leaveRide, currentAltitude,
} from './player.js';
import { currentAction, placing, startPlacing, cancelPlacing, updatePlacing, stationUpgradeNear } from './interact.js';
import { ensureHotbar, selectSlot, dropSlot, HAMMER_ID } from './hotbar.js';
import { initHotbar, updateHotbar } from './hotbarUi.js';
import { initAchievements, unlock, addAchStat, recordAchStat } from './achievements.js';
import { RANKS, myRank } from './ranks.js';
import { MARKET, SUIT_COLORS, toolById } from './catalog.js';
import { launchRocket, launchSeconds, ROCKET } from './rocket.js';
import { initFacility, openFacility, facilityOpen, refreshFacility } from './facility.js';
import { input, bindInput } from './input.js';
import { toggleAutopilot, autopilotMode, autopilotOff, takeAutopilotNote, setAutopilotMovers } from './autopilot.js';
import { preloadModels } from './assets/models.js';
import { initRocks, rocksTick, takeRockNote, ROCK_MODELS } from './rocks.js';
import { createRocksView } from './scene/rocksView.js';
import { syncTerrainPatches } from './structures.js';
import { takeTerrainChanges } from './planet/height.js';

// Budovy základny (GLB) se staví hned se scénou – načtou se spolu s přípravou Měsíce.
const BASE_MODELS = ['building-buyback', 'building-workshop', 'building-toolshop', 'aircraft-prachovka', 'aircraft-kolibrik', 'aircraft-mula', 'aircraft-kondor',
  'ground-push', 'ground-rideon', 'ground-lunar', 'ground-mega', 'ground-crew', 'ground-prachocuc', 'trailer-1', 'trailer-2', 'trailer-3', 'trailer-4', 'swap-battery-full', 'swap-battery-empty'];   // letouny: builder vozidla potřebuje GLB (3.1)
import { updateUi, setPrompt, flashMoney, floatText, toast, updatePlayers, showAchievement, navTarget } from './ui.js';
import { saveGame, loadGame, importV1, lockSaves, savePlanet, peekSave, saveFresh, stashHandoff, takeHandoff, logWorldLoad } from './storage.js';
import { cloudMeta, loadCloud, cloudHasMap, hostOf, releaseHost, resetCloudMap, setWorldPassword, checkAccess, blockCloud } from './cloud.js';
import { FIREBASE_DEV } from './firebase-config.js';
import { VERSION, cmpVersion } from './version.js';
import { initVersionUi } from './versionUi.js';
import { fmt } from './format.js';
import { settings, loadSettings, matchPreset } from './settings.js';
import { initSettingsMenu } from './settingsMenu.js';
import { createDebug } from './debug.js';
import { energyTick, TICK as ENERGY_TICK, live as energyLive, swapEvents } from './energy.js';
import { dronesTick, predictTick, setDroneHooks, takeDroneEvents, droneOffer, missionFor, orderDrone, droneStatus, DRONE as DELIVERY } from './dronport.js';
import { roofOf } from './scene/swapperCrane.js';
import { purchase } from './econ.js';
import './laac.js';                                              // LAAC (3.1): díly stavby (partsFor) a domov letounů
import { isAirType } from './catalog.js';
import { scan, scanDust } from './flight.js';
import { setCarryHooks, carrying } from './carry.js';
import { takeFromDepot, stationHasBelt } from './logistics.js';
import { stationMk } from './catalog.js';
import { loadFromSilo } from './player.js';
import { vehicleStats } from './equipment.js';
import { researchCenter, researchTick, researchOffline, techById } from './research.js';
import { batteryCap, batteryPoint, hangPoint } from './catalog.js';
import { hasArm, toggleArm, takeArmNote, swapArmHint, trailerPoint } from './prachocuc.js';
import { build as bld, hammerActive, toggleHammer, toggleMenu, toggleDemolish, cancelBuild, rotateBy, updateBuild, placeNow, closeAll, startCable, connectNow, beltClick } from './build.js';
import { initBuildUi, updateBuildUi, placeHoldRing, placeStructLabel } from './buildUi.js';
import { describe as describeStructure } from './energy.js';
import { structureById as structById, STRUCTURES as STRUCT_DEFS, padTopHeight } from './structures.js';
import { loadProfile, profile, saveProfile } from './profile.js';
import {
  net, initLobby, startHost, joinWorld, netTick, addEarned, sendChat, refreshLobbyRank, players, movingVehicles,
  vehicleOverride, vehicleTakenBy, vehicleRemoteMoving, hostRobotCompleted, setRagdollPresence, savePersonal, inviteLink,
  addCollected, reportDeposit, reportTake, reportParked, myStatKey, passengersOf, request, hostOwnDust, saveWorldNow, saveWorldOnHide, setWorldLocked, worldLocked, findWorld,
  loadPersonal,
} from './net.js';
import { initChat, showChat, addMessage, openChat, chatOpen } from './chat.js';
import { initMenu, initPause, showLoading, hideMenu, setMoonStatus } from './menu.js';
import { sunElevationDeg, sunAngle } from './planet/sun.js';
import { sunVisible } from './planet/sunwindow.js';
import { angleBetween, norm, madd } from './planet/vec.js';
import { altitude } from './physics.js';
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
import { createHoloView } from './scene/hologram.js';
import { createCompass } from './scene/compass.js';
import { createSpots, SPOTS } from './scene/lights.js';

const canvas = document.getElementById('scene-canvas');
const fpsEl = document.getElementById('fps-counter');
const BOOT_KEY = 'ms2_boot';
let world, terrain, actors, particles, cam, map, remotes, pause, settingsUi, compass, spots, debug, rocks3d;
let running = false;

// ---------- příprava Měsíce (mapa prachu ve Web Workeru) ----------

function prepareMoon() {
  initGrid();
  return new Promise(resolve => {
    const fallback = () => { game.dust = generateDust(); resolve(); };
    try {
      const w = new Worker(new URL(`./planet/moonWorker.js?planet=${PLANET.id}`, import.meta.url), { type: 'module' });
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
  rocksTick();                                              // rozbité kameny ze stavu, schované pod stavbami / pásy
  const before = s.money;
  const eqNow = activeEquipment();
  const earned = collect();
  unloadToDepot(dt);                                        // vozidlo pod výsypkou → do depa (L-63)
  if (playerFx.dump?.kg > 0) {
    const { id, kg } = playerFx.dump;
    if (net.mode === 'client') reportDeposit(id, kg);       // hostitel ověří proti nasbíranému prachu (dk)
    else { depositToDepot(id, kg); hostOwnDust(0, kg); }
  }
  loadFromSilo(dt);                                         // Kondor nad silem → náklad ze skladu (3.1, L-67)
  if (playerFx.silo?.kg > 0) {
    const { id, kg } = playerFx.silo;
    if (net.mode === 'client') { reportTake(id, kg); playerFx.pendingTake = { ...(playerFx.pendingTake || {}), [id]: (playerFx.pendingTake?.[id] || 0) + kg }; }
    else hostOwnDust(takeFromDepot(id, kg), 0);             // prach z depa je „nasbíraný“ – prodej ve Výkupu projde kontrolou
  }
  batteryWarnings();
  const gained = s.money - before;
  const swept = playerFx.swept / UNITS_PER_KG;
  // úspěchy: zubní kartáček, dočištěné hexy, vlastní výdělek, prodej za tmy
  if (swept && eqNow.kind === 'tool' && eqNow.base.id === 'toothbrush') addAchStat('tb', swept);
  if (playerFx.completed.length) addAchStat('hex', playerFx.completed.length);
  addAchStat('kg', swept);
  if (swept) checkRank();                                    // hodnost podle nasbíraného prachu (ranks.js)
  if (riding()) addAchStat('ride', dt / 60);
  addAchStat('earn', gained + (playerFx.deposit ? playerFx.deposit.kg * dustPrice() : 0));
  if (earned && sunElevationDeg(s.p, gameTime()) < -6) unlock('nightshift');
  if (net.mode === 'client') {
    addEarned(gained);                                       // výdělek se přičte do společných peněz
    addCollected(swept);
  } else {
    addStat(myStatKey(), profile.name, 'e', gained);
    addStat(myStatKey(), profile.name, 'kg', swept);
    hostOwnDust(swept, earned / dustPrice() + (playerFx.deposit ? playerFx.deposit.kg : 0));   // bilance pro kontrolu klientů
  }
  if (playerFx.deposit) {                                    // náklad vysypaný do depa
    const { id, kg } = playerFx.deposit;
    if (net.mode === 'client') reportDeposit(id, kg);
    else depositToDepot(id, kg);                             // prodá se, až ho pás doveze do Výkupu (L-20)
    floatAtTool(`+${fmt(kg)} kg do depa`, 'sale');
  }
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
  if (net.mode === 'client') logisticsClientTick(dt);        // klient: položky na pásech se posouvají mezi pakety
  if (net.mode !== 'client') {                               // roboty simuluje jen hostitel / hráč sám
    for (const st of s.stations) {
      const done = robotTick(st, dt);
      if (done.length) hostRobotCompleted(done);
    }
    stationNotes();                                          // plná stanice bez pásu (11. 11.)
    for (const dr of s.drones) {                             // UFO drony si hexy hledají samy
      const done = droneTick(dr, dt);
      if (done.length) hostRobotCompleted(done);
    }
    logisticsTick(dt);                                       // pásy, depa, slinovny (L-20 až L-24)
    energyAcc += dt;
    if (energyAcc >= ENERGY_TICK) {
      energyAcc -= ENERGY_TICK;
      energyTick(ENERGY_TICK, vehicleMoving);
      while (swapEvents.length) if (swapEvents.shift() === s.driving) toast('Baterie vyměněná – 100 %. Můžeš jet.', 3500);
      const rc = researchCenter();
      if (rc) {
        const done = researchTick(ENERGY_TICK, energyLive.get(rc.id)?.f ?? 0);   // výzkum jede podle dodané energie (L-30)
        if (done) researchFinished(done);
      }
    }
    if (!s.won && hexes.doneCount >= hexes.total * (1 - WIN_LEFT)) {
      s.won = true;
      toast(`${PLANET.name} je čistý. Na odvrácené straně čeká raketa – nastupte!`, 9000);
    }
  }
}

let energyAcc = 0;
// Hotový výzkum: hláška (klient ji ukáže sám, když v H.rs přibude hotový výzkum – net.js).
function researchFinished(id) {
  const t = techById(id);
  if (!t) return;
  toast(`Výzkum „${t.name}“ je hotový – odemyká: ${t.unlocks}.`, 8000);
  refreshFacility();
}
// Hýbe se vozidlo i? (nabíjení a výměna baterie jen ve stání; řidič smí sedět)
const vehicleMoving = i => (i === game.s.driving ? Math.abs(currentVehicleSpeed()) > 0.3 : vehicleRemoteMoving(i));

// ---------- dronová donáška baterií (3.1, L-62) ----------
// Poloha a rychlost vozidla pro let dronu: řízené mnou / jiným hráčem / zaparkované.
setDroneHooks({
  vehicle: i => {
    const s = game.s, v = s.vehicles[i];
    if (!v) return null;
    // dron míří nad baterii vozidla (uzel baterie nebývá nad středem, 07 fáze B)
    const bp = batteryPoint(v.type);
    const at = (p, f) => (bp && f ? norm(madd(p, f, bp.z / MOON.radius)) : p);
    if (i === s.driving) return { p: at(v.p, v.f), speed: Math.abs(currentVehicleSpeed()) };
    const o = net.mode !== 'off' ? vehicleOverride(i) : null;
    return o ? { p: at(o.p, o.f || v.f), speed: o.speed || 0 } : { p: at(v.p, v.f), speed: 0 };
  },
  roof: type => batteryPoint(type)?.y ?? roofOf(type || 'rideon'),   // „střecha“ pro dron = spodek baterie v kolébce
});
// B / tlačítko v HUD: objednat baterii dronem, podruhé zrušit
function orderBattery() {
  const s = game.s, i = s.driving;
  if (i < 0) { toast('Baterii dronem objednáš, když sedíš ve vozidle (B).', 4000); return; }
  const v = s.vehicles[i], cur = missionFor(i);
  if (hasArm(v) && (v.armT || 0) > 0) { toast('Zvedni ramena (F) – dron vymění baterii jen s rameny nahoře.', 4000); return; }
  const send = (on, ok) => Promise.resolve(purchase('dorder', [i, v.uid, on ? 1 : 0], 0, () => orderDrone(i, on))).then(r => toast(r ? ok : 'Objednávka dronu se nepovedla – zkus to znovu.', 4000));
  if (cur) {
    if (cur.m.carry !== 'full' || cur.m.cancel) return;
    if (cur.m.ph === 'swap') { toast('Dron právě vyměňuje baterii.', 3000); return; }
    send(false, 'Objednávka zrušena – dron se vrací s baterií.');
    return;
  }
  const o = droneOffer(i);
  if (!o.ok) { toast(o.reason, 4500); return; }
  send(true, 'Dron letí s nabitou baterií. Až bude nad tebou, zastav.');
}
// Převoz vozidel (3.1, L-67): výška střechy, kdo vozidlo řídí, položené vozidlo klient nahlásí hostiteli
setCarryHooks({
  roof: type => roofOf(type || 'rideon'),
  hang: type => hangPoint(type),                // závěsné oko vozidla (GLB); null = střed střechy
  taken: i => i === game.s.driving || !!vehicleTakenBy(i),
  placed: i => { if (net.mode === 'client' && i >= 0) reportParked(i); },
});
// Stanice robota bez pásu (11. 11.): prach se prodá jen přes pás – když se zásobník zaplní, jednou za hru hláška
const fullWarned = new Set();
function stationNotes() {
  for (const st of game.s.stations) {
    if (!st.full || stationHasBelt(st) || fullWarned.has(st.hex)) continue;
    fullWarned.add(st.hex);
    toast(`${stationMk(st).name}: zásobník stanice je plný (${stationMk(st).store} kg) a robot stojí. Prach se prodá jen přes pás – postav ho kladivem z oranžové zásuvky stanice do Výkupu (V → Logistika → Pás).`, 10000);
  }
}
// Skener Kolibříku (3.1, L-65): za letu 1× za 2 s najde 5 nejšpinavějších hexů v dosahu → značky na mapě (M)
let scanToast = false;
function scanTick() {
  const s = game.s, v = s.driving >= 0 ? s.vehicles[s.driving] : null;
  const range = v && v.air?.mode === 'fly' ? vehicleStats(v).scan : 0;
  if (!range) { if (scan.cells.length && performance.now() - scan.at > 30000) scan.cells = []; return; }
  if (performance.now() - scan.at < 2000) return;
  scan.at = performance.now();
  scan.cells = scanDust(v.p, range);
  if (!scanToast && scan.cells.length) { scanToast = true; toast(`Skener prachu: ${scan.cells.length} nejšpinavějších hexů do ${range} m je na mapě (M) žlutě.`, 6000); }
}
// Hlášky letu (hostitel z událostí, klient podle stavu letu k mému vozidlu)
let droneSeen = { uid: null, carry: null };
function droneNotes() {
  const s = game.s;
  for (const e of takeDroneEvents()) {
    if (e.v !== s.driving) continue;
    toast(e.kind === 'done' ? 'Baterie vyměněná dronem – 100 %. Můžeš jet.' : `Vozidlo je dál než ${DELIVERY.range} m od výměníku – dron se vrací.`, 4500);
  }
  if (net.mode !== 'client') return;
  const v = s.driving >= 0 ? s.vehicles[s.driving] : null;
  const m = v ? missionFor(s.driving)?.m : null;
  if (v && m && droneSeen.uid === v.uid && droneSeen.carry === 'full' && m.carry === 'empty') toast('Baterie vyměněná dronem – 100 %. Můžeš jet.', 4500);
  droneSeen = { uid: v?.uid || null, carry: m?.carry || null };
}

// Upozornění na baterii vozidla (L-02): toast při 20 % a 10 %, při 0 % nouzový režim.
let batteryWarn = { uid: null, level: 1 };
function batteryWarnings() {
  const s = game.s;
  if (s.driving < 0) return;
  const v = s.vehicles[s.driving], cap = batteryCap(v);
  if (!cap) return;
  const k = v.charge / cap;
  if (batteryWarn.uid !== v.uid) batteryWarn = { uid: v.uid, level: k };
  for (const [mark, text] of [[0.2, 'Baterie má 20 % – šipka nahoře ukazuje nejbližší nabíječku.'], [0.1, 'Baterie má jen 10 %! Zamiř k nabíječce.'], [0.0001, 'Baterie je vybitá – nouzový režim: 15 % rychlosti a nezametá. Dojeď k nabíječce.']]) {
    if (batteryWarn.level >= mark && k < mark) toast(text, 6000);
  }
  batteryWarn.level = k;
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
  if (autopilotMode()) { autopilotOff(); toast('Autopilot vypnutý.', 2500); return; }   // E vypne autopilot (L-41)
  if (!action?.run) return;
  settle(action.run());
  action = null;
}
// Hláška podle výsledku akce (i u R = vylepšení stanice)
function settle(result) {
  const done = r => {
    if (r === 'placed') toast('Stanice postavena. Robot začíná uklízet okolní hexy.');
    else if (r === 'moved') toast('Stanice přesunutá. Robot uklízí hexy kolem nového místa.');
    else if (r === 'carry') toast('Stanice je v hotbaru. Vyber nové místo mimo základnu: E = položit, Esc = nechat na místě.', 7000);
    else if (r === 'depot') toast('Depo postavené. Vysyp do něj zásobník, a až u něj postavíš pás (E), prach pojede do Výkupu.', 8000);
    else if (r === 'belt') toast('Pás postavený. Prach z depa teď jede do Výkupu a prodává se sám.', 6000);
    else if (r === 'dcarry') toast('Depo je v hotbaru. Vyber nové místo mimo základnu: E = přesunout ($1 000), Esc = nechat na místě.', 7000);
    else if (r === 'dmoved') toast('Depo je přesunuté i se zásobou. Napojené pásy se zbouraly (60 % zpět) – postav je znovu kladivem.', 7000);
    else if (r === 'liftoff') liftoff();
    else if (r === 'stup') toast('Stanice vylepšená. Robot jezdí rychleji a uveze víc prachu.', 5000);
    else if (r === 'built' && bld.type === 'depot' && (game.s.buildings || []).filter(b => b.type === 'depot').length === 1) {
      // L-25: doporučená první linka
      toast('První depo! Doporučená linka: vozidla → depo u pole dun → pás → Slinovna (v síti se solárem a baterií) → pás → Výkup. Pás: V → Logistika → Pás, klik na oranžovou zásuvku.', 12000);
    } else if (r === 'built') toast('Postaveno. Stejnou stavbu můžeš hned postavit znovu, Esc = zrušit výběr.', 4000);
    else if (r === 'belted') toast('Pás postavený. Jakmile bude ve zdroji náklad, pojede po něm.', 4000);
    else if (r === 'unbelted') toast('Úsek pásu zbouraný, vrátilo se 60 % jeho ceny. Na volný konec pásu navážeš nový pás (V → Logistika → Pás).', 5000);
    else if (r === 'demolished') toast('Zbořeno. Vrátilo se 60 % ceny.', 3000);
    else if (r === 'cabled') toast('Kabel natažený.', 2500);
    else if (r === 'uncabled') toast('Kabel zrušený.', 2500);
    else if (r?.blocked) toast(r.blocked, 5000);
    else if (r === 'denied') toast('Hostitel nákup neschválil (nejspíš došly společné peníze).');
    updateUi();
  };
  if (result && typeof result.then === 'function') result.then(done);
  else done(result);
}

// Štítek stavby (D-01): pod kurzorem (paprsek), jinak nejbližší energetická stavba do 6 m. Výběr 4× za s.
let labelAt = 0, labelFor = null;
function updateStructLabel() {
  const now = performance.now();
  if (now - labelAt > 250) {
    labelAt = now;
    const s = game.s;
    const busyUi = map.active || modalOpen() || (hammerActive() && (bld.menu || bld.mode));   // lišta / hologram: bez štítku
    let id = input.cursor && !busyUi ? actors.pickStructure(input.cursor.x, input.cursor.y, world.camera, canvas) : null;
    if (id && angleBetween(structById(id)?.p || s.p, s.p) * MOON.radius > 60) id = null;
    if (!id && !busyUi) {
      let best = 6 / MOON.radius;
      for (const b of s.buildings || []) { const d = angleBetween(b.p, s.p); if ((STRUCT_DEFS[b.type]?.energy || b.type === 'depot') && d < best) { best = d; id = b.id; } }
    }
    labelFor = id;
  }
  const b = labelFor && structById(labelFor);
  const text = b ? describeStructure(b) : null;
  if (!text) { placeStructLabel(null); return; }
  const def = STRUCT_DEFS[b.type];
  const r = MOON.radius + padTopHeight(b) - (def.padTop || 0) + (def.anchors?.[0]?.[1] || def.labelY || 3) + 1.6;
  labelPos ||= new window.THREE.Vector3();
  placeStructLabel(text, labelPos.set(b.p[0] * r, b.p[1] * r, b.p[2] * r), world.camera);
}
let labelPos = null;

// Výsledek akce stavění / bourání (hodnota nebo Promise) → hláška.
function handleResult(r) {
  if (!r) return;
  action = { run: () => r };
  doAction();
}

function cancel() {
  if (cancelBuild()) { promptTimer = 0; return; }
  if (placing.active) {
    const kind = placing.kind;
    cancelPlacing();
    toast(kind === 'move' ? 'Stanice zůstává na původním místě.' : kind === 'dmove' ? 'Depo zůstává na původním místě.'
      : kind === 'depot' ? 'Stavba depa zrušena.' : 'Stavba stanice zrušena.');
  }
}

// ---------- jetpack a úspěchy ----------

let lookDir = null;
function jet() {
  lookDir ||= new window.THREE.Vector3();
  if (!running || !tryJet(world.camera.getWorldDirection(lookDir).toArray())) return;
  if (settings.particles) particles.emit(actors.feetPosition(), 14, 0.8);
  addAchStat('jets', 1);
}

// Rekordy skoků a letu vozidlem (volá se každý snímek).
const air = { from: null, high: 0, veh: 0, walk: null };
function trackJumps(dt) {
  const s = game.s;
  const onFoot = s.driving < 0 && !riding() && !isRagdoll();
  const b = activeBody();
  if (onFoot && !b.grounded) {
    if (!air.from) { air.from = b.p.slice(); air.high = 0; }
    air.high = Math.max(air.high, altitude(b));
    recordAchStat('jumpHigh', air.high);
  } else if (air.from) {
    if (onFoot) recordAchStat('jumpLen', angleBetween(air.from, b.p) * MOON.radius);
    air.from = null;
  }
  const plane = s.driving >= 0 && isAirType(s.vehicles[s.driving]?.type);            // let letounem není skok vozidlem (3.1)
  if (s.driving >= 0 && !plane && !b.grounded) { air.veh += dt; recordAchStat('vehAir', air.veh); } else air.veh = 0;
  // ušlá vzdálenost pěšky (bez skoků přes půl Měsíce po srážce, bez přepravníku)
  if (onFoot && air.walk) {
    const d = angleBetween(air.walk, s.p) * MOON.radius;
    if (d < 20) addAchStat('walk', d / 1000);
  }
  air.walk = onFoot ? s.p.slice() : null;
}

// Úspěchy, které se poznají z polohy a pohybu (volá se každý snímek).
function checkAchievements() {
  const s = game.s;
  if (currentAltitude() >= 150) unlock('orbit');
  if (s.driving >= 0 && !isAirType(s.vehicles[s.driving]?.type) && Math.abs(currentVehicleSpeed()) >= 30) unlock('speed');
  if (angleBetween(s.p, BASE.dir) > Math.PI * 170 / 180) unlock('darkside');
  if (net.mode === 'off') return;
  if (s.driving >= 0 && s.vehicles[s.driving]?.type === 'crew' && passengersOf(s.driving).length >= 2) unlock('bus');
  for (const r of net.remotes.values()) {                    // kolega právě odletěl po srážce s mým vozidlem
    const hit = !!r.rag && !r.wasRag;
    r.wasRag = !!r.rag;
    if (hit && s.driving >= 0 && r.sp && angleBetween(r.sp, s.p) * MOON.radius < 12) {
      unlock('roadkill');
      addAchStat('hits', 1);
    }
  }
}
function checkSharedAchievements() {
  if ((game.s.market | 0) >= MARKET.max) unlock('wallstreet');
}

// ---------- svět bez hostitele (cloud.js) ----------

// Hostitel odešel: svět převezme hráč s nejnižším označením (všichni vidí stejný seznam, takže se shodnou
// bez domlouvání). Ten načte svět z cloudu a hostuje; ostatní se za chvíli připojí znovu přes odkaz.
function hostLeft() {
  const code = net.code;
  const peers = [net.me, ...[...net.remotes.keys()].filter(p => p !== net.hostPeer)].filter(Boolean).sort();
  try { history.replaceState(null, '', `#${code}`); } catch { /* nic */ }
  if (peers[0] === net.me) {
    toast('Hostitel odešel – svět teď hostuješ ty (načítám ho z cloudu)…', 6000);
    // moje mapa (snímek + tahy všech) je novější než ta v cloudu → uložit na předávku, po načtení se sloučí (F-10)
    const stash = stashHandoff(code);
    setTimeout(async () => {
      await stash;
      try { sessionStorage.setItem(BOOT_KEY, JSON.stringify({ mode: 'host', cloud: code, planet: PLANET.id, public: game.s.netPublic !== false })); } catch { /* nic */ }
      lockSaves();
      location.reload();
    }, 2500);
  } else {
    toast('Hostitel odešel – svět přebírá jiný hráč, za chvíli tě připojím zpátky…', 8000);
    setTimeout(() => { lockSaves(); location.reload(); }, 9000);
  }
}

// Hostitel: nastavit / zrušit heslo světa (menu pauzy).
async function worldPassword(pw) {
  if (net.mode !== 'host') return false;
  const uids = [...net.remotes.keys()].map(p => String(p).split('_')[0]);   // kdo je ve světě, zůstane
  const ok = await setWorldPassword(net.code, pw, uids);
  if (ok) {
    setWorldLocked(!!pw);
    toast(pw ? 'Svět má heslo. Kdo je teď ve světě, může hrát dál; ostatní ho zadají při připojení.' : 'Heslo zrušené – připojit se může kdokoli s kódem.', 7000);
  } else toast('Heslo se nepodařilo uložit (jsou ve Firebase nová pravidla databáze?).', 7000);
  return ok;
}

// ---------- odlet raketou (a z Měsíce na Mars) ----------

// Kdo stiskne E u rakety: na Marsu jen start domů a úspěch; na Měsíci odletí celý svět na Mars.
// Klient o odlet požádá hostitele, odletovou scénu pak spustí stav od hostitele (net.onDepart).
function liftoff() {
  if (PLANET.id !== 'moon') {
    if (launchRocket()) { unlock('marsdone'); cutscene.start(false); }
    return;
  }
  if (net.mode === 'client') {
    request('depart', [], 0).then(ok => { if (!ok) toast('Hostitel teď odlet nepovolil.'); });
    return;
  }
  depart('mars');
}

// Hostitel / hráč sám: odletová scéna, pak uložení světa na nové planetě a znovunačtení stránky.
function depart(planet) {
  if (game.s.go) return false;
  game.s.go = planet;                                       // klienti to uvidí v H.go
  launchRocket();
  unlock('liftoff');
  cutscene.start(true, async () => {
    const old = game.s;
    newGame(old.title);
    const s = game.s;
    s.planet = planet;
    s.netCode = old.netCode;
    s.netPublic = old.netPublic;
    s.arrived = 1;
    s.history = [...(Array.isArray(old.history) ? old.history : []), { planet: old.planet || 'moon', playMs: old.playMs || 0, money: Math.round(old.money), at: Date.now() }];
    lockSaves();
    if (game.slot) await saveFresh(game.slot, s);
    if (net.mode === 'host') await resetCloudMap(net.code);   // svět v cloudu taky na novou planetu
    const boot = game.slot
      ? { mode: net.mode === 'host' ? 'host' : 'sp', slot: game.slot, action: 'load', public: s.netPublic !== false }
      : { mode: 'host', cloud: net.code, planet, public: s.netPublic !== false };
    switchPlanet(planet, boot);
  });
  return true;
}

// Přepne planetu: zapamatuje si ji v sessionStorage a načte stránku znovu (boot = co spustit potom;
// klient se vrátí přes odkaz …#kód).
function switchPlanet(planet, boot) {
  lockSaves();
  try {
    sessionStorage.setItem(PLANET_KEY, planet);
    if (boot) sessionStorage.setItem(BOOT_KEY, JSON.stringify(boot));
  } catch { /* nic */ }
  if (!boot && net.code) { try { history.replaceState(null, '', `#${net.code}`); } catch { /* nic */ } }
  location.reload();
}

// Odletová scéna: kamera u rampy sleduje raketu, odpočet, start a (při odletu na Mars) prolnutí do tmy.
const cutscene = {
  active: false, t0: 0, travel: false, done: null, eye: null, look: null, up: null,
  start(travel, done = null) {
    if (this.active) return;
    const T = window.THREE;
    this.active = true;
    this.travel = travel;
    this.done = done;
    this.t0 = performance.now();
    this.look = new T.Vector3();
    this.up = actors.rocketSite.clone().normalize();
    // kamera 70 m od rampy směrem k hráči, 14 m nad terénem
    const side = new T.Vector3(...game.s.p).multiplyScalar(MOON.radius).sub(actors.rocketSite);
    side.addScaledVector(this.up, -side.dot(this.up));
    if (side.lengthSq() < 1) side.set(1, 0, 0).addScaledVector(this.up, -this.up.x);
    side.normalize();
    this.eye = actors.rocketSite.clone().addScaledVector(side, 70).addScaledVector(this.up, 14);
    input.enabled = false;
    input.release();
    if (map.active) toggleMap(false);
    document.getElementById('cutscene').hidden = false;
    document.getElementById('cutscene').classList.remove('cutscene--dark');
    document.body.classList.add('cutscene-on');
    // konec podle hodin, ne podle snímků (skrytá karta hostitele snímky nekreslí, ale odletět musí)
    const cd = ROCKET.countdown;
    if (travel) setTimeout(() => document.getElementById('cutscene').classList.add('cutscene--dark'), (cd + 6) * 1000);
    setTimeout(() => this.finish(), (travel ? cd + 9.5 : cd + 8) * 1000);
  },
  finish() {
    if (this.done) { const fn = this.done; this.done = null; fn(); return; }
    if (this.travel) return;
    this.active = false;
    document.getElementById('cutscene').hidden = true;
    document.body.classList.remove('cutscene-on');
    input.enabled = !modalOpen() && !chatOpen();
  },
  // vrací true, když scéna řídí kameru
  update() {
    if (!this.active) return false;
    const t = (performance.now() - this.t0) / 1000;
    const text = document.getElementById('cutscene-text');
    const cd = ROCKET.countdown;
    text.textContent = t < cd ? `${Math.ceil(cd - t)}…` : t < cd + 2.5 ? 'Start! 🚀'
      : this.travel ? (t < cd + 6.5 ? 'Sbohem, Měsíci. Byl jsi krásně čistý.' : 'Kurz: Mars 🔴 · nový úklid začíná od nuly')
        : 'Kurz: Země 🌍 · Mars je uklizený!';
    actors.rocketPosition(this.look);
    world.camera.position.copy(this.eye);
    world.camera.up.copy(this.up);
    world.camera.lookAt(this.look);
    return true;
  },
};

// Postup na novou hodnost: hláška u mě a v multiplayeru zpráva do chatu všem (jako úspěch).
// Poprvé (profil bez hodnosti, např. hráč z dřívější verze) se hodnost jen uloží – bez oznámení.
function checkRank() {
  const i = myRank();
  if (!Number.isInteger(profile.rank)) { profile.rank = i; saveProfile(); return; }
  if (i <= profile.rank) return;
  profile.rank = i;
  saveProfile();
  toast(`🎖 Nová hodnost: ${RANKS[i].name}!`, 6000);
  if (net.mode !== 'off') { sendChat(`🎖 postoupil(a) na hodnost „${RANKS[i].name}“`); refreshLobbyRank(); }
}

function onAchievement(a) {
  showAchievement(a);
  if (net.mode !== 'off') sendChat(`🏆 získal(a) úspěch „${a.name}“`);
}

// × v políčku hotbaru: nástroj nebo kladivo se zničí, stavební sada se zahodí (hotbar.js dropSlot).
function dropFromHotbar(k) {
  const e = dropSlot(k);
  if (e == null) return;
  if (!hammerActive()) closeAll();
  promptTimer = 0;
  updateHotbar();
  toast(e === HAMMER_ID ? 'Kladivo je zničené. Nové koupíš v Dílně (záložka Astronaut).'
    : typeof e === 'string' ? `${toolById(e)?.name || 'Nástroj'} je zničený. Znovu ho koupíš v Obchodě.`
    : 'Stavební sada je pryč z hotbaru.', 5000);
}

// ---------- světla: čelovka a světlomety ----------

let lightsOff = false;                                     // klávesa L
const darkness = elev => Math.min(1, Math.max(0, (4 - elev) / 10));
let spotSrc = null;

function toggleLights() {
  lightsOff = !lightsOff;
  net.lightsOff = lightsOff;
  toast(lightsOff ? 'Světla vypnutá (L = zapnout).' : 'Světla zapnutá – v noci svítí čelovka a světlomety samy.', 3000);
}

// Zdroje reflektorů podle důležitosti: moje světlo, pak nejbližší ostatní hráči (čelovka / světlomety).
function collectSpots(dark, t) {
  const T = window.THREE;
  spotSrc ||= Array.from({ length: SPOTS + 6 }, () => ({ type: 'lamp', pos: new T.Vector3(), dir: new T.Vector3(), up: new T.Vector3(), k: 0, d: 0 }));
  const s = game.s;
  let n = 0;
  const flat = src => { src.dir.addScaledVector(src.up, -src.dir.dot(src.up)).normalize(); };
  // zdroj ze světlometů vozidla i, nebo z čelovky (lamp(pos, dir) → false = žádné světlo)
  const fill = (src, vehicle, lamp) => {
    if (vehicle >= 0 && actors.vehicleHeadlight(vehicle, src.pos, src.dir)) { src.type = 'car'; return true; }
    if (!lamp(src.pos, src.dir)) return false;
    src.type = 'lamp';
    flat(src);
    return true;
  };
  const me = spotSrc[n++];
  me.up.set(s.p[0], s.p[1], s.p[2]);
  me.k = lightsOff || isRagdoll() || riding() ? 0 : dark;
  if (me.k > 0 && !fill(me, s.driving, (pos, dir) => { actors.lampPosition(pos); actors.lampDirection(dir); return true; })) me.k = 0;
  const others = [];
  if (net.mode !== 'off' && remotes) {
    for (const r of net.remotes.values()) {
      if (!r.sp || r.lo || r.rd || n >= spotSrc.length) continue;
      const src = spotSrc[n];
      src.up.set(r.sp[0], r.sp[1], r.sp[2]);
      src.k = darkness(sunElevationDeg(r.sp, t));
      if (src.k <= 0.01 || !fill(src, r.d, (pos, dir) => remotes.lampOf(r.peer, pos, dir))) continue;
      src.d = src.pos.distanceToSquared(world.camera.position);
      others.push(src);
      n++;
    }
    others.sort((a, b) => a.d - b.d);
  }
  return [me, ...others.slice(0, SPOTS - 1)];
}

// Ostatní hráči pro mapu (M): poloha a barva skafandru.
function mapOthers() {
  if (net.mode === 'off') return [];
  const out = [];
  for (const r of net.remotes.values()) if (r.sp) out.push({ p: r.sp, color: SUIT_COLORS[r.look?.color]?.hex ?? 0xeceae3 });
  return out;
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

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - prev) / 1000, 0.25);
  prev = now;
  debug?.frameStart(performance.now());
  const s = game.s;
  const eq = activeEquipment();
  const paused = pause.isOpen && net.mode === 'sp';             // sám hráč může hru pozastavit

  syncTerrainPatches();                                     // srovnaný terén pod stavbami (jen když se stavby změnily)
  if (!paused) {
    const turn = input.turn();
    const turnRate = s.driving >= 0 ? (eq.base.kind === 'push' ? 2.0 : 1.4) : 2.2;
    if (turn && !isRagdoll()) rotateHeading(turn * dt * turnRate);
    if (input.jump) tryJump();
    // 11. 11.: posun času klávesou T zrušen (přání hráče) – s.warp zůstává jen kvůli starým uložením (posun se drží)

    const ride = riding();
    if (ride) {                                             // cestující jede s přepravníkem
      const o = s.vehicles[ride.i] ? (net.mode !== 'off' ? vehicleOverride(ride.i) : null) : null;
      if (!s.vehicles[ride.i]) leaveRide();
      else if (o) followRide(o.p, o.r);
      else { const b = vehicleBody(ride.i); followRide(b.p, b.r); }
    }
    input.tick(dt);                                         // podržené tlačítko: cíl podle kurzoru i bez pohybu myši (F-01)
    movePlayer(input, dt);
    { const n = takeAutopilotNote(); if (n) toast(n, 6000); }
    if (playerFx.landed) {
      if (settings.particles) particles.emit(actors.feetPosition(), Math.min(30, 8 + playerFx.landed * 6), 1.0);
      playerFx.landed = 0;
    }
    // srážka s vozidlem jiného hráče → ragdoll
    if (net.mode !== 'off' && checkVehicleHits(movingVehicles(actors.vehicleRadius), actors.ragdollPose)) {
      toast(`Srazilo tě vozidlo! Letíš ${PLANET.id === 'moon' ? 'měsíční' : 'marťanskou'} gravitací…`, 4000);
      unlock('bowling');
      addAchStat('knocked', 1);
    }
    checkAchievements();
    trackJumps(dt);
    updatePlacing();
    {
      const cur = hammerActive() && bld.mode && input.cursor && input.pick ? input.pick(input.cursor.x, input.cursor.y) : null;
      const pickMode = hammerActive() && (bld.mode === 'demolish' || bld.mode === 'cable') && input.cursor;
      const picked = pickMode ? actors.pickStructure(input.cursor.x, input.cursor.y, world.camera, canvas) : undefined;
      const pickedCable = pickMode && bld.mode === 'demolish' && !picked ? actors.pickCable(input.cursor.x, input.cursor.y, world.camera, canvas) : null;
      const res = updateBuild(dt, cur, input.keys, picked, pickedCable);
      if (res) handleResult(res);
    }
    workAcc += dt * 1000;
    while (workAcc >= TICK_MS) {
      work(TICK_MS / 1000);
      workAcc -= TICK_MS;
    }
    if (net.mode !== 'client') dronesTick(dt); else predictTick(dt);   // lety dronů s bateriemi (3.1) – plynule každý snímek
    droneNotes();
    scanTick();
  }
  if (net.mode !== 'off') {
    setRagdollPresence(ragdollNet());
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
  // tma = Slunce pod obzorem nebo stín kopce → čelovka a světlomety (scene/lights.js)
  const dark = Math.max(darkness(elev), (1 - sunHere) * 0.9);
  actors.setLamp(dark);
  actors.setBaseDark(darkness(sunElevationDeg(BASE.dir, t)));
  spots.update(collectSpots(dark, t));
  terrain.setLighting({
    ...light,
    lampPos: actors.lampPosition(lampPos),
    lampIntensity: lightsOff || s.driving >= 0 ? 0 : dark * 0.35,
    shadow: world.shadowInfo(),
    spots: spots.uniforms,
    spotShadow: spots.shadowInfo(),
  });

  terrain.updateDust();
  terrain.setFocus(focus);
  terrain.updateVisibility(world.camera.position);
  actors.update(rdt, now / 1000, playerFx, 45 + cam.distance * 2.5);
  rocks3d.update(focus);
  { const rn = takeRockNote(); if (rn) toast(rn, 4000); }
  { if (s.driving >= 0) swapArmHint(s.vehicles[s.driving]); const an = takeArmNote(); if (an) toast(an, 4000); }   // Prachocuc: rameno narazilo / výměník s rameny dole
  updateBuildUi();
  placeHoldRing(input.cursor);
  updateStructLabel(rdt);
  {
    const drv = s.driving >= 0 ? eq.base : null;
    const fr = Math.max(0, drv?.front || 0);                  // Prachocuc má záběr za sebou → značka se měří od středu
    const nose = drv ? [s.p[0] + s.f[0] * fr / MOON.radius, s.p[1] + s.f[1] * fr / MOON.radius, s.p[2] + s.f[2] * fr / MOON.radius] : null;
    actors.updateMarker(rdt, map.active ? null : input.target, drv ? { radius: actors.vehicleRadius(s.driving), nose } : null, input.miss, input.clicks);
  }
  if (remotes) remotes.update(rdt, now / 1000, map.active);
  particles.update(rdt);
  cam.setBaseDistance(s.driving >= 0 ? eq.base.camera : isRagdoll() || riding() ? 16 : CAMERA.distance);
  cam.update(rdt, actors.focusPosition(), s.p, s.f);
  const director = cutscene.update();
  const navTo = navTarget();                                    // pod 20 % baterie šipka k nabíječce
  compass.update(s.p, !director && !map.active && (!!navTo || angleBetween(s.p, BASE.dir) * MOON.radius >= BASE.clean), now / 1000, rdt, navTo || BASE.dir);
  actors.fadeOccluders(world.camera.position, actors.focusPosition());
  if (map.active) map.setTarget(input.target);
  map.update(rdt, focus, map.active ? mapOthers() : undefined);
  debug?.beforeRender();
  world.renderer.render(world.scene, world.camera);
  debug?.afterRender();
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
  if (next.shadows !== before.shadows || next.lightShadows !== before.lightShadows) {
    spots.setShadows(next.shadows && next.lightShadows);
    world.setShadows(next.shadows);                         // přepočítá materiály
    actors.setShadows(next.shadows);
  }
  fpsEl.hidden = !next.showFps;
  perf.samples = [];
}

// ---------- pohledy (M): třetí osoba → ptačí pohled → celá planeta → zpátky ----------

function cycleView() {
  if (map.active) { toggleMap(false); return; }               // z planety zpátky za hráče
  if (!cam.bird) {
    cam.setBird(true);
    toast('Ptačí pohled – postavu ovládáš dál. M = celá planeta, kolečko = výška.', 4000);
    return;
  }
  toggleMap(true);
}

// ---------- mapa celého Měsíce (M) ----------

const settingsOpen = () => !document.getElementById('settings').hidden;
const modalOpen = () => facilityOpen() || settingsOpen() || pause?.isOpen;
const mapButton = () => document.getElementById('map-toggle');

function toggleMap(on = !map.active) {
  if (on === map.active || (on && modalOpen())) return;
  if (on) {
    input.enabled = false;
    input.release();
    input.target = null;
    terrain.setHidden(true);
    map.open(game.s.p, game.s.f);
    toast(`Mapa ${PLANET.gen}: WSAD / šipky nebo tažení myší = otáčení, kolečko / Q / E = přiblížení, klik = jdi tam, M = zpět za hráče, Esc = zavřít.`, 7000);
  } else {
    map.close();
    terrain.setHidden(false);
    input.enabled = true;
    cam.setBird(false);                                       // po mapě zpátky do pohledu třetí osoby
  }
  mapButton().setAttribute('aria-pressed', String(on));
  mapButton().classList.toggle('controls__button--active', on);
}

// Klik do mapy: astronaut (nebo vozidlo, ve kterém sedíš) vyrazí na vybrané místo.
function goTo(d) {
  if (!d || isRagdoll()) return;
  input.target = d;
  map.setTarget(d);
  toast(game.s.driving >= 0
    ? 'Vozidlo jede k vybranému místu. W/S nebo klik ve hře cíl zruší.'
    : 'Astronaut jde k vybranému místu. W/S nebo klik ve hře cíl zruší.', 5000);
}

// ---------- ukládání a menu ----------

const canSave = () => net.mode !== 'client' && !!game.slot;

async function saveNow(slot) {
  if (net.mode === 'client') { savePersonal(); return true; }
  if (net.mode === 'host') saveWorldNow(true);
  if (!slot) { toast('Svět uložený do cloudu.', 2500); return true; }
  const ok = await saveGame(slot, toast);
  if (ok) toast(slot && slot !== game.slot ? 'Uloženo.' : `Uloženo do slotu ${String(game.slot).replace('slot', '')}.`, 2500);
  return ok;
}

async function toMenu() {
  savePersonal();
  if (net.mode !== 'client') await saveGame(game.slot);
  if (net.mode === 'host') {
    showLoading('Ukládám svět do cloudu…');
    await saveWorldNow(true);
    await releaseHost(net.code);
  }
  try { sessionStorage.removeItem(BOOT_KEY); history.replaceState(null, '', location.pathname); } catch { /* nic */ }
  location.reload();
}

function loadFrom(slot) {
  try { sessionStorage.setItem(BOOT_KEY, JSON.stringify({ mode: 'sp', slot, action: 'load' })); } catch { /* nic */ }
  location.reload();
}

// L-71 (3.1): vylepšení Síla u nástrojů zrušeno. Koupené úrovně se vrátí v penězích – jednou: úrovně se po vrácení
// smažou (ve slotu / cloudu u hostitele, v osobní části klienta). Klient o vrácení požádá hostitele (peníze jsou
// společné); dokud hostitel nepotvrdí, úrovně zůstanou a zkusí se to při dalším připojení.
function refundToolPower(client) {
  const back = powerRefund(game.s.tools);
  if (back <= 0) { stripPower(game.s.tools); return; }
  const done = () => {
    stripPower(game.s.tools);
    setTimeout(() => toast(`Vylepšení Síla u nástrojů bylo zrušeno, vráceno $${Math.round(back).toLocaleString('cs-CZ')}.`, 9000), client ? 0 : 3000);
  };
  if (!client) { game.s.money += back; done(); return; }
  request('refund31', [back], 0).then(ok => {
    if (!ok) { console.warn('[3.1] hostitel nepotvrdil vrácení za Sílu – zkusí se při dalším připojení'); return; }
    done();
    savePersonal();
  });
}

// Doplní práci robotů za dobu, kdy hra neběžela (zavřená stránka / skrytá karta).
function catchUp(since) {
  const sec = Math.min((Date.now() - since) / 1000, OFFLINE_CAP_S) | 0;
  if (sec >= 10) {                                         // výzkum běží i offline (L-30)
    const done = researchOffline(sec);
    if (done.length) toast(`Během nepřítomnosti se dokončil výzkum: ${done.map(id => techById(id).name).join(', ')}.`, 7000);
  }
  if (sec < 10 || (!game.s.stations.length && !game.s.drones.length && !(game.s.belts || []).length)) return;
  const earned = simulateOffline(sec) + dronesOffline(sec) + logisticsOffline(sec);
  if (earned >= 1) toast(`Za ${Math.max(1, Math.round(sec / 60))} min tvé nepřítomnosti roboti, drony a pásy vydělali $${fmt(earned)}.`, 6000);
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
  on('map-toggle', () => cycleView());
  on('trophies-open', () => { if (!modalOpen() && !map.active) openFacility('trophies'); });
  on('menu-open', () => pause.open());
  on('chat-open', () => openChat());
  on('players-invite', () => copyInvite(null));
  on('btn-drone', () => { document.getElementById('btn-drone').blur(); orderBattery(); });   // objednat / zrušit baterii dronem (3.1)
  // Esc: zavře to, co je otevřené; když nic, otevře menu pauzy. (Fáze zachycení = stav před zavřením.)
  addEventListener('keydown', e => {
    if (!running || e.repeat) return;
    if (e.key === 'Escape') {
      if (pause.isOpen) { pause.close(); e.stopImmediatePropagation(); return; }
      if (hammerActive() && (bld.menu || bld.mode)) { cancelBuild(); promptTimer = 0; e.stopImmediatePropagation(); return; }   // Esc ruší stavění
      if (performance.now() - bld.cancelledAt < 80) return;                                  // stejný Esc už zrušil stavění
      if (chatOpen() || facilityOpen() || settingsOpen() || map.active || placing.active) return;
      pause.open();
      e.stopImmediatePropagation();
      return;
    }
    if (e.key === 'F3') {                                       // ladicí výpis výkonu (O-01)
      e.preventDefault();
      if (e.shiftKey) debug?.breakdown(); else debug?.toggle();
      return;
    }
    if (e.target.matches?.('input, textarea, select')) return;
    if (e.key === 'Enter' && net.mode !== 'off' && !modalOpen() && !map.active) {
      e.preventDefault();
      input.release();
      openChat();
      return;
    }
    if (e.key.toLowerCase() === 'm' && !modalOpen() && !chatOpen()) cycleView();
    else if (e.key.toLowerCase() === 'u' && !modalOpen() && !chatOpen() && !map.active) openFacility('trophies');
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
      savePersonal();
      if (net.mode !== 'client') saveGame(game.slot, toast);
      if (net.mode === 'host') saveWorldOnHide();             // stav světa (a mapa) do cloudu (kdyby se karta zavřela)
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
  // srovnaný terén pod stavbami ještě před stavbou terénu – jinak by se hned po startu kusy terénu stavěly podruhé (~0,8 s trhání)
  syncTerrainPatches();
  takeTerrainChanges();
  initPlayer();
  world = createWorld(canvas, { antialias: settings.antialias, pixelRatio: settings.scale, shadows: settings.shadows });
  debug = createDebug(world.renderer, world.scene, world.camera);
  window.msDebug = debug;                                     // měření z konzole: msDebug.stats(), msDebug.breakdown()
  terrain = createTerrain(world.scene, world.renderer, settings.view);
  actors = createActors(world.scene, settings.shadows, profile.look, {
    vehicleOverride: i => (net.mode === 'off' ? null : vehicleOverride(i)),
    onDust: (pos, n) => { if (settings.particles) particles?.emit(pos, n, 1.6); },
    camera: world.camera,
  });
  actors.preloadStructures();                                // GLB staveb na pozadí (O-15)
  particles = createParticles(world.scene);
  rocks3d = createRocksView(world.scene, { onDust: (pos, n) => { if (settings.particles) particles?.emit(pos, n, 1.6); } });
  compass = createCompass(world.scene, world.camera);
  spots = createSpots(world.scene);
  spots.setShadows(settings.shadows && settings.lightShadows);
  cam = createFollowCamera(world.camera);
  const pickDir = createPicker(canvas, world.camera);
  map = createMoonMap(world.scene, world.camera, canvas, terrain.texture, { onPick: (x, y) => goTo(pickDir(x, y)) });
  terrain.linkUniforms(map.uniforms);
  // hostitel se připojí k síti až po stavbě scény (net.mode je tu ještě 'off') → podle game.mode, jinak by ostatní neviděl
  if (net.mode !== 'off' || game.mode === 'host') remotes = createRemotes(world.scene, world.camera, actors, document.getElementById('nametag-layer'));
  actors.update(0.016, 0, playerFx, 120);
  cam.update(1, actors.focusPosition(), game.s.p, game.s.f);
  terrain.updateVisibility(world.camera.position, Infinity);

  const pauseInput = () => { input.enabled = false; input.release(); };
  const resumeInput = () => { input.enabled = !map.active && !modalOpen() && !chatOpen(); };

  bindInput(canvas, {
    pickDir,
    rotate: a => cam.orbit(-a),                               // orbit kamery kolem astronauta (směr postavy se nemění)
    tilt: dy => cam.tilt(dy),
    zoom: f => {
      if (map.active) { map.zoom(f); return; }
      if (hammerActive() && bld.mode === 'build' && input.keys.r) { rotateBy((f > 1 ? -1 : 1) * (input.keys.shift ? 15 : 1), !!input.keys.shift); return; }
      const av = game.s.driving >= 0 ? game.s.vehicles[game.s.driving] : null;   // Mula s navijákem: kolečko = délka lana 8–20 m
      if (av?.type === 'mula' && (av.lv?.special | 0) > 0 && carrying()) { av.ropeLen = Math.max(8, Math.min(20, (av.ropeLen || 12) + (f > 1 ? 1 : -1))); toast(`Lano ${av.ropeLen} m`, 1200); return; }
      cam.zoom(f);
    },
    onAction: doAction,
    onCancel: cancel,
    onJump: jet,
    onAlt: () => {
      if (hammerActive()) return;                                // R s kladivem = otáčení stavby
      const up = stationUpgradeNear();                           // R u stanice = vylepšení na MK1 / MK2
      if (up) { settle(up); promptTimer = 0; }
    },
    onSlot: k => { if (selectSlot(k)) { if (!hammerActive()) closeAll(); promptTimer = 0; updateHotbar(); } },
    onDrop: () => { if (hammerActive()) { toggleDemolish(); promptTimer = 0; } },   // nástroj se ničí jen × v políčku hotbaru
    onHammer: () => { const msg = toggleHammer(); promptTimer = 0; if (msg) toast(msg, 4000); updateHotbar(); },
    onBuildMenu: () => { if (!toggleMenu() && !hammerActive()) toast(game.s.hammer ? 'Nejdřív vezmi kladivo do ruky (Q nebo číslo jeho políčka).' : 'Stavět jde kladivem – kup ho v Dílně (záložka Astronaut).', 4000); promptTimer = 0; },
    onLights: toggleLights,
    onBattery: orderBattery,                                   // B = objednat baterii dronem (3.1, L-62)
    onMode: () => {                                            // F = Prachocuc: jízda (ramena nahoře) ↔ sběr (ramena do stran)
      const v = game.s.vehicles[game.s.driving];
      if (!v || !hasArm(v)) return;
      toast(toggleArm(v, activeEquipment().stats.width), 3500);
    },
    onAuto: () => {                                            // C = autocruise → asistent hrany → vypnuto (L-40, L-41)
      if (game.s.driving < 0) return;
      if (isAirType(game.s.vehicles[game.s.driving]?.type)) { toast('Letoun nemá autopilota – klikni do terénu a doletí tam sám.', 4000); return; }
      const msg = toggleAutopilot(Math.abs(currentVehicleSpeed()) / Math.max(0.1, activeEquipment().stats.speed));
      if (msg) toast(msg, 6000);
    },
  });
  // autopilot: ostatní vozidla a hráči jako překážky (řízené jiným hráčem / chodící = pohyblivé)
  setAutopilotMovers(() => {
    const out = [];
    game.s.vehicles.forEach((v, i) => {
      if (i === game.s.driving) return;
      const o = net.mode !== 'off' ? vehicleOverride(i) : null;
      out.push({ p: o ? o.p : v.p, dyn: !!o });
      if (hasArm(v)) out.push({ p: trailerPoint(v, o ? o.p : v.p, o?.f || v.f), dyn: !!o });      // přívěs Prachocucu je taky překážka
    });
    for (const r of net.remotes.values()) if (r.d < 0 && r.sp && !r.rd) out.push({ p: r.sp, dyn: true });
    return out;
  });
  // klik ve stavebním režimu: levé = postavit / držet pro zboření, pravé = zrušit hologram
  input.capture = e => {
    if (!hammerActive()) return false;
    if (!bld.mode) {                                          // kladivo v ruce: klik na kotvu = ruční kabel (D-13)
      if (e.button !== 0) return false;
      const id = actors.pickStructure(e.clientX, e.clientY, world.camera, canvas);
      if (id && structById(id)?.type === 'pole' && startCable(id)) { promptTimer = 0; return true; }
      return false;
    }
    if (e.button === 2) { if (bld.mode === 'build' || bld.mode === 'cable' || bld.mode === 'belt') { cancelBuild(); promptTimer = 0; return true; } return false; }
    if (e.button !== 0) return false;
    if (bld.mode === 'build') handleResult(placeNow());
    else if (bld.mode === 'cable') handleResult(connectNow());
    else if (bld.mode === 'belt') { handleResult(beltClick()); promptTimer = 0; }
    else bld.mouseHold = true;
    return true;
  };
  input.onRelease = () => { bld.mouseHold = false; };
  const thumbs = createThumbs(world.renderer);
  initBuildUi(thumbs);
  const wardrobe = createWardrobe(thumbs);
  initHotbar(thumbs, k => { if (selectSlot(k)) { promptTimer = 0; updateHotbar(); } }, dropFromHotbar);
  initAchievements(onAchievement);
  initFacility(thumbs, {
    onOpen: pauseInput,
    onClose: resumeInput,
    onChange: () => { flashMoney(); updateUi(); },
    onDenied: () => toast('Hostitel nákup neschválil (nejspíš došly společné peníze).'),
    onPlaceStation: (mk = 0) => {
      startPlacing('station', mk);
      toast(`Stanice je v hotbaru. Vyber místo mimo základnu: robot uklidí hexy do vzdálenosti ${mk >= 2 ? 3 : 2} od stanice. E = postavit (zaplatí se až teď), Esc = zrušit.`, 8000);
    },
    onLook: look => actors.setLook(look),
    wardrobe,
    holo: createHoloView(),
    headThumb: id => wardrobe.headThumb(id),
    skinThumb: id => wardrobe.skinThumb(id),
  });
  pause = initPause({
    canSave, canLoad: () => net.mode === 'sp',
    canSaveAs: () => net.mode !== 'client',
    password: { available: () => net.mode === 'host' && !!net.fb, locked: worldLocked, set: worldPassword },
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
      if (net.mode === 'host') return `Hostuješ svět ${net.code} · hráčů ${1 + net.remotes.size}. Svět se ukládá ${game.slot ? 'do tvého slotu a ' : ''}do cloudu – hrát se dá i bez tebe.`;
      if (net.mode === 'client') return `Hraješ ve světě ${net.code}. Svět ukládá hostitel, tvé vybavení zůstává v tomto prohlížeči.`;
      return game.slot ? `Hraješ ve slotu ${game.slot.replace('slot', '')} · hra se ukládá každých 30 s.` : '';
    },
  });
  initChat({ send: sendChat, onOpen: pauseInput, onClose: resumeInput });
  bindButtons();
  bindVisibility();
  document.querySelector('.hud').addEventListener('click', e => e.target.closest('button')?.blur());
  updateUi();
  updateHotbar();
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
  // Hra z jiné planety (nebo nová hra na Měsíci, když stránka běží s Marsem) → znovu načíst s ní
  const want = spec.mode === 'client' ? (spec.world?.planet || 'moon') : spec.cloud ? (spec.planet || 'moon')
    : spec.action === 'load' ? (await savePlanet(spec.slot)) || 'moon' : 'moon';
  if (want !== PLANET.id) {
    showLoading(`Přelétám ${want === 'mars' ? 'na Mars' : 'na Měsíc'}…`);
    if (spec.mode === 'client') { try { history.replaceState(null, '', `#${spec.world.code}`); } catch { /* nic */ } }
    switchPlanet(want, spec.mode === 'client' ? null : spec);
    return;
  }
  showLoading(`Připravuji ${PLANET.acc}…`);
  await moonReady;
  let fresh = false;
  game.mode = spec.mode;

  if (spec.mode === 'client') {
    showLoading('Připojuji se ke světu…');
    if (!(await initLobby())) { launchError('Multiplayer tu nejde připojit.'); return; }
    const err = await joinWorld(spec.world, showLoading);
    if (err && err !== 'nomap') { launchError(err); return; }
    try { history.replaceState(null, '', `#${spec.world.code}`); } catch { /* nic */ }
    if (err === 'nomap') setTimeout(() => toast('Mapu od hostitele se zatím nepodařilo stáhnout – zkouším to dál, vyčištěná místa se doplní.', 8000), 1500);
    game.slot = null;
  } else if (spec.cloud) {
    // svět z cloudu: hostitel teď není online, hostovat ho budu já
    showLoading('Načítám svět z cloudu…');
    if (!(await initLobby())) { launchError('Multiplayer tu nejde připojit.'); return; }
    const cm = await cloudMeta(spec.cloud);
    if (cmpVersion(cm?.ver, VERSION) > 0) { launchError(`Svět je uložený ve verzi ${cm.ver} – obnov stránku (Ctrl+F5).`); return; }
    const hadMap = await cloudHasMap(spec.cloud);
    if (!(await loadCloud(spec.cloud))) { launchError('Svět se z cloudu nepodařilo načíst.'); return; }
    if (!loadPersonal(spec.cloud)) resetPersonal(game.s);     // moje vybavení a poloha, ne po předchozím hostiteli
    const cloudDone = hexes.doneCount;
    const handed = await takeHandoff(spec.cloud);             // převzetí hostitele: moje mapa z předchozí hry (F-10)
    logWorldLoad(hadMap ? (handed >= 0 ? 'cloud + předávka od předchozího hostitele (sloučeno)' : 'cloud') : 'nový – v cloudu chybí mapa', `v cloudu ${cloudDone} hexů`);
    if (!hadMap) {
      setTimeout(() => toast(`V cloudu chybí mapa prachu tohoto světa – ${PLANET.name} je zatím zasypaný. Vyčištění se vrátí, až svět otevře původní hostitel ze svého slotu.`, 14000), 2500);
    }
    game.slot = spec.slot || null;
    if (spec.slot) setTimeout(() => toast(`Svět mezitím pokračoval ${PLANET.loc} – načetl jsem ho z cloudu a tvůj slot se teď ukládá s ním.`, 10000), 2500);
    game.s.netPublic = spec.public !== false && game.s.netPublic !== false;
  } else {
    if (spec.action === 'load') {
      showLoading('Načítám uloženou hru…');
      // Sdílený svět ze slotu (hostování i „Hrát sám“) – F-10, 10. 11.: stav světa (peníze, stavby…) se vezme
      // ten s vyšší revizí (slot / cloud), ne podle hodin různých počítačů; mapy prachu se VŽDY sloučí
      // (v každém bodě méně prachu z obou – prach se sám nevrací, takže se nic zameteného nezasype).
      // Když svět právě hostuje někdo jiný, připojíš se k němu (jen při hostování).
      const peek = await peekSave(spec.slot);
      const online = peek?.netCode && (await Promise.race([initLobby(), new Promise(r => setTimeout(() => r(false), 8000))]));
      if (online && spec.mode === 'host') {
        const other = await hostOf(peek.netCode);
        if (other && other.u !== net.uid) {
          const w = findWorld(peek.netCode);
          if (w && !w.compatible) { launchError(`Svět právě hostuje ${other.n || 'jiný hráč'} v jiné verzi hry (${w.ver}) – ${w.newer ? 'obnov stránku (Ctrl+F5)' : 'hostitel musí obnovit stránku'}.`); return; }
          if (w) { launching = false; launch({ mode: 'client', world: w }); return; }
        }
      }
      const meta = online ? await Promise.race([cloudMeta(peek.netCode), new Promise(r => setTimeout(() => r(null), 8000))]) : null;   // Firebase neodpovídá → jen slot
      const cloudPlanet = meta?.pn === 'mars' ? 'mars' : 'moon';
      // revize v cloudu; svět uložený starší verzí (bez revize) – podle času jako dřív
      const cloudRev = !meta ? -1 : Number.isFinite(meta.rv) ? meta.rv : (meta.at > peek.last + 5000 ? Infinity : -1);
      const metaNewerGame = cmpVersion(meta?.ver, VERSION) > 0;    // L-60: cloud uložila novější verze hry → stav z něj nebrat
      const cloudNewer = !metaNewerGame && cloudRev > peek.rev;
      if (metaNewerGame) setTimeout(() => toast(`Svět v cloudu uložila novější verze hry (${meta.ver}) – obnov stránku (Ctrl+F5). Do té doby se do cloudu neukládá.`, 12000), 2500);
      if (meta && spec.mode === 'host' && cloudNewer && cloudPlanet !== PLANET.id) {
        // kamarádi mezitím odletěli na jinou planetu → načíst svět z cloudu na jeho planetě (slot se pak přepíše jím)
        showLoading(`Svět mezitím odletěl ${cloudPlanet === 'mars' ? 'na Mars' : 'na Měsíc'} – načítám ho z cloudu…`);
        switchPlanet(cloudPlanet, { mode: 'host', cloud: peek.netCode, planet: cloudPlanet, slot: spec.slot, public: spec.public !== false });
        return;
      }
      if (!(await loadGame(spec.slot))) { launchError('Uloženou hru se nepodařilo načíst.'); return; }
      let source = 'místní slot';
      const slotDone = hexes.doneCount;
      if (meta && cloudPlanet === PLANET.id) {
        const foreign = !!meta.wu && meta.wu !== net.uid;          // do cloudu naposled zapsal někdo jiný
        const hasMap = await cloudHasMap(peek.netCode);
        if (cloudNewer) {
          const mine = pickPersonal(game.s);
          if (await loadCloud(peek.netCode, { map: hasMap, merge: true })) {
            putPersonal(game.s, mine);                             // moje vybavení a poloha ze slotu
            game.slot = spec.slot;
            source = hasMap ? 'cloud (stav) + slot a cloud (mapa sloučená)' : 'cloud (stav) + místní slot (mapa – v cloudu chybí)';
            if (foreign) setTimeout(() => toast('Kamarádi mezitím hráli bez tebe – načetl jsem novější stav světa z cloudu a vyčištění Měsíce ze slotu i z cloudu spojil.', 10000), 2500);
          } else source = 'místní slot (cloud nejde načíst)';
        } else if (hasMap && (await loadCloud(peek.netCode, { merge: true, state: false }))) {
          source = 'místní slot + cloud (mapa sloučená)';
          if (foreign && Number.isFinite(meta.rv) && meta.rv > peek.crv) {
            // obě větve pokračovaly zvlášť (třeba Hrát sám ve slotu a kamarádi v cloudu)
            setTimeout(() => toast(`Svět mezitím hrál i někdo jiný (revize ${meta.rv}), ty jsi ale hrál dál ve slotu (revize ${peek.rev}). Stav světa (peníze, stavby) je z tvého slotu, vyčištění Měsíce z obou je spojené.`, 14000), 2500);
          }
        }
      }
      logWorldLoad(source, `slot: rev ${peek?.rev ?? 0}, ${slotDone} hexů · cloud: ${meta ? `rev ${meta.rv ?? '– (starší verze)'}, ${meta.d ?? '?'} hexů` : 'není'}`);
    } else {
      if (spec.action === 'v1') importV1(spec.title);
      else newGame(spec.title);
      game.slot = spec.slot;
      fresh = true;
    }
    if (spec.mode === 'host') game.s.netPublic = spec.public !== false;
  }

  if (spec.mode !== 'client') refundToolPower(false);       // L-71: zrušená Síla nástrojů → peníze zpět (sám / hostitel)
  ensureHotbar(game.s);
  // F-10 test „druhý den“ (jen lokálně): …?dnyPosun=1 posune čas posledního uložení o N dní zpět
  if (FIREBASE_DEV && spec.mode !== 'client' && !fresh) {
    const days = Number(new URLSearchParams(location.search).get('dnyPosun'));
    if (days > 0) { game.s.last = (game.s.last || Date.now()) - days * 86400000; console.info(`[svět] test: čas posledního uložení posunut o ${days} d zpět`); }
  }
  const loadedLast = game.s.last;
  showLoading('Stavím scénu…');
  await new Promise(r => setTimeout(r, 30));
  build();
  hideMenu();
  game.started = Date.now();
  running = true;

  if (spec.mode === 'host') {
    // pojistka (ještě před prvním uložením): novější svět v cloudu na jiné planetě se nepřepíše
    if (game.s.netCode && (await initLobby())) {
      const before = await cloudMeta(game.s.netCode);
      if (before && (before.pn === 'mars' ? 'mars' : 'moon') !== PLANET.id && before.at > (game.s.last || 0) + 5000) {
        blockCloud(true);
        setTimeout(() => toast(`Pozor: svět ${game.s.netCode} je v cloudu novější a ${before.pn === 'mars' ? 'na Marsu' : 'na Měsíci'}. Tahle hra ho nepřepíše – odejdi do menu a otevři svět znovu.`, 15000), 3000);
      }
    }
    const ok = (await initLobby()) && (await startHost());
    if (typeof ok === 'string' && ok.startsWith('taken:')) {
      // svět mezitím otevřel někdo jiný → připojit se k němu jako hráč
      toast(`Svět právě hostuje ${ok.slice(6)} – připojuji tě jako hráče…`, 5000);
      setTimeout(() => { try { history.replaceState(null, '', `#${game.s.netCode}`); } catch { /* nic */ } lockSaves(); location.reload(); }, 2500);
      return;
    }
    if (ok) {
      const meta = await cloudMeta(net.code);
      setWorldLocked(!!meta?.lk);
      try { history.replaceState(null, '', `#${net.code}`); } catch { /* nic */ }
      toast(`Svět je otevřený, kód ${net.code}. Odkaz pro kamarády zkopíruješ tlačítkem Pozvat vpravo nahoře.`, 9000);
    }
    else { net.mode = 'off'; game.mode = 'sp'; toast('Svět se nepodařilo otevřít ostatním – hraješ sám.', 6000); }
  }
  net.onCloud = text => toast(text, 9000);                    // F-10: chyba / obnova zápisu světa do cloudu
  net.onResearchDone = ids => ids.forEach(researchFinished);   // klient: hostitel dokončil výzkum
  net.onMapLoaded = () => toast('Mapa prachu od hostitele je načtená – vyčištěná místa jsou zpět.', 6000);
  net.onDepartRequest = () => (PLANET.id === 'moon' && hexes.total > 0 && hexes.doneCount >= hexes.total ? depart('mars') : false);
  net.onDepart = planet => {                                  // klient: hostitel odlétá s celým světem
    if (PLANET.id === planet) return;
    savePersonal();
    unlock('liftoff');
    launchRocket();
    cutscene.start(true, () => {
      // hostitel potřebuje chvilku na start světa na nové planetě
      showLoading(`Přistáváme ${planet === 'mars' ? 'na Marsu' : 'na Měsíci'}… čekám na hostitele`);
      setTimeout(() => switchPlanet(planet, null), 6000);
    });
  };
  if (net.mode !== 'off') {
    showChat(true);
    net.onChat = addMessage;
    net.onKicked = () => {                                   // svět dostal nové heslo → zadat ho znovu v lobby
      savePersonal();
      toast('Svět má nové heslo – vracím tě do lobby, kde ho zadáš.', 6000);
      setTimeout(() => { lockSaves(); location.reload(); }, 3500);
    };
    net.onHostLeft = () => {
      if (cutscene.active) return;                          // hostitel odlétá na jinou planetu – letíme s ním
      savePersonal();
      hostLeft();
    };
    addMessage({ system: true, text: 'Chat: Enter = napsat zprávu, Esc = zavřít.' });
  }

  if (game.s.arrived) {
    delete game.s.arrived;
    await saveGame(game.slot, toast);
    toast('Přistáli jste na Marsu! Je 4× větší než Měsíc, gravitace táhne víc a prach je rezavý. Začínáte od nuly – hodně štěstí.', 12000);
  } else if (fresh) {
    await saveGame(game.slot, toast);
    toast(spec.action === 'v1'
      ? 'Vybavení a peníze z verze 1 jsou převedené. Vítej na větším Měsíci!'
      : `Vítej ${PLANET.loc}! Zametej zubním kartáčkem a prach odnes do Výkupu uprostřed základny.`, 8000);
  } else if (spec.mode !== 'client') {
    catchUp(loadedLast);                                     // od času v načteném stavu (F-10 – první zápis do cloudu ho mezitím přepíše)
  }

  setInterval(() => {
    updateUi();
    updateHotbar();
    refreshFacility();
    updatePlayers(net.mode !== 'off' ? players() : null, net.code);
    backgroundStep();
    checkSharedAchievements();
  }, 250);
  setInterval(() => {
    savePersonal();
    if (net.mode !== 'client') saveGame(game.slot, toast);
  }, 30000);
  addEventListener('beforeunload', () => {
    savePersonal();
    if (net.mode !== 'client') saveGame(game.slot);
    if (net.mode === 'host') saveWorldNow(false, true);       // stav světa do cloudu (hned, stihne-li se odeslat)
  });

  if (spec.mode === 'client') setTimeout(() => refundToolPower(true), 3000);   // L-71: klient – vrácení připíše hostitel
  prev = perf.since = performance.now();
  requestAnimationFrame(frame);
}

async function start() {
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
  initVersionUi({ onNewer: ver => { if (running) toast(`Je dostupná nová verze hry v${ver}. Ulož hru a obnov stránku (Ctrl+F5).`, 12000); } });
  // 3.1 (AST-02): model astronauta musí být načtený dřív, než menu vykreslí postavu, šatnu a lobby (bez něj záložní model)
  await Promise.race([preloadModels(['astronaut']), new Promise(r => setTimeout(r, 6000))]);
  initMenu({ onLaunch: launch, openSettings: () => settingsUi.open() });
  setMoonStatus(`Připravuji ${PLANET.acc}…`, false);
  moonReady = Promise.all([prepareMoon().then(() => initRocks()), preloadModels([...BASE_MODELS, ...ROCK_MODELS])]).then(() => setMoonStatus(`${PLANET.name} připraven · ${hexes.total.toLocaleString('cs-CZ')} sektorů`, true));

  let boot = null;
  try { boot = JSON.parse(sessionStorage.getItem(BOOT_KEY)); sessionStorage.removeItem(BOOT_KEY); } catch { /* nic */ }
  if (boot?.slot || boot?.cloud) launch(boot);
}

start();
