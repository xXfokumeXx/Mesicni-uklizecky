// Stavební lišta (V), řádek režimu kladiva a kroužek průběhu bourání u kurzoru (D-08).
// Lišta: kategorie Energie · Vozidla · Logistika · Výroba · Výzkum, pod nimi karty staveb s náhledem, cenou a stavem.
import { game } from './state.js';
import { build, selectType, buildHud, hammerActive } from './build.js';
import { CATEGORIES, STRUCTURES, buildPrice, lockReason } from './structures.js';
import { instantiate, isReady, preloadModels } from './assets/models.js';
import { fmt } from './format.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let thumb = null;
let cat = 'vehicles';
let sig = '';

export function initBuildUi(renderThumb) {
  thumb = renderThumb;
  $('buildbar').addEventListener('click', e => {
    const t = e.target.closest('[data-cat],[data-type]');
    if (!t) return;
    if (t.dataset.cat) { cat = t.dataset.cat; sig = ''; return; }
    if (t.dataset.type && !t.disabled) selectType(t.dataset.type);
  });
}

function thumbOf(type) {
  const def = STRUCTURES[type];
  if (!isReady(def.model)) { preloadModels([def.model]).then(() => { sig = ''; }); return ''; }
  return thumb(`str-${type}`, () => instantiate(def.model).root);
}

function renderBar() {
  const types = Object.entries(STRUCTURES).filter(([, d]) => d.cat === cat);
  const tabs = CATEGORIES.map(c => {
    const n = Object.values(STRUCTURES).filter(d => d.cat === c.id).length;
    return `<button class="buildbar__cat${c.id === cat ? ' buildbar__cat--active' : ''}" type="button" data-cat="${c.id}"${n ? '' : ' data-empty'}>${esc(c.name)}</button>`;
  }).join('');
  const cards = types.length ? types.map(([type, d]) => {
    const price = buildPrice(type);
    const lock = lockReason(d);
    const ready = d.ready && !lock;
    const poor = game.s.money < price;
    const state = !d.ready ? '🔒 v další fázi' : lock ? '🔒 ' + lock : poor ? 'chybí peníze' : price ? 'dostupné' : 'zdarma';
    const img = thumbOf(type);
    return `
      <button class="buildbar__card${build.type === type ? ' buildbar__card--active' : ''}${!ready || poor ? ' buildbar__card--off' : ''}" type="button" data-type="${type}"${ready ? '' : ' disabled'} title="${esc(d.desc)}">
        ${img ? `<img class="buildbar__img" src="${img}" alt="">` : '<span class="buildbar__img buildbar__img--empty"></span>'}
        <span class="buildbar__name">${esc(d.name)}</span>
        <span class="buildbar__price">${price ? '$' + (d.perMeter ? `${price}/m` : fmt(price)) : 'zdarma'}</span>
        <span class="buildbar__state">${state}</span>
      </button>`;
  }).join('') : '<p class="buildbar__empty">V této kategorii zatím nic není – přibude v dalších fázích 3.0.</p>';
  $('buildbar').innerHTML = `<div class="buildbar__cats" role="tablist">${tabs}</div><div class="buildbar__cards">${cards}</div>`;
}

export function updateBuildUi() {
  const on = hammerActive();
  const bar = $('buildbar');
  bar.hidden = !(on && build.menu);
  if (!bar.hidden) {
    const s = `${build.version}|${cat}|${Math.floor(game.s.money)}|${build.type}`;
    if (s !== sig) { sig = s; renderBar(); }
  }
  const hud = $('build-hud');
  const text = on ? buildHud() : '';
  hud.hidden = !text;
  if (text && hud.textContent !== text) hud.textContent = text;

  // kroužek průběhu bourání u kurzoru
  const ring = $('build-hold');
  const showRing = on && build.mode === 'demolish' && build.target && build.hold > 0;
  ring.hidden = !showRing;
  document.body.classList.toggle('demolish-cursor', on && build.mode === 'demolish');
  return ring;
}

// Štítek stavby po najetí (D-01): jen jeden naráz (O-06). text = null → schovat; world = THREE.Vector3 nad stavbou.
export function placeStructLabel(text, world, camera) {
  const el = $('struct-label');
  if (!text || !world) { el.hidden = true; return; }
  const v = world.clone().project(camera);
  if (v.z > 1) { el.hidden = true; return; }
  el.hidden = false;
  if (el.textContent !== text) el.textContent = text;
  el.style.transform = `translate(${((v.x + 1) / 2 * innerWidth).toFixed(1)}px, ${((1 - v.y) / 2 * innerHeight).toFixed(1)}px) translate(-50%, -100%)`;
}

// poloha kroužku podle kurzoru (volá main.js s input.cursor)
export function placeHoldRing(cursor) {
  const ring = $('build-hold');
  if (ring.hidden || !cursor) return;
  ring.style.transform = `translate(${cursor.x}px, ${cursor.y}px) translate(-50%, -50%)`;
  ring.style.setProperty('--p', `${Math.round(build.hold * 100)}%`);
}
