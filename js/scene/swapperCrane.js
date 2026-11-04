// Jeřáb výměníku baterií (D-04, A-06): most, hák, dvě lanka a baterie na háku – podle README servisních budov.
// Dodaný model nemá animační klip, proto je pohyb spočítaný v kódu z bodů v registru (crane). Animace běží
// jen během výměny a do 60 m od hráče; v multiplayeru se posílá jen začátek výměny (H.bd), každý si ji přehraje sám.
import { MODELS } from '../assets/registry.js';
import { instantiate } from '../assets/models.js';
import { SWAP, STRUCTURES } from '../structures.js';
import { hostNow } from '../energy.js';
import { game } from '../state.js';

const THREE = window.THREE;
const C = MODELS.swapper.crane;           // { bridgeY, bridgeZ: [nad vozidlem, u skladu], hookTopY, hookRackY, cableTopY, cableX, batteryBelowHook }
const RACK_Z = C.bridgeZ[1];
const cableMat = new THREE.MeshLambertMaterial({ color: 0x2b2b2e });
const cableGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 6).translate(0, -0.5, 0);   // délka 1 dolů od horního konce

// Výška střechy vozidla (m nad podlahou) – z obálky modelu, jednou na typ
const roofCache = new Map();
function roofOf(type) {
  if (!roofCache.has(type)) {
    let h = 1.6;
    try {
      const o = instantiate(`vehicle-${type}`).root;
      const box = new THREE.Box3().setFromObject(o);
      if (isFinite(box.max.y)) h = box.max.y;
    } catch { /* výchozí výška */ }
    roofCache.set(type, h);
  }
  return roofCache.get(type);
}

const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
const seg = (t, a, b) => (t - a) / (b - a);           // 0–1 v úseku [a, b]

export function createSwapperCrane(root) {
  const padTop = STRUCTURES.swapper.padTop;
  const bridge = instantiate('swapper-bridge').root;
  const hook = instantiate('swapper-hook').root;
  const full = instantiate('swap-battery-full').root;
  const empty = instantiate('swap-battery-empty').root;
  const cables = [new THREE.Mesh(cableGeo, cableMat), new THREE.Mesh(cableGeo, cableMat)];
  root.add(bridge, hook, full, empty, ...cables);
  full.visible = empty.visible = false;

  // poloha jeřábu: z (most + hák), hookY, která baterie visí / leží kde
  function pose(z, hookY, carry, onRoof, roofY) {
    bridge.position.set(0, C.bridgeY, z);
    hook.position.set(0, hookY, z);
    cables.forEach((c, k) => {
      c.position.set(k ? C.cableX : -C.cableX, C.cableTopY, z);
      c.scale.y = Math.max(0.05, C.cableTopY - (hookY + 0.18));
    });
    full.visible = empty.visible = false;
    const put = (m, y, zz) => { m.visible = true; m.position.set(0, y, zz); };
    if (carry) put(carry === 'full' ? full : empty, hookY - C.batteryBelowHook, z);
    if (onRoof) put(onRoof === 'full' ? full : empty, roofY, 0);
  }
  pose(RACK_Z, C.hookTopY, null, null, 0);

  let idle = true;
  // b = stavba, near = hráč do 60 m
  function update(b, near) {
    const sw = b.data.swap;
    const t = sw ? (hostNow() - sw.at) / 1000 / SWAP.dur : Infinity;
    if (!sw || !near || t < 0 || t > 1.25) {
      if (!idle) { pose(RACK_Z, C.hookTopY, null, null, 0); idle = true; }
      return;
    }
    idle = false;
    const v = game.s.vehicles[sw.i];
    const roofY = padTop + roofOf(v?.type || 'rideon') - 0.05;     // spodek baterie na střeše vozidla
    const hookCar = roofY + C.batteryBelowHook;                       // hák při uchopení baterie na voze
    const z0 = C.bridgeZ[0], z1 = RACK_Z, top = C.hookTopY, rack = C.hookRackY;
    // 1 most k vozidlu · 2 hák dolů a nahoru s vybitou · 3 do skladu, výměna za nabitou · 4 zpět, usadit, nahoru
    if (t < 0.15) pose(lerp(z1, z0, seg(t, 0, 0.15)), top, null, 'empty', roofY);
    else if (t < 0.25) pose(z0, lerp(top, hookCar, seg(t, 0.15, 0.25)), null, 'empty', roofY);
    else if (t < 0.35) pose(z0, lerp(hookCar, top, seg(t, 0.25, 0.35)), 'empty', null, roofY);
    else if (t < 0.5) pose(lerp(z0, z1, seg(t, 0.35, 0.5)), top, 'empty', null, roofY);
    else if (t < 0.58) pose(z1, lerp(top, rack, seg(t, 0.5, 0.58)), 'empty', null, roofY);
    else if (t < 0.66) pose(z1, lerp(rack, top, seg(t, 0.58, 0.66)), 'full', null, roofY);
    else if (t < 0.81) pose(lerp(z1, z0, seg(t, 0.66, 0.81)), top, 'full', null, roofY);
    else if (t < 0.9) pose(z0, lerp(top, hookCar, seg(t, 0.81, 0.9)), 'full', null, roofY);
    else if (t <= 1) pose(z0, lerp(hookCar, top, seg(t, 0.9, 1)), null, 'full', roofY);
    else pose(lerp(z0, z1, seg(t, 1, 1.25)), top, null, 'full', roofY);   // most se vrací, nabitá leží na voze
  }
  return { update };
}
