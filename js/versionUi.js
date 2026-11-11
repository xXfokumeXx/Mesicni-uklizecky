// Verze hry v menu, lobby, menu pauzy a nastavení grafiky (D-18, L-60, 3.1).
// Každý prvek s atributem data-ver dostane „v3.1.0 · 6. 11. 2026“ (po najetí myší plná verze s buildem),
// kliknutí otevře okno Novinky ve verzi (poslední 3 verze z CHANGELOG.md). data-ver-mm = jen „3.1“.
// Každých 10 minut se stáhne version.json – když je na serveru novější verze, ukáže se nad číslem
// žlutý štítek „Je dostupná v3.1.1 · obnov stránku“ (klik = obnovit) a ve hře jednou toast (onNewer).
import { VERSION, MAJOR_MINOR, cmpVersion, versionLabel, versionFull } from './version.js';

const CHECK_MS = 10 * 60 * 1000;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const latest = { version: null, build: null, date: null };
let hooks = {};
let told = false;

export function initVersionUi(h = {}) {
  hooks = h;
  for (const el of document.querySelectorAll('[data-ver-mm]')) el.textContent = MAJOR_MINOR;
  for (const el of document.querySelectorAll('[data-ver]')) renderBadge(el);
  document.addEventListener('click', e => {
    if (e.target.closest('.ver__new')) { location.reload(); return; }
    if (e.target.closest('.ver__btn')) openNews();
  });
  addEventListener('keydown', e => {                      // Esc zavře Novinky dřív, než ho chytí menu pauzy
    if (e.key === 'Escape' && newsOpen()) { closeNews(); e.stopImmediatePropagation(); e.preventDefault(); }
  }, true);
  setTimeout(checkLatest, 4000);
  setInterval(checkLatest, CHECK_MS);
}

function renderBadge(el) {
  el.classList.add('ver');
  el.innerHTML = `<button class="ver__new" type="button" hidden></button>`
    + `<button class="ver__btn" type="button" title="Novinky ve verzi" aria-label="Verze hry ${esc(VERSION)} – novinky">`
    + `<span class="ver__short">${esc(versionLabel())}</span><span class="ver__full">${esc(versionFull())}</span></button>`;
}

function showNewer() {
  const text = `Je dostupná v${latest.version} · obnov stránku`;
  for (const b of document.querySelectorAll('.ver__new')) { b.textContent = text; b.hidden = false; b.title = 'Obnovit stránku (Ctrl+F5)'; }
  if (!told) { told = true; hooks.onNewer?.(latest.version); }
}

export async function checkLatest() {
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const j = await res.json();
    if (typeof j?.version !== 'string') return;
    Object.assign(latest, { version: j.version, build: j.build || null, date: j.date || null });
    if (cmpVersion(j.version, VERSION) > 0) showNewer();
  } catch { /* offline / soubor chybí – nic */ }
}

// ---------- okno Novinky ve verzi ----------

let modal = null;
const newsOpen = () => !!modal && !modal.hidden;

function ensureModal() {
  if (modal) return modal;
  modal = document.createElement('div');
  modal.className = 'modal news';
  modal.id = 'news';
  modal.hidden = true;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'news-title');
  modal.innerHTML = `
    <div class="modal__backdrop" data-news-close></div>
    <div class="modal__panel news__panel">
      <header class="modal__header">
        <h2 class="modal__title" id="news-title">Novinky ve verzi</h2>
        <button class="modal__close" type="button" aria-label="Zavřít" data-news-close>×</button>
      </header>
      <div class="modal__body news__body" id="news-body"><p class="field__hint">Načítám…</p></div>
      <footer class="modal__footer news__footer"><span class="news__ver">${esc(versionFull())}</span>
        <button class="button button--primary" type="button" data-news-close>Zavřít</button></footer>
    </div>`;
  modal.addEventListener('click', e => { if (e.target.closest('[data-news-close]')) closeNews(); });
  document.body.appendChild(modal);
  return modal;
}

export async function openNews() {
  ensureModal().hidden = false;
  modal.querySelector('.modal__close').focus();
  const body = modal.querySelector('#news-body');
  try {
    const res = await fetch(`CHANGELOG.md?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    body.innerHTML = newsHtml(parseChangelog(await res.text()).slice(0, 3));
  } catch {
    body.innerHTML = '<p class="field__hint">Seznam novinek se nepodařilo načíst.</p>';
  }
}

export function closeNews() {
  if (modal) modal.hidden = true;
}

// „## 3.1.0 · 10. 11. 2026“ + body „- …“ → [{ version, date, items[] }]
export function parseChangelog(md) {
  const out = [];
  let cur = null;
  for (const line of String(md).split(/\r?\n/)) {
    const h = /^##\s+(\d+\.\d+\.\d+)\s*(?:·\s*(.*))?$/.exec(line.trim());
    if (h) { cur = { version: h[1], date: (h[2] || '').trim(), items: [] }; out.push(cur); continue; }
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (li && cur) cur.items.push(li[1].trim());
  }
  return out;
}

const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');

function newsHtml(list) {
  if (!list.length) return '<p class="field__hint">Zatím žádné novinky.</p>';
  return list.map(v => `
    <section class="news__item">
      <h3 class="news__title">v${esc(v.version)}${v.date ? ` <span>${esc(v.date)}</span>` : ''}${v.version === VERSION ? ' <em>tvoje verze</em>' : ''}</h3>
      <ul class="news__list">${v.items.map(i => `<li>${inline(i)}</li>`).join('')}</ul>
    </section>`).join('');
}
