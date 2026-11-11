// Vzhled energetiky (D-01, D-02, D-03, D-13):
//   • kontrolky: segmenty nabití baterií, LED solárů, světla slotů nabíječky – všechny jedno InstancedMesh (O-03)
//   • kabely vedení: jedna geometrie (trubka r 0,075, prověšená), modré pulzy v shaderu, když síť přenáší energii (O-09)
//   • nabíjecí kabel od stojanu k vozidlu, ikona přeškrtnutého blesku nad stavbou bez kabelu
//   • náhled kabelů k nejbližším uzlům při stavění energetické stavby
import { MOON } from '../config.js';
import { game } from '../state.js';
import { STRUCTURES, axes, localToDir, padTopHeight } from '../structures.js';
import { live, cableEnds, sagOf, cablePoint, vehicleOnSlot, autoTargets, anchorAt, cableFlows } from '../energy.js';
import { build } from '../build.js';
import { heightAt, terrainVersion } from '../planet/height.js';
import { VEHICLE_POINTS } from '../catalog.js';

const THREE = window.THREE;
const R = MOON.radius;
const IND_MAX = 800;
const C = {
  off: new THREE.Color(0x2a2d33), white: new THREE.Color(0xe8eef2), blue: new THREE.Color(0x5fb8d9), green: new THREE.Color(0x7fd38a),
  orange: new THREE.Color(0xe8742a), red: new THREE.Color(0xe0654c), dimBlue: new THREE.Color(0x24506a),
};

export function createEnergyView(scene, views) {
  // ---------- kontrolky ----------
  const ind = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), IND_MAX);
  for (let i = 0; i < IND_MAX; i++) ind.setColorAt(i, C.off);
  ind.count = 0;
  ind.frustumCulled = false;
  ind.userData.dbg = 'building';
  scene.add(ind);
  const _m = new THREE.Matrix4(), _t = new THREE.Matrix4(), _c = new THREE.Color();

  function indicatorsOf(b, out, now) {
    const def = STRUCTURES[b.type], e = def.energy, L = live.get(b.id);
    if (!e) return;
    const pad = def.pad, cx = (pad[0] + pad[1]) / 2, front = pad[3] + 0.03;
    if (e.role === 'storage') {
      // 5 segmentů (D-01): nabíjí = modrá vlna nahoru, plno = zelená, vybíjí = bílá, pod 20 % oranžová, prázdná = červený blikající
      const k = Math.max(0, Math.min(1, (b.data.charge || 0) / e.cap));
      const lit = Math.ceil(k * 5 - 1e-6);
      const flow = L?.flow || 0;
      const h = def.anchors[0][1] / 0.62;
      const w = Math.min(0.22, (pad[1] - pad[0]) * 0.11), y = Math.min(1.4, h * 0.55);
      for (let i = 0; i < 5; i++) {
        let col = C.off;
        if (i < lit) col = k >= 0.999 ? C.green : flow > 0.5 ? C.blue : k < 0.2 ? C.orange : flow < -0.5 ? C.white : C.blue;
        if (lit === 0 && i === 0) col = Math.floor(now / 400) % 2 ? C.red : C.off;
        let glow = 1;
        if (flow > 0.5 && i < lit) glow = 0.55 + 0.45 * Math.max(0, Math.sin(now / 160 - i * 0.9));   // vlna běží nahoru
        out.push({ x: cx + (i - 2) * w * 1.25, y, z: front, sx: w, sy: 0.12, sz: 0.05, col, glow });
      }
    } else if (e.role === 'source' && !e.rtg) {
      // LED u paty (D-02): zelená = vyrábí, modrá = málo (nízké Slunce), zhasnutá = noc / stín
      const col = !L?.wired || L.light === 'dark' ? C.off : L.light === 'low' ? C.blue : C.green;
      out.push({ x: cx, y: 0.35, z: front, sx: 0.14, sy: 0.14, sz: 0.06, col, glow: 1 });
    } else if (b.type === 'charger') {
      // světlo na stojanu (D-03): volný = bílé, nabíjí = modré pulzující, nabito = zelené, málo energie = oranžové blikání
      const n = b.data.slots || 1;
      for (let k = 0; k < n; k++) {
        const st = L?.slots?.[k]?.state || 'free';
        const [sx, sz] = def.stands[k];
        let col = C.white, glow = 1;
        if (!L?.wired) { col = C.orange; glow = Math.floor(now / 350) % 2 ? 1 : 0.2; }
        else if (st === 'charging') { col = C.blue; glow = 0.55 + 0.45 * Math.sin(now / 220); }
        else if (st === 'full') col = C.green;
        else if (st === 'short') { col = C.orange; glow = Math.floor(now / 350) % 2 ? 1 : 0.2; }
        out.push({ x: sx - 0.05, y: 3.6, z: sz - 0.4, sx: 0.3, sy: 0.3, sz: 0.3, col, glow });
      }
      // rámeček slotu na podlaze: aktivní = barva stavu (bílý volný, modrý pulzující nabíjí, zelený nabito, oranžový málo energie),
      // druhé místo základní nabíječky bez rozšíření = tmavý rámeček („neaktivní“)
      const y = (def.padTop || 0) + 0.16, W = 4.6, D = 5.4, T = 0.22;              // stání v modelu je o ~0,1 m výš než deska
      for (let k = 0; k < Math.max(2, n); k++) {
        const [cx0, cz0] = def.slots[k];
        let col = C.off, glow = 1;
        if (k < n) {
          const st = L?.slots?.[k]?.state || 'free';
          if (!L?.wired || st === 'short') { col = C.orange; glow = Math.floor(now / 350) % 2 ? 0.9 : 0.25; }
          else if (st === 'charging') { col = C.blue; glow = 0.5 + 0.5 * Math.sin(now / 220); }
          else if (st === 'full') col = C.green;
          else { col = C.white; glow = 0.55; }
        }
        out.push({ x: cx0, y, z: cz0 - D / 2, sx: W, sy: 0.03, sz: T, col, glow });
        out.push({ x: cx0, y, z: cz0 + D / 2, sx: W, sy: 0.03, sz: T, col, glow });
        out.push({ x: cx0 - W / 2, y, z: cz0, sx: T, sy: 0.03, sz: D, col, glow });
        out.push({ x: cx0 + W / 2, y, z: cz0, sx: T, sy: 0.03, sz: D, col, glow });
      }
    } else if (b.type === 'swapper') {
      // regál (D-04): nabitá = modrá, nabíjí se = oranžová pulzující (šířka = nabití), bez energie = červená; volná pozice = zhasnuto
      const rack = b.data.rack || [];
      def.rack.forEach(([x, y], k) => {
        if (k >= rack.length || rack[k] < 0) { out.push({ x, y, z: -5.52, sx: 0.5, sy: 0.12, sz: 0.04, col: C.off, glow: 1 }); return; }   // < 0 = baterii odnesl dron
        const q = rack[k];
        const charging = L?.wired && (L.f ?? 0) > 0.01 && q < 0.999;
        const col = q >= 0.999 ? C.blue : charging ? C.orange : C.red;
        const glow = charging ? 0.6 + 0.4 * Math.sin(now / 260 + k) : 1;
        out.push({ x: x - 0.25 + 0.25 * (q >= 0.999 ? 1 : Math.max(0.15, q)), y, z: -5.52, sx: 0.5 * (q >= 0.999 ? 1 : Math.max(0.15, q)), sy: 0.12, sz: 0.04, col, glow });
      });
      // stavové světlo na budce (L-09): modrá = je nabitá baterie, oranžová blikající = žádná
      const any = rack.some(q => q >= 0.999);
      out.push({ x: 9.9, y: 3.3, z: -4.25, sx: 0.35, sy: 0.35, sz: 0.06, col: any ? C.blue : C.orange, glow: any ? 1 : (Math.floor(now / 400) % 2 ? 1 : 0.25) });
    }
  }

  const list = [];
  function updateIndicators(now) {
    let n = 0;
    for (const v of views.values()) {
      if (v.dying || !v.root.visible || !STRUCTURES[v.b.type]?.energy) continue;
      list.length = 0;
      indicatorsOf(v.b, list, now);
      for (const d of list) {
        if (n >= IND_MAX) break;
        _t.makeScale(d.sx, d.sy, d.sz).setPosition(d.x, d.y, d.z);
        _m.multiplyMatrices(v.root.matrixWorld, _t);
        ind.setMatrixAt(n, _m);
        ind.setColorAt(n, _c.copy(d.col).multiplyScalar(d.glow));
        n++;
      }
    }
    ind.count = n;
    ind.instanceMatrix.needsUpdate = true;
    if (ind.instanceColor) ind.instanceColor.needsUpdate = true;
  }

  // ---------- kabely ----------
  const cableMat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: `
      attribute float along; attribute float live;
      varying float vAlong; varying float vLive; varying vec3 vN;
      void main() { vAlong = along; vLive = live; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    // live = směr toku: 1 od začátku kabelu, −1 opačně (modré „komety“ s hlavou ve směru toku),
    // 2 = oběma směry (jantarové pulzy proti sobě + slabá stálá záře), 0 = bez toku
    fragmentShader: `
      uniform float time; varying float vAlong; varying float vLive; varying vec3 vN;
      void main() {
        vec3 base = vec3(0.118, 0.106, 0.106) * (0.75 + 0.35 * vN.y);
        vec3 col = base;
        if (vLive > 1.5) {
          float a = smoothstep(0.86, 1.0, fract(vAlong / 4.0 - time * 0.6));
          float b = smoothstep(0.86, 1.0, fract(-vAlong / 4.0 - time * 0.6));
          col += vec3(1.0, 0.72, 0.28) * (max(a, b) * 1.2 + 0.12);
        } else if (abs(vLive) > 0.5) {
          float p = smoothstep(0.78, 1.0, fract(sign(vLive) * vAlong / 5.0 - time * 0.7));
          col += vec3(0.66, 0.94, 1.0) * p * 1.3;
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  let cableMesh = null, cableSig = '', cableCheckAt = 0;
  const SEG = 18, SIDES = 6, RAD = 0.075;

  function rebuildCables() {
    const s = game.s;
    const flows = cableFlows();                       // směr toku na každém kabelu (energy.js)
    const sig = (s.cables || []).map((c, k) => `${c[0]}-${c[1]}:${flows[k]}`).join('|') + '#' + [...views.keys()].length + '#' + terrainVersion();
    if (sig === cableSig) return;
    cableSig = sig;
    if (cableMesh) { scene.remove(cableMesh); cableMesh.geometry.dispose(); cableMesh = null; }
    const pos = [], nor = [], along = [], liveA = [], idx = [];
    const p = [0, 0, 0], q = [0, 0, 0];
    const t = new THREE.Vector3(), u = new THREE.Vector3(), w = new THREE.Vector3(), c = new THREE.Vector3(), o = new THREE.Vector3();
    for (const [ci, [a, b]] of (s.cables || []).entries()) {
      const A = s.buildings.find(x => x.id === a), B = s.buildings.find(x => x.id === b);
      if (!A || !B) continue;
      const ends = cableEnds(A, B);
      const sag = sagOf(ends.len);
      const lv = flows[ci] || 0;
      const base = pos.length / 3;
      for (let i = 0; i <= SEG; i++) {
        cablePoint(ends.a, ends.b, i / SEG, sag, p);
        cablePoint(ends.a, ends.b, Math.min(1, i / SEG + 0.01), sag, q);
        c.set(...p);
        t.set(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
        if (i === SEG) { cablePoint(ends.a, ends.b, 0.99, sag, q); t.set(p[0] - q[0], p[1] - q[1], p[2] - q[2]); }
        t.normalize();
        u.copy(c).normalize().cross(t).normalize();
        w.crossVectors(t, u).normalize();
        for (let k = 0; k < SIDES; k++) {
          const ang = k / SIDES * Math.PI * 2;
          o.copy(u).multiplyScalar(Math.cos(ang)).addScaledVector(w, Math.sin(ang));
          pos.push(c.x + o.x * RAD, c.y + o.y * RAD, c.z + o.z * RAD);
          nor.push(o.x, o.y, o.z);
          along.push(ends.len * i / SEG);
          liveA.push(lv);
        }
      }
      for (let i = 0; i < SEG; i++) for (let k = 0; k < SIDES; k++) {
        const a0 = base + i * SIDES + k, a1 = base + i * SIDES + (k + 1) % SIDES;
        const b0 = a0 + SIDES, b1 = a1 + SIDES;
        idx.push(a0, b0, b1, a0, b1, a1);
      }
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('along', new THREE.Float32BufferAttribute(along, 1));
    g.setAttribute('live', new THREE.Float32BufferAttribute(liveA, 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    cableMesh = new THREE.Mesh(g, cableMat);
    cableMesh.userData.dbg = 'building';
    scene.add(cableMesh);
  }

  // ---------- nabíjecí kabely a náhled ----------
  const LINE_MAX = 400;
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LINE_MAX * 2 * 3), 3));
  const chargeLines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0x1e1b1b }));
  chargeLines.frustumCulled = false;
  scene.add(chargeLines);
  const prevGeo = new THREE.BufferGeometry();
  prevGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LINE_MAX * 2 * 3), 3));
  const preview = new THREE.LineSegments(prevGeo, new THREE.LineBasicMaterial({ color: 0x7fd38a, transparent: true, opacity: 0.95 }));
  preview.frustumCulled = false;
  scene.add(preview);

  function sagLine(geo, start, a, b, sag, segs) {
    const P = geo.attributes.position;
    const p = [0, 0, 0], q = [0, 0, 0];
    let k = start;
    for (let i = 0; i < segs && k < LINE_MAX; i++) {
      cablePoint(a, b, i / segs, sag, p);
      cablePoint(a, b, (i + 1) / segs, sag, q);
      P.setXYZ(k * 2, ...p);
      P.setXYZ(k * 2 + 1, ...q);
      k++;
    }
    return k;
  }

  const _v = new THREE.Vector3();
  function updateChargeLines() {
    let k = 0;
    for (const v of views.values()) {
      if (v.b.type !== 'charger' || v.dying || !v.root.visible) continue;
      const L = live.get(v.b.id);
      const def = STRUCTURES.charger;
      for (let s = 0; s < (v.b.data.slots || 1); s++) {
        const i = vehicleOnSlot(v.b, s);
        const st = L?.slots?.[s]?.state;
        if (i < 0 || !st || st === 'free') continue;
        const veh = game.s.vehicles[i];
        const [sx, sz] = def.stands[s];
        _v.set(sx, 2.0, sz).applyMatrix4(v.root.matrixWorld);
        // konec kabelu: nabíjecí zásuvka vozidla (uzel „nabijeni“, 07 fáze B), jinak bok vozidla ve výšce 1,1 m
        const pl = veh.f ? VEHICLE_POINTS[veh.type]?.plug : null;
        let end;
        if (pl) {
          const p = veh.p, f = veh.f, rt = [p[1] * f[2] - p[2] * f[1], p[2] * f[0] - p[0] * f[2], p[0] * f[1] - p[1] * f[0]];   // osa +x vozidla = nahoru × dopředu
          const r = R + heightAt(p) + (def.padTop || 0) + pl[1];
          end = [0, 1, 2].map(c => p[c] * r + rt[c] * pl[0] + f[c] * pl[2]);
        } else {
          const r = R + heightAt(veh.p) + 1.1;
          end = [veh.p[0] * r, veh.p[1] * r, veh.p[2] * r];
        }
        k = sagLine(lineGeo, k, _v.toArray(), end, 0.45, 8);
      }
    }
    lineGeo.setDrawRange(0, k * 2);
    lineGeo.attributes.position.needsUpdate = true;
    chargeLines.visible = k > 0;
  }

  let previewAt = 0;
  function updatePreview(now) {
    // ruční kabel (zelená / červená) nebo kabel k bourání (červený)
    const S = game.s.buildings;
    if (build.mode === 'cable' || (build.mode === 'demolish' && build.cable)) {
      const [a, b] = build.mode === 'cable' ? [build.from, build.target] : build.cable;
      const A = S.find(x => x.id === a), B = b && S.find(x => x.id === b);
      let k = 0;
      if (A && B) {
        const ends = cableEnds(A, B);
        k = sagLine(prevGeo, 0, ends.a, ends.b, sagOf(ends.len), 16);
      }
      preview.material.color.setHex(build.mode === 'cable' && build.valid ? 0x7fd38a : 0xe0654c);
      prevGeo.setDrawRange(0, k * 2);
      prevGeo.attributes.position.needsUpdate = true;
      preview.visible = k > 0;
      return;
    }
    preview.material.color.setHex(0x7fd38a);
    const on = build.mode === 'build' && build.type && STRUCTURES[build.type]?.energy && build.p;
    preview.visible = !!on;
    if (!on || now - previewAt < 200) return;
    previewAt = now;
    const ghost = { id: null, type: build.type, p: build.p, yaw: build.yaw, data: {} };
    const targets = autoTargets(ghost);
    build.links = targets.length;
    let k = 0;
    for (const id of targets) {
      const B = game.s.buildings.find(x => x.id === id);
      const ends = cableEnds({ ...ghost, id: '__new' }, B);
      k = sagLine(prevGeo, k, ends.a, ends.b, sagOf(ends.len), 12);
    }
    prevGeo.setDrawRange(0, k * 2);
    prevGeo.attributes.position.needsUpdate = true;
  }

  // ---------- ikona „bez kabelu“ ----------
  const iconTex = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const x = cv.getContext('2d');
    x.fillStyle = 'rgba(18,20,26,0.85)'; x.beginPath(); x.arc(32, 32, 30, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#f2b33d'; x.beginPath(); x.moveTo(36, 8); x.lineTo(18, 36); x.lineTo(30, 36); x.lineTo(26, 56); x.lineTo(46, 26); x.lineTo(34, 26); x.closePath(); x.fill();
    x.strokeStyle = '#e0654c'; x.lineWidth = 6; x.beginPath(); x.moveTo(12, 52); x.lineTo(52, 12); x.stroke();
    return new THREE.CanvasTexture(cv);
  })();
  const iconMat = new THREE.SpriteMaterial({ map: iconTex, depthTest: false, transparent: true });
  const icons = [];
  function updateIcons() {
    let n = 0;
    for (const v of views.values()) {
      const def = STRUCTURES[v.b.type];
      if (!def?.energy || v.dying || !v.root.visible || def.energy.role === 'node') continue;
      if (live.get(v.b.id)?.wired ?? (game.s.cables || []).some(c => c[0] === v.b.id || c[1] === v.b.id)) continue;
      let sp = icons[n];
      if (!sp) { sp = new THREE.Sprite(iconMat); sp.scale.setScalar(1.1); sp.renderOrder = 7; scene.add(sp); icons[n] = sp; }
      const top = (def.anchors?.[0]?.[1] || 2) + 1.6;
      sp.position.set(0, top + Math.sin(performance.now() / 500) * 0.1, 0).applyMatrix4(v.root.matrixWorld);
      sp.visible = true;
      n++;
    }
    for (let i = n; i < icons.length; i++) icons[i].visible = false;
  }

  // Kabel pod kurzorem (bourání jednotlivého kabelu): nejbližší do 14 px na obrazovce → [idA, idB] nebo null.
  const _p = new THREE.Vector3();
  function pickCable(clientX, clientY, camera, canvas) {
    const r = canvas.getBoundingClientRect();
    let best = null, bestD = 14;
    const p = [0, 0, 0];
    for (const c of game.s.cables || []) {
      const A = game.s.buildings.find(x => x.id === c[0]), B = game.s.buildings.find(x => x.id === c[1]);
      if (!A || !B) continue;
      const ends = cableEnds(A, B), sag = sagOf(ends.len);
      for (let i = 0; i <= 12; i++) {
        cablePoint(ends.a, ends.b, i / 12, sag, p);
        _p.set(p[0], p[1], p[2]).project(camera);
        if (_p.z > 1) continue;
        const sx = r.left + (_p.x + 1) / 2 * r.width, sy = r.top + (1 - _p.y) / 2 * r.height;
        const d = Math.hypot(sx - clientX, sy - clientY);
        if (d < bestD) { bestD = d; best = [c[0], c[1]]; }
      }
    }
    return best;
  }

  return {
    pickCable,
    update(dt) {
      const now = performance.now();
      cableMat.uniforms.time.value = now / 1000;
      if (now - cableCheckAt > 1000) { cableCheckAt = now; rebuildCables(); }
      updateIndicators(now);
      updateChargeLines();
      updatePreview(now);
      updateIcons();
    },
    forceCables() { cableSig = ''; cableCheckAt = 0; },
  };
}
