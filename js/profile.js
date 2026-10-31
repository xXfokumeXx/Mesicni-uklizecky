// Profil hráče (jméno a vzhled astronauta) – patří prohlížeči, ne uložené hře.
// Platí pro všechny sloty i pro multiplayer.
import { DEFAULT_LOOK, SUIT_COLORS, propById } from './catalog.js';

const KEY = 'ms2_profile';

export const profile = {
  name: '',
  look: { ...DEFAULT_LOOK },
};

const clean = s => String(s || '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '').trim();

export function sanitizeName(s) {
  return clean(s).slice(0, 16);
}

export function validLook(l) {
  const look = { ...DEFAULT_LOOK };
  if (l && Number.isInteger(l.color) && l.color >= 0 && l.color < SUIT_COLORS.length) look.color = l.color;
  if (l && propById(l.top)?.slot === 'top') look.top = l.top;
  if (l && propById(l.face)?.slot === 'face') look.face = l.face;
  return look;
}

export function loadProfile() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY));
    if (p) {
      profile.name = sanitizeName(p.name);
      profile.look = validLook(p.look);
    }
  } catch { /* poškozené nebo nedostupné úložiště */ }
  if (!profile.name) profile.name = `Zametač-${Math.floor(100 + Math.random() * 900)}`;
}

export function saveProfile() {
  try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch { /* nic */ }
}
