// Reflektory: čelovka astronauta (široký kužel ~110°) a světlomety vozidel (užší, dál) jako skutečná
// směrová světla. Ve scéně je stálá sada SPOTS světel – počet světel se nemění, takže se materiály
// nepřekompilovávají; každý snímek se přiřadí nejdůležitějším zdrojům (moje světlo, pak nejbližší ostatní).
// Terén má vlastní shader, proto dostane stejná světla jako pole uniforem (terrainMaterial.js).
// Moje světlo (první v sadě) může vrhat stíny – jen při zapnutém nastavení „Stíny světel“ (předvolba Vysoká).
const THREE = window.THREE;

export const SPOTS = 4;

// angle = poloviční úhel kuželu (rad), penumbra = měkký okraj (podíl), range = dosah (m), tilt = sklon dolů (rad)
export const LIGHT_TYPES = {
  lamp: { angle: 0.95, penumbra: 0.55, range: 26, power: 1.7, tilt: 0.22, color: 0xfff1dc },
  car:  { angle: 0.55, penumbra: 0.35, range: 55, power: 4.5, tilt: 0.2,  color: 0xfff4d6 },
};

export function createSpots(scene) {
  const pool = [];
  for (let i = 0; i < SPOTS; i++) {
    const l = new THREE.SpotLight(0xffffff, 0, 30, 0.6, 0.5, 2);
    l.target = new THREE.Object3D();
    scene.add(l, l.target);
    pool.push(l);
  }
  const own = pool[0];
  own.shadow.mapSize.set(512, 512);
  own.shadow.camera.near = 0.3;
  own.shadow.camera.far = 55;
  own.shadow.bias = -0.0006;
  own.shadow.normalBias = 0.02;

  const uniforms = {
    pos: Array.from({ length: SPOTS }, () => new THREE.Vector3()),
    dir: Array.from({ length: SPOTS }, () => new THREE.Vector3(0, 1, 0)),
    color: Array.from({ length: SPOTS }, () => new THREE.Color(0)),
    cone: Array.from({ length: SPOTS }, () => new THREE.Vector2(1, 1)),
    range: new Array(SPOTS).fill(1),
  };
  const down = new THREE.Vector3();

  return {
    uniforms,
    // Stíny mého světla (změna přepočítá materiály – jen při změně nastavení).
    setShadows(on) { own.castShadow = on; },
    // sources = [{ type: 'lamp' | 'car', pos: Vector3, dir: Vector3 (vodorovně), up: Vector3, k: 0–1 }, …] podle důležitosti
    update(sources) {
      for (let i = 0; i < SPOTS; i++) {
        const src = sources[i];
        const l = pool[i];
        if (!src || !(src.k > 0.01)) {
          l.intensity = 0;
          uniforms.color[i].setRGB(0, 0, 0);
          continue;
        }
        const T = LIGHT_TYPES[src.type];
        // sklon dolů (světlo míří kousek před sebe na zem)
        down.copy(src.dir).multiplyScalar(Math.cos(T.tilt)).addScaledVector(src.up, -Math.sin(T.tilt)).normalize();
        l.color.setHex(T.color);
        l.intensity = T.power * src.k;
        l.distance = T.range;
        l.angle = T.angle;
        l.penumbra = T.penumbra;
        l.position.copy(src.pos);
        l.target.position.copy(src.pos).add(down);
        uniforms.pos[i].copy(src.pos);
        uniforms.dir[i].copy(down);
        uniforms.color[i].setHex(T.color).multiplyScalar(T.power * src.k);
        uniforms.cone[i].set(Math.cos(T.angle), Math.cos(T.angle * (1 - T.penumbra)));
        uniforms.range[i] = T.range;
      }
    },
    // Stínová mapa mého světla pro shader terénu (null = bez stínů).
    shadowInfo() {
      if (!own.castShadow || !own.shadow.map || own.intensity <= 0) return null;
      return { map: own.shadow.map, matrix: own.shadow.matrix, mapSize: own.shadow.mapSize };
    },
  };
}
