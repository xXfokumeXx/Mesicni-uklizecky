// Navigační 3D šipka k základně nahoře uprostřed obrazovky (styl GPS šipky ze závodních her):
// tlustá šipka se světlým vrchem a tmavšími boky leží ve vlastní „podlaze“ nakloněné k divákovi,
// otáčí se kolem svislé osy podle směru k Výkupu (vůči tomu, kam míří kamera) a plynule doběhne.
// Kreslí se přes všechno (bez hloubky). Vzdálenost pod ní ukazuje HUD (#base-nav, ui.js).
import { BASE } from '../config.js';
import { tangentTo, dot } from '../planet/vec.js';

const THREE = window.THREE;
const DIST = 4;              // jak daleko před kamerou šipka visí (m)
const SCREEN_Y = 34;         // střed šipky v px od horního okraje obrazovky
const PITCH = 1.0;           // pohled na šipku šikmo shora (rad) – tvar hrotu je čitelný v každém směru
const SIZE = 0.3;            // velikost šipky (zmenšená)

function arrowGeometry() {
  // šipka v rovině xy, hrot na +y; vytažená do tloušťky se zkosením (vrch = skupina 0, boky = skupina 1)
  const sh = new THREE.Shape();
  sh.moveTo(0, 0.7);
  sh.lineTo(0.5, 0.12);
  sh.lineTo(0.2, 0.12);
  sh.lineTo(0.2, -0.5);
  sh.lineTo(-0.2, -0.5);
  sh.lineTo(-0.2, 0.12);
  sh.lineTo(-0.5, 0.12);
  sh.closePath();
  const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.045, bevelSegments: 3 });
  geo.translate(0, -0.08, -0.07);
  geo.rotateX(-Math.PI / 2);          // ležící šipka: tloušťka podél +y, hrot míří na −z…
  geo.rotateY(Math.PI);               // …otočit na +z
  geo.computeVertexNormals();
  return geo;
}

export function createCompass(scene, camera) {
  const top = new THREE.MeshPhongMaterial({
    color: 0x6fe0ff, emissive: 0x1d6a85, specular: 0xffffff, shininess: 70, depthTest: false, depthWrite: false, transparent: true,
  });
  const side = new THREE.MeshPhongMaterial({
    color: 0x2a6f8a, emissive: 0x0d2f3d, specular: 0x88ccee, shininess: 40, depthTest: false, depthWrite: false, transparent: true,
  });
  const arrow = new THREE.Mesh(arrowGeometry(), [top, side]);
  arrow.renderOrder = 1000;
  arrow.frustumCulled = false;
  arrow.visible = false;
  scene.add(arrow);

  const fwd = new THREE.Vector3(), up = new THREE.Vector3(), right = new THREE.Vector3();
  const nrm = new THREE.Vector3(), tip = new THREE.Vector3(), sideV = new THREE.Vector3();
  const floorFwd = new THREE.Vector3(), m = new THREE.Matrix4();
  let yaw = 0, ready = false;

  return {
    // p = poloha hráče (jednotkový vektor), show = jestli šipku ukázat (mimo základnu, bez mapy a scén)
    update(p, show, time, dt = 1 / 60) {
      arrow.visible = show;
      if (!show) { ready = false; return; }
      camera.updateMatrixWorld();
      camera.getWorldDirection(fwd);
      up.set(0, 1, 0).applyQuaternion(camera.quaternion);
      right.crossVectors(fwd, up).normalize();

      // směr k základně vůči kameře (vodorovně v místě hráče): 0 = rovně před kamerou, kladně doprava
      const to = tangentTo(p, BASE.dir);
      const camF = tangentTo(p, fwd.toArray());
      const camR = tangentTo(p, right.toArray());
      const want = Math.atan2(dot(to, camR), dot(to, camF));
      if (!ready) { yaw = want; ready = true; }
      let d = want - yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      yaw += d * Math.min(1, dt * 8);                              // plynulé otáčení

      // poloha: nahoře uprostřed obrazovky (SCREEN_Y px od horního okraje), DIST před kamerou
      const h = innerHeight || 1;
      const ndcY = 1 - 2 * (SCREEN_Y / h);
      const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * DIST;
      arrow.position.copy(camera.position).addScaledVector(fwd, DIST).addScaledVector(up, ndcY * halfH);

      // „podlaha“ šipky nakloněná k divákovi: normála = nahoru + kousek ke kameře
      nrm.copy(up).multiplyScalar(Math.cos(PITCH)).addScaledVector(fwd, -Math.sin(PITCH)).normalize();
      floorFwd.copy(fwd).multiplyScalar(Math.cos(PITCH)).addScaledVector(up, Math.sin(PITCH)).normalize();
      tip.copy(floorFwd).multiplyScalar(Math.cos(yaw)).addScaledVector(right, Math.sin(yaw)).normalize();
      sideV.crossVectors(nrm, tip).normalize();
      m.makeBasis(sideV, nrm, tip);
      arrow.quaternion.setFromRotationMatrix(m);
      arrow.position.addScaledVector(nrm, 0.04 * Math.sin(time * 3));   // jemné vznášení
      arrow.scale.setScalar(SIZE);
    },
  };
}
