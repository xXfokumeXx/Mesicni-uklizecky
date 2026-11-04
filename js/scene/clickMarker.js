// Ukazatel místa kliknutí (D-09): kroužek v barvě --hivis, který se za 0,25 s rozbalí a pak jemně pulzuje,
// nad ním šipka dolů 0,5 m nad zemí. U vozidla je kroužek větší a od přední hrany k cíli vede přerušovaná čára po terénu.
// Při tažení sleduje kurzor, po dojetí zmizí, klik do oblohy = krátce červený. Bez cíle se nic nekreslí.
import { MOON } from '../config.js';
import { heightAt } from '../planet/height.js';
import { norm, angleBetween } from '../planet/vec.js';

const THREE = window.THREE;
const R = MOON.radius;
const HIVIS = 0xf2b33d, RED = 0xe0654c;
const DASH_MAX = 80;               // úseků přerušované čáry (1 m)

export function createClickMarker(scene) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  const ringMat = new THREE.MeshBasicMaterial({ color: HIVIS, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 40).rotateX(-Math.PI / 2), ringMat);
  ring.position.y = 0.08;
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.34, 10).rotateX(Math.PI), ringMat);
  group.add(ring, arrow);
  ring.renderOrder = arrow.renderOrder = 6;

  const dashGeo = new THREE.BufferGeometry();
  dashGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DASH_MAX * 2 * 3), 3));
  const dashes = new THREE.LineSegments(dashGeo, new THREE.LineBasicMaterial({ color: HIVIS, transparent: true, opacity: 0.85 }));
  dashes.frustumCulled = false;
  dashes.visible = false;
  scene.add(dashes);

  const _up = new THREE.Vector3(), _q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
  let shown = null;                // poslední cíl (jednotkový vektor)
  let bornAt = 0, goneAt = 0, redUntil = 0, lastClicks = 0, lastKey = '';

  function setAt(d) {
    const r = R + heightAt(d);
    group.position.set(d[0] * r, d[1] * r, d[2] * r);
    _up.set(d[0], d[1], d[2]);
    group.quaternion.copy(_q.setFromUnitVectors(Y, _up));
  }

  function drawDashes(from, to) {
    const len = angleBetween(from, to) * R;
    const n = Math.min(DASH_MAX, Math.floor(len / 1));
    const pos = dashGeo.attributes.position;
    let k = 0;
    for (let i = 0; i < n; i++) {
      for (const t of [i / (n || 1), (i + 0.55) / (n || 1)]) {
        const d = norm([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t]);
        const r = R + heightAt(d) + 0.15;
        pos.setXYZ(k++, d[0] * r, d[1] * r, d[2] * r);
      }
    }
    dashGeo.setDrawRange(0, k);
    pos.needsUpdate = true;
  }

  // target = cíl pohybu myší (nebo null), vehicle = { radius, nose: [x,y,z] } při jízdě, miss/clicks z input.js
  function update(dt, target, vehicle, miss, clicks) {
    const now = performance.now();
    if (clicks !== lastClicks) {                       // nové kliknutí
      lastClicks = clicks;
      if (miss) redUntil = now + 400;
      else bornAt = now;
    }
    if (target) {
      const key = target.join(',');
      if (!shown || key !== lastKey) { if (!shown) bornAt = now; lastKey = key; }
      shown = target;
      goneAt = 0;
      setAt(target);
    } else if (shown && !goneAt) {
      goneAt = now;                                    // dojeto → zmenšit a vyblednout
    }
    const fading = goneAt ? Math.min(1, (now - goneAt) / 300) : 0;
    if (goneAt && fading >= 1) shown = null;
    const red = now < redUntil;
    group.visible = !!shown || red;
    dashes.visible = !!shown && !!vehicle && !goneAt;
    if (!group.visible) return;

    const base = vehicle ? Math.max(1.4, vehicle.radius * 0.8 + 0.6) : 0.55;
    const open = Math.min(1, (now - bornAt) / 250);
    const pulse = 1 + Math.sin(now / 260) * 0.06 * open;
    const k = (0.3 + 0.7 * (1 - Math.pow(1 - open, 3))) * pulse * (1 - fading * 0.7);
    ring.scale.set(base * k, 1, base * k);
    arrow.position.y = 0.5 + Math.sin(now / 320) * 0.08 + base * 0.15;
    ringMat.color.setHex(red ? RED : HIVIS);
    ringMat.opacity = 0.9 * (1 - fading);
    if (dashes.visible) drawDashes(vehicle.nose, shown);
  }

  return { update };
}
