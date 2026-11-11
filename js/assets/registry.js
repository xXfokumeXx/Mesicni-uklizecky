// Registr všech modelů ve hře (A-02). Kód mimo js/assets/ nesahá na cesty k souborům ani na funkce build…():
// model se vytvoří přes instantiate(id) z models.js. Když se některý model v kódu nahradí GLB, změní se jen řádek tady.
//
// GLB:     { src, points?, anchors?, scale?, rotateY?, offset?, instanced?, foundation? }
//   points  = pojmenované body v souřadnicích modelu (dodané modely nemají Empty uzly, viz README v zipech)
//   anchors = místa pro kabel vedení; když chybí, vezmou se z gltf.scene.userData.kotevni_body
// builder: (…args) => { root, … }  – dnešní modely napsané v kódu (vrací svůj „view“ objekt beze změny)
import { VEHICLES } from '../catalog.js';
import { createAstronaut } from '../scene/astronaut.js';
import { buildVehicle } from '../scene/vehicles.js';
import { buildStation, buildSilo } from '../scene/buildings.js';
import { buildBot, buildDrone, buildJetpack, buildBelt, buildRtg } from '../scene/models.js';
import { mergeObject } from '../scene/mergeParts.js';
import { buildToolModel, buildBootsModel, buildHammerModel } from '../scene/toolModels.js';
import { buildBeltPiece, buildBeltNode } from '../scene/beltsView.js';
import { buildAircraft } from '../scene/aircraft.js';
import { buildGroundVehicle } from '../scene/groundVehicle.js';

const M = 'assets/models/';

export const MODELS = {
  // ---------- stavby z GLB (3.0) ----------
  'garage-3': { src: M + 'budova-garaz.glb', foundation: true },
  // pevné budovy základny (D-12): Výkup prachu, Dílna, Obchod s nástroji – přednačítají se se scénou (main.js BASE_MODELS)
  'building-buyback': { src: M + 'budova-vykup-prachu.glb', foundation: true },
  'building-workshop': { src: M + 'budova-dilna.glb', foundation: true },
  'building-toolshop': { src: M + 'budova-obchod-nastroje-maly2.glb', foundation: true },
  'research': { src: M + 'budova-vyzkumne-stredisko.glb', foundation: true },
  'power-pole': { src: M + 'vedeni-kotva.glb', instanced: true, stretchBeams: 6.5 },   // paprsky trysek až ke kruhům na zemi (kotva výš)
  'power-pole-ground': { src: M + 'vedeni-kotva-zem.glb', instanced: true },
  // kameny po planetě (rocks.js, scene/rocksView.js – InstancedMesh na typ), počátek uprostřed spodní plochy
  'rock-s1': { src: M + 'kamen-maly-1.glb', instanced: true },
  'rock-s2': { src: M + 'kamen-maly-2.glb', instanced: true },
  'rock-s3': { src: M + 'kamen-maly-3.glb', instanced: true },
  'rock-m1': { src: M + 'kamen-stredni-1.glb', instanced: true },
  'rock-m2': { src: M + 'kamen-stredni-2.glb', instanced: true },
  'power-plug': { src: M + 'vedeni-pripojka.glb', instanced: true },
  'charger': {
    src: M + 'budova-nabijecka.glb', foundation: true,
    points: {
      slot_1: [-5, 0.5, 2.2], slot_2: [1, 0.5, 2.2],          // místa pro vozidla
      plug_1: [-1.95, 2.0, 1.0], plug_2: [4.15, 2.0, 1.0],    // začátek nabíjecího kabelu (stojany)
    },
    // stojany jako samostatné díly: 2. stojan se ukáže až rozšířením (L-05), 1. se kopíruje pro moduly 3. a 4. slotu
    groups: { stand1: [-2.8, -1.1, 0.25, 4.3, 0.05, 1.95], stand2: [3.3, 5.0, 0.25, 4.3, 0.05, 1.95] },
    hideEffects: [[-2, 3.6, 0.6], [4.1, 3.6, 0.6]],          // oranžové kontrolky stojanů → hra kreslí vlastní podle stavu slotu
  },
  'swapper': {
    src: M + 'budova-vymenik.glb', foundation: true,
    points: {
      bay: [0, 0.5, 0],                                       // vozidlo stojí na středu, jede po ose X
      rack_1: [0, 3.1, -6.4],                                 // volná pozice ve skladu (horní řada uprostřed)
    },
    // kontrolky 4 pozic regálu kreslí hra podle nabití (energyView); ostatní LED modelu jsou ozdoba skladu
    hideEffects: [[-2.6, 1.245, -5.572], [2.6, 1.245, -5.572], [-2.6, 3.445, -5.572], [2.6, 3.445, -5.572]],
    crane: { bridgeY: 6.42, bridgeZ: [0, -6.4], hookTopY: 4.45, hookRackY: 3.82, cableTopY: 5.8, cableX: 0.5, batteryBelowHook: 0.72 },
  },
  'swapper-bridge': { src: M + 'vymenik-most.glb' },
  'swapper-hook': { src: M + 'vymenik-hak.glb' },
  'swap-battery-full': { src: M + 'vymenik-baterie-nabita.glb', instanced: true },
  'swap-battery-empty': { src: M + 'vymenik-baterie-vybita.glb', instanced: true },
  // LAAC (3.1, A-10, D-16): věž (radar = otočný uzel) a plošina pro sousední hex
  'laac': { src: M + 'laac.glb', nodes: ['radar'] },
  'laac-pad': { src: M + 'laac-plocha.glb' },
  // letouny (3.1, A-11, D-17): GLB, ve hře přes builder vehicle-<typ> (scene/aircraft.js). Body: sedadla, trysky, štítky čísla
  'aircraft-prachovka': { src: M + 'letoun-prachovka.glb', nodes: ['zasobnik_hladina'], radius: 2.9,
    points: { seat: [0, 1.72, 0.95], thrusters: [[-1.45, 0.68, 1.15], [1.45, 0.68, 1.15], [-1.45, 0.68, -1.15], [1.45, 0.68, -1.15]], labelL: [-2.61, 1.42, -0.1], labelR: [2.61, 1.42, -0.1], level: [1.62, 2.25], nose: 2.4 } },
  'aircraft-kolibrik': { src: M + 'letoun-kolibrik.glb', nodes: ['skener'], radius: 3.6,
    points: { seat: [0, 1.75, 1.35], seat2: [0, 1.75, -0.05], thrusters: [[-1.45, 0.9, -2], [1.45, 0.9, -2], [0, 0.85, 2.3], [0, 0.85, 0.6]], rear: [[-1.45, 1.7, -3.47], [1.45, 1.7, -3.47]], labelL: [-0.92, 1.62, -1.55], labelR: [0.92, 1.62, -1.55], beam: [0, 2.2, 3.43], nose: 3.5 } },
  'aircraft-mula': { src: M + 'letoun-mula.glb', nodes: ['navijak_buben'], radius: 4.6,
    points: { seat: [0, 3.2, 1.6], thrusters: [[-2.9, 1.78, 2.55], [2.9, 1.78, 2.55], [-2.9, 1.78, -2.55], [2.9, 1.78, -2.55]], labelL: [-2.01, 2.95, -1.4], labelR: [2.01, 2.95, -1.4], winch: [0, 0.9, 0], nose: 3.3 } },
  'aircraft-kondor': { src: M + 'letoun-kondor.glb', nodes: ['poklop', 'naklad_ukazatel', 'ruka_rameno', 'ruka_predlokti', 'ruka_klesti'], radius: 3.9,
    points: { seat: [0, 2.35, 2.55], thrusters: [[-2.45, 1.68, 1.75], [2.45, 1.68, 1.75], [-2.45, 1.68, -2.2], [2.45, 1.68, -2.2]], labelL: [-1.52, 2.95, 1.6], labelR: [1.52, 2.95, 1.6], nose: 3.5 } },
  // dronport a dron s baterií (3.1, A-11, D-14). Skupiny: stavová světla a 2. místo přistání (ukáže se s 2. dronem).
  'dronport': {
    src: M + 'vymenik-dronport.glb',
    groups: { stav1: [-3.45, -2.85, 5.9, 7.0, 3.0, 3.6], stav2: [-3.45, -2.85, 5.9, 7.0, -3.6, -3.0], pad2: [-3.1, 3.1, 6.005, 6.3, -6.7, -0.15] },
    hideEffects: [[-3.15, 6.72, 3.3], [-3.15, 6.72, -3.3]],     // záře stavových světel kreslí hra podle stavu dronu
  },
  'drone-battery': { src: M + 'dron-baterie.glb', points: { hookA: [0, 0.84, 0.9], hookB: [0, 0.84, -0.9], frameA: [0, 0.12, 0.9], frameB: [0, 0.12, -0.9], thrusters: [[-1.75, 0.7, 1.75], [1.75, 0.7, 1.75], [-1.75, 0.7, -1.75], [1.75, 0.7, -1.75]], labelL: [-1.39, 1.24, 0], labelR: [1.39, 1.24, 0] } },
  // pozemní vozidla (07, fáze A): GLB s pohyblivými koly a kartáči, ve hře přes builder vehicle-<typ> (scene/groundVehicle.js).
  // Sedadla, ruce, světla, baterie, závěs… jsou prázdné uzly modelu (inst.empties), rozměry v extras.
  'ground-push': { src: M + 'vozidlo-push.glb', nodes: ['kolo_1', 'kolo_2', 'kolo_3', 'kolo_4', 'kartac_1', 'kartac_2'] },
  'ground-rideon': { src: M + 'vozidlo-rideon.glb', nodes: ['kolo_1', 'kolo_2', 'kolo_3', 'kolo_4', 'kartac_1', 'kartac_2'] },
  'ground-lunar': { src: M + 'vozidlo-lunar.glb', nodes: ['kolo_1', 'kolo_2', 'kolo_3', 'kolo_4', 'kartac_1', 'kartac_2', 'kartac_3', 'kartac_4'] },
  'ground-mega': { src: M + 'vozidlo-mega.glb', nodes: ['kolo_1', 'kolo_2', 'kolo_3', 'kolo_4', 'kolo_5', 'kolo_6', 'saci_hlava'] },
  'ground-crew': { src: M + 'vozidlo-crew.glb', nodes: ['kolo_1', 'kolo_2', 'kolo_3', 'kolo_4'] },
  // Prachocuc (07, fáze D): ramena = řetěz uzlů (rameno_X → _u1 → _u2 → _u3), každý díl má oporu konce (_opora)
  'ground-prachocuc': { src: M + 'vozidlo-prachocuc.glb', nodes: ['kolo_1', 'kolo_2', 'kolo_3', 'kolo_4',
    'rameno_L', 'rameno_L_u1', 'rameno_L_u2', 'rameno_L_u3', 'rameno_P', 'rameno_P_u1', 'rameno_P_u2', 'rameno_P_u3',
    'rameno_L_opora', 'rameno_L_u1_opora', 'rameno_L_u2_opora', 'rameno_L_u3_opora', 'rameno_P_opora', 'rameno_P_u1_opora', 'rameno_P_u2_opora', 'rameno_P_u3_opora'] },
  // přívěsy Prachocucu (07, fáze E): 4 velikosti podle vylepšení Přívěs; hladina = uzel, který se posouvá podle náplně
  'trailer-1': { src: M + 'vozidlo-prachocuc-privez-1.glb', nodes: ['kolo_1', 'kolo_2', 'hladina'] },
  'trailer-2': { src: M + 'vozidlo-prachocuc-privez-2.glb', nodes: ['kolo_1', 'kolo_2', 'kolo_3', 'kolo_4', 'hladina'] },
  'trailer-3': { src: M + 'vozidlo-prachocuc-privez-3.glb', nodes: ['kolo_1', 'kolo_2', 'kolo_3', 'kolo_4', 'hladina'] },
  'trailer-4': { src: M + 'vozidlo-prachocuc-privez-4.glb', nodes: ['kolo_1', 'kolo_2', 'kolo_3', 'kolo_4', 'hladina'] },
  'sinter': { src: M + 'budova-slinovna.glb', foundation: true },
  'battery-t1': { src: M + 'baterie-T1-bedna.glb', instanced: true },
  'battery-t2': { src: M + 'baterie-T2-skrin.glb', instanced: true },
  'battery-t3': { src: M + 'baterie-T3-kontejner.glb', instanced: true },
  'battery-t4': { src: M + 'baterie-T4-trojcata.glb', instanced: true },
  'battery-t5': { src: M + 'baterie-T5-jadro.glb', instanced: true },
  'solar-t1': { src: M + 'solar-T1-zaplata.glb', instanced: true },
  'solar-t2': { src: M + 'solar-T2-kozlik.glb', instanced: true },
  'solar-t3': { src: M + 'solar-T3-sledovac.glb', instanced: true },
  'solar-t4': { src: M + 'solar-T4-slunecnice.glb', instanced: true },
  'solar-t5': { src: M + 'solar-T5-koruna.glb', instanced: true },

  // ---------- postava (3.1, AST-02): GLB převedený na kostru + paletu (character.js); bez něj náhradní kapsle (A-04) ----------
  'astronaut': { src: M + 'astronaut.glb', clips: 'assets/anim/astronaut-klipy.json', character: true, builder: look => createAstronaut(look) },

  // ---------- dnešní modely v kódu ----------
  ...Object.fromEntries(VEHICLES.map(v => [`vehicle-${v.id}`, { builder: () => (v.kind === 'air' ? buildAircraft(v.id) : buildGroundVehicle(v.id)) }])),   // letouny i pozemní vozidla z GLB; bez GLB starý model v kódu
  'station': { builder: ghost => buildStation(ghost) },
  'robot': { builder: () => buildBot() },
  'drone': { builder: () => buildDrone() },
  'silo': { builder: ghost => buildSilo(ghost) },                // depo z v2 (3.0 zatím s původním modelem)
  'jetpack': { builder: () => ({ root: buildJetpack() }) },
  'utility-belt': { builder: lv => ({ root: buildBelt(lv) }) },  // opasek (hotbar)
  'tool': { builder: id => ({ root: buildToolModel(id) }) },
  'boots': { builder: lv => ({ root: buildBootsModel(lv) }) },
  'hammer': { builder: () => ({ root: buildHammerModel() }) },
  'belt-piece': { builder: () => buildBeltPiece() },             // kus pásu (náhled v liště, fáze 3)
  'belt-splitter': { builder: () => buildBeltNode('splitter') },  // rozdělovač pásu (4. 11.)
  'belt-merger': { builder: () => buildBeltNode('merger') },      // spojovač pásů (4. 11.)
  'rtg': { builder: () => { const root = buildRtg(); mergeObject(root); return { root }; } },   // RTG (L-07, model v kódu)   // kladivo (D-07, model v kódu)
};

export const GLB_IDS = Object.keys(MODELS).filter(id => MODELS[id].src);

// Sedadla vozidel pro astronauta (AST-08): body pro ruce [L, P] v souřadnicích vozidla (L = levá ruka postavy = +x),
// ruce se k nim dotáhnou IK dvou kostí. Poloha pánve je view.seat z modelu vozidla (scene/vehicles.js).
// Pozemní vozidla z GLB mají ruce v uzlech ruka_L / ruka_P (view.hands) – čísla tady platí jen pro starý model v kódu a letouny.
// Ruční vozík: madlo. Cestující ruce nedotahují.
export const SEATS = {
  push: { hands: [[0.3, 1.28, -0.92], [-0.3, 1.28, -0.92]] },
  rideon: { hands: [[0.15, 1.5, 0.04], [-0.15, 1.5, 0.04]] },
  lunar: { hands: [[-0.3, 1.6, 1.75], [-0.6, 1.6, 1.75]] },
  mega: { hands: [[0.15, 2.6, -1.1], [-0.15, 2.6, -1.1]] },
  crew: { hands: [[-0.3, 1.4, 1.75], [-0.6, 1.4, 1.75]] },
  prachovka: { hands: [[0.22, 1.95, 1.35], [-0.22, 1.95, 1.35]] },     // řídicí páky před sedadlem (3.1)
  kolibrik: { hands: [[0.2, 1.98, 1.75], [-0.2, 1.98, 1.75]] },
  mula: { hands: [[0.22, 3.45, 2.0], [-0.22, 3.45, 2.0]] },
  kondor: { hands: [[0.22, 2.6, 2.95], [-0.22, 2.6, 2.95]] },
};

// Úchop nástrojů v pravé ruce astronauta (AST-06): len = délka od hlavy nástroje (dole, y = 0) k místu úchopu,
// reach = jak daleko před tělem leží hlava nástroje na zemi (m) – stejně jako bod zametání v player.js (TOOL_AHEAD 0,95).
export const TOOL_GRIPS = {
  toothbrush: { len: 1.05, reach: 0.95 },
  handbrush: { len: 1.05, reach: 0.95 },
  broom: { len: 1.25, reach: 0.95 },
  handvac: { len: 1.05, reach: 0.95 },
  squeegee: { len: 1.35, reach: 0.95 },
};
