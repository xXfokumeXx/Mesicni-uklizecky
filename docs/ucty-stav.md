# Účty a ukládání: výchozí stav (3.3, fáze U0)

Inventura před herními účty (`Update 3.3/PREDAVKA-UCTY-A-UKLADANI.md`). Stav kódu 3.2.0 + mobilní ovládání M1–M5, 17. 11. 2026.
Doplňuje se v dalších fázích (testy pravidel, úklid, GitHub Actions).

## 1. Co se dnes ukládá a kde

### V prohlížeči (localStorage)

| Klíč | Modul | Obsah | Velikost | Do účtu? |
|---|---|---|---|---|
| `ms2_profile` | `profile.js` | jméno, vzhled (`look` = skin, color, top, face), úspěchy `ach`, postup k úspěchům `achStats` (z něj hodnost), `rank` | ~0,3–2 kB | **ano** (bez jména, to je v účtu zvlášť) |
| `ms2_mp_<kód>`, na Marsu `ms2_mp_<kód>_mars` | `net.js savePersonal` | osobní postup v cizím světě: tools, tool, boots, belt, jetpack, hammer, hotbar, sel, p, f | ~0,5–2 kB / svět | **ano** (`ucty/<uid>/svety/<kód>[_mars]`) |
| `moonsweep_settings_v2` | `settings.js` | grafika + od 3.3 ovládání (`ovladani`, `joySide`, `camSens`, `btnSize`, `btnOpacity`, `vibrace`) | < 1 kB | **ne** – patří zařízení |
| `ms2_last_slot` | `storage.js` | naposledy hraný slot | pár bajtů | ne |
| `ms2_save_<slot>` | `storage.js` | náhradní uložení slotu, když nejde IndexedDB (mapa v base64) | jako slot | ne (jen záloha zařízení) |
| `moonsweep_v5` | `config.js SAVE_KEY` | hra verze 1 (jen import) | – | ne |

### V prohlížeči (sessionStorage)
`ms2_boot` (co spustit po obnovení stránky), `ms2_planet` (planeta této karty) – jen za běhu, do účtu nepatří.

### V prohlížeči (IndexedDB)

| Databáze / úložiště | Obsah | Do účtu? |
|---|---|---|
| `moonsweepers2` / `saves`, záznamy `slot1`–`slot5` | `{ id, v, meta: { title, savedAt, money, done, total, playMs, planet, ver }, s: game.s, dust: { gz, bytes } }` – stav hry + gzip rozdílu mapy prachu proti vygenerované mapě | **ano** (`ucty/<uid>/sloty/<id>`) |
| `moonsweepers2` / `saves`, záznam `handoff` | mapa klienta při převzetí hostitele (platí 10 min) | ne |
| `ms2_sunmap` / `tiles` | cache mapy oken osvětlení (stíny kopců) | ne – spočítá se znovu |

### Ve Firebase (Realtime Database, `europe-west1`)

Ostrý projekt `moon-sweepers-0fq8i`, testovací `moon-sweepers-dev` (localhost / 127.0.0.1). Obě databáze v **europe-west1** (podle `databaseURL` v `js/firebase-config.js`).

| Cesta | Kdo zapisuje | Obsah | Trvalé? |
|---|---|---|---|
| `lobby/<peer>` | každý hráč | presence v lobby (onDisconnect maže) | ne |
| `rooms/svet-<kód>/peers/<peer>` | každý hráč světa | presence ve světě | ne |
| `w/<kód>/meta` | hostitel | `t` název, `pn` planeta, `at` čas uložení (**čas klienta** = `s.last`), `rv` revize, `wu` uid, `ws` relace, `ver`, `lk` heslo, `d`/`dp` hotové hexy mapy | ano |
| `w/<kód>/state`, `head`, `parts/p<i>` | hostitel | stav světa, hlavička mapy, mapa prachu v dílech po **400 000 znaků** base64 (`cloud.js PART`) | ano |
| `w/<kód>/host` | hostitel | zámek hostitele | ano (dokud se neuvolní) |
| `secrets/<kód>` | vlastník světa | hash hesla `h`, vlastníci `o` | ano |
| `members/<kód>/<uid>` | hráč | hash hesla, kterým se přihlásil | ano |
| `docs/worlds~<kód>…` | (verze ≤ 2.3) | starý snímek mapy | pozůstatek |

- **Přihlášení:** jen anonymní (`signInAnonymously`) a **jen při multiplayeru** – `net.js initLobby → connectPlatform` (menu „Hrát s ostatními“, hostování, převzetí). Kdo hraje jen sám, nemá žádné `uid`.
- **SDK:** compat 10.12.2 (`firebase-app/auth/database-compat.js` z gstatic). Má `linkWithCredential`, `EmailAuthProvider`, `verifyBeforeUpdateEmail`, `reauthenticateWithCredential`, `sendPasswordResetEmail`.
- **Analytics:** v kódu žádná (žádný `firebase-analytics`, `gtag`, `measurementId`). V konzoli projektu ověří hráč (U4).
- **Revize (F-10) je hotová:** `s.rev` roste s každým uložením, `s.crv` = revize cloudu při poslední synchronizaci, cloud odmítne zápis nižší revize (`meta/rv`).

## 2. Změřená velikost slotu

Měřeno v Chromu (127.0.0.1, slot 5, Měsíc): mapa prachu 4 800 × 1 920 = **9,2 mil. bodů** (1 bajt / bod), 10 892 hexů. Do slotu se ukládá gzip rozdílu proti vygenerované mapě. Čištění simulováno `clearHex` na náhodných hexech (ukládání během měření zamčené).

| Vyčištěno | gzip | base64 (do RTDB) |
|---|---|---|
| 0 % (nová hra) | 9 kB | 12 kB |
| 10 % | 206 kB | 275 kB |
| 50 % | 742 kB | 990 kB |
| 100 % | 1 029 kB | 1 373 kB |

- **Stav hry** (`game.s` jako JSON): nová hra 0,8 kB; rozehraná se stavbami, pásy a vozidly řádově **10–100 kB** (odhad, roste hlavně s pásy – body trasy).
- **Mars:** mapa 20,7 mil. bodů = 2,25× Měsíc → odhad **až ~2,3 MB gzip / ~3,1 MB base64**.
- Skutečné zametání nechává v hexech zbytky (ne čistou nulu), rozdíl je pak méně pravidelný – počítám s rezervou **×1,5**: Měsíc nejvýš ~2 MB, Mars ~4,5 MB base64 na slot.
- **Díly:** použít stejnou velikost jako svět v cloudu, **400 000 znaků** (`cloud.js PART`, jedna funkce pro obojí) místo 200 000 ze zadání → Měsíc nejvýš 4–5 dílů, Mars 8–12. Pravidlo: řetězec dílu ≤ 400 000 znaků.

## 3. Odhad pro tarif Spark

Limity Spark (RTDB): **1 GB uložených dat**, **10 GB stažených dat za měsíc**, 100 současných připojení. Nahrávání (zápis) se do 10 GB nepočítá.

- **Úložiště na účet:** typicky 1–2 rozehrané sloty na Měsíci = 0,5–3 MB; nejhorší případ 5 slotů + záloha na Marsu ≈ 6 × 4,5 MB = **27 MB**. Profil a osobní postup ve světech < 50 kB.
  → 1 GB stačí na **stovky běžných účtů** (300–1 000), v nejhorším případě ~35 účtů plných marťanských slotů. Pro desítky hráčů hluboko pod limitem; mazání po 30 dnech neaktivity drží objem dole.
- **Stahování:** slot se stahuje jen při načtení na jiném zařízení / když je v cloudu novější revize (jinak se hraje z místní kopie v IndexedDB). Načtení = 0,3–2 MB. I 50 hráčů × 30 načtení měsíčně × 2 MB = 3 GB – vedle dnešního provozu multiplayeru (~47 MB na hráče a hodinu, `UKOLY.md`) je to málo.
- **Zápis do cloudu nejvýš 1× za 2 min** (U §4) a **jen když se změnila mapa nebo stav** (porovnat otisk / revizi) – nahrávání sice limit nežere, ale šetří data na mobilu.
- Doporučení pro U2: díly mapy zapisovat jen při změně mapy (otisk gzipu), stav + meta při každém uložení; meta jako poslední = potvrzení celého slotu.

## 4. Dopady na další fáze (z prověrky)

- **Jméno a klíč:** dnešní jména (`Zametač-123`) projdou pravidlem klíče `[a-z0-9_-]{3,16}` po odstranění diakritiky. Pravidla jména viz `Update 3.3/PLAN-3.3.md` (Rozhodnutí 3).
- **Registrace bez `uid`:** hráč, který nikdy nehrál multiplayer, nemá anonymní účet → `createUserWithEmailAndPassword`; jinak `linkWithCredential` (zachová `uid` a tím i `members/<kód>/<uid>`).
- **Chyby přihlášení:** s ochranou proti zjišťování e-mailů vrací Firebase `auth/invalid-credential` (ne `wrong-password` / `user-not-found`).
- **Úklid (U4):** číst lehký index `aktivita/<uid>` místo celých `ucty/*` (jinak by úklid denně stáhl všechny sloty), světy podle nového `w/<kód>/meta/posledni` (serverový čas), anonymní účty podle `metadata.lastRefreshTime`. Při mazání světa i `secrets/<kód>`, `members/<kód>`, `rooms/svet-<kód>`, staré `docs/worlds~<kód>*`.
- **Členství v cizích světech** (`members/<kód>/<uid>`): dnešní pravidlo nedovolí členovi záznam smazat (zápis jen s hashem) → při smazání účtu ho nechá úklid, nebo se pravidlo rozšíří o `!newData.exists()`.

## 5. Ještě ověřit (potřebuje Firebase konzoli nebo souhlas hráče)

- [x] V dev projektu zapnout **Email/Password** (Authentication → Sign-in method) – hráč 17. 11.
- [x] Firebase přijme technickou adresu `…@hraci.mesicni-zametacky.invalid` (ověřeno 17. 11., zkušební účet smazán).
- [x] Po `linkWithCredential` je `signInProvider` v tokenu hned `password` a uid stejné (ověřeno 17. 11.).
- [x] **Email enumeration protection** zapnutá v dev (hráč 17. 11.).
- [ ] **České šablony e-mailů** (Authentication → Templates → u každé šablony tužka → *Template language: Czech*) – v dev i v ostrém projektu.
- [ ] Ostrý projekt při nasazení: zapnout Email/Password, ochrana proti zjišťování e-mailů, české šablony, pravidla `database.rules.json`.
- [ ] Analytics v projektu vypnutá, potvrzené *Data Processing and Security Terms* (Project settings).

## 6. Aktivita a úklid po 30 dnech (U4)

- **Aktivita účtu:** `ucty/<uid>/posledni`, `jmena/<klíč>/posledni` a `aktivita/<uid>` (serverový čas) se zapíšou při přihlášení / otevření hry a pak 1× za 10 min, dokud je hra otevřená (`account.js touchActivity`).
- **Aktivita světa:** hostitel při každém zápisu světa do cloudu zapíše `w/<kód>/meta/posledni` (serverový čas, `cloud.js`). Starší světy bez něj se posuzují podle `meta/at` (čas klienta).
- **Pozor:** úklid smaže i sdílený svět, který nikdo 30 dní neotevřel – platí i pro hlavní svět kamarádů, když se 30 dní nehraje. Zálohu má hostitel ve svém slotu (a mimo repozitář).

### Skript `tools/uklid-uctu.mjs`

Firebase Admin SDK (funguje i na Sparku – platí se jen za Cloud Functions, ty se nepoužívají). Smaže účty bez hraní 30+ dní (`ucty`, `jmena`, `aktivita` + přihlašovací účet i s e-mailem), anonymní přihlášení bez aktivity 30+ dní (`metadata.lastRefreshTime`), nedokončené registrace starší než 1 den a světy neotevřené 30+ dní (`w`, `secrets`, `members`, `rooms/svet-<kód>`, staré `docs/worlds~<kód>…`). Čte jen `aktivita` a po jednom `w/<kód>/meta` (seznam světů mělce přes REST) – nestahuje uložené hry ani mapy. Do výpisu jdou jen počty.

Jednou nainstalovat (ve složce `tools`): `npm install`. Pak nanečisto `node uklid-uctu.mjs --nanecisto`, ostře `node uklid-uctu.mjs`.

Přihlášení: proměnná `GOOGLE_APPLICATION_CREDENTIALS` = cesta k JSON klíči servisního účtu (soubor **mimo repozitář**), nebo `FIREBASE_SERVICE_ACCOUNT` = obsah klíče; databáze `FIREBASE_DATABASE_URL` (nebo `--projekt <id>`). Volba `--dni N` (výchozí 30).

**Klíč servisního účtu** (udělá hráč, pro každý projekt zvlášť): Firebase konzole → ⚙ Project settings → **Service accounts** → *Generate new private key* → uložit do vlastní složky **mimo složku hry** (např. `klice` vedle ní). Klíč dává plný přístup k projektu – nikomu ho neposílat, nenahrávat na GitHub.

**První spuštění vždy nanečisto** (nejdřív dev projekt, pak ostrý) a výstup ukázat.

**Dev projekt 17. 11.:** nanečisto 5 přihlašovacích účtů, 9 světů, nic ke smazání. Test: účet s aktivitou o 31 dní zpět → nanečisto 1 účet → ostrý běh ho smazal (jméno volné, přihlášení nejde, účtů 4). Ostrý projekt zatím nespuštěn.

### GitHub Actions `.github/workflows/uklid-uctu.yml`

- Denně ve 3:17 UTC (`cron: '17 3 * * *'`) ostře; ručně (Actions → Úklid účtů → Run workflow) s volbou *nanečisto* (výchozí zapnutá).
- Secrets (repozitář → Settings → Secrets and variables → Actions → New repository secret): `FIREBASE_SERVICE_ACCOUNT` = celý obsah JSON klíče **ostrého** projektu, `FIREBASE_DATABASE_URL` = `https://moon-sweepers-0fq8i-default-rtdb.europe-west1.firebasedatabase.app`.
- Souhrn běhu (počty) je v záložce běhu (Summary).
- **GitHub vypne plánované workflow ve veřejném repozitáři po 60 dnech bez commitu.** Znovu zapnout: Actions → Úklid účtů → tlačítko *Enable workflow*. Úklid jde kdykoli spustit i ručně u sebe (výše).
- Workflow a `tools/` se nahrávají na GitHub s nasazením 3.3 (webovým rozhraním jako ostatní soubory; `tools/node_modules` ne).

## 7. Pravidla – co je ověřené

Ověřeno skutečnými požadavky z hry proti dev projektu (17. 11., U1–U3), v Rules Playground jde zopakovat:

| Požadavek | Výsledek |
|---|---|
| čtení celého `jmena` (seznam hráčů) | zamítnuto |
| čtení `jmena/<klíč>` | povoleno (jen uid, jméno, technická adresa, způsob přihlášení, čas) |
| čtení `ucty/<cizí uid>` | zamítnuto |
| zápis `jmena/<klíč>`, který patří jinému uid | zamítnuto (registrace → „Jméno je obsazené“) |
| zápis do `jmena`, `ucty`, `aktivita` anonymním hráčem | zamítnuto (`auth.provider === 'password'`) |
| vlastník zapíše `ucty/<uid>/sloty/slot5` (díly ≤ 400 000 znaků) | povoleno |
| smazání vlastních `ucty`, `jmena`, `aktivita` (smazání účtu) | povoleno |

## 8. Rozumné minimum k ochraně údajů – stav

- [x] Žádné povinné osobní údaje (jméno + heslo), upozornění „Použij přezdívku…“.
- [x] E-mail jen volitelně a jen ve Firebase Authentication, v profilu zkráceně; maže se s účtem.
- [x] Text **Co ukládáme** (hlavní menu, registrace) – `accountUi.js openPrivacy`.
- [x] Smazání účtu hráčem po zadání hesla; automatické smazání po 30 dnech (skript výše).
- [x] V kódu žádná analytika; do konzole se nepíšou e-maily ani hesla.
- [ ] Firebase konzole (hráč): Analytics vypnutá, potvrzené *Data Processing and Security Terms* (Project settings → Data privacy), české šablony e-mailů. Databáze běží v **europe-west1** (Belgie).
