// Hlavní menu (hra sám / s ostatními), seznam uložených her ve slotech, lobby multiplayeru
// a menu pauzy ve hře. Samotné spuštění hry dělá main.js (onLaunch).
import { SUIT_COLORS, HELMET_PROPS, propById } from './catalog.js';
import { createAvatarShots } from './scene/avatarShots.js';
import { createWardrobe } from './scene/wardrobe.js';
import { profile, saveProfile, sanitizeName } from './profile.js';
import { SLOTS, listSaves, deleteSave, lastSlot, hasV1Save, exportSlot, importSlot } from './storage.js';
import { SAVE_VERSION } from './state.js';
import { net, initLobby, lobbyPeers, openWorlds, findWorld, setLobbyStatus, roomOnline } from './net.js';
import { checkAccess, enterPassword, cloudMeta } from './cloud.js';
import { fmt } from './format.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let hooks = null;          // { onLaunch(spec), openSettings() }
let slotMode = 'sp';       // 'sp' = hrát sám, 'host' = založit svět

function fmtDate(ms) {
  return new Date(ms).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtPlay(ms) {
  const min = Math.round((ms || 0) / 60000);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

// ---------- přepínání obrazovek ----------

function show(panel) {
  for (const id of ['menu-home', 'menu-slots', 'menu-wardrobe', 'menu-lobby', 'menu-loading']) $(id).hidden = id !== panel;
  $('menu-inner').hidden = panel === 'menu-lobby';                     // lobby je přes celou obrazovku
  $('menu').classList.toggle('menu--lobby', panel === 'menu-lobby');
  $('menu').classList.toggle('menu--compact', panel !== 'menu-home' && panel !== 'menu-lobby');
  if (panel !== 'menu-wardrobe') wardrobe?.unmount();
  if (panel === 'menu-lobby') { setLobbyStatus('lobby'); lobbySig = ''; renderLobby(); }
  else if (panel !== 'menu-loading') setLobbyStatus('menu');
}

export function showLoading(text) {
  $('menu').hidden = false;
  show('menu-loading');
  $('menu-loading-text').textContent = text;
}

export function hideMenu() {
  $('menu').hidden = true;
}

export function setMoonStatus(text, ready) {
  const el = $('menu-moon');
  el.textContent = text;
  el.classList.toggle('menu__moon-status--ready', !!ready);
}

// ---------- profil ----------

// Název oblečení: barva skafandru + rekvizita na helmě / hledí (např. „Bílá NASA · Čertovské rohy“)
function outfitName(look) {
  const parts = [SUIT_COLORS[look.color]?.name || 'Skafandr'];
  if (look.top && look.top !== 'none') parts.push(propById(look.top)?.name);
  if (look.face && look.face !== 'noface') parts.push(propById(look.face)?.name);
  return parts.filter(Boolean).join(' · ');
}
let shots = null, wardrobe = null;                 // obrázky astronautů a šatna v menu (vlastní malý renderer)
const avatar = (look, wave = false) => (shots ? shots.shot(look, { wave }) : { url: '', fig: 1 });

function renderProfile() {
  $('menu-name').value = profile.name;
  $('menu-avatar').src = avatar(profile.look, true).url;
  $('menu-outfit').textContent = outfitName(profile.look);
}

// ---------- šatna v menu (stejná jako v Dílně: barva skafandru a rekvizity) ----------

let wardrobeBack = 'menu-home';
function openWardrobe(from) {
  wardrobeBack = from;
  show('menu-wardrobe');
  renderWardrobe();
  wardrobe?.mount($('menu-wardrobe-stage'), profile.look);
}
function renderWardrobe() {
  const look = profile.look;
  const hex = c => '#' + c.toString(16).padStart(6, '0');
  const swatches = SUIT_COLORS.map((c, i) => `
    <button class="swatch${i === look.color ? ' swatch--active' : ''}" type="button" data-color="${i}" style="--swatch:${hex(c.hex)}" aria-pressed="${i === look.color}" title="${esc(c.name)}" aria-label="${esc(c.name)}"></button>`).join('');
  const cards = slot => HELMET_PROPS.filter(p => p.slot === slot).map(p => {
    const on = look[slot] === p.id;
    return `
      <button class="item-card item-card--compact${on ? ' item-card--selected' : ''}" type="button" data-prop="${p.id}" aria-pressed="${on}">
        <span class="item-card__chip item-card__chip--${on ? 'active' : 'store'}">${on ? 'NASAZENO' : slot === 'top' ? 'HELMA' : 'HLEDÍ'}</span>
        <img class="item-card__img" src="${wardrobe ? wardrobe.headThumb(p.id) : ''}" alt="">
        <span class="item-card__name">${esc(p.name)}</span>
      </button>`;
  }).join('');
  $('menu-wardrobe-pick').innerHTML = `
    <div class="wardrobe">
      <h3 class="wardrobe__heading">Barva skafandru · ${esc(SUIT_COLORS[look.color].name)}</h3>
      <div class="wardrobe__swatches" role="group" aria-label="Barva skafandru">${swatches}</div>
      <h3 class="wardrobe__heading">Na helmu</h3>
      <div class="facility__grid">${cards('top')}</div>
      <h3 class="wardrobe__heading">Na hledí</h3>
      <div class="facility__grid">${cards('face')}</div>
    </div>`;
}
function setLook(patch) {
  Object.assign(profile.look, patch);
  saveProfile();
  setLobbyStatus(net.lobbyStatus);              // vzhled jde ostatním v presence lobby (a)
  renderProfile();
  renderWardrobe();
  wardrobe?.mount($('menu-wardrobe-stage'), profile.look);
}
function bindWardrobe() {
  $('menu-wardrobe-pick').addEventListener('click', e => {
    const t = e.target.closest('[data-color],[data-prop]');
    if (!t) return;
    if (t.dataset.color !== undefined) setLook({ color: Number(t.dataset.color) });
    else { const p = propById(t.dataset.prop); if (p) setLook({ [p.slot]: p.id }); }
  });
  $('wardrobe-back').addEventListener('click', () => show(wardrobeBack));
  $('menu-wardrobe-open').addEventListener('click', () => openWardrobe('menu-home'));
  $('lobby-wardrobe').addEventListener('click', () => openWardrobe('menu-lobby'));
}

// ---------- sloty ----------

async function renderSlots() {
  $('slots-title').textContent = slotMode === 'host' ? 'Založit svět' : 'Hrát sám';
  $('slots-public-row').hidden = slotMode !== 'host';
  $('slots-hint').textContent = slotMode === 'host'
    ? 'Vyber uloženou hru, kterou otevřeš ostatním, nebo začni novou. Svět se ukládá u tebe, peníze jsou společné.'
    : 'Pět slotů pro uložené hry. Hra se sama ukládá každých 30 s a při odchodu do menu.';
  const saves = await listSaves();
  const v1 = hasV1Save();
  const last = lastSlot();
  $('slot-list').innerHTML = SLOTS.map((id, i) => {
    const sv = saves.find(x => x.id === id);
    if (!sv) {
      return `
        <li class="slot slot--empty">
          <div class="slot__info">
            <span class="slot__title">Prázdný slot ${i + 1}</span>
            <input class="field__input slot__name" id="slot-name-${id}" type="text" maxlength="40" placeholder="Název směny" aria-label="Název nové hry ve slotu ${i + 1}">
            ${v1 ? `<label class="slot__v1"><input type="checkbox" id="slot-v1-${id}"> Převést peníze a vybavení z verze 1</label>` : ''}
          </div>
          <div class="slot__actions">
            <button class="button button--primary" type="button" data-new="${id}">${slotMode === 'host' ? 'Nový svět' : 'Nová hra'}</button>
            <button class="button" type="button" data-import="${id}" title="Nahrát uloženou hru ze souboru .json">Import</button>
          </div>
        </li>`;
    }
    const pct = sv.total ? Math.floor(sv.done / sv.total * 1000) / 10 : 0;
    const newer = sv.v > SAVE_VERSION;
    return `
      <li class="slot${id === last ? ' slot--last' : ''}">
        <div class="slot__info">
          <span class="slot__title">${esc(sv.title || `Slot ${i + 1}`)}${id === last ? ' <span class="slot__badge">naposledy</span>' : ''}${newer ? ' <span class="slot__badge">novější verze</span>' : ''}</span>
          <span class="slot__meta">${pct.toLocaleString('cs-CZ')} % hexů · $${fmt(sv.money || 0)} · ${fmtPlay(sv.playMs)}</span>
          <span class="slot__meta">${newer ? `Uloženo ve verzi ${sv.v} – tahle verze hry ji neotevře.` : `Uloženo ${fmtDate(sv.savedAt)}`}</span>
        </div>
        <div class="slot__actions">
          <button class="button button--primary" type="button" data-load="${id}"${newer ? ' disabled' : ''}>${slotMode === 'host' ? 'Hostovat' : 'Načíst'}</button>
          <button class="button" type="button" data-export="${id}" title="Uložit hru do souboru .json (záloha)">Export</button>
          <button class="button button--danger" type="button" data-del="${id}">Smazat</button>
        </div>
      </li>`;
  }).join('');
}

function bindSlots() {
  $('slot-list').addEventListener('click', async e => {
    const t = e.target.closest('[data-new],[data-load],[data-del],[data-export],[data-import]');
    if (!t) return;
    if (t.dataset.export) {
      const file = await exportSlot(t.dataset.export);
      if (!file) return;
      const url = URL.createObjectURL(new Blob([file.text], { type: 'application/json' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } else if (t.dataset.import) {
      const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
      input.addEventListener('change', async () => {
        const f = input.files?.[0];
        if (!f) return;
        const res = await importSlot(t.dataset.import, await f.text());
        $('slots-hint').textContent = res.ok ? `Hra „${f.name}“ je nahraná do slotu.` : res.error;
        renderSlots();
      });
      input.click();
    } else if (t.dataset.new) {
      const id = t.dataset.new;
      const title = ($(`slot-name-${id}`).value || '').trim().slice(0, 40) || 'Nová směna';
      const v1 = $(`slot-v1-${id}`)?.checked;
      hooks.onLaunch({ mode: slotMode, slot: id, action: v1 ? 'v1' : 'new', title, public: $('slots-public').checked });
    } else if (t.dataset.load) {
      hooks.onLaunch({ mode: slotMode, slot: t.dataset.load, action: 'load', public: $('slots-public').checked });
    } else if (t.dataset.del) {
      // mazání na dvě kliknutí (v artefaktu se confirm() nezobrazuje)
      if (!t.classList.contains('button--armed')) {
        t.classList.add('button--armed');
        t.textContent = 'Opravdu?';
        setTimeout(() => { t.classList.remove('button--armed'); t.textContent = 'Smazat'; }, 3000);
        return;
      }
      await deleteSave(t.dataset.del);
      renderSlots();
    }
  });
}

// ---------- lobby ----------


// Plošiny ve scéně 1920 × 1080 (HANDOFF lobby): x, y = střed spodní hrany postavy, h = výška postavy; pořadí obsazování
const SPOTS = [[884, 741, 263], [557, 739, 262], [1214, 743, 265], [659, 838, 314], [270, 834, 312], [1052, 841, 316]];
const onStage = [null, null, null, null, null, null];    // peer na plošině (0 = já)
let lobbySig = '';
const plural = n => (n === 1 ? 'hráč' : n < 5 ? 'hráči' : 'hráčů');

// Kdo stojí na plošinách: já vždy na 1., ostatní náhodně; kdo zůstává, nehýbe se; uvolněné místo dostane někdo, kdo ještě nestojí.
function assignStage(people) {
  const ids = new Set(people.map(p => p.peer));
  onStage[0] = people.find(p => p.me)?.peer || 'me';
  for (let k = 1; k < 6; k++) if (onStage[k] && (!ids.has(onStage[k]) || onStage[k] === onStage[0])) onStage[k] = null;
  const used = new Set(onStage.filter(Boolean));
  const free = people.filter(p => !p.me && !used.has(p.peer));
  for (let k = 1; k < 6 && free.length; k++) {
    if (!onStage[k]) onStage[k] = free.splice(Math.floor(Math.random() * free.length), 1)[0].peer;
  }
}

function statusOf(p, worldsAll) {
  if (p.world) {
    const w = worldsAll.find(x => x.code === p.world);
    return `uklízí · ${w ? w.title : p.world}`;
  }
  return p.scr === 'menu' ? 'v menu' : 'v lobby';
}

function renderLobby() {
  if ($('menu-lobby').hidden) return;
  const online = roomOnline();
  let people = lobbyPeers();
  if (!people.some(p => p.me)) people = [{ peer: 'me', name: profile.name, look: profile.look, me: true, scr: 'lobby', world: null }, ...people];
  const worldsAll = openWorlds(true);
  const worlds = openWorlds();
  assignStage(people);
  const byPeer = new Map(people.map(p => [p.peer, p]));
  const statusText = net.room === false
    ? (net.error || 'Multiplayer tu nejde připojit.')
    : online ? (people.length > 6 ? 'Připojeno · na plošině vidíš 6 hráčů' : 'Připojeno · vidíš všechny, kdo mají hru právě otevřenou.') : 'Připojuji…';
  const stage = onStage.map(id => {
    const p = id && byPeer.get(id);
    return p ? { me: !!p.me, name: p.name, look: p.look, outfit: outfitName(p.look), status: statusOf(p, worldsAll), guest: !!p.guest } : null;
  });
  const sig = JSON.stringify([online, statusText, people.length, stage, worlds, people.map(p => [p.name, p.world, p.scr])]);
  if (sig === lobbySig) return;                    // nic se nezměnilo → DOM nepřekreslovat (obrázky by blikaly)
  lobbySig = sig;

  $('lobby-status').textContent = statusText;
  $('lobby-status').classList.toggle('lobby-bar__status--ok', online);
  $('lobby-count').textContent = String(online ? people.length : 1);
  $('lobby-bg').src = people.length >= 2 ? 'assets/lobby/stage-6.png' : 'assets/lobby/stage-1.png';
  const pctX = x => `${(x / 1920 * 100).toFixed(3)}%`, pctY = y => `${(y / 1080 * 100).toFixed(3)}%`;
  $('lobby-platforms').innerHTML = SPOTS.map(([x, y, h], k) => {
    const p = stage[k];
    if (!p) return `<div class="lobby-free" style="left:${pctX(x)};top:${pctY(y - 13)}">Volné místo</div>`;
    const img = avatar(p.look, p.me);
    const ih = h / img.fig;                        // výška obrázku tak, aby postava měla výšku h
    return `
      <img class="lobby-player" src="${img.url}" alt="${esc(p.name)}" style="left:${pctX(x)};top:${pctY(y - ih)};height:${pctY(ih)}">
      <div class="lobby-plate${p.me ? ' lobby-plate--me' : ''}" style="left:${pctX(x)};top:${pctY(y - h - (k >= 3 ? 18 : people.length > 1 ? 40 : 16))}">
        <b>${esc(p.name)}${p.me ? ' <span class="lobby-tag">TY</span>' : ''}</b>
        <span>${esc(p.outfit)}</span>
        <i>${esc(p.status)}</i>
      </div>`;
  }).join('');
  const more = people.length - 6;
  $('lobby-more').hidden = more <= 0;
  $('lobby-more').textContent = `Zobrazit dalších ${Math.max(0, more)}`;
  if (more <= 0) $('lobby-people-box').hidden = true;
  $('lobby-people').innerHTML = people.map(p => `
    <li><span>${esc(p.name)}${p.me ? ' <span class="lobby-tag">TY</span>' : ''}</span><small>${esc(statusOf(p, worldsAll))}</small></li>`).join('');
  $('lobby-worlds').innerHTML = worlds.length ? worlds.map((w, i) => {
    const meta = [w.hostName, `${w.players} ${plural(w.players)}`, w.done !== null ? `${w.done.toLocaleString('cs-CZ')} % hexů` : null].filter(Boolean).join(' · ');
    const btn = w.me ? '<button class="lobby-btn lobby-btn--ghost" type="button" disabled>Tvůj svět</button>'
      : w.locked ? `<button class="lobby-btn lobby-btn--ghost" type="button" data-join="${i}">Zadat heslo</button>`
        : `<button class="lobby-btn lobby-btn--primary" type="button" data-join="${i}">Připojit</button>`;
    return `<li class="lobby-world"><b>${esc(w.title)}</b>${btn}<small>${esc(meta)}</small></li>`;
  }).join('') : '<li class="lobby-worlds__empty">Nikdo zatím svět neotevřel. Založ ho a ostatní se připojí.</li>';
  $('lobby-host').disabled = !online;
}

function bindLobby() {
  $('lobby-worlds').addEventListener('click', e => {
    const t = e.target.closest('[data-join]');
    if (!t) return;
    const w = openWorlds()[Number(t.dataset.join)];
    if (w) enterWorld(w.code, () => hooks.onLaunch({ mode: 'client', world: w }));
  });
  $('lobby-pass-form').addEventListener('submit', async e => {
    e.preventDefault();
    if (!passFor) return;
    const err = $('lobby-code-error');
    if (await enterPassword(passFor.code, $('lobby-pass').value)) {
      $('lobby-pass').value = '';
      $('lobby-pass-form').hidden = true;
      err.hidden = true;
      const go = passFor.go;
      passFor = null;
      go();
    } else {
      err.hidden = false;
      err.textContent = 'Špatné heslo.';
    }
  });
  $('lobby-cloud').addEventListener('click', () => {
    if (!cloudOffer) return;
    const { code, meta } = cloudOffer;
    enterWorld(code, () => hooks.onLaunch({ mode: 'host', cloud: code, planet: meta.pn === 'mars' ? 'mars' : 'moon', public: true }));
  });
  $('lobby-host').addEventListener('click', () => { slotMode = 'host'; show('menu-slots'); renderSlots(); });
  $('lobby-more').addEventListener('click', () => {
    const box = $('lobby-people-box');
    box.hidden = !box.hidden;
    $('lobby-more').setAttribute('aria-expanded', String(!box.hidden));
  });
  $('lobby-code-form').addEventListener('submit', e => {
    e.preventDefault();
    joinByCode($('lobby-code').value);
  });
}

// Svět s heslem: zeptat se na heslo (jednou na prohlížeč), pak pokračovat (go).
let passFor = null, cloudOffer = null;
async function enterWorld(code, go) {
  if ((await checkAccess(code)) === 'ok') { go(); return; }
  passFor = { code, go };
  $('lobby-pass-form').hidden = false;
  const err = $('lobby-code-error');
  err.hidden = false;
  err.textContent = `Svět ${code} je chráněný heslem.`;
  $('lobby-pass').focus();
}

// Připojení kódem (z pole v lobby nebo z odkazu …#kód). Lobby se načítá chvilku → počkat až 30 s.
// Když svět nikdo nehostuje, ale je uložený v cloudu, nabídne se jeho otevření (hostitelem budu já).
async function joinByCode(raw) {
  const code = String(raw || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const err = $('lobby-code-error');
  err.hidden = true;
  if (!code) return;
  if (!(await initLobby())) { renderLobby(); return; }
  $('lobby-code').value = code;
  const t0 = Date.now();
  let w = findWorld(code);
  $('lobby-cloud').hidden = true;
  const meta = w ? null : await cloudMeta(code);
  while (!w && Date.now() - t0 < 30000) {          // po odletu / převzetí hostitel chvíli startuje
    err.hidden = false;
    err.textContent = meta ? `Hledám hostitele světa ${code}…` : `Hledám svět ${code}…`;
    if (meta && Date.now() - t0 > 4000) {             // svět je v cloudu → nabídnout otevření (čekání běží dál)
      cloudOffer = { code, meta };
      $('lobby-cloud').hidden = false;
      err.textContent = `Svět ${code} („${meta.t || 'Svět'}“) teď nikdo nehostuje. Můžeš ho otevřít ty – nebo počkej na hostitele.`;
    }
    await new Promise(r => setTimeout(r, 400));
    w = findWorld(code);
  }
  if (!w) {
    err.hidden = false;
    if (!meta) err.textContent = `Svět s kódem ${code} teď nikdo nehostuje. Zkontroluj kód, nebo počkej, až ho hostitel otevře.`;
    return;
  }
  if (w.me) return;
  err.hidden = true;
  $('lobby-cloud').hidden = true;
  enterWorld(w.code, () => hooks.onLaunch({ mode: 'client', world: w }));
}

// ---------- start ----------

export function initMenu(h) {
  hooks = h;
  try {
    shots = createAvatarShots();
    wardrobe = createWardrobe(shots.thumbs);
  } catch (e) { console.warn('[menu] náhled astronauta nejde vykreslit', e); }
  renderProfile();
  bindWardrobe();
  $('menu-name').addEventListener('change', () => {
    profile.name = sanitizeName($('menu-name').value) || profile.name;
    saveProfile();
    renderProfile();
    setLobbyStatus(net.lobbyStatus);
  });
  $('menu-sp').addEventListener('click', () => { slotMode = 'sp'; show('menu-slots'); renderSlots(); });
  $('menu-mp').addEventListener('click', async () => {
    show('menu-lobby');
    renderLobby();
    await initLobby();
    renderLobby();
  });
  $('menu-gfx').addEventListener('click', () => hooks.openSettings());
  for (const b of document.querySelectorAll('[data-menu-back]')) {
    b.addEventListener('click', () => show(slotMode === 'host' && b.closest('#menu-slots') ? 'menu-lobby' : 'menu-home'));
  }
  bindSlots();
  bindLobby();
  net.onLobby = renderLobby;
  setInterval(renderLobby, 2000);
  $('menu').hidden = false;
  show('menu-home');
  // odkaz od kamaráda: …/#kód → rovnou do lobby a připojit
  const code = (location.hash || '').slice(1).toLowerCase();
  if (/^[a-z0-9]{3,12}$/.test(code)) {
    show('menu-lobby');
    renderLobby();
    joinByCode(code);
  }
}

// ---------- pauza ve hře ----------

export function initPause(h) {
  // h: { canSave, save, saveTo(slot), loadFrom(slot), toMenu, openSettings, onOpen, onClose, info }
  const modal = $('pause');
  const close = () => { if (!modal.hidden) { modal.hidden = true; h.onClose(); } };
  async function renderPauseSlots(kind) {
    const saves = await listSaves();
    $('pause-slots').hidden = false;
    $('pause-help-box').hidden = true;
    $('pause-slots-title').textContent = kind === 'save' ? 'Uložit do slotu' : 'Načíst hru';
    $('pause-slot-list').innerHTML = SLOTS.map((id, i) => {
      const sv = saves.find(x => x.id === id);
      if (kind === 'load' && !sv) return '';
      return `
        <li class="slot slot--compact">
          <div class="slot__info">
            <span class="slot__title">${sv ? esc(sv.title) : `Prázdný slot ${i + 1}`}</span>
            <span class="slot__meta">${sv ? `Uloženo ${fmtDate(sv.savedAt)} · $${fmt(sv.money || 0)}` : 'volný'}</span>
          </div>
          <button class="button button--primary" type="button" data-${kind}-slot="${id}">${kind === 'save' ? (sv ? 'Přepsat' : 'Uložit') : 'Načíst'}</button>
        </li>`;
    }).join('') || '<li class="lobby__empty">Žádná uložená hra.</li>';
  }
  $('pause-resume').addEventListener('click', close);
  $('pause-backdrop').addEventListener('click', close);
  $('pause-close').addEventListener('click', close);
  $('pause-save').addEventListener('click', async () => { await h.save(); close(); });
  $('pause-save-as').addEventListener('click', () => renderPauseSlots('save'));
  $('pause-load').addEventListener('click', () => renderPauseSlots('load'));
  $('pause-gfx').addEventListener('click', () => { close(); h.openSettings(); });
  $('pause-help').addEventListener('click', () => {                 // přehled ovládání (místo nápovědy dole na obrazovce)
    const box = $('pause-help-box');
    box.hidden = !box.hidden;
    $('pause-help').setAttribute('aria-expanded', String(!box.hidden));
    if (!box.hidden) $('pause-slots').hidden = true;
  });
  $('pause-invite').addEventListener('click', () => h.copyInvite($('pause-invite-link')));
  // heslo světa (jen hostitel): nastavit / zrušit – hlídají ho pravidla Firebase (cloud.js)
  $('pause-pass').addEventListener('click', () => {
    const box = $('pause-pass-box');
    box.hidden = !box.hidden;
    $('pause-pass').setAttribute('aria-expanded', String(!box.hidden));
    if (!box.hidden) $('pause-pass-input').focus();
  });
  $('pause-pass-box').addEventListener('submit', async e => {
    e.preventDefault();
    const pw = $('pause-pass-input').value.trim();
    if (pw.length < 6) { $('pause-pass-state').textContent = 'Heslo musí mít aspoň 6 znaků.'; return; }
    if (await h.password.set(pw)) { $('pause-pass-input').value = ''; close(); }
  });
  $('pause-pass-clear').addEventListener('click', async () => { if (await h.password.set('')) close(); });
  $('pause-menu').addEventListener('click', () => h.toMenu());
  $('pause-slot-list').addEventListener('click', async e => {
    const t = e.target.closest('[data-save-slot],[data-load-slot]');
    if (!t) return;
    if (t.dataset.saveSlot) { await h.saveTo(t.dataset.saveSlot); close(); }
    else h.loadFrom(t.dataset.loadSlot);
  });
  return {
    open() {
      $('pause-slots').hidden = true;
      $('pause-help-box').hidden = true;
      $('pause-help').setAttribute('aria-expanded', 'false');
      const can = h.canSave();
      $('pause-save').hidden = !can;
      $('pause-save-as').hidden = !(h.canSaveAs ? h.canSaveAs() : can);
      $('pause-load').hidden = !h.canLoad();
      $('pause-info').textContent = h.info();
      $('pause-invite').hidden = !h.invite();
      const pass = !!h.password?.available();
      $('pause-pass').hidden = !pass;
      $('pause-pass-box').hidden = true;
      if (pass) $('pause-pass-state').textContent = h.password.locked() ? 'Svět má heslo. Nové heslo odhlásí všechny ostatní (zadají ho znovu).' : 'Bez hesla se připojí kdokoli, kdo zná kód světa.';
      $('pause-invite-link').hidden = true;
      modal.hidden = false;
      h.onOpen();
      $('pause-resume').focus();
    },
    close,
    get isOpen() { return !modal.hidden; },
  };
}
