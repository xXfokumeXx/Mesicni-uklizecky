// Obrázky astronautů pro menu a lobby (nové lobby, 4. 11.): vlastní malý renderer mimo hru, model z registru
// ('astronaut' – barva skafandru a rekvizity z profilu), průhledné pozadí, nohy přesně na spodní hraně obrázku.
// shot(look, { wave }) → { url, fig } – fig = podíl výšky obrázku, který zabírá postava (pro měřítko na plošině).
// Stejný renderer slouží i šatně v menu (thumbs + wardrobe) – hra pak má vlastní (createWorld).
import { instantiate } from '../assets/models.js';
import { createThumbs } from './thumbs.js';

const THREE = window.THREE;
const W = 256, H = 512;

export function createAvatarShots() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xe6ecf8, 0x3a3226, 0.85));
  const key = new THREE.DirectionalLight(0xfff2dc, 1.05);
  key.position.set(2.5, 4, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fc7ff, 0.35);
  rim.position.set(-3, 2, -4);
  scene.add(rim);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
  const cache = new Map();
  const box = new THREE.Box3(), size = new THREE.Vector3(), center = new THREE.Vector3();

  function shot(look, { wave = false } = {}) {
    const k = `${look.skin}|${look.color}|${look.top}|${look.face}|${wave ? 1 : 0}`;
    if (cache.has(k)) return cache.get(k);
    const a = instantiate('astronaut', look);
    a.setToolSize?.(0);                                    // v lobby bez nástroje v ruce (skryje ho až update)
    a.update?.(1 / 60, 0, { moving: false, speed: 0, swept: false, airborne: false, alt: 0, vel: 0, landed: false, seated: false, pushing: false });
    const R = a.arms?.R, L = a.arms?.L;
    if (L) { L.shoulder.rotation.set(-0.15, 0, -0.12); L.elbow.rotation.set(-0.25, 0, 0); }
    if (R) {
      if (wave) { R.shoulder.rotation.set(0, 0, 2.55); R.elbow.rotation.set(0, 0, 0.55); }   // ruka nahoře, mává
      else { R.shoulder.rotation.set(-0.15, 0, 0.12); R.elbow.rotation.set(-0.25, 0, 0); }
    }
    a.root.rotation.y = -0.38;                             // trochu z boku jako na náhledech v návrhu
    scene.add(a.root);
    a.root.updateMatrixWorld(true);
    box.setFromObject(a.root);
    box.getSize(size);
    box.getCenter(center);
    const vh = Math.max(size.y, size.x * 2) * 1.04, vw = vh / 2;
    camera.left = -vw / 2; camera.right = vw / 2;
    camera.top = vh; camera.bottom = 0;                    // spodní hrana = chodidla
    camera.position.set(center.x, box.min.y - 0.01, center.z + 10);
    camera.lookAt(center.x, box.min.y - 0.01, center.z);
    camera.updateProjectionMatrix();
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, camera);
    const out = { url: renderer.domElement.toDataURL('image/png'), fig: size.y / vh };
    scene.remove(a.root);
    cache.set(k, out);
    return out;
  }

  return { shot, renderer, thumbs: createThumbs(renderer) };
}
