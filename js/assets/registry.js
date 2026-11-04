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

  // ---------- dnešní modely v kódu ----------
  'astronaut': { builder: look => createAstronaut(look) },
  ...Object.fromEntries(VEHICLES.map(v => [`vehicle-${v.id}`, { builder: () => buildVehicle(v.id) }])),
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
