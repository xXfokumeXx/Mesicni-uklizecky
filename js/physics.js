// Fyzika těles na Měsíci. Gravitace míří vždy do středu Měsíce (radiálně).
// Těleso = směr p (jednotkový vektor), vzdálenost od středu r, radiální rychlost vr
// a vodorovná (tečná) rychlost v. Na zemi se drží povrchu; když terén „uteče“ rychleji,
// než by těleso padalo, odlepí se (vyskočí z hřebene). Ve vzduchu letí balisticky.
import { MOON, MOON_GRAVITY, AIR_CONTROL } from './config.js';
import { heightAt } from './planet/height.js';
import { madd, norm, tangentTo, dot } from './planet/vec.js';

const R = MOON.radius;
const MAX_SUBSTEP = 1 / 60;

// maxVr = nejvyšší svislá rychlost, se kterou těleso vyletí z hřebene (tlumiče).
// grip = přilnavost: kolikrát silněji než gravitace drží boty / pneumatiky na svahu.
//   Bez ní by na Měsíci (g = 1,62) letělo všechno z každého boulí; s ní se odlepí jen na ostrém hřebeni.
// airG = kolikrát měsíční gravitace táhne těleso dolů, když nechtěně vyletí (výchozí = grip,
//   tlumiče ho „stáhnou“; 1 = skutečná měsíční gravitace, dlouhé lety).
export function createBody(p, maxVr = 3, grip = 4, airG = grip) {
  const r = R + heightAt(p);
  return { p, r, g: r, vr: 0, v: [0, 0, 0], grounded: true, landed: 0, maxVr, grip, airG };
}

// Výška nad terénem (m).
export const altitude = b => b.r - (R + heightAt(b.p));

// Pozice tělesa ve světě [x, y, z].
export const bodyPos = b => [b.p[0] * b.r, b.p[1] * b.r, b.p[2] * b.r];

export function jumpBody(b, speed) {
  if (!b.grounded) return false;
  b.vr = Math.max(b.vr, 0) + speed;
  b.grounded = false;
  b.jumped = true;
  return true;
}

// want = požadovaná tečná rychlost [m/s] nebo null (na zemi = stát, ve vzduchu = letět dál).
// air = jak moc jde měnit směr ve vzduchu (0 = vůbec).
function substep(b, dt, want, air) {
  // vodorovně
  if (b.grounded) {
    b.v = want ? want.slice() : [0, 0, 0];
  } else if (want && air > 0) {
    const k = Math.min(1, dt * air);
    b.v = [b.v[0] + (want[0] - b.v[0]) * k, b.v[1] + (want[1] - b.v[1]) * k, b.v[2] + (want[2] - b.v[2]) * k];
  }
  const speed = Math.hypot(b.v[0], b.v[1], b.v[2]);
  if (speed > 1e-4) {
    const p = norm(madd(b.p, b.v, dt / b.r));
    b.v = tangentTo(p, b.v).map(c => c * speed);       // rychlost se „přenese“ do nové tečné roviny
    b.p = p;
  }

  // svisle (radiálně)
  const ground = R + heightAt(b.p);
  const slopeRate = (ground - b.g) / dt;              // jak rychle stoupá/klesá terén pod tělesem
  b.g = ground;
  if (!b.grounded) {
    // skok = plná měsíční lehkost; nechtěný odskok z hrbolu tlumiče rychle „stáhnou“ zpět
    b.vr -= MOON_GRAVITY * (b.jumped ? 1 : b.airG) * dt;
    b.r += b.vr * dt;
    if (b.r <= ground) {
      b.landed = -b.vr;                                // rychlost dopadu (pro efekty)
      b.r = ground;
      b.vr = slopeRate;                                // dál po svahu, ne znovu do vzduchu
      b.grounded = true;
      b.jumped = false;
    }
    return;
  }
  // Kam by těleso „spadlo“ s přilnavostí? Když terén klesá rychleji (zakřivení·v² > grip·g),
  // mohlo by se odlepit. Odlepí se ale jen tehdy, když by opravdu letělo – tlumiče a nohy
  // pohltí hrbol, po kterém by dopadlo do zlomku sekundy (willFly).
  const fall = b.r + b.vr * dt - 0.5 * MOON_GRAVITY * b.grip * dt * dt;
  if (ground < fall - 0.004 && speed > 0.5 && willFly(b, Math.min(b.vr, b.maxVr), speed)) {
    b.grounded = false;
    b.vr = Math.min(b.vr, b.maxVr) - MOON_GRAVITY * dt;
    b.r = Math.max(ground, b.r + b.vr * dt);
  } else {
    b.vr = (ground - b.r) / dt;                        // skutečná svislá rychlost po povrchu
    b.r = ground;
  }
}

// Předpověď: vyletí těleso z hřebene na déle než FLY_MIN s? (dráha s přilnavostí vs. terén před ním)
const FLY_MIN = 0.45;
function willFly(b, vr, speed) {
  const g = MOON_GRAVITY * b.grip;
  for (let i = 1; i <= 5; i++) {
    const t = FLY_MIN * i / 5;
    const r = b.r + vr * t - 0.5 * g * t * t;
    const p = norm(madd(b.p, b.v, t / b.r));
    if (r <= R + heightAt(p) + 0.05) return false;     // za chvilku by stejně dopadlo → drž se země
  }
  return speed > 0;
}

export function stepBody(b, dt, want = null, air = AIR_CONTROL) {
  b.landed = 0;
  const n = Math.max(1, Math.ceil(dt / MAX_SUBSTEP));
  for (let i = 0; i < n; i++) substep(b, dt / n, want, air);
}

// Udrží tečnou rychlost a směr v tečné rovině (po změně polohy).
export const horizontalSpeed = b => Math.hypot(b.v[0], b.v[1], b.v[2]);
export const forwardSpeed = (b, f) => dot(b.v, f);
