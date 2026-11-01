// Kamera z pohledu třetí osoby na kouli: „nahoru“ je vždy od středu Měsíce k hráči.
// Pravé tlačítko + tažení = orbit kolem astronauta: do stran obíhá (orbit), nahoru / dolů mění náklon (tilt);
// natočení astronauta se nemění. Ptačí pohled (setBird)
// = kamera vysoko nad hráčem, skoro kolmo dolů; hráč se dál ovládá normálně (klávesa M, main.js).
import { MOON, CAMERA } from '../config.js';
import { heightAt } from '../planet/height.js';

const THREE = window.THREE;
const R = MOON.radius;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const ELEV = { min: 0.06, max: 1.35, start: Math.atan(0.38) };   // náklon kamery nad obzor (rad)
const BIRD = { dist: 70, elev: 1.25, min: 30, max: 220 };          // ptačí pohled

export function createFollowCamera(camera) {
  // zoom = násobek základní vzdálenosti (ta se mění podle vozidla)
  let base = CAMERA.distance, zoomK = 1;
  let dist = base, targetDist = dist;
  let elev = ELEV.start, targetElev = elev;
  let bird = false, birdDist = BIRD.dist;
  let ready = false;
  const pos = new THREE.Vector3(), look = new THREE.Vector3(), up = new THREE.Vector3();
  const want = new THREE.Vector3(), wantLook = new THREE.Vector3();
  const wantUp = new THREE.Vector3(), heading = new THREE.Vector3(), camUp = new THREE.Vector3();
  let userElev = ELEV.start;                                       // náklon, který si hráč nastavil
  let yaw = 0, targetYaw = 0;                                      // oběh kolem astronauta vůči jeho směru (rad)
  const side = new THREE.Vector3(), dir = new THREE.Vector3();

  const applyTarget = () => {
    targetDist = bird ? birdDist : clamp(base * zoomK, CAMERA.minDistance, CAMERA.maxDistance);
    targetElev = bird ? BIRD.elev : userElev;
  };

  return {
    get distance() { return dist; },
    get bird() { return bird; },
    zoom(factor) {
      if (bird) birdDist = clamp(birdDist * factor, BIRD.min, BIRD.max);
      else zoomK = clamp(zoomK * factor, CAMERA.minDistance / base, CAMERA.maxDistance / base);
      applyTarget();
    },
    setBaseDistance(d) {
      if (d === base) return;
      base = d;
      applyTarget();
    },
    // tažení pravým tlačítkem nahoru / dolů (px): kladné = kamera výš (víc shora)
    tilt(dy) {
      if (bird) return;
      userElev = clamp(userElev + dy * 0.005, ELEV.min, ELEV.max);
      applyTarget();
    },
    // tažení pravým tlačítkem do stran (rad): kamera obíhá kolem astronauta
    orbit(a) {
      targetYaw += a;
    },
    setBird(on) {
      bird = !!on;
      applyTarget();
    },

    // playerPos = THREE.Vector3, p a f = pole (pozice a směr pohledu)
    update(dt, playerPos, p, f) {
      const k8 = 1 - Math.exp(-dt * 8);
      dist += (targetDist - dist) * k8;
      elev += (targetElev - elev) * k8;
      wantUp.set(p[0], p[1], p[2]);
      heading.set(f[0], f[1], f[2]);
      // oběh: směr kamery = směr astronauta otočený kolem svislice o yaw
      yaw += (targetYaw - yaw) * k8;
      side.crossVectors(heading, wantUp);
      dir.copy(heading).multiplyScalar(Math.cos(yaw)).addScaledVector(side, Math.sin(yaw)).normalize();
      heading.copy(dir);

      // kamera za hráčem v úhlu elev nad obzorem
      want.copy(playerPos)
        .addScaledVector(wantUp, Math.sin(elev) * dist + 1.5)
        .addScaledVector(heading, -Math.cos(elev) * dist);

      // kamera nesmí zajet pod kopec
      const l = want.length();
      const minR = R + heightAt([want.x / l, want.y / l, want.z / l]) + 1.5;
      if (l < minR) want.setLength(minR);

      wantLook.copy(playerPos).addScaledVector(wantUp, 1.6);
      // „nahoru“ na obrazovce: při pohledu shora se přiklání ke směru pohledu (lookAt by se jinak zvrtlo)
      camUp.copy(wantUp).multiplyScalar(Math.cos(elev)).addScaledVector(heading, Math.sin(elev)).normalize();

      if (!ready) {
        pos.copy(want);
        look.copy(wantLook);
        up.copy(camUp);
        ready = true;
      }
      const k = 1 - Math.exp(-dt * 6);
      pos.lerp(want, k);
      look.lerp(wantLook, k);
      up.lerp(camUp, k).normalize();

      camera.position.copy(pos);
      camera.up.copy(up);
      camera.lookAt(look);
    },
  };
}
