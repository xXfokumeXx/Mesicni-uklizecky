// Obrazovky herního účtu v hlavním menu (3.3, U1): stav vpravo nahoře, Vytvořit účet, Přihlásit, Profil.
// Logika je v account.js, tady jen formuláře a texty.
import { account, onAccount, register, login, logout, checkName, nameFree, PASS_MIN, addEmail, resetPassword, changePassword, deleteAccount, pendingEmail } from './account.js';
import { listSaves, deleteSave, SLOTS, BACKUP_SLOT } from './storage.js';
import { profile, saveProfile } from './profile.js';
import { DEFAULT_LOOK } from './catalog.js';

const $ = id => document.getElementById(id);
let show = null;                 // přepnutí panelu menu (menu.js)
let onChange = null;             // po přihlášení / odhlášení (menu.js překreslí profil)

const DAY = 86400000;
const fmtDate = t => new Date(t).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' });

function setState(id, text, kind = '') {
  const el = $(id);
  el.textContent = text || '';
  el.className = `account-form__state${kind ? ` account-form__state--${kind}` : ''}`;
}
// Skrytá adresa pro zobrazení (pe***@seznam.cz) – e-mail se ve hře celý neukazuje
const maskEmail = e => { const [a, d] = String(e).split('@'); return d ? `${a.slice(0, 2)}***@${d}` : ''; };

function setError(id, text) {
  const el = $(id);
  el.textContent = text || '';
  el.hidden = !text;
}

// Který formulář je vidět: 'register' | 'login' | 'profile'
export function openAccount(mode) {
  show?.('menu-account');
  for (const [m, id] of [['register', 'account-register'], ['login', 'account-login'], ['profile', 'account-profile']]) $(id).hidden = m !== mode;
  $('account-title').textContent = mode === 'register' ? 'Vytvořit účet' : mode === 'login' ? 'Přihlásit' : 'Profil';
  setError('reg-error'); setError('login-error'); setError('profile-error');
  if (mode === 'profile') renderProfile();
  if (mode === 'register') listSaves().then(l => { $('reg-saves').hidden = !l.length; }).catch(() => {});
  const first = mode === 'register' ? 'reg-name' : mode === 'login' ? 'login-name' : null;
  if (first) setTimeout(() => $(first)?.focus(), 50);
}

function renderBar(user) {
  $('account-bar').hidden = !account.ready;
  $('account-state').textContent = user ? user.jmeno : 'Hraješ bez účtu';
  $('account-state').classList.toggle('account-bar__state--in', !!user);
  $('account-login-open').hidden = !!user;
  $('account-register-open').hidden = !!user;
  $('account-profile-open').hidden = !user;
}

function renderProfile() {
  const u = account.user;
  if (!u) return;
  $('profile-name').textContent = u.jmeno;
  const last = u.posledni || Date.now();
  $('profile-expiry').textContent = `Účet je aktivní. Smaže se ${fmtDate(Math.max(last, Date.now()) + 30 * DAY)}, pokud do té doby nebudeš hrát.`;
  const pend = pendingEmail();
  $('profile-email-state').textContent = u.prihlaseni === 'email'
    ? `Přihlašuješ se jménem, e-mailem ${maskEmail(u.email)} a heslem. Na tenhle e-mail ti můžeme poslat obnovu hesla.`
    : pend ? 'Ověřovací odkaz je odeslaný. Až ho v e-mailu potvrdíš a znovu se přihlásíš, bude e-mail platit (přihlášení pak jménem, e-mailem a heslem).'
      : 'Účet nemá e-mail – zapomenuté heslo pak obnovit nejde.';
  $('email-box').hidden = u.prihlaseni === 'email';
  for (const id of ['email-new', 'email-pass', 'pass-old', 'pass-new', 'pass-new2', 'delete-pass']) $(id).value = '';
  for (const id of ['email-state', 'pass-state', 'delete-state']) setState(id, '');
  $('delete-send').disabled = true;
}

// ---------- registrace: kontrola jména při psaní (prodleva 400 ms) ----------
let nameTimer = 0, nameAsked = '';
function checkRegName() {
  const name = $('reg-name').value;
  const state = $('reg-name-state');
  clearTimeout(nameTimer);
  state.className = 'account-form__state';
  if (!name.trim()) { state.textContent = ''; return; }
  const why = checkName(name);
  if (why) { state.textContent = why; state.classList.add('account-form__state--bad'); return; }
  state.textContent = 'Ověřuji…';
  nameAsked = name;
  nameTimer = setTimeout(async () => {
    const free = await nameFree(name);
    if (nameAsked !== name) return;
    state.textContent = free === true ? 'Jméno je volné.' : free === false ? 'Jméno je obsazené.' : '';
    state.classList.toggle('account-form__state--ok', free === true);
    state.classList.toggle('account-form__state--bad', free === false);
  }, 400);
}

async function submitRegister(e) {
  e.preventDefault();
  const name = $('reg-name').value, pass = $('reg-pass').value, pass2 = $('reg-pass2').value;
  const why = checkName(name);
  if (why) { setError('reg-error', why); return; }
  if (pass.length < PASS_MIN) { setError('reg-error', `Heslo musí mít aspoň ${PASS_MIN} znaků.`); return; }
  if (pass !== pass2) { setError('reg-error', 'Hesla se neshodují.'); return; }
  setError('reg-error');
  const btn = $('reg-submit');
  btn.disabled = true;
  btn.textContent = 'Zakládám účet…';
  try {
    await register(name, pass);
    const email = $('reg-email').value.trim();
    let mailErr = '';
    if (email) { try { await addEmail(email, pass); } catch (err) { mailErr = err.text || 'E-mail se nepodařilo přidat.'; } }
    $('reg-pass').value = $('reg-pass2').value = $('reg-email').value = '';
    openAccount('profile');
    if (mailErr) setError('profile-error', `Účet je založený, ale e-mail ne: ${mailErr} Zkus ho přidat níže.`);
  } catch (err) {
    setError('reg-error', err.text || 'Něco se nepovedlo. Zkus to znovu.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Vytvořit účet';
  }
}

async function submitLogin(e) {
  e.preventDefault();
  const name = $('login-name').value, pass = $('login-pass').value;
  const email = $('login-email-row').hidden ? '' : $('login-email').value;
  if (!name.trim() || !pass) { setError('login-error', 'Vyplň jméno a heslo.'); return; }
  setError('login-error');
  const btn = $('login-submit');
  btn.disabled = true;
  btn.textContent = 'Přihlašuji…';
  try {
    const res = await login(name, pass, email);
    if (res?.needEmail) {                                  // účet s vlastním e-mailem (U3): zeptat se na něj
      $('login-email-row').hidden = false;
      $('login-email').focus();
      return;
    }
    $('login-pass').value = '';
    $('login-email-row').hidden = true;
    show?.('menu-home');
  } catch (err) {
    setError('login-error', (err.text || 'Špatné jméno nebo heslo.') + (err.offerEmail ? ' Jestli sis k účtu nastavil e-mail, zadej i ten.' : ''));
    if (err.offerEmail) $('login-email-row').hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Přihlásit';
  }
}

export function initAccountUi(h) {
  show = h.show;
  onChange = h.onChange;
  for (const b of document.querySelectorAll('[data-privacy]')) b.addEventListener('click', openPrivacy);
  $('account-login-open').addEventListener('click', () => openAccount('login'));
  $('account-register-open').addEventListener('click', () => openAccount('register'));
  $('account-profile-open').addEventListener('click', () => openAccount('profile'));
  for (const b of document.querySelectorAll('[data-account-mode]')) b.addEventListener('click', () => openAccount(b.dataset.accountMode));
  $('reg-name').addEventListener('input', checkRegName);
  $('account-register').addEventListener('submit', submitRegister);
  $('account-login').addEventListener('submit', submitLogin);
  $('login-name').addEventListener('input', () => { $('login-email-row').hidden = true; });
  $('profile-logout').addEventListener('click', async () => {
    try { await logout(); show?.('menu-home'); } catch { setError('profile-error', 'Odhlášení se nepovedlo. Zkus to znovu.'); }
  });
  onAccount(user => { renderBar(user); onChange?.(user); });

  // U3: zapomenuté heslo, e-mail, změna hesla, smazání účtu
  const busy = async (btnId, label, fn) => {
    const btn = $(btnId), text = btn.textContent;
    btn.disabled = true; btn.textContent = label;
    try { await fn(); } finally { btn.disabled = false; btn.textContent = text; }
  };
  $('forgot-send').addEventListener('click', () => busy('forgot-send', 'Posílám…', async () => {
    try {
      await resetPassword($('forgot-email').value);
      setState('forgot-state', 'Pokud k nějakému účtu patří tento e-mail, přišel na něj odkaz pro nové heslo (podívej se i do spamu).', 'ok');
    } catch (err) { setState('forgot-state', err.text, 'bad'); }
  }));
  $('email-send').addEventListener('click', () => busy('email-send', 'Posílám…', async () => {
    try {
      await addEmail($('email-new').value, $('email-pass').value);
      renderProfile();
      setState('email-state', 'Odkaz je odeslaný. Potvrď ho v e-mailu (i ve spamu).', 'ok');
    } catch (err) { setState('email-state', err.text, 'bad'); }
  }));
  $('pass-send').addEventListener('click', () => busy('pass-send', 'Měním…', async () => {
    if ($('pass-new').value !== $('pass-new2').value) { setState('pass-state', 'Nová hesla se neshodují.', 'bad'); return; }
    try {
      await changePassword($('pass-old').value, $('pass-new').value);
      for (const id of ['pass-old', 'pass-new', 'pass-new2']) $(id).value = '';
      setState('pass-state', 'Heslo je změněné.', 'ok');
    } catch (err) { setState('pass-state', err.text, 'bad'); }
  }));
  $('delete-pass').addEventListener('input', () => { $('delete-send').disabled = !$('delete-pass').value; });
  $('delete-send').addEventListener('click', () => busy('delete-send', 'Mažu…', async () => {
    const wipe = $('delete-local').checked;
    try {
      await deleteAccount($('delete-pass').value);
    } catch (err) { setState('delete-state', err.text, 'bad'); return; }
    if (wipe) await wipeLocal();
    location.reload();                                    // zpět do hlavního menu jako hráč bez účtu
  }));
}

// Smazání účtu s volbou „i z tohoto prohlížeče“: sloty, profil (vzhled, úspěchy, hodnost), postup ve světech.
// Nastavení grafiky a ovládání patří zařízení – zůstává.
async function wipeLocal() {
  for (const id of [...SLOTS, BACKUP_SLOT]) { try { await deleteSave(id); } catch { /* nic */ } }
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith('ms2_mp_')) keys.push(k); }
    for (const k of [...keys, 'ms2_sync', 'ms2_last_slot', 'ms2_email_pending']) localStorage.removeItem(k);
  } catch { /* nic */ }
  profile.look = { ...DEFAULT_LOOK };
  profile.ach = {};
  profile.achStats = {};
  profile.rank = null;
  saveProfile();
}

// ---------- spor verzí slotu (U2): hrál jsi na dvou zařízeních od poslední synchronizace ----------
// local / cloud = { title, savedAt, done, total }. Vrací Promise<'cloud' | 'local' | null> (null = zavřeno).
export function askSlotConflict(local, cloud) {
  const fmt = t => (t ? new Date(t).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '?');
  const pct = x => (x?.total ? `${(Math.floor(x.done / x.total * 1000) / 10).toLocaleString('cs-CZ')} % hexů` : '');
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return new Promise(resolve => {
    const box = document.createElement('div');
    box.className = 'modal account-sync';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.innerHTML = `
      <div class="modal__backdrop"></div>
      <div class="modal__panel">
        <header class="modal__header"><h2 class="modal__title">Které uložení chceš?</h2></header>
        <div class="modal__body">
          <p>Na tomto zařízení je jiné uložení než v účtu (hrál jsi na dvou zařízeních). To, které nevybereš, se uloží jako <strong>Záloha</strong>.</p>
          <button class="button account-sync__pick" type="button" data-pick="cloud"><strong>Z účtu</strong><span>${esc(cloud.title)} · ${pct(cloud)} · uloženo ${fmt(cloud.savedAt)}</span></button>
          <button class="button account-sync__pick" type="button" data-pick="local"><strong>Z tohoto zařízení</strong><span>${esc(local.title)} · ${pct(local)} · uloženo ${fmt(local.savedAt)}</span></button>
        </div>
        <footer class="modal__footer"><button class="button" type="button" data-pick="">Zpět do menu</button></footer>
      </div>`;
    document.body.append(box);
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-pick]');
      if (!b) return;
      box.remove();
      resolve(b.dataset.pick || null);
    });
  });
}

// ---------- Co ukládáme (U4, rozumné minimum k ochraně údajů) ----------
const PRIVACY = `
  <p>Když si vytvoříš účet, uložíme: jméno astronauta, heslo (zašifrované, vidí ho jen přihlašovací služba), vzhled postavy, úspěchy a hodnost, tvoje uložené hry a postup ve sdílených světech a čas, kdy jsi naposledy hrál. Pokud přidáš e-mail, použijeme ho jen k obnově zapomenutého hesla.</p>
  <p>Data ukládáme ve službě Firebase od Googlu (databáze v Evropě, Belgie). Ta kvůli provozu technicky zpracovává i IP adresu tvého zařízení.</p>
  <p>Když 30 dní nehraješ, účet se se všemi daty automaticky smaže. Účet můžeš kdykoli smazat sám v profilu. E-mail z účtu zatím odebrat nejde – kdo ho tam mít nechce, smaže účet a založí nový.</p>
  <p>Nepoužíváme analytiku, reklamy ani sledovací cookies.</p>
  <p>Bez účtu se tvůj postup ukládá jen v tomto prohlížeči. Při hře s ostatními se jméno, vzhled a poloha astronauta posílají hráčům ve stejném světě.</p>`;
export function openPrivacy() {
  const box = document.createElement('div');
  box.className = 'modal account-sync';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'Co ukládáme');
  box.innerHTML = `<div class="modal__backdrop" data-close></div>
    <div class="modal__panel">
      <header class="modal__header"><h2 class="modal__title">Co ukládáme</h2><button class="modal__close" type="button" data-close aria-label="Zavřít">×</button></header>
      <div class="modal__body account-privacy">${PRIVACY}</div>
      <footer class="modal__footer"><button class="button button--primary" type="button" data-close>Rozumím</button></footer>
    </div>`;
  document.body.append(box);
  const close = () => { box.remove(); removeEventListener('keydown', esc, true); };
  const esc = e => { if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); } };
  addEventListener('keydown', esc, true);
  box.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });
  box.querySelector('.button--primary').focus();
}
