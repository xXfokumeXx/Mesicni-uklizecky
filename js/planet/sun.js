// Pohyb Slunce po obloze Měsíce (Měsíc se otáčí kolem osy y se sklonem 1,54°).
import { SUN } from '../config.js';
import { dot } from './vec.js';

export const sunAngle = ms => (ms / 1000 / SUN.dayLength) * Math.PI * 2;

export function sunDirection(ms) {
  const th = sunAngle(ms), e = SUN.tilt;
  return [Math.sin(th) * Math.cos(e), Math.sin(e), Math.cos(th) * Math.cos(e)];
}

// Výška Slunce nad obzorem ve stupních pro bod p na povrchu.
export function sunElevationDeg(p, ms) {
  return Math.asin(Math.max(-1, Math.min(1, dot(p, sunDirection(ms))))) * 180 / Math.PI;
}
