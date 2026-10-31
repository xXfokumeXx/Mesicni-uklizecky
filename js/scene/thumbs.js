// Náhledové obrázky modelů pro okna budov: model se jednou vykreslí do malé textury
// (stejným rendererem jako hra) a výsledek se uloží jako obrázek.
const THREE = window.THREE;
const W = 240, H = 170;

export function createThumbs(renderer) {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfe6f5, 0x2a2622, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(3, 5, 4);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, W / H, 0.05, 200);
  const target = new THREE.WebGLRenderTarget(W, H);
  const pixels = new Uint8Array(W * H * 4);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const cache = new Map();
  const box = new THREE.Box3(), size = new THREE.Vector3(), center = new THREE.Vector3();
  const clear = new THREE.Color();

  return function thumb(key, build) {
    if (cache.has(key)) return cache.get(key);
    const obj = build();
    obj.rotation.y += -0.6;
    scene.add(obj);
    box.setFromObject(obj);
    box.getSize(size);
    box.getCenter(center);
    const r = Math.max(size.x, size.y, size.z) * 0.95;
    camera.position.set(center.x + r * 1.6, center.y + r * 1.05, center.z + r * 2.2);
    camera.lookAt(center);

    renderer.getClearColor(clear);
    const alpha = renderer.getClearAlpha();
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, W, H, pixels);
    renderer.setRenderTarget(null);
    renderer.setClearColor(clear, alpha);
    scene.remove(obj);

    // WebGL čte řádky odspodu → otočit
    const img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      img.data.set(pixels.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    }
    ctx.putImageData(img, 0, 0);
    const url = canvas.toDataURL('image/png');
    cache.set(key, url);
    return url;
  };
}
