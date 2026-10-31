// Ostatní hráči v multiplayeru: astronaut s jejich vzhledem, animace podle presence,
// sedadlo ve vozidle, ragdoll a jmenovka nad hlavou.
import { MOON } from '../config.js';
import { SUIT_COLORS } from '../catalog.js';
import { net } from '../net.js';
import { decodeRagdoll } from '../ragdoll.js';
import { createAstronaut } from './astronaut.js';

const THREE = window.THREE;
const R = MOON.radius;
const TAG_RANGE = 140;

const _x = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4(), _up = new THREE.Vector3();
const _v = new THREE.Vector3();

function orient(obj, up, f) {
  _z.set(f[0], f[1], f[2]).addScaledVector(up, -_z.dot(up));
  if (_z.lengthSq() < 1e-8) return;
  _z.normalize();
  _x.crossVectors(up, _z).normalize();
  _m.makeBasis(_x, up, _z);
  obj.quaternion.setFromRotationMatrix(_m);
}

export function createRemotes(scene, camera, actors, layer) {
  const views = new Map();            // peer → { astro, tag, lookKey, wasAir }

  function viewFor(r) {
    let v = views.get(r.peer);
    if (!v) {
      const astro = createAstronaut(r.look);
      astro.root.traverse(o => { if (o.isMesh && !o.userData.blob && !o.material.transparent) o.castShadow = true; });
      scene.add(astro.root);
      const tag = document.createElement('div');
      tag.className = 'nametag';
      layer.append(tag);
      v = { astro, tag, lookKey: '', wasAir: false, name: '' };
      views.set(r.peer, v);
    }
    const key = `${r.look.color}|${r.look.top}|${r.look.face}`;
    if (key !== v.lookKey) { v.lookKey = key; v.astro.setLook(r.look); }
    if (v.name !== r.name) {
      v.name = r.name;
      v.tag.textContent = r.name;
      v.tag.style.setProperty('--tag', '#' + SUIT_COLORS[r.look.color].hex.toString(16).padStart(6, '0'));
    }
    return v;
  }

  function remove(peer) {
    const v = views.get(peer);
    if (!v) return;
    scene.remove(v.astro.root);
    v.tag.remove();
    views.delete(peer);
  }

  function update(dt, time, hidden) {
    for (const peer of views.keys()) if (!net.remotes.has(peer)) remove(peer);
    for (const r of net.remotes.values()) {
      if (!r.sp) continue;
      const v = viewFor(r);
      const a = v.astro;
      a.root.visible = !hidden;
      const pts = r.rag ? decodeRagdoll(r.rag) : null;
      let seated = false, pushing = false;
      if (pts) {
        a.applyRagdoll(pts);
      } else {
        if (a.ragdolling) a.endRagdoll();
        const seat = r.d >= 0 ? actors.seatTransform(r.d, a.root) : false;
        if (seat === 'seat') seated = true;
        else if (seat === 'push') pushing = true;
        else {
          a.root.position.set(r.sp[0] * r.sr, r.sp[1] * r.sr, r.sp[2] * r.sr);
          _up.set(r.sp[0], r.sp[1], r.sp[2]);
          orient(a.root, _up, r.f);
        }
      }
      const air = !!r.m[4];
      a.update(dt, time, {
        moving: !seated && r.m[0] > 2 && !air, speed: r.m[0] / 10, swept: !!r.m[3] && r.d < 0,
        airborne: air && r.d < 0, alt: r.m[1] / 100, vel: r.m[2] / 10,
        landed: v.wasAir && !air, seated, pushing,
      });
      v.wasAir = air;
      a.setToolSize(r.tw / 200);

      // jmenovka
      _v.copy(a.root.position).addScaledVector(_up.set(r.sp[0], r.sp[1], r.sp[2]), 2.3);
      const dist = _v.distanceTo(camera.position);
      _v.project(camera);
      const show = !hidden && _v.z < 1 && dist < TAG_RANGE;
      v.tag.hidden = !show;
      if (show) {
        v.tag.style.transform = `translate(${((_v.x + 1) / 2 * innerWidth).toFixed(1)}px, ${((1 - _v.y) / 2 * innerHeight).toFixed(1)}px) translate(-50%, -100%)`;
        v.tag.style.opacity = String(Math.max(0.35, 1 - dist / TAG_RANGE));
      }
    }
  }

  return { update, clear: () => { for (const p of [...views.keys()]) remove(p); } };
}
