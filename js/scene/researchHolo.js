// Hologram nad Výzkumným centrem (D-10): během výzkumu se nad projektorem točí průsvitný model vyvíjené
// technologie a modré světlo pulzuje; bez výzkumu je hologram zhasnutý. Bez energie bliká slabě.
import { instantiate, isReady, preloadModels } from '../assets/models.js';
import { researchProgress, TECH_MODEL } from '../research.js';
import { live } from '../energy.js';

const THREE = window.THREE;
const SPOT = new THREE.Vector3(-6, 8.6, -3.15);   // nad modrým projektorem v modelu (paprsek z [-6, 5.5, -3.15])
const SIZE = 2.6;                                  // m – největší rozměr hologramu
const holoMat = new THREE.MeshBasicMaterial({ color: 0x7fd8f2, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending });
const ringMat = new THREE.MeshBasicMaterial({ color: 0x6fd8f2, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });

export function createResearchHolo(root, b) {
  const group = new THREE.Group();
  group.position.copy(SPOT);
  group.visible = false;
  root.add(group);
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.62, 40), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -1.5;
  group.add(ring);
  let model = null, modelId = null;

  function setModel(id) {
    if (id === modelId) return;
    if (!isReady(id)) { preloadModels([id]); return; }
    if (model) group.remove(model);
    modelId = id;
    const o = instantiate(id).root;
    o.traverse(m => { if (m.isMesh) { m.material = holoMat; m.castShadow = m.receiveShadow = false; } });
    const box = new THREE.Box3().setFromObject(o), size = new THREE.Vector3(), c = new THREE.Vector3();
    box.getSize(size); box.getCenter(c);
    const k = SIZE / Math.max(size.x, size.y, size.z, 0.01);
    model = new THREE.Group();
    o.position.sub(c);
    model.add(o);
    model.scale.setScalar(k);
    group.add(model);
  }

  function update(now, near) {
    const pr = researchProgress();
    group.visible = !!pr && near;
    if (!group.visible) return;
    setModel(TECH_MODEL[pr.tech.id] || 'robot');
    const f = live.get(b.id)?.f ?? 0;
    const pulse = f > 0.05 ? 0.35 + 0.2 * Math.sin(now / 140) : 0.12 + 0.08 * Math.sin(now / 600);   // s energií rychleji
    holoMat.opacity = pulse;
    ringMat.opacity = 0.3 + pulse;
    if (model) { model.rotation.y = now / 1400; model.position.y = Math.sin(now / 700) * 0.12; }
    ring.scale.setScalar(0.9 + 0.1 * Math.sin(now / 300));
  }
  return { update };
}
