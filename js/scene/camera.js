// Kamera z pohledu třetí osoby na kouli: „nahoru“ je vždy od středu Měsíce k hráči.
import { MOON, CAMERA } from '../config.js';
import { heightAt } from '../planet/height.js';

const THREE = window.THREE;
const R = MOON.radius;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export function createFollowCamera(camera) {
  // zoom = násobek základní vzdálenosti (ta se mění podle vozidla)
  let base = CAMERA.distance, zoomK = 1;
  let dist = base, targetDist = dist;
  let ready = false;
  const pos = new THREE.Vector3(), look = new THREE.Vector3(), up = new THREE.Vector3();
  const want = new THREE.Vector3(), wantLook = new THREE.Vector3();
  const wantUp = new THREE.Vector3(), heading = new THREE.Vector3();

  return {
    get distance() { return dist; },
    zoom(factor) {
      zoomK = clamp(zoomK * factor, CAMERA.minDistance / base, CAMERA.maxDistance / base);
      targetDist = base * zoomK;
    },
    setBaseDistance(d) {
      if (d === base) return;
      base = d;
      targetDist = clamp(base * zoomK, CAMERA.minDistance, CAMERA.maxDistance);
    },

    // playerPos = THREE.Vector3, p a f = pole (pozice a směr pohledu)
    update(dt, playerPos, p, f) {
      dist += (targetDist - dist) * (1 - Math.exp(-dt * 8));
      wantUp.set(p[0], p[1], p[2]);
      heading.set(f[0], f[1], f[2]);

      const height = dist * 0.38 + 1.5;
      want.copy(playerPos).addScaledVector(wantUp, height).addScaledVector(heading, -dist);

      // kamera nesmí zajet pod kopec
      const l = want.length();
      const minR = R + heightAt([want.x / l, want.y / l, want.z / l]) + 1.5;
      if (l < minR) want.setLength(minR);

      wantLook.copy(playerPos).addScaledVector(wantUp, 1.6);

      if (!ready) {
        pos.copy(want);
        look.copy(wantLook);
        up.copy(wantUp);
        ready = true;
      }
      const k = 1 - Math.exp(-dt * 6);
      pos.lerp(want, k);
      look.lerp(wantLook, k);
      up.lerp(wantUp, k).normalize();

      camera.position.copy(pos);
      camera.up.copy(up);
      camera.lookAt(look);
    },
  };
}
