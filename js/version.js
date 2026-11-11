// Verze hry – jediný zdroj pravdy (L-60, 3.1). BUILD a DATE doplní při nasazení scripts/stamp-version.mjs
// (zároveň zapíše version.json do kořene webu, podle kterého hra pozná, že je na serveru novější verze).
// VERSION mění Claude Code ručně: oprava po nasazení 3.1.1, 3.1.2…, větší update 3.2.0.
export const VERSION = '3.1.1';          // MAJOR.MINOR.PATCH
export const BUILD = 'aa840aa';              // zkrácený hash commitu (skript při nasazení)
export const DATE = '2026-11-11T09:04';  // čas sestavení (skript při nasazení)
export const NET_PROTOCOL = 5;           // zvýšit při každé změně formátu dat v multiplayeru (5 = 3.1)

export const MAJOR_MINOR = VERSION.split('.').slice(0, 2).join('.');

// Porovnání verzí „3.1.0“ / „3.0.4“: záporné = a je starší než b, 0 = stejné, kladné = a je novější.
export function cmpVersion(a, b) {
  const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

const pad = n => String(n).padStart(2, '0');
function parts(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(iso || ''));
  return m ? { y: +m[1], mo: +m[2], d: +m[3], h: m[4] ?? null, mi: m[5] ?? null } : null;
}
// „v3.1.0 · 6. 11. 2026“
export function versionLabel(ver = VERSION, date = DATE) {
  const p = parts(date);
  return p ? `v${ver} · ${p.d}. ${p.mo}. ${p.y}` : `v${ver}`;
}
// „v3.1.0 · build a1b2c3d · 6. 11. 2026 14:32“
export function versionFull(ver = VERSION, build = BUILD, date = DATE) {
  const p = parts(date);
  const when = p ? `${p.d}. ${p.mo}. ${p.y}${p.h !== null ? ` ${pad(p.h)}:${pad(p.mi)}` : ''}` : '';
  return [`v${ver}`, `build ${build}`, when].filter(Boolean).join(' · ');
}
