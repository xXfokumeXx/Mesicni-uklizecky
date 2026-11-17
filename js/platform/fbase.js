// Společné připojení k Firebase (3.3, účty U1): aplikace, přihlášení a databáze pro multiplayer (firebaseRoom.js)
// i pro herní účty (account.js), které fungují i bez multiplayeru.
// Pozor: currentUser je po načtení stránky chvíli null, než Firebase obnoví uložené přihlášení. Kdo by v tu chvíli
// zavolal signInAnonymously, odhlásil by přihlášený účet – proto vždy nejdřív authReady().
import { FIREBASE_CONFIG } from '../firebase-config.js';

let readyPromise = null;

// window.firebase s inicializovanou aplikací, nebo null (SDK se nenačetlo / chybí konfigurace)
export function firebaseApp() {
  const fb = window.firebase;
  if (!FIREBASE_CONFIG || !fb?.initializeApp || !fb.auth || !fb.database) return null;
  if (!fb.apps.length) fb.initializeApp(FIREBASE_CONFIG);
  return fb;
}

// Počká, až Firebase obnoví uložené přihlášení (nebo zjistí, že žádné není). Vrací uživatele nebo null.
export function authReady() {
  const fb = firebaseApp();
  if (!fb) return Promise.resolve(null);
  readyPromise ||= new Promise(resolve => {
    const stop = fb.auth().onAuthStateChanged(user => { stop(); resolve(user); });
  });
  return readyPromise.then(() => fb.auth().currentUser);
}

// Přihlášený uživatel – herní účet, nebo anonymní (založí se, když není nikdo). Pro multiplayer.
export async function ensureUser() {
  const fb = firebaseApp();
  if (!fb) throw new Error('sdk');
  await authReady();
  if (!fb.auth().currentUser) await fb.auth().signInAnonymously();
  return fb.auth().currentUser;
}
