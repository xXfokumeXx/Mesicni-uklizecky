// Šatna: živý náhled astronauta (vlastní malý renderer, běží jen když je šatna otevřená)
// a náhledové obrázky rekvizit na helmě.
import { createAstronaut } from './astronaut.js';
import { DEFAULT_LOOK } from '../catalog.js';

const THREE = window.THREE;

export function createWardrobe(thumb) {
  const canvas = document.createElement('canvas');
  canvas.className = 'wardrobe__canvas';
  canvas.setAttribute('aria-label', 'Náhled astronauta');
  let renderer = null, scene, camera, astro, raf = 0, angle = 0.5, dragging = false, lastX = 0, mounted = false;

  function setup() {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xdfe6f5, 0x2a2622, 0.8));
    const sun = new THREE.DirectionalLight(0xfff2dc, 1.0);
    sun.position.set(2, 4, 3);
    scene.add(sun);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(0.9, 40), new THREE.MeshLambertMaterial({ color: 0x3a3e4a }));
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
    camera.position.set(0, 1.25, 3.6);
    camera.lookAt(0, 0.95, 0);
    astro = createAstronaut(DEFAULT_LOOK);
    scene.add(astro.root);
    canvas.addEventListener('pointerdown', e => { dragging = true; lastX = e.clientX; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', e => { if (dragging) { angle += (e.clientX - lastX) * 0.012; lastX = e.clientX; } });
    const stop = () => { dragging = false; };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
  }

  function loop(t) {
    raf = requestAnimationFrame(loop);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    if (!dragging) angle += 0.004;
    astro.root.rotation.y = angle;
    astro.update(1 / 60, t / 1000, { moving: false, speed: 0, swept: false, airborne: false, alt: 0, vel: 0, landed: false, seated: false, pushing: false });
    renderer.render(scene, camera);
  }

  return {
    mount(container, look) {
      if (!renderer) setup();
      astro.setLook(look);
      container.append(canvas);
      if (!mounted) { mounted = true; raf = requestAnimationFrame(loop); }
    },
    unmount() {
      if (!mounted) return;
      mounted = false;
      cancelAnimationFrame(raf);
      canvas.remove();
    },
    // Náhled hlavy s rekvizitou (pro karty v šatně).
    headThumb(propId) {
      return thumb(`prop-${propId}`, () => {
        const a = createAstronaut({ ...DEFAULT_LOOK, top: propId.match(/^(none|noface|moustache|glasses|whiskers)$/) ? 'none' : propId, face: /^(moustache|glasses|whiskers)$/.test(propId) ? propId : 'noface' });
        const head = a.head;
        head.parent.remove(head);
        head.position.set(0, 0, 0);
        head.rotation.y = 0.35;
        return head;
      });
    },
  };
}
