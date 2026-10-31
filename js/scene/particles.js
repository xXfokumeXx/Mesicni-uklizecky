// Poletující měsíční prach za nástrojem (malý pool bodů, gravitace míří do středu Měsíce).
import { MOON_GRAVITY } from '../config.js';

const THREE = window.THREE;

export function createParticles(scene, count = 90) {
  const pos = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  const life = new Float32Array(count);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0xbdb6aa, size: 0.14, transparent: true, opacity: 0.8, depthWrite: false,
  }));
  points.frustumCulled = false;
  points.visible = false;
  scene.add(points);

  let next = 0;
  let alive = 0;

  // at = THREE.Vector3 (místo emise), spread = šířka v m
  function emit(at, n, spread) {
    const ux = at.x, uy = at.y, uz = at.z, l = Math.hypot(ux, uy, uz);
    const nx = ux / l, ny = uy / l, nz = uz / l;
    for (let k = 0; k < n; k++) {
      const i = next;
      next = (next + 1) % count;
      const jx = (Math.random() - 0.5) * spread, jy = (Math.random() - 0.5) * spread, jz = (Math.random() - 0.5) * spread;
      pos.set([at.x + jx, at.y + jy, at.z + jz], i * 3);
      const upSpeed = 0.6 + Math.random() * 0.9;
      vel.set([
        nx * upSpeed + (Math.random() - 0.5) * 1.2,
        ny * upSpeed + (Math.random() - 0.5) * 1.2,
        nz * upSpeed + (Math.random() - 0.5) * 1.2,
      ], i * 3);
      if (life[i] <= 0) alive++;
      life[i] = 1.4;
    }
    points.visible = true;
  }

  function update(dt) {
    if (!alive) return;
    for (let i = 0; i < count; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      if (life[i] <= 0) {
        alive--;
        pos[i * 3] = pos[i * 3 + 1] = pos[i * 3 + 2] = 0;   // schovat do středu Měsíce
        continue;
      }
      const o = i * 3;
      const l = Math.hypot(pos[o], pos[o + 1], pos[o + 2]);
      const g = MOON_GRAVITY * dt / l;
      vel[o] -= pos[o] * g;
      vel[o + 1] -= pos[o + 1] * g;
      vel[o + 2] -= pos[o + 2] * g;
      pos[o] += vel[o] * dt;
      pos[o + 1] += vel[o + 1] * dt;
      pos[o + 2] += vel[o + 2] * dt;
    }
    geo.attributes.position.needsUpdate = true;
    if (!alive) points.visible = false;
  }

  // Okamžitě schová všechen poletující prach (vypnutí v nastavení).
  function clear() {
    life.fill(0);
    pos.fill(0);
    alive = 0;
    points.visible = false;
  }

  return { emit, update, clear };
}
