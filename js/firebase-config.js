// Konfigurace Firebase projektu pro multiplayer.
// Najdeš ji ve Firebase konzoli: Project settings → General → Your apps → Web app → SDK setup and configuration → Config.
// Klíč apiKey není tajný – data chrání pravidla databáze (database.rules.json).
// Dokud je tu null, hra jde hrát jen sama (singleplayer).
export const FIREBASE_CONFIG = null;

/* Příklad, jak to má vypadat:
export const FIREBASE_CONFIG = {
  apiKey: 'AIza...',
  authDomain: 'moon-sweepers.firebaseapp.com',
  databaseURL: 'https://moon-sweepers-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'moon-sweepers',
  appId: '1:1234567890:web:abcdef123456',
};
*/
