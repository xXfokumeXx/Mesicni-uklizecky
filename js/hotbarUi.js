// Hotbar dole na obrazovce: políčka s nástroji a stavebními sadami (hotbar.js), klik nebo 1–3 = vybrat,
// × / pravé tlačítko / X = vyprázdnit. Zamčená políčka jsou úzká a jen ukazují, že je odemkne opasek v Dílně.
import { BELT, toolById } from './catalog.js';
import { game } from './state.js';
import { toolStats } from './equipment.js';
import { hotbarSlots, KIT_NAMES } from './hotbar.js';
import { buildToolModel } from './scene/toolModels.js';
import { buildStation, buildSilo } from './scene/buildings.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MAX = BELT.levels[BELT.levels.length - 1].slots;

let thumb = null;

export function initHotbar(renderThumb, onSelect, onDrop) {
  thumb = renderThumb;
  const bar = $('hotbar');
  bar.addEventListener('click', e => {
    const b = e.target.closest('[data-slot]');
    if (b && !b.disabled) {
      if (e.target.closest('[data-drop]')) onDrop(Number(b.dataset.slot));
      else onSelect(Number(b.dataset.slot));
    }
    b?.blur();
  });
  bar.addEventListener('contextmenu', e => {
    e.preventDefault();
    const b = e.target.closest('[data-slot]');
    if (b && !b.disabled) onDrop(Number(b.dataset.slot));
  });
}

function slotView(e) {
  if (typeof e === 'string') {
    const t = toolById(e);
    const item = game.s.tools[e];
    const cap = toolStats(e).hopper;
    return { name: t.name, img: thumb(`tool-${e}`, () => buildToolModel(e)), fill: cap ? Math.min(1, item.load / cap) : 0 };
  }
  if (e && e.kit) {
    const img = e.kit === 'depot' || e.kit === 'dmove' ? thumb('silo', () => buildSilo().root) : thumb('station', () => buildStation().root);
    return { name: KIT_NAMES[e.kit], img, kit: true };
  }
  return { name: 'Prázdné', img: '' };
}

export function updateHotbar() {
  if (!thumb || !game.s) return;
  const s = game.s;
  const n = hotbarSlots();
  const html = Array.from({ length: MAX }, (_, k) => {
    if (k >= n) {
      return `<button class="hotbar__slot hotbar__slot--locked" type="button" disabled title="Políčko ${k + 1} odemkne ${esc(BELT.levels[k].name)} v Dílně">
        <span class="hotbar__lock">🔒</span></button>`;
    }
    const v = slotView(s.hotbar[k]);
    const on = k === s.sel && s.driving < 0;
    return `<button class="hotbar__slot${on ? ' hotbar__slot--active' : ''}${v.kit ? ' hotbar__slot--kit' : ''}" type="button" data-slot="${k}" aria-pressed="${on}" title="${esc(v.name)}">
      <span class="hotbar__key">${k + 1}</span>
      ${v.img ? `<img class="hotbar__img" src="${v.img}" alt="">` : '<span class="hotbar__img hotbar__img--empty"></span>'}
      <span class="hotbar__name">${esc(v.name)}</span>
      ${s.hotbar[k] != null ? '<span class="hotbar__drop" data-drop title="Odebrat z hotbaru (X)">×</span>' : ''}
      ${v.fill !== undefined ? `<span class="hotbar__load"><span style="width:${Math.round(v.fill * 100)}%"></span></span>` : ''}
    </button>`;
  }).join('');
  const el = $('hotbar');
  el.classList.toggle('hotbar--driving', s.driving >= 0);
  if (el.dataset.html !== html) { el.dataset.html = html; el.innerHTML = html; }
}

