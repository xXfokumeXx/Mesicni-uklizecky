// Overhaul základny (D-12): náměstí kolem Výkupu, cesty se svítícími obrubníky, sloupy osvětlení (za tmy světelné
// kruhy na zemi), směrovka a vyznačená stavební zóna. Data jsou v base.js (PLAZA, PATHS, …).
// Všechno je sloučené do 6 vykreslení (O-02): beton, sloupy, svítící prvky, světelné kruhy, nápisy, obrysy.
import { MOON } from '../config.js';
import { baseDir, PLAZA, PATHS, PLOTS, LAMPS, SIGNPOST, onPath } from '../base.js';
import { heightAt } from '../planet/height.js';

const THREE = window.THREE;
const R = MOON.radius;
const C_CONCRETE = 0xb4b2ab, C_PATH = 0xc2c0b8, C_EDGE = 0xf2b33d;
const C_POLE = 0x4b4f59, C_HEAD = 0x2d313b, C_LAMP = 0xfff0c8, C_CURB = 0xffe3a0;

// Bod (x, y) základny ve výšce lift nad terénem → THREE.Vector3
function at(x, y, lift, out = new THREE.Vector3()) {
  const d = baseDir(x, y);
  const r = R + heightAt(d) + lift;
  return out.set(d[0] * r, d[1] * r, d[2] * r);
}
// Místní osy v bodě (x, y): východ, nahoru, sever (tečná rovina)
function frame(x, y) {
  const up = at(x, y, 0).normalize();
  const e = new THREE.Vector3(1, 0, 0).addScaledVector(up, -up.x).normalize();
  const n = new THREE.Vector3().crossVectors(up, e).normalize();
  return { e, up, n };
}

// Sběrač geometrie s barvou ve vrcholech
function builder() {
  const pos = [], col = [], nrm = [], idx = [];
  const c = new THREE.Color();
  return {
    pos, col, idx,
    vert(v, color, normal) {
      pos.push(v.x, v.y, v.z);
      c.setHex(color);
      col.push(c.r, c.g, c.b);
      const n = normal || v.clone().normalize();
      nrm.push(n.x, n.y, n.z);
      return pos.length / 3 - 1;
    },
    // kvádr: střed (x, y) základny, výška nad terénem (spodek), rozměry e × výška × n, otočení kolem svislé osy
    box(x, y, bottom, w, h, d, color, yaw = 0) {
      const g = new THREE.BoxGeometry(w, h, d);
      const f = frame(x, y);
      const cs = Math.cos(yaw), sn = Math.sin(yaw);
      const ex = f.e.clone().multiplyScalar(cs).addScaledVector(f.n, sn);   // yaw = úhel od východu k severu
      const ez = new THREE.Vector3().crossVectors(ex, f.up);                  // pravotočivá báze (jinak by se obrátily stěny)
      const m = new THREE.Matrix4().makeBasis(ex, f.up, ez).setPosition(at(x, y, bottom + h / 2));
      g.applyMatrix4(m);
      const base = pos.length / 3;
      const p = g.attributes.position, n = g.attributes.normal;
      for (let i = 0; i < p.count; i++) this.vert(new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)), color, new THREE.Vector3(n.getX(i), n.getY(i), n.getZ(i)));
      for (const i of g.index.array) idx.push(base + i);
      g.dispose();
    },
    geometry() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeBoundingSphere();
      return g;
    },
  };
}

// Plocha zadaná obvodem shape(u) → [x, y] (u 0–1) a středem; mřížka po obvodu (seg) × poloměru (rings) sleduje zakřivení
function fan(b, cx, cy, shape, seg, rings, lift, color, from = 0) {
  const rows = [];
  for (let k = 0; k <= rings; k++) {
    const v = from + (1 - from) * k / rings, row = [];
    for (let i = 0; i < seg; i++) {
      const [px, py] = shape(i / seg);
      row.push(b.vert(at(cx + (px - cx) * v, cy + (py - cy) * v, lift), color));
    }
    rows.push(row);
  }
  for (let k = 0; k < rings; k++) {
    for (let i = 0; i < seg; i++) {
      const a = rows[k][i], b2 = rows[k][(i + 1) % seg], c = rows[k + 1][i], d = rows[k + 1][(i + 1) % seg];
      b.idx.push(a, c, b2, b2, c, d);
    }
  }
}
// Šestiúhelník s vrcholy na ±y
const hexShape = r => u => {
  const s = u * 6, k = Math.floor(s), t = s - k;
  const a0 = Math.PI / 2 + k * Math.PI / 3, a1 = a0 + Math.PI / 3;
  return [r * (Math.cos(a0) * (1 - t) + Math.cos(a1) * t), r * (Math.sin(a0) * (1 - t) + Math.sin(a1) * t)];
};

// Pás betonu z (x0, y0) do (x1, y1) šířky w, po ~1 m
function strip(b, x0, y0, x1, y1, w, lift, color) {
  const L = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(L));
  const ux = (x1 - x0) / L, uy = (y1 - y0) / L, nx = -uy * w / 2, ny = ux * w / 2;
  let prev = null;
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
    const cur = [b.vert(at(x - nx, y - ny, lift), color), b.vert(at(x + nx, y + ny, lift), color)];
    if (prev) b.idx.push(prev[0], cur[0], prev[1], prev[1], cur[0], cur[1]);
    prev = cur;
  }
}

// Atlas nápisů (jedno vykreslení pro všechny cedule a nápisy na zemi)
function textAtlas(texts) {
  const W = 1024, H = 128, c = document.createElement('canvas');
  c.width = W; c.height = H * texts.length;
  const ctx = c.getContext('2d');
  const uv = {};
  texts.forEach(({ id, text, bg, fg, size = 0.62, align = 'center' }, i) => {
    const y = i * H;
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, y, W, H); }
    ctx.fillStyle = fg;
    ctx.font = `600 ${Math.round(H * size)}px "Chakra Petch", "Arial Narrow", sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, align === 'center' ? W / 2 : 24, y + H * 0.52);
    uv[id] = [(i * H + 2) / c.height, ((i + 1) * H - 2) / c.height];
  });
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return { tex, uv, aspect: W / H };
}

export function createBasePlaza(scene) {
  // ---------- beton: náměstí a cesty ----------
  const ground = builder();
  fan(ground, 0, 0, hexShape(PLAZA.r - 0.35), 48, 10, 0.05, C_CONCRETE);
  fan(ground, 0, 0, hexShape(PLAZA.r), 48, 1, 0.055, C_EDGE, (PLAZA.r - 0.35) / PLAZA.r);     // žlutý okraj
  for (const p of PATHS) strip(ground, ...p.from, ...p.to, p.w, 0.06, C_PATH);
  const groundMat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const groundMesh = new THREE.Mesh(ground.geometry(), groundMat);
  groundMesh.receiveShadow = true;
  groundMesh.userData.dbg = 'building';

  // ---------- sloupy, směrovka (tmavé díly) a svítící prvky ----------
  const poles = builder(), glow = builder();
  for (const [x, y] of LAMPS) {
    poles.box(x, y, 0, 0.5, 0.25, 0.5, C_HEAD);                 // patka
    poles.box(x, y, 0.25, 0.16, 4.6, 0.16, C_POLE);             // sloup
    poles.box(x, y, 4.75, 0.7, 0.22, 0.45, C_HEAD);             // hlava
    glow.box(x, y, 4.66, 0.56, 0.08, 0.34, C_LAMP);             // svítidlo (spodek hlavy)
  }
  // svítící obrubníky: po obou stranách cest a po obvodu náměstí (kus u budov a zón vynechán)
  for (const { from: [x0, y0], to: [x1, y1], w } of PATHS) {
    const L = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / L, uy = (y1 - y0) / L, yaw = Math.atan2(uy, ux);
    for (let s = 1; s < L; s += 2) {
      for (const sg of [-1, 1]) glow.box(x0 + ux * s - uy * sg * (w / 2 + 0.15), y0 + uy * s + ux * sg * (w / 2 + 0.15), 0, 0.32, 0.09, 0.12, C_CURB, yaw);
    }
  }
  const hex = hexShape(PLAZA.r + 0.1);
  for (let i = 0; i < 72; i++) {
    const [x, y] = hex(i / 72);
    if (Math.abs(x) > 10.5 || onPath(x, y, 0.4)) continue;        // u Dílny a Obchodu (desky budov) a kde začíná cesta
    glow.box(x, y, 0, 0.22, 0.09, 0.22, C_CURB);
  }
  // směrovka: sloup + 3 tabule (texty z atlasu níž)
  const [sx, sy] = SIGNPOST;
  poles.box(sx, sy, 0, 0.14, 3.4, 0.14, C_POLE);
  const boards = [
    { id: 'dilna', text: 'DÍLNA  →', y: 3.0 },
    { id: 'obchod', text: '←  OBCHOD S NÁSTROJI', y: 2.45 },
    { id: 'zona', text: '↓  STAVEBNÍ ZÓNA', y: 1.9 },
  ];
  for (const bd of boards) poles.box(sx, sy, bd.y - 0.22, 2.3, 0.44, 0.06, C_HEAD);
  const polesMesh = new THREE.Mesh(poles.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  polesMesh.userData.dbg = 'building';
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const glowMesh = new THREE.Mesh(glow.geometry(), glowMat);
  glowMesh.userData.dbg = 'building';

  // ---------- nápisy: tabule směrovky a nápisy na zemi (jeden atlas) ----------
  const atlas = textAtlas([
    ...boards.map(b => ({ id: b.id, text: b.text, bg: '#1b1e26', fg: '#e4e2da', size: 0.5 })),
    ...PLOTS.map((p, i) => ({ id: `plot${i}`, text: p.name, fg: 'rgba(242,179,61,0.92)', size: 0.7 })),
    { id: 'zoneText', text: 'STAVEBNÍ ZÓNA', fg: 'rgba(242,179,61,0.75)', size: 0.6 },
  ]);
  const tb = builder(), tuv = [];
  const quad = (corners, id) => {                                // corners: 4 Vector3 (vlevo dole, vpravo dole, vpravo nahoře, vlevo nahoře)
    const [v0, v1] = atlas.uv[id], base = tb.pos.length / 3;
    corners.forEach(c => tb.vert(c, 0xffffff));
    tuv.push(0, 1 - v1, 1, 1 - v1, 1, 1 - v0, 0, 1 - v0);
    tb.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  // tabule (čelem na jih – ke spawnu)
  for (const bd of boards) {
    const f = frame(sx, sy), c = at(sx, sy, bd.y).addScaledVector(f.n, -0.035);
    const w = 2.25, hh = w / atlas.aspect / 2;
    quad([c.clone().addScaledVector(f.e, -w / 2).addScaledVector(f.up, -hh), c.clone().addScaledVector(f.e, w / 2).addScaledVector(f.up, -hh),
      c.clone().addScaledVector(f.e, w / 2).addScaledVector(f.up, hh), c.clone().addScaledVector(f.e, -w / 2).addScaledVector(f.up, hh)], bd.id);
  }
  // nápis na zemi: střed (x, y), šířka w, čtení od jihu (spodek textu na jih)
  const groundText = (x, y, w, id) => {
    const h = w / atlas.aspect * 2.2;
    const p = (dx, dy) => at(x + dx, y + dy, 0.08);
    quad([p(-w / 2, -h / 2), p(w / 2, -h / 2), p(w / 2, h / 2), p(-w / 2, h / 2)], id);
  };
  PLOTS.forEach((p, i) => groundText(p.x, p.y, Math.min(p.w * 0.9, p.name.length * 1.6 + 2), `plot${i}`));
  groundText(0, -26.5, 14, 'zoneText');
  const tg = tb.geometry();
  tg.setAttribute('uv', new THREE.Float32BufferAttribute(tuv, 2));
  const textMat = new THREE.MeshBasicMaterial({ map: atlas.tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const textMesh = new THREE.Mesh(tg, textMat);
  textMesh.userData.dbg = 'building';

  // ---------- obrysy stavební zóny (přerušované) ----------
  const lp = [];
  const dash = (x0, y0, x1, y1) => {
    const L = Math.hypot(x1 - x0, y1 - y0);
    for (let s = 0; s < L; s += 1.6) {
      const e = Math.min(L, s + 0.9);
      for (const t of [s / L, e / L]) { const v = at(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 0.1); lp.push(v.x, v.y, v.z); }
    }
  };
  for (const p of PLOTS) {
    const x0 = p.x - p.w / 2, x1 = p.x + p.w / 2, y0 = p.y - p.h / 2, y1 = p.y + p.h / 2;
    dash(x0, y0, x1, y0); dash(x1, y0, x1, y1); dash(x1, y1, x0, y1); dash(x0, y1, x0, y0);
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: C_EDGE, transparent: true, opacity: 0.9 }));
  lines.userData.dbg = 'building';

  // ---------- světelné kruhy pod lampami (za tmy, aditivně) ----------
  const pc = document.createElement('canvas');
  pc.width = pc.height = 128;
  const px = pc.getContext('2d'), gr = px.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,236,190,1)'); gr.addColorStop(0.45, 'rgba(255,226,170,0.45)'); gr.addColorStop(1, 'rgba(255,220,160,0)');
  px.fillStyle = gr; px.fillRect(0, 0, 128, 128);
  const pb = builder(), puv = [];
  for (const [x, y] of LAMPS) {
    const N = 4, r = 5.5, base = pb.pos.length / 3;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      pb.vert(at(x - r + 2 * r * i / N, y - r + 2 * r * j / N, 0.12), 0xffffff);
      puv.push(i / N, j / N);
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = base + j * (N + 1) + i;
      pb.idx.push(a, a + 1, a + N + 1, a + 1, a + N + 2, a + N + 1);
    }
  }
  const pg = pb.geometry();
  pg.setAttribute('uv', new THREE.Float32BufferAttribute(puv, 2));
  const poolMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(pc), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
  const pools = new THREE.Mesh(pg, poolMat);
  pools.visible = false;

  const all = [groundMesh, polesMesh, glowMesh, textMesh, lines, pools];
  for (const m of all) scene.add(m);

  let lastDark = -1;
  return {
    meshes: all,
    // dark = 0 den … 1 noc (tma u základny): rozsvítí lampy, obrubníky a světelné kruhy
    update(dark) {
      if (Math.abs(dark - lastDark) < 0.01) return;
      lastDark = dark;
      glowMat.color.setScalar(0.45 + 0.55 * dark);
      poolMat.opacity = 0.42 * dark;
      pools.visible = dark > 0.02;
    },
  };
}
