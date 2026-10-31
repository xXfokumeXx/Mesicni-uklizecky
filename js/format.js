// Formátování čísel: 12.5 · 840 · 4.2k · 1.35M
export const fmt = n =>
  n < 1e3 ? n.toFixed(n < 100 ? 1 : 0)
  : n < 1e6 ? (n / 1e3).toFixed(1) + 'k'
  : (n / 1e6).toFixed(2) + 'M';
