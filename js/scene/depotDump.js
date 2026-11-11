// Výsypka depa – pohyblivé a stavové části (D-15, O-27, 3.1). Statické rameno a výsypka jsou v modelu sila
// (scene/buildings.js buildSilo). Tady: zóna 5 × 5 m se žlutočernými pruhy po terénu, tabule „VÝSYP · 100 kg/s“
// (svítí, natočená ke kameře, mění se s výzkumem), světlo stavu na rameni (zelená = připraveno, oranžová pulzuje =
// vysypává se, červená = depo plné), klapka na konci výsypky (otočení o 70° za 0,4 s) a proud prachu z vozidla nahoru
// do výsypky (rameno ho nasává; válec s posouvanou průsvitnou texturou, 1 vykreslení, širší s rychlostí). Do 120 m.
import { MOON } from '../config.js';
import { game } from '../state.js';
import { STRUCTURES, padTopHeight, localToDir, axes } from '../structures.js';
import { DUMP, DEPOT, dumpRate } from '../logistics.js';
import { heightAt } from '../planet/height.js';

const THREE = window.THREE;
const R = MOON.radius;
const RANGE = 120;

function hazardTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  g.save();
  g.beginPath();
  g.rect(0, 0, 128, 128);
  g.rect(14, 14, 100, 100);                                   // jen okraj (pruh 0,55 m)
  g.clip('evenodd');
  g.fillStyle = '#f2b33d';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#16140f';
  for (let k = -128; k < 256; k += 22) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 11, 0); g.lineTo(k + 11 - 128, 128); g.lineTo(k - 128, 128); g.fill(); }
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

function signTexture(rate) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#16140f';
  g.fillRect(0, 0, 256, 64);
  g.strokeStyle = '#f2b33d';
  g.lineWidth = 5;
  g.strokeRect(3, 3, 250, 58);
  g.fillStyle = '#f2b33d';
  g.font = '700 30px Chakra Petch, Arial Narrow, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(`VÝSYP · ${rate} kg/s`, 128, 34);
  return new THREE.CanvasTexture(c);
}

export function createDepotDump(scene) {
  const zoneMat = new THREE.MeshBasicMaterial({ map: hazardTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
  const signTex = new Map();                                   // rychlost → textura
  const signMat = rate => {
    if (!signTex.has(rate)) signTex.set(rate, new THREE.MeshBasicMaterial({ map: signTexture(rate), side: THREE.DoubleSide }));
    return signTex.get(rate);
  };
  const lightGeo = new THREE.BoxGeometry(0.28, 0.2, 0.28);
  const flapGeo = new THREE.BoxGeometry(1.1, 0.06, 0.9).translate(0, 0, -0.45);   // pant na hraně výsypky
  const flapMat = new THREE.MeshLambertMaterial({ color: 0x2d313b });
  const streamMat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    transparent: true, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float time; varying vec2 vUv;
      void main() {
        float s = sin(vUv.y * 40.0 - time * 14.0 + sin(vUv.x * 25.0) * 1.5) * 0.5 + 0.5;   // proud nahoru (sání do depa)
        float a = (0.35 + 0.35 * s) * smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.92, vUv.y);
        gl_FragColor = vec4(mix(vec3(0.62, 0.57, 0.48), vec3(0.85, 0.8, 0.7), s), a);
      }`,
  });
  const streamGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true).translate(0, -0.5, 0);   // z výsypky dolů, jednotková
  const views = new Map();                                      // id depa → { key, zone, sign, light, flap, stream, open }
  const _m = new THREE.Matrix4(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
  const world = (dir, h) => new THREE.Vector3(dir[0], dir[1], dir[2]).multiplyScalar(R + h);

  function orient(obj, b) {
    const ax = axes(b.p, b.yaw);
    _x.set(...ax.X); _y.set(...b.p); _z.set(...ax.Z);
    _m.makeBasis(_x, _y, _z);
    obj.quaternion.setFromRotationMatrix(_m);
  }

  function zoneGeometry(b) {
    const N = 6, verts = [], uvs = [], idx = [];
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const x = -DUMP.half + (2 * DUMP.half * i) / N, z = DUMP.z - DUMP.half + (2 * DUMP.half * j) / N;
        const d = localToDir(b.p, b.yaw, x, z);
        const v = world(d, heightAt(d) + 0.07);
        verts.push(v.x, v.y, v.z);
        uvs.push(i / N, j / N);
      }
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const a = i * (N + 1) + j, c = a + N + 1;
      idx.push(a, c, a + 1, a + 1, c, c + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    return g;
  }

  function viewFor(b) {
    const key = `${b.p.join(',')}|${b.yaw}`;
    let v = views.get(b.id);
    if (v && v.key === key) return v;
    if (v) remove(b.id);
    const base = padTopHeight(b) - (STRUCTURES.depot.padTop || 0);
    const zone = new THREE.Mesh(zoneGeometry(b), zoneMat);
    zone.renderOrder = 2;
    const anchor = new THREE.Group();                         // místní souřadnice depa (x, výška nad deskou, z)
    anchor.position.copy(world(b.p, base));
    orient(anchor, b);
    const light = new THREE.Mesh(lightGeo, new THREE.MeshBasicMaterial({ color: 0x5fd36e }));
    light.position.set(0, 6.85, -6.7);
    const flap = new THREE.Mesh(flapGeo, flapMat);
    flap.position.set(0, 5.53, -7.05);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), signMat(dumpRate()));
    sign.position.set(0, 7.45, -7.5);
    sign.userData.rate = dumpRate();
    const stream = new THREE.Mesh(streamGeo, streamMat);
    stream.position.set(0, 5.5, -7.5);
    stream.visible = false;
    stream.renderOrder = 3;
    anchor.add(light, flap, sign, stream);
    scene.add(zone, anchor);
    // výška proudu: od výsypky k terénu pod ní (vozidlo ho zakryje)
    const under = localToDir(b.p, b.yaw, 0, DUMP.z);
    v = { key, zone, anchor, light, flap, sign, stream, open: 0, drop: Math.max(1, base + 5.5 - heightAt(under)) };
    views.set(b.id, v);
    return v;
  }

  function remove(id) {
    const v = views.get(id);
    if (!v) return;
    scene.remove(v.zone, v.anchor);
    v.zone.geometry.dispose();
    v.light.material.dispose();
    v.sign.geometry.dispose();
    views.delete(id);
  }

  // dumping = Set id dep, do kterých se právě vysypává (actors: moje vozidlo + stojící vozidla ostatních pod výsypkou)
  // focus = poloha kamery (tabule se natáčí k ní)
  function update(dt, time, focus, dumping) {
    streamMat.uniforms.time.value = time;
    const seen = new Set();
    const rate = dumpRate();
    for (const b of game.s.buildings || []) {
      if (b.type !== 'depot') continue;
      if (world(b.p, 0).distanceTo(focus) > RANGE) continue;
      seen.add(b.id);
      const v = viewFor(b);
      v.zone.visible = v.anchor.visible = true;
      const full = (b.data.store || 0) >= DEPOT.cap - 0.1;
      const active = dumping.has(b.id) && !full;
      v.light.material.color.setHex(full ? 0xd9533d : active ? (Math.sin(time * 9) > 0 ? 0xf28c28 : 0x7a4a14) : 0x5fd36e);
      v.open += ((active ? 1 : 0) - v.open) * Math.min(1, dt / 0.13);   // ~0,4 s
      v.flap.rotation.x = -v.open * 70 * Math.PI / 180;
      v.stream.visible = v.open > 0.6;
      if (v.stream.visible) {
        const r = rate >= 400 ? 0.5 : rate >= 200 ? 0.36 : 0.26;
        v.stream.scale.set(r, v.drop, r);
      }
      if (v.sign.userData.rate !== rate) { v.sign.material = signMat(rate); v.sign.userData.rate = rate; }
      // tabule natočená k hráči (vodorovně)
      v.anchor.updateMatrixWorld();
      const sw = v.sign.getWorldPosition(new THREE.Vector3());
      const toward = new THREE.Vector3().subVectors(focus, sw);
      const local = v.anchor.worldToLocal(sw.clone().add(toward)).sub(v.sign.position);
      v.sign.rotation.y = Math.atan2(local.x, local.z);
    }
    for (const id of [...views.keys()]) {
      if (seen.has(id)) continue;
      if (!(game.s.buildings || []).some(b => b.id === id)) remove(id);
      else { const v = views.get(id); v.zone.visible = v.anchor.visible = false; }
    }
  }

  return { update };
}
