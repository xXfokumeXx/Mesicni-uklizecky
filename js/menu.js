// Hlavní menu (hra sám / s ostatními), seznam uložených her ve slotech, lobby multiplayeru
// a menu pauzy ve hře. Samotné spuštění hry dělá main.js (onLaunch).
import { SUIT_COLORS } from './catalog.js';
import { profile, saveProfile, sanitizeName } from './profile.js';
import { SLOTS, listSaves, deleteSave, lastSlot, hasV1Save } from './storage.js';
import { net, initLobby, lobbyPeers, openWorlds, findWorld, setLobbyStatus, roomOnline } from './net.js';
import { fmt } from './format.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const colorOf = i => '#' + SUIT_COLORS[i].hex.toString(16).padStart(6, '0');

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
  for (const id of ['menu-home', 'menu-slots', 'menu-lobby', 'menu-loading']) $(id).hidden = id !== panel;
  if (panel === 'menu-lobby') setLobbyStatus('lobby');
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

function renderProfile() {
  $('menu-name').value = profile.name;
  $('menu-avatar').style.setProperty('--suit', colorOf(profile.look.color));
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
          </div>
        </li>`;
    }
    const pct = sv.total ? Math.floor(sv.done / sv.total * 1000) / 10 : 0;
    return `
      <li class="slot${id === last ? ' slot--last' : ''}">
        <div class="slot__info">
          <span class="slot__title">${esc(sv.title || `Slot ${i + 1}`)}${id === last ? ' <span class="slot__badge">naposledy</span>' : ''}</span>
          <span class="slot__meta">${pct.toLocaleString('cs-CZ')} % hexů · $${fmt(sv.money || 0)} · ${fmtPlay(sv.playMs)}</span>
          <span class="slot__meta">Uloženo ${fmtDate(sv.savedAt)}</span>
        </div>
        <div class="slot__actions">
          <button class="button button--primary" type="button" data-load="${id}">${slotMode === 'host' ? 'Hostovat' : 'Načíst'}</button>
          <button class="button button--danger" type="button" data-del="${id}">Smazat</button>
        </div>
      </li>`;
  }).join('');
}

function bindSlots() {
  $('slot-list').addEventListener('click', async e => {
    const t = e.target.closest('[data-new],[data-load],[data-del]');
    if (!t) return;
    if (t.dataset.new) {
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

const SCR = { menu: 'v menu', lobby: 'v lobby', game: 've hře' };

function renderLobby() {
  if ($('menu-lobby').hidden) return;
  const online = roomOnline();
  $('lobby-status').textContent = net.room === false
    ? (net.error || 'Multiplayer tu nejde připojit.')
    : online ? 'Připojeno · vidíš všechny, kdo mají hru právě otevřenou.' : 'Připojuji…';
  $('lobby-status').classList.toggle('lobby__status--ok', online);
  const people = lobbyPeers();
  const worlds = openWorlds();
  $('lobby-count').textContent = String(people.length);
  $('lobby-people').innerHTML = people.length ? people.map(p => {
    const where = p.hosting ? `hostuje svět` : p.world ? `hraje ve světě ${esc(p.world)}` : SCR[p.scr] || 'online';
    return `
      <li class="person">
        <span class="person__avatar" style="--suit:${colorOf(p.look.color)}" aria-hidden="true"></span>
        <span class="person__name">${esc(p.name)}${p.me ? ' <span class="person__you">ty</span>' : ''}${p.guest ? ' <span class="person__guest">host z venku</span>' : ''}</span>
        <span class="person__where">${where}</span>
      </li>`;
  }).join('') : '<li class="lobby__empty">Zatím tu nikdo není.</li>';
  $('lobby-worlds').innerHTML = worlds.length ? worlds.map((w, i) => `
    <li class="world">
      <div class="world__info">
        <span class="world__title">${esc(w.title)}</span>
        <span class="world__meta">Hostitel ${esc(w.hostName)} · ${w.players} ${w.players === 1 ? 'hráč' : w.players < 5 ? 'hráči' : 'hráčů'} · kód ${esc(w.code)}</span>
      </div>
      <button class="button button--primary" type="button" data-join="${i}" ${w.me ? 'disabled' : ''}>Připojit</button>
    </li>`).join('') : '<li class="lobby__empty">Nikdo zatím svět neotevřel. Založ ho a ostatní se připojí.</li>';
  $('lobby-host').disabled = !online;
}

function bindLobby() {
  $('lobby-worlds').addEventListener('click', e => {
    const t = e.target.closest('[data-join]');
    if (!t) return;
    const w = openWorlds()[Number(t.dataset.join)];
    if (w) hooks.onLaunch({ mode: 'client', world: w });
  });
  $('lobby-host').addEventListener('click', () => { slotMode = 'host'; show('menu-slots'); renderSlots(); });
  $('lobby-code-form').addEventListener('submit', e => {
    e.preventDefault();
    joinByCode($('lobby-code').value);
  });
}

// Připojení kódem (z pole v lobby nebo z odkazu …#kód). Lobby se načítá chvilku → počkat až 10 s.
async function joinByCode(raw) {
  const code = String(raw || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const err = $('lobby-code-error');
  err.hidden = true;
  if (!code) return;
  if (!(await initLobby())) { renderLobby(); return; }
  $('lobby-code').value = code;
  const t0 = Date.now();
  let w = findWorld(code);
  while (!w && Date.now() - t0 < 10000) {
    err.hidden = false;
    err.textContent = `Hledám svět ${code}…`;
    await new Promise(r => setTimeout(r, 400));
    w = findWorld(code);
  }
  if (!w) {
    err.hidden = false;
    err.textContent = `Svět s kódem ${code} teď nikdo nehostuje. Zkontroluj kód, nebo počkej, až ho hostitel otevře.`;
    return;
  }
  if (w.me) return;
  err.hidden = true;
  hooks.onLaunch({ mode: 'client', world: w });
}

// ---------- start ----------

export function initMenu(h) {
  hooks = h;
  renderProfile();
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
  $('pause-invite').addEventListener('click', () => h.copyInvite($('pause-invite-link')));
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
      const can = h.canSave();
      $('pause-save').hidden = !can;
      $('pause-save-as').hidden = !can;
      $('pause-load').hidden = !h.canLoad();
      $('pause-info').textContent = h.info();
      $('pause-invite').hidden = !h.invite();
      $('pause-invite-link').hidden = true;
      modal.hidden = false;
      h.onOpen();
      $('pause-resume').focus();
    },
    close,
    get isOpen() { return !modal.hidden; },
  };
}
