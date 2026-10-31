// Rozmístění základny: budovy, jejich vchody, parkoviště garáže a místo startu.
// Souřadnice v metrech v tečné rovině středu základny: x = východ, y = sever.
import { MOON, BASE, INTERACT_RADIUS } from './config.js';
import { norm, angleBetween, tangentTo } from './planet/vec.js';

const R = MOON.radius;
const C = BASE.dir;
const E1 = [1, 0, 0];   // východ (tečna ve středu základny [0, 0, 1])
const E2 = [0, 1, 0];   // sever

export function baseDir(x, y) {
  return norm([C[0] + E1[0] * x / R + E2[0] * y / R, C[1] + E1[1] * x / R + E2[1] * y / R, C[2] + E1[2] * x / R + E2[2] * y / R]);
}

// door = jak daleko před budovou (směrem ke středu základny) je vchod
export const BUILDINGS = [
  { id: 'depot',    name: 'Výkup prachu',      x: 0,   y: 0,  door: 0 },
  { id: 'workshop', name: 'Dílna',             x: 16,  y: 4,  door: 4.6 },
  { id: 'toolshop', name: 'Obchod s nástroji', x: -16, y: 4,  door: 4.2 },
  { id: 'garage',   name: 'Garáž',             x: 0,   y: 19, door: 6.2 },
];

for (const b of BUILDINGS) {
  b.dir = baseDir(b.x, b.y);
  const len = Math.hypot(b.x, b.y) || 1;
  b.doorDir = baseDir(b.x - b.x / len * b.door, b.y - b.y / len * b.door);
  b.facing = b.id === 'depot' ? tangentTo(b.dir, E2) : tangentTo(b.dir, C.map((c, i) => c - b.dir[i]));
}

export const building = id => BUILDINGS.find(b => b.id === id);

export const SPAWN = baseDir(0, -9);
export const SPAWN_FACING = E2;

// Parkovací místa flotily (vozidla se tu objeví po koupi / přivolání):
// 6 míst v řadě před garáží a 4 místa po stranách garáže.
export function parkingSpot(i) {
  const k = ((i % 10) + 10) % 10;
  if (k < 6) return { dir: baseDir(-13.75 + k * 5.5, 11), facing: [0, -1, 0] };
  const j = k - 6;
  return { dir: baseDir(j % 2 ? 12.5 : -12.5, 17 + Math.floor(j / 2) * 5.5), facing: [0, -1, 0] };
}

// Je bod blízko vchodu budovy?
export function nearDoor(p, b) {
  return angleBetween(p, b.doorDir) * R < INTERACT_RADIUS;
}

export const distanceToBase = p => angleBetween(p, C) * R;
