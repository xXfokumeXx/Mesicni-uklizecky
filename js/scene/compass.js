// Navigační 3D šipka k základně nahoře uprostřed obrazovky. Leží „na zemi“ (v tečné rovině v místě hráče)
// a míří k Výkupu, takže z kamery za zády vypadá jako kompas. Kreslí se přes všechno (bez hloubky).
// Vzdálenost pod ní ukazuje HUD (#base-nav, ui.js).
import { BASE } from '../config.js';
import { tangentTo } from '../planet/vec.js';

const THREE = window.THREE;
const DIST = 4;              // jak daleko před kamerou šipka visí (m)
const TILT = 0.85;           // naklopení k divákovi (rad), ať šipku z kamery za zády není vidět jen z boku
const SCREEN_Y = 34;         // střed šipky v px od horního okraje obrazovky

function arrowGeometry() {
  // plochá šipka (hrot na +z), vytažená do tloušťky se zkosením
  const sh = new THREE.Shape();
  sh.moveTo(0, 0.62);
  sh.lineTo(0.46, 0.08);
  sh.lineTo(0.17, 0.08);
  sh.lineTo(0.17, -0.5);
  sh.lineTo(-0.17, -0.5);
  sh.lineTo(-0.17, 0.08);
  sh.lineTo(-0.46, 0.08);
  sh.closePath();
  const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.035, bevelSegments: 2 });
  geo.translate(0, 0, -0.06);
  geo.rotateX(-Math.PI / 2);          // tvar ležící v rovině xz, hrot míří na −z → otočit na +z
  geo.rotateY(Math.PI);
  return geo;
}

export function createCompass(scene, camera) {
  const mat = new THREE.MeshLambertMaterial({ color: 0x5fb8d9, emissive: 0x1d4a5c, depthTest: false, depthWrite: false, transparent: true });
  const arrow = new THREE.Mesh(arrowGeometry(), mat);
  arrow.renderOrder = 1000;
  arrow.frustumCulled = false;
  arrow.visible = false;
  scene.add(arrow);

  const fwd = new THREE.Vector3(), up = new THREE.Vector3(), side = new THREE.Vector3();
  const pos = new THREE.Vector3(), surfUp = new THREE.Vector3(), aim = new THREE.Vector3();
  const m = new THREE.Matrix4();
  const camRight = new THREE.Vector3(), tilt = new THREE.Quaternion();

  return {
    // p = poloha hráče (jednotkový vektor), show = jestli šipku ukázat (mimo základnu, bez mapy a scén)
    update(p, show, time) {
      arrow.visible = show;
      if (!show) return;
      camera.updateMatrixWorld();
      camera.getWorldDirection(fwd);
      up.set(0, 1, 0).applyQuaternion(camera.quaternion);
      // kam na obrazovku: nahoře uprostřed (SCREEN_Y px od horního okraje)
      const h = innerHeight || 1;
      const ndcY = 1 - 2 * (SCREEN_Y / h);
      const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * DIST;
      pos.copy(camera.position).addScaledVector(fwd, DIST).addScaledVector(up, ndcY * halfH);
      arrow.position.copy(pos);
      // orientace: „nahoru“ = svislice v místě hráče, hrot k základně (v tečné rovině)
      surfUp.set(p[0], p[1], p[2]);
      const to = tangentTo(p, BASE.dir);
      aim.set(to[0], to[1], to[2]);
      side.crossVectors(surfUp, aim).normalize();
      m.makeBasis(side, surfUp, aim);
      arrow.quaternion.setFromRotationMatrix(m);
      camRight.crossVectors(fwd, up).normalize();
      tilt.setFromAxisAngle(camRight, -TILT);
      arrow.quaternion.premultiply(tilt);
      const s = 0.42 * (1 + 0.04 * Math.sin(time * 4));            // jemné „dýchání“
      arrow.scale.setScalar(s);
    },
  };
}
