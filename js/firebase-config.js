// Konfigurace Firebase projektu pro multiplayer.
// Najdeš ji ve Firebase konzoli: Project settings → General → Your apps → Web app → SDK setup and configuration → Config.
// Klíč apiKey není tajný – data chrání pravidla databáze (database.rules.json).
// Dokud je tu null, hra jde hrát jen sama (singleplayer).

// Ostrá hra (GitHub Pages) – svět kamarádů 2oc4g.
const LIVE = {
  apiKey: 'AIzaSyBWc73Ctlrqqunv4SocJ_TWqpxeVpMUkVs',
  authDomain: 'moon-sweepers-0fq8i.firebaseapp.com',
  databaseURL: 'https://moon-sweepers-0fq8i-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'moon-sweepers-0fq8i',
  appId: '1:429041371685:web:30aebef218d162557bcdcc',
};

// Lokální testování (localhost / 127.0.0.1) – oddělená databáze, testovací světy se kamarádům v lobby neukážou.
// Pravidla jsou stejná jako u ostré (database.rules.json), tarif Spark.
const DEV = {
  apiKey: 'AIzaSyAZQNYXMbzFcJ9AFv0pUh4Au8vbugHn2lg',
  authDomain: 'moon-sweepers-dev.firebaseapp.com',
  databaseURL: 'https://moon-sweepers-dev-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'moon-sweepers-dev',
  appId: '1:652405996318:web:83593feb8b26054f47e70f',
};

const host = typeof location !== 'undefined' ? location.hostname : '';
export const FIREBASE_DEV = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');
export const FIREBASE_CONFIG = FIREBASE_DEV ? DEV : LIVE;
