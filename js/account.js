// Herní účty (3.3, fáze U1 – Update 3.3/PREDAVKA-UCTY-A-UKLADANI.md, části 3 a 9).
// Registrace jménem astronauta a heslem, bez e-mailu. Firebase umí heslo jen s e-mailovou adresou, proto má účet
// technickou adresu <16 náhodných znaků>@hraci.mesicni-zametacky.invalid (doména .invalid nikdy neexistuje, nic se
// na ni neposílá, hráč ji nevidí). Přihlášení: jméno → veřejný záznam jmena/<klíč> → technická adresa → heslo.
// Anonymní hráč (multiplayer) se při registraci propojí (linkWithCredential) – zůstane mu stejné uid.
// Databáze:
//   jmena/<klíč>  { uid, jmeno, tech | –, prihlaseni: 'jmeno' | 'email', posledni }   veřejné, čte se po jednom klíči
//   ucty/<uid>    { jmeno, klic, vytvoreno, posledni, … }                             jen vlastník
//   aktivita/<uid> { t, k }                                                            čas poslední hry pro úklid (U4)
import { firebaseApp, authReady } from './platform/fbase.js';
import { profile, saveProfile } from './profile.js';

export const TECH_DOMAIN = 'hraci.mesicni-zametacky.invalid';
export const PASS_MIN = 8;
// Zakázaná jména (porovnává se klíč bez _ a -; obsahuje-li slovo, jméno nejde)
const BANNED = ['admin', 'moderator', 'system', 'hostitel', 'claude', 'anthropic', 'firebase', 'podpora',
  'kurva', 'kurvy', 'pica', 'pice', 'prdel', 'hovno', 'debil', 'kokot', 'zmrd', 'curak', 'mrdat', 'mrdka', 'sukat', 'fuck', 'shit', 'bitch', 'nigg', 'hitler', 'nazi'];

// Stav účtu pro UI: null = hraje bez účtu
export const account = { ready: false, user: null };
const listeners = new Set();
export function onAccount(fn) { listeners.add(fn); if (account.ready) fn(account.user); return () => listeners.delete(fn); }
const emit = () => { for (const fn of listeners) fn(account.user); };

// ---------- jméno ----------

// Klíč jména pro jedinečnost: malá písmena bez diakritiky, mezery → _. „Zametač Pepa“ = „zametac pepa“ = zametac_pepa
export function nameKey(name) {
  return String(name || '').trim().toLowerCase()
    .replace(/ł/g, 'l').replace(/ø/g, 'o').replace(/đ/g, 'd').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '_');
}

// Prázdný řetězec = jméno je v pořádku, jinak důvod pro hráče
export function checkName(name) {
  const n = String(name || '').trim();
  if (n.length < 3) return 'Jméno musí mít aspoň 3 znaky.';
  if (n.length > 16) return 'Jméno může mít nejvýš 16 znaků.';
  if (/\s{2,}/.test(n)) return 'Jen jedna mezera mezi slovy.';
  const key = nameKey(n);
  if (!/^[a-z0-9_-]+$/.test(key)) return 'Jen písmena (i s háčky a čárkami), číslice, mezera, - a _.';
  if (key.length < 3 || key.length > 16) return 'Jméno musí mít 3–16 znaků.';
  const bare = key.replace(/[_-]/g, '');
  if (BANNED.some(w => bare.includes(w))) return 'Tohle jméno použít nejde, vyber si jiné.';
  return '';
}

// ---------- Firebase ----------

const fb = () => firebaseApp();
const db = () => fb().database();
const TS = () => window.firebase.database.ServerValue.TIMESTAMP;
const rand = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');

// Kódy chyb Firebase → česká hláška. Neexistující jméno i špatné heslo = stejná věta (nejde zjišťovat jména).
export function errorText(e) {
  const code = String(e?.code || e?.message || '');
  if (/invalid-credential|wrong-password|user-not-found|invalid-login|invalid-email/.test(code)) return 'Špatné jméno nebo heslo.';
  if (/too-many-requests/.test(code)) return 'Moc pokusů za sebou. Zkus to za pár minut.';
  if (/network-request-failed|timeout/.test(code)) return 'Nepodařilo se spojit se serverem. Zkontroluj připojení k internetu.';
  if (/weak-password/.test(code)) return `Heslo je moc slabé (aspoň ${PASS_MIN} znaků).`;
  if (/operation-not-allowed|admin-restricted/.test(code)) return 'Účty teď nejdou založit (vypnuté přihlašování heslem ve Firebase).';
  if (/permission[_-]denied/i.test(code)) return 'Server zápis odmítl. Zkus to znovu, případně obnov stránku.';
  if (/requires-recent-login/.test(code)) return 'Z bezpečnostních důvodů se znovu přihlas.';
  if (code === 'sdk') return 'Knihovnu Firebase se nepodařilo načíst. Zkontroluj připojení a obnov stránku.';
  return 'Něco se nepovedlo. Zkus to znovu.';
}
const fail = (text, code) => Object.assign(new Error(text), { code: code || 'ucet', text });

// Veřejný záznam jména (nebo null)
export async function nameRecord(key) {
  if (!fb()) throw fail(errorText({ code: 'sdk' }), 'sdk');
  return (await db().ref(`jmena/${key}`).get()).val();
}

// Je jméno volné? true / false / null (nejde zjistit)
export async function nameFree(name) {
  if (checkName(name)) return null;
  try { return !(await nameRecord(nameKey(name))); } catch { return null; }
}

// Načte údaje účtu přihlášeného uživatele z ucty/<uid> do account.user (nebo null)
async function loadAccount(user) {
  if (!user || user.isAnonymous) { account.user = null; return null; }
  try {
    const u = (await db().ref(`ucty/${user.uid}`).get()).val();
    if (!u?.klic) { account.user = null; return null; }            // nedokončená registrace (úklid ji smaže)
    const viaEmail = !!user.email && !user.email.endsWith('@' + TECH_DOMAIN);
    account.user = { uid: user.uid, jmeno: u.jmeno, klic: u.klic, vytvoreno: u.vytvoreno, posledni: u.posledni, prihlaseni: viaEmail ? 'email' : 'jmeno', email: viaEmail ? user.email : '' };
    profile.name = u.jmeno;                                         // jméno ve hře = jméno účtu (nejde měnit)
    saveProfile();
    if (viaEmail) {                                                 // U3: hráč potvrdil e-mail → veřejný záznam jména bez technické adresy
      clearPendingEmail();
      db().ref(`jmena/${u.klic}`).transaction(r => (r && (r.tech || r.prihlaseni !== 'email') ? { ...r, tech: null, prihlaseni: 'email' } : undefined))
        .catch(e => console.warn('[účet] záznam jména po e-mailu', e?.code || e));
    }
  } catch (e) {
    console.warn('[účet] nejde načíst', e?.code || e);
    account.user = null;
  }
  return account.user;
}

// Poslední aktivita (serverový čas) do ucty, jmena a aktivita – při přihlášení, během hraní 1× za 10 min (U4)
export async function touchActivity() {
  const u = account.user;
  if (!u || !fb()) return;
  try {
    await db().ref().update({
      [`ucty/${u.uid}/posledni`]: TS(),
      [`jmena/${u.klic}/posledni`]: TS(),
      [`aktivita/${u.uid}`]: { t: TS(), k: u.klic },
    });
  } catch (e) { console.warn('[účet] aktivita se nezapsala', e?.code || e); }
}

// ---------- registrace, přihlášení, odhlášení ----------

// Vytvoří účet. Vrací account.user, nebo vyhodí chybu s .text pro hráče.
export async function register(name, pass) {
  const why = checkName(name);
  if (why) throw fail(why);
  if (String(pass || '').length < PASS_MIN) throw fail(`Heslo musí mít aspoň ${PASS_MIN} znaků.`);
  if (!fb()) throw fail(errorText({ code: 'sdk' }), 'sdk');
  const jmeno = String(name).trim(), klic = nameKey(jmeno);
  if (await nameRecord(klic)) throw fail('Jméno je obsazené, vyber si jiné.', 'taken');

  const auth = fb().auth();
  const current = await authReady();
  if (current && !current.isAnonymous) throw fail('Už jsi přihlášený. Nejdřív se odhlas.');
  const tech = `${rand(16)}@${TECH_DOMAIN}`;
  let user, linked = false;
  try {
    if (current?.isAnonymous) {                                    // dosavadní anonymní hráč: stejné uid (záznamy ve světech zůstanou)
      user = (await current.linkWithCredential(window.firebase.auth.EmailAuthProvider.credential(tech, pass))).user;
      linked = true;
    } else {
      user = (await auth.createUserWithEmailAndPassword(tech, pass)).user;
    }
    await user.getIdToken(true);                                   // nový token: auth.provider = 'password' (pravidla)
  } catch (e) { throw fail(errorText(e), e?.code); }

  // jméno transakcí – zapíše se, jen když ho mezitím nikdo nezabral (pravidlo to hlídá taky)
  let ok = false;
  try {
    const res = await db().ref(`jmena/${klic}`).transaction(cur => (cur ? undefined : { uid: user.uid, jmeno, tech, prihlaseni: 'jmeno', posledni: TS() }));
    ok = res.committed;
  } catch (e) { console.warn('[účet] jméno', e?.code || e); }
  if (!ok) {                                                       // někdo byl rychlejší: vrátit zpět
    try { if (linked) await user.unlink('password'); else await user.delete(); } catch (e) { console.warn('[účet] návrat registrace', e?.code || e); }
    throw fail('Jméno je obsazené, vyber si jiné.', 'taken');
  }
  try {
    await db().ref().update({
      [`ucty/${user.uid}/jmeno`]: jmeno,
      [`ucty/${user.uid}/klic`]: klic,
      [`ucty/${user.uid}/vytvoreno`]: TS(),
      [`ucty/${user.uid}/posledni`]: TS(),
      [`aktivita/${user.uid}`]: { t: TS(), k: klic },
    });
  } catch (e) { throw fail(errorText(e), e?.code); }
  await loadAccount(user);
  emit();
  return account.user;
}

// Přihlášení jménem (a e-mailem, když si ho hráč nastavil – U3). Vrací account.user, { needEmail: true }, nebo vyhodí chybu.
export async function login(name, pass, email = '') {
  if (!fb()) throw fail(errorText({ code: 'sdk' }), 'sdk');
  const klic = nameKey(name);
  const bad = () => fail('Špatné jméno nebo heslo.', 'auth/invalid-credential');
  if (checkName(name) && !/^[a-z0-9_-]{3,16}$/.test(klic)) throw bad();
  const rec = await nameRecord(klic).catch(() => null);
  if (!rec) throw bad();
  if (rec.prihlaseni === 'email' && !email) return { needEmail: true };
  // e-mail zadaný hráčem má přednost: po potvrzení nového e-mailu ještě záznam jména může mít starou technickou adresu
  const address = String(email || '').trim() || rec.tech;
  if (!address) throw bad();
  await authReady();
  let user;
  try { user = (await fb().auth().signInWithEmailAndPassword(address, pass)).user; } catch (e) {
    const err = fail(errorText(e), e?.code);
    if (!email && /invalid-credential|wrong-password|user-not-found/.test(String(e?.code))) err.offerEmail = true;   // možná už se přihlašuje e-mailem
    throw err;
  }
  if (user.uid !== rec.uid) { await fb().auth().signOut(); throw bad(); }   // záznam jména patří jinému účtu
  if (!(await loadAccount(user))) { await fb().auth().signOut(); throw fail('Účet se nepodařilo načíst. Zkus to znovu.'); }
  touchActivity();
  emit();
  return account.user;
}

// ---------- e-mail, heslo, smazání účtu (U3) ----------
// Skutečný e-mail je jen ve Firebase Authentication (přihlašovací adresa), nikdy v databázi hry ani v uložené hře.

const credential = (address, pass) => window.firebase.auth.EmailAuthProvider.credential(address, pass);
async function reauth(pass) {
  const user = fb().auth().currentUser;
  if (!user || user.isAnonymous) throw fail('Nejsi přihlášený.');
  try { await user.reauthenticateWithCredential(credential(user.email, pass)); }
  catch (e) { throw fail(/invalid-credential|wrong-password/.test(String(e?.code)) ? 'Špatné heslo.' : errorText(e), e?.code); }
  return user;
}

// Čekající ověření e-mailu (jen v tomto prohlížeči, kvůli textu v profilu): { klic, at }
const PENDING_KEY = 'ms2_email_pending';
export function pendingEmail() {
  try { const p = JSON.parse(localStorage.getItem(PENDING_KEY)); return p?.klic === account.user?.klic ? p : null; } catch { return null; }
}
function clearPendingEmail() { try { localStorage.removeItem(PENDING_KEY); } catch { /* nic */ } }

// Přidá e-mail pro obnovu hesla: Firebase pošle ověřovací odkaz, po potvrzení je e-mail přihlašovací adresou.
export async function addEmail(email, pass) {
  const address = String(email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw fail('Tohle nevypadá jako e-mailová adresa.');
  if (address.toLowerCase().endsWith('@' + TECH_DOMAIN)) throw fail('Zadej svůj skutečný e-mail.');
  const user = await reauth(pass);
  try { await user.verifyBeforeUpdateEmail(address); } catch (e) {
    throw fail(/invalid-email/.test(String(e?.code)) ? 'Tohle nevypadá jako e-mailová adresa.' : /email-already-in-use/.test(String(e?.code)) ? 'Tenhle e-mail už používá jiný účet.' : errorText(e), e?.code);
  }
  try { localStorage.setItem(PENDING_KEY, JSON.stringify({ klic: account.user.klic, at: Date.now() })); } catch { /* nic */ }
}

// Zapomenuté heslo: odkaz na e-mail (jen účty s potvrzeným e-mailem). Se zapnutou ochranou proti zjišťování e-mailů
// Firebase neprozradí, jestli adresa existuje – hláška je pro všechny stejná.
export async function resetPassword(email) {
  const address = String(email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw fail('Tohle nevypadá jako e-mailová adresa.');
  if (!fb()) throw fail(errorText({ code: 'sdk' }), 'sdk');
  try { await fb().auth().sendPasswordResetEmail(address); } catch (e) {
    if (/user-not-found|invalid-email/.test(String(e?.code))) return;            // bez ochrany: stejně nic neprozradit
    throw fail(errorText(e), e?.code);
  }
}

export async function changePassword(oldPass, newPass) {
  if (String(newPass || '').length < PASS_MIN) throw fail(`Nové heslo musí mít aspoň ${PASS_MIN} znaků.`);
  const user = await reauth(oldPass);
  try { await user.updatePassword(newPass); } catch (e) { throw fail(errorText(e), e?.code); }
}

// Smazání účtu po zadání hesla: ucty, jmena, aktivita, pak přihlašovací účet (i s e-mailem).
// Záznamy v cizích světech (members/<kód>/<uid> = hash hesla světa) nechá úklid se světem (pravidlo je mazat nedovolí).
// wipeLocal: smazat i místní uložení v tomto prohlížeči (sloty, profil, postup ve světech) – dělá accountUi přes onDeleted.
export async function deleteAccount(pass) {
  const u = account.user;
  if (!u) throw fail('Nejsi přihlášený.');
  const user = await reauth(pass);
  try {
    await db().ref().update({ [`ucty/${u.uid}`]: null, [`jmena/${u.klic}`]: null, [`aktivita/${u.uid}`]: null });
  } catch (e) { throw fail(errorText(e), e?.code); }
  try { await user.delete(); } catch (e) { throw fail(errorText(e), e?.code); }
  clearPendingEmail();
  account.user = null;
  profile.name = `Zametač-${Math.floor(100 + Math.random() * 900)}`;
  saveProfile();
  emit();
}

export async function logout() {
  if (!fb()) return;
  const wasIn = !!account.user;
  await fb().auth().signOut();
  account.user = null;
  // jméno účtu zůstává účtu – hráč bez účtu dostane náhodné (jako nový hráč), ať se v lobby nevydává za účet
  if (wasIn) { profile.name = `Zametač-${Math.floor(100 + Math.random() * 900)}`; saveProfile(); }
  emit();
}

// Při startu stránky: obnoví přihlášení (Firebase si ho pamatuje v prohlížeči) a sleduje změny
export async function initAccount() {
  if (!fb()) { account.ready = true; emit(); return; }
  const user = await authReady();
  await loadAccount(user);
  account.ready = true;
  emit();
  if (account.user) touchActivity();
  // U4: během hraní (stránka otevřená) 1× za 10 min – účet se smaže až po 30 dnech bez hraní
  setInterval(() => { if (account.user && !document.hidden) touchActivity(); }, 10 * 60000);
  fb().auth().onAuthStateChanged(async u => {
    if ((u?.uid || null) === (account.user?.uid || null) && (!u || !u.isAnonymous)) return;
    await loadAccount(u);
    emit();
  });
}
