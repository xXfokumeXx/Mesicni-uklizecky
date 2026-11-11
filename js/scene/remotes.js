// Ostatní hráči v multiplayeru: astronaut s jejich vzhledem, animace podle presence,
// sedadlo ve vozidle (řidič i cestující v přepravníku), jetpack, ragdoll a jmenovka nad hlavou.
import { MOON } from '../config.js';
import { SUIT_COLORS } from '../catalog.js';
import { net } from '../net.js';
import { remoteRagdoll, advanceRemote, correctRemote, ragdollPoints } from '../ragdoll.js';
import { game } from '../state.js';
import { instantiate } from '../assets/models.js';
import { rankName, rankBadge } from '../ranks.js';

const THREE = window.THREE;
const R = MOON.radius;
const TAG_RANGE = 140;
// Úroveň detailu astronauta (O-21, 3.1): do 25 m plná, do 60 m mixer 30×/s, do 120 m pevná póza bez stínu, dál nic.
const LOD_HALF = 25, LOD_FROZEN = 60, FAR_HIDE = 120, IK_RANGE = 40;

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
      const astro = instantiate('astronaut', r.look);
      astro.root.traverse(o => { if (o.isMesh && !o.userData.blob && !o.material.transparent) o.castShadow = true; });
      scene.add(astro.root);
      const tag = document.createElement('div');
      tag.className = 'nametag';
      layer.append(tag);
      v = { astro, tag, lookKey: '', wasAir: false, name: '', rank: null };
      views.set(r.peer, v);
    }
    const key = `${r.look.skin}|${r.look.color}|${r.look.top}|${r.look.face}`;
    if (key !== v.lookKey) { v.lookKey = key; v.astro.setLook(r.look); }
    if (v.name !== r.name || v.rank !== r.rank) {           // jmenovka: hodnost (malým písmem) nad jménem
      v.name = r.name;
      v.rank = r.rank;
      const rk = rankName(r.rank);
      v.tag.replaceChildren();
      if (rk) {                                              // odznak hodnosti před názvem (3.1)
        const small = Object.assign(document.createElement('small'), { className: 'nametag__rank' });
        small.append(Object.assign(document.createElement('img'), { className: 'rank-badge', src: rankBadge(r.rank), alt: '' }), document.createTextNode(rk));
        v.tag.append(small);
      }
      v.tag.append(document.createTextNode(r.name));
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
      // ragdoll po srážce si počítám sám ze začátku letu, polohu pánve dotahuji podle korekcí
      if (!r.rag) v.rag = null;
      else if (!v.rag || v.rag.k !== r.rag.k) v.rag = remoteRagdoll(r.rag, (Date.now() + game.clockOffset - r.rag.a) / 1000);
      if (v.rag) {
        advanceRemote(v.rag, dt);
        if (r.ragFix) correctRemote(v.rag, r.ragFix);
      }
      let seated = false, pushing = false;
      if (v.rag) {
        a.applyRagdoll(ragdollPoints(v.rag));
      } else {
        if (a.ragdolling) a.endRagdoll();                    // vstávání klipem (směr z presence f)
        const seat = r.d >= 0 ? actors.seatTransform(r.d, a.root)
          : r.rd && actors.passengerTransform(r.rd[0], r.rd[1], a.root) ? 'seat' : false;
        if (seat === 'seat') seated = true;
        else if (seat === 'push') pushing = true;
        else {
          a.root.position.set(r.sp[0] * r.sr, r.sp[1] * r.sr, r.sp[2] * r.sr);
          _up.set(r.sp[0], r.sp[1], r.sp[2]);
          orient(a.root, _up, r.f);
        }
      }
      // úroveň detailu 4× za sekundu (O-13 krok 3): do 40 m plný, do 120 m snímek, dál nic.
      // Sezení, tlačení vozíku a ragdoll potřebují pózu → plný model.
      v.lodT = (v.lodT ?? 0) - dt;
      if (v.lodT <= 0) {
        v.lodT = 0.25;
        const dist = a.root.position.distanceTo(camera.position);
        const posed = seated || pushing || !!v.rag;
        let level = dist >= FAR_HIDE ? 3 : dist >= LOD_FROZEN ? 2 : dist >= LOD_HALF ? 1 : 0;
        if (posed && level === 2) level = 1;               // sezení, vozík a ragdoll potřebují pózu
        if (level !== a.detail) {
          a.setDetail(level);
          a.mesh?.traverse?.(o => { if (o.isMesh) o.castShadow = level < 2; });
        }
        v.ikOk = dist < IK_RANGE;
      }
      // sedí ve vozidle, které je za hranicí kreslení → ani on (jinak by visel ve vzduchu bez letounu, 11. 11.)
      const inHidden = seated && !actors.vehicleShown(r.d >= 0 ? r.d : r.rd[0]);
      a.root.visible = !hidden && a.detail !== 3 && !inHidden;
      a.setHands?.(v.ikOk && (seated || pushing) && r.d >= 0 ? actors.handsFor(r.d) : null);
      const air = !!r.m[4];
      a.update(dt, time, {
        moving: !seated && r.m[0] > 2 && !air, speed: r.m[0] / 10, swept: !!r.m[3] && r.d < 0,
        airborne: air && r.d < 0, alt: r.m[1] / 100, vel: r.m[2] / 10,
        landed: v.wasAir && !air, seated, pushing,
      });
      v.wasAir = air;
      a.setTool?.(r.tool);                                     // nástroj v ruce podle presence tl (3.1, AST-06)
      a.setToolSize(seated ? 0 : r.tw / 200);
      a.setJetpack(r.jp);

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

  // Čelovka ostatního hráče (poloha a vodorovný směr pohledu helmy) – pro reflektory (scene/lights.js).
  function lampOf(peer, pos, dir) {
    const v = views.get(peer);
    if (!v || v.rag || !v.astro.root.visible) return false;
    v.astro.root.updateMatrixWorld();
    v.astro.lampPosition(pos);
    v.astro.lampDirection(dir);
    return true;
  }

  return { update, lampOf, clear: () => { for (const p of [...views.keys()]) remove(p); } };
}
