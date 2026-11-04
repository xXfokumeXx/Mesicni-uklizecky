// Multiplayer běží jen přes Firebase Realtime Database (firebaseRoom.js) – hra se hraje z GitHub Pages.
// (Od 3.0 bez větve pro artefakt na claude.ai.) Lokálně (localhost) se použije dev databáze, viz firebase-config.js.
// Vrací { room, db, me?, kind } nebo { error: text pro hráče }.
import { FIREBASE_CONFIG } from '../firebase-config.js';
import { createFirebasePlatform } from './firebaseRoom.js';

export async function connectPlatform() {
  if (!FIREBASE_CONFIG) {
    return { error: 'Multiplayer ještě není nastavený: do souboru js/firebase-config.js patří konfigurace Firebase projektu (návod je v README).' };
  }
  if (!window.firebase) {
    return { error: 'Knihovnu Firebase se nepodařilo načíst. Zkontroluj připojení k internetu nebo blokování reklam a obnov stránku.' };
  }
  try {
    return await createFirebasePlatform(FIREBASE_CONFIG);
  } catch (e) {
    console.warn('Firebase', e);
    const code = String(e?.code || e?.message || '');
    if (code.includes('admin-restricted') || code.includes('operation-not-allowed')) {
      return { error: 'Ve Firebase konzoli zapni přihlášení Anonymous (Authentication → Sign-in method).' };
    }
    return { error: 'K multiplayeru se nepodařilo připojit. Zkus obnovit stránku.' };
  }
}
