#!/usr/bin/env node
// Úklid herních účtů a sdílených světů (3.3, fáze U4 – Update 3.3/PREDAVKA-UCTY-A-UKLADANI.md, část 5.1).
// Firebase zůstává na tarifu Spark: místo Cloud Functions (jen Blaze) běží tenhle skript s Firebase Admin SDK
// – denně v GitHub Actions (.github/workflows/uklid-uctu.yml), nebo ručně u sebe.
//
// Co smaže (vše starší než 30 dní):
//   1. herní účty bez hraní: aktivita/<uid>.t → ucty/<uid>, jmena/<klíč>, aktivita/<uid> + přihlašovací účet (i e-mail)
//   2. anonymní přihlašovací účty (multiplayer bez účtu) podle metadata.lastRefreshTime
//   3. nedokončené registrace: účet s heslem bez záznamu v aktivita, založený před víc než 1 dnem
//   4. sdílené světy, které nikdo neotevřel (w/<kód>/meta/posledni, u starších meta/at): w/<kód>, secrets/<kód>,
//      members/<kód>, rooms/svet-<kód> a staré docs/worlds~<kód>…
// Do výpisu jdou jen počty – žádná jména, e-maily ani uid.
//
// Spuštění:
//   cd tools && npm install            (jednou – nainstaluje firebase-admin)
//   node tools/uklid-uctu.mjs --nanecisto                     jen vypíše, co by smazal (VŽDY nejdřív tohle)
//   node tools/uklid-uctu.mjs                                 smaže
// Přihlášení (jedno z):
//   FIREBASE_SERVICE_ACCOUNT = obsah JSON klíče servisního účtu (GitHub secret), FIREBASE_DATABASE_URL = adresa databáze
//   GOOGLE_APPLICATION_CREDENTIALS = cesta k JSON klíči (mimo repozitář!), FIREBASE_DATABASE_URL
// Volby: --dni N (výchozí 30), --projekt <id> (bez FIREBASE_DATABASE_URL: https://<id>-default-rtdb.europe-west1.firebasedatabase.app)
import admin from 'firebase-admin';
import fs from 'node:fs';

const args = process.argv.slice(2);
const arg = (name, def = null) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def; };
const DRY = args.includes('--nanecisto');
const DAYS = Number(arg('--dni', 30));
const NOW = Date.now();
const LIMIT = NOW - DAYS * 86400000;
const DAY1 = NOW - 86400000;
const TECH = '@hraci.mesicni-zametacky.invalid';

// ---------- přihlášení ----------
function credentialAndProject() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    return { credential: admin.credential.cert(sa), projectId: sa.project_id };
  }
  // GOOGLE_APPLICATION_CREDENTIALS = cesta k JSON klíči servisního účtu (projekt z klíče)
  const file = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (file) { const sa = JSON.parse(fs.readFileSync(file, 'utf8')); return { credential: admin.credential.cert(sa), projectId: sa.project_id }; }
  console.error('Chybí klíč servisního účtu: FIREBASE_SERVICE_ACCOUNT (obsah JSON) nebo GOOGLE_APPLICATION_CREDENTIALS (cesta k souboru).');
  process.exit(2);
}
const { credential, projectId } = credentialAndProject();
const DB_URL = (process.env.FIREBASE_DATABASE_URL || (arg('--projekt') || projectId ? `https://${arg('--projekt') || projectId}-default-rtdb.europe-west1.firebasedatabase.app` : '')).replace(/\/$/, '');
if (!DB_URL) { console.error('Chybí FIREBASE_DATABASE_URL (nebo --projekt).'); process.exit(2); }
const project = arg('--projekt') || projectId;
admin.initializeApp({ credential, databaseURL: DB_URL, projectId: project });
const db = admin.database();
const auth = admin.auth();

// Klíče uzlu bez stahování obsahu (REST shallow – Admin SDK to neumí; celé w/ by stáhlo všechny mapy)
async function keys(p) {
  const { access_token: token } = await credential.getAccessToken();
  const r = await fetch(`${DB_URL}/${p}.json?shallow=true`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`shallow ${p}: HTTP ${r.status}`);
  return Object.keys((await r.json()) || {});
}

// Zápis mazání po dávkách (víc cest najednou)
async function removePaths(paths) {
  for (let i = 0; i < paths.length; i += 200) {
    const upd = Object.fromEntries(paths.slice(i, i + 200).map(p => [p, null]));
    if (!DRY) await db.ref().update(upd);
  }
}
async function removeUsers(uids) {
  for (let i = 0; i < uids.length; i += 1000) {
    if (DRY) continue;
    const res = await auth.deleteUsers(uids.slice(i, i + 1000));
    if (res.failureCount) console.warn(`  přihlašovací účty: ${res.failureCount} se nepodařilo smazat`);
  }
}

const summary = [];
const say = line => { console.log(line); summary.push(line); };

async function main() {
  say(`Úklid ${DRY ? '**NANEČISTO** (nic se nemaže)' : 'ostrý'} · projekt ${project || '?'} · neaktivní déle než ${DAYS} dní`);

  // 1. herní účty podle aktivity
  const aktivita = (await db.ref('aktivita').get()).val() || {};
  const stale = Object.entries(aktivita).filter(([, a]) => !(Number(a?.t) > LIMIT));
  const accPaths = [];
  for (const [uid, a] of stale) {
    accPaths.push(`ucty/${uid}`, `aktivita/${uid}`);
    if (a?.k && /^[a-z0-9_-]{3,16}$/.test(a.k)) {
      const owner = (await db.ref(`jmena/${a.k}/uid`).get()).val();
      if (owner === uid) accPaths.push(`jmena/${a.k}`);          // jméno mezitím nemá jiný účet
    }
  }

  // 2. + 3. přihlašovací účty (anonymní, nedokončené registrace)
  const anon = [], unfinished = [];
  let users = 0, page;
  do {
    const res = await auth.listUsers(1000, page);
    for (const u of res.users) {
      users++;
      const created = Date.parse(u.metadata.creationTime) || 0;
      const seen = Date.parse(u.metadata.lastRefreshTime || u.metadata.lastSignInTime || u.metadata.creationTime) || 0;
      const isPassword = u.providerData.some(p => p.providerId === 'password');
      if (!isPassword) { if (seen < LIMIT) anon.push(u.uid); continue; }
      if (!aktivita[u.uid] && created < DAY1 && (u.email?.endsWith(TECH) || !u.email)) unfinished.push(u.uid);
    }
    page = res.pageToken;
  } while (page);
  for (const uid of unfinished) accPaths.push(`ucty/${uid}`);

  say(`- přihlašovacích účtů celkem: ${users}`);
  say(`- herní účty bez hraní ${DAYS}+ dní: ${stale.length}`);
  say(`- anonymní přihlášení bez aktivity ${DAYS}+ dní: ${anon.length}`);
  say(`- nedokončené registrace (starší než 1 den): ${unfinished.length}`);

  // 4. sdílené světy
  const codes = await keys('w');
  const docs = await keys('docs').catch(() => []);
  const oldWorlds = [];
  for (const code of codes) {
    const meta = (await db.ref(`w/${code}/meta`).get()).val() || {};
    const last = Number(meta.posledni) || Number(meta.at) || 0;
    if (last < LIMIT) oldWorlds.push(code);
  }
  const worldPaths = oldWorlds.flatMap(c => [`w/${c}`, `secrets/${c}`, `members/${c}`, `rooms/svet-${c}`,
    ...docs.filter(d => d.startsWith(`worlds~${c}`)).map(d => `docs/${d}`)]);
  say(`- sdílené světy: ${codes.length}, neotevřené ${DAYS}+ dní: ${oldWorlds.length}`);

  // mazání (nanečisto nic)
  await removePaths([...accPaths, ...worldPaths]);
  await removeUsers([...stale.map(([uid]) => uid), ...anon, ...unfinished]);
  say(DRY ? '→ Nanečisto: nic se nesmazalo. Ostrý běh: bez --nanecisto.' : '→ Smazáno.');

  if (process.env.GITHUB_STEP_SUMMARY) {
    summary.push('', '> GitHub vypne plánované spouštění ve veřejném repozitáři po 60 dnech bez commitu. Pak ho znovu zapneš v Actions → Úklid účtů → Enable workflow (popis v docs/ucty-stav.md).');
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join('\n') + '\n');
  }
}

main().then(() => process.exit(0), e => { console.error('Úklid selhal:', e?.message || e); process.exit(1); });
