// Kliknutí na obrazovce → místo na povrchu Měsíce.
// Místo raycastu proti 150 000 trojúhelníkům se protne koule ve výšce terénu (2 iterace).
import { MOON } from '../config.js';
import { heightAt } from '../planet/height.js';

const THREE = window.THREE;
const R = MOON.radius;

export function createPicker(canvas, camera) {
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hit = new THREE.Vector3();

  function hitSphere(o, d, radius) {
    const b = o.dot(d);
    const c = o.lengthSq() - radius * radius;
    const disc = b * b - c;
    if (disc < 0) return false;
    const t = -b - Math.sqrt(disc);
    if (t < 0) return false;
    hit.copy(o).addScaledVector(d, t);
    return true;
  }

  return function pickDir(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ndc.set((clientX - r.left) / r.width * 2 - 1, -(clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const { origin, direction } = ray.ray;

    let radius = R;
    for (let i = 0; i < 3; i++) {
      if (!hitSphere(origin, direction, radius)) return null;
      const l = hit.length();
      radius = R + heightAt([hit.x / l, hit.y / l, hit.z / l]);
    }
    const l = hit.length();
    return [hit.x / l, hit.y / l, hit.z / l];
  };
}
