// Kliknutí na obrazovce → místo na povrchu Měsíce.
// Místo raycastu proti 150 000 trojúhelníkům se protne koule ve výšce terénu (2 iterace).
import { MOON } from '../config.js';
import { heightAt } from '../planet/height.js';

const THREE = window.THREE;
const R = MOON.radius;
const HORIZON = 40;          // m – náhradní cíl, když kurzor při podrženém tlačítku míří nad obzor

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

  const up = new THREE.Vector3(), flat = new THREE.Vector3();
  // Kurzor nad obzorem (malý Měsíc → při jízdě z kopce časté): směr paprsku po povrchu, HORIZON m před kamerou.
  function horizonDir(origin, direction) {
    up.copy(origin).normalize();
    flat.copy(direction).addScaledVector(up, -direction.dot(up));
    if (flat.lengthSq() < 1e-8) return null;
    flat.normalize();
    hit.copy(up).addScaledVector(flat, HORIZON / R).normalize();
    return [hit.x, hit.y, hit.z];
  }

  // horizon = true: místo „nic“ (obloha) vrátit bod ve směru kurzoru (pro podržené tlačítko při jízdě / chůzi)
  return function pickDir(clientX, clientY, horizon = false) {
    const r = canvas.getBoundingClientRect();
    ndc.set((clientX - r.left) / r.width * 2 - 1, -(clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const { origin, direction } = ray.ray;

    let radius = R;
    for (let i = 0; i < 3; i++) {
      if (!hitSphere(origin, direction, radius)) return horizon ? horizonDir(origin, direction) : null;
      const l = hit.length();
      radius = R + heightAt([hit.x / l, hit.y / l, hit.z / l]);
    }
    const l = hit.length();
    return [hit.x / l, hit.y / l, hit.z / l];
  };
}
