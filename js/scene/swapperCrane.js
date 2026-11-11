// Jeřáb výměníku baterií (D-04, A-06): most, hák, dvě lanka a baterie na háku – podle README servisních budov.
// Dodaný model nemá animační klip, proto je pohyb spočítaný v kódu z bodů v registru (crane). Animace běží
// jen během výměny a do 60 m od hráče; v multiplayeru se posílá jen začátek výměny (H.bd), každý si ji přehraje sám.
import { MODELS } from '../assets/registry.js';
import { instantiate } from '../assets/models.js';
import { SWAP, STRUCTURES, dirToLocal } from '../structures.js';
import { batteryPoint } from '../catalog.js';
import { MOON } from '../config.js';
import { norm, madd } from '../planet/vec.js';
import { hostNow } from '../energy.js';
import { game } from '../state.js';

const THREE = window.THREE;
const C = MODELS.swapper.crane;           // { bridgeY, bridgeZ: [nad vozidlem, u skladu], hookTopY, hookRackY, cableTopY, cableX, batteryBelowHook }
const RACK_Z = C.bridgeZ[1];
const cableMat = new THREE.MeshLambertMaterial({ color: 0x2b2b2e });
const cableGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 6).translate(0, -0.5, 0);   // délka 1 dolů od horního konce

// Výška střechy vozidla (m nad podlahou) – z obálky modelu, jednou na typ
const roofCache = new Map();
export function roofOf(type) {
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

// Baterie vozidla v souřadnicích výměníku (07, fáze B): { x, z, y = spodek baterie, yaw = natočení delší strany }.
// Jeřáb si pro ni dojede (kočka po mostě v x, most v z) a natočí hák podle vozidla – vozidlo se nemusí rovnat.
// null = vozidlo bez uzlu baterie (starý model, letoun) → baterie na vršku obálky jako dřív.
const TROLLEY = 2.2;                                   // kam až dojede kočka po mostě (m od středu)
function batteryTarget(b, v, padTop) {
  const bp = v && batteryPoint(v.type);
  if (!bp || !v.f) return null;
  const at = norm(madd(v.p, v.f, bp.z / MOON.radius));
  const [x, z] = dirToLocal(b.p, b.yaw, at);
  const [fx, fz] = dirToLocal(b.p, b.yaw, norm(madd(at, v.f, 1 / MOON.radius)));
  let yaw = Math.atan2(-(fz - z), fx - x);            // osa X baterie (delší strana) míří po směru jízdy
  while (yaw > Math.PI / 2) yaw -= Math.PI;
  while (yaw <= -Math.PI / 2) yaw += Math.PI;
  return { x: Math.max(-TROLLEY, Math.min(TROLLEY, x)), z, y: padTop + bp.y, yaw };
}

// Co má baterie na vozidle i dělat během výměny ve výměníku (actors.js): null = nic zvláštního,
// 'empty' = jeřáb si pro ni jede (červený pás), 'hidden' = je na háku / v regálu, 'full' = nová už leží na voze.
export function swapPhase(i) {
  for (const b of game.s.buildings) {
    const sw = b.type === 'swapper' ? b.data?.swap : null;
    if (!sw || sw.i !== i) continue;
    const t = (hostNow() - sw.at) / 1000 / SWAP.dur;
    if (t < 0 || t > 1.3) return null;
    return t < 0.25 ? 'empty' : t < 0.9 ? 'hidden' : 'full';
  }
  return null;
}

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
  function pose(z, hookY, carry, onRoof, roofY, x = 0, yaw = 0) {
    bridge.position.set(0, C.bridgeY, z);
    hook.position.set(x, hookY, z);
    hook.rotation.y = yaw;
    const cx = Math.cos(yaw) * C.cableX, cz = -Math.sin(yaw) * C.cableX;
    cables.forEach((c, k) => {
      c.position.set(x + (k ? cx : -cx), C.cableTopY, z + (k ? cz : -cz));
      c.scale.y = Math.max(0.05, C.cableTopY - (hookY + 0.18));
    });
    full.visible = empty.visible = false;
    const put = (m, xx, y, zz, rot) => { m.visible = true; m.position.set(xx, y, zz); m.rotation.y = rot; };
    if (carry) put(carry === 'full' ? full : empty, x, hookY - C.batteryBelowHook, z, yaw);
    if (onRoof) put(onRoof === 'full' ? full : empty, 0, roofY, 0, 0);
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
    const T = batteryTarget(b, v, padTop);                            // baterie v kolébce vozidla (GLB), jinak na střeše
    const roofY = T ? T.y : padTop + roofOf(v?.type || 'rideon') - 0.05;     // spodek baterie na vozidle
    const hookCar = roofY + C.batteryBelowHook;                       // hák při uchopení baterie na voze
    const z0 = T ? T.z : C.bridgeZ[0], z1 = RACK_Z, top = C.hookTopY, rack = C.hookRackY;
    // k = 0 u skladu … 1 nad baterií vozidla; baterii na voze s uzlem kreslí samo vozidlo (actors.js, swapPhase)
    const P = (k, hookY, carry, onRoof) => {
      k = Math.max(0, Math.min(1, k));
      pose(lerp(z1, z0, k), hookY, carry, T ? null : onRoof, roofY, T ? T.x * k : 0, T ? T.yaw * k : 0);
    };
    // 1 most k vozidlu · 2 hák dolů a nahoru s vybitou · 3 do skladu, výměna za nabitou · 4 zpět, usadit, nahoru
    if (t < 0.15) P(seg(t, 0, 0.15), top, null, 'empty');
    else if (t < 0.25) P(1, lerp(top, hookCar, seg(t, 0.15, 0.25)), null, 'empty');
    else if (t < 0.35) P(1, lerp(hookCar, top, seg(t, 0.25, 0.35)), 'empty', null);
    else if (t < 0.5) P(1 - seg(t, 0.35, 0.5), top, 'empty', null);
    else if (t < 0.58) P(0, lerp(top, rack, seg(t, 0.5, 0.58)), 'empty', null);
    else if (t < 0.66) P(0, lerp(rack, top, seg(t, 0.58, 0.66)), 'full', null);
    else if (t < 0.81) P(seg(t, 0.66, 0.81), top, 'full', null);
    else if (t < 0.9) P(1, lerp(top, hookCar, seg(t, 0.81, 0.9)), 'full', null);
    else if (t <= 1) P(1, lerp(hookCar, top, seg(t, 0.9, 1)), null, 'full');
    else P(1 - seg(t, 1, 1.25), top, null, 'full');                      // most se vrací, nabitá leží na voze
  }
  return { update };
}
