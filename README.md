# Moon Sweepers 2

Chill inkrementální hra: zametáš prach z celého Měsíce zubním kartáčkem, koštětem, vysavači a nakonec flotilou zametacích vozů. Až je Měsíc na 100 % čistý, odletíte obří raketou na Mars a úklid začíná znovu. Hraje se sám nebo s kamarády přes odkaz.

- **Singleplayer:** 5 slotů pro uložené hry (ukládají se v prohlížeči).
- **Multiplayer:** jeden hráč svět hostuje a ostatním pošle odkaz nebo kód. Peníze jsou společné a všichni vidí pohyb a zametání ostatních v reálném čase. Je tu chat a stejná denní doba pro všechny.
- Běží na three.js r128 a statickém webu (GitHub Pages). Multiplayer jede přes Firebase Realtime Database v bezplatném tarifu.

---

## 1. Firebase (multiplayer) – asi 10 minut

Bez tohoto kroku hra funguje, ale jen pro jednoho hráče.

1. Otevři <https://console.firebase.google.com> a klikni na **Create a project** (Vytvořit projekt). Pojmenuj ho třeba `moon-sweepers`. Google Analytics můžeš vypnout. Platební kartu nezadávej, tarif **Spark** je zdarma.
2. **Databáze:** v levém menu zvol **Build → Realtime Database → Create database**.
   - Umístění: **Belgium (europe-west1)**, nejblíž k Česku.
   - Režim: **Start in locked mode**.
   - Na kartě **Rules** smaž obsah, vlož celý soubor `database.rules.json` z tohoto repozitáře a klikni na **Publish**.
3. **Přihlášení:** zvol **Build → Authentication → Get started → Sign-in method**, vyber **Anonymous** a **Enable**. Hráči nepotřebují účet, hra je přihlásí anonymně.
4. **Konfigurace pro web:** klikni na ozubené kolečko → **Project settings → General → Your apps** a přidej webovou aplikaci (ikona `</>`). Firebase Hosting nezaškrtávej.
   - Zkopíruj objekt `firebaseConfig` a vlož ho do souboru `js/firebase-config.js` místo `null`. Příklad, jak to má vypadat, je přímo v tom souboru.
   - **Zkontroluj, že konfigurace obsahuje `databaseURL`** (např. `https://moon-sweepers-default-rtdb.europe-west1.firebasedatabase.app`). Pokud chybí, zkopíruj adresu z horní části stránky Realtime Database.

`apiKey` není tajný a může být ve veřejném repozitáři. Data chrání pravidla databáze: každý hráč smí zapisovat jen svůj vlastní záznam.

## 2. GitHub Pages (hosting zdarma)

1. Na GitHubu vytvoř nový **veřejný** repozitář, třeba `moon-sweepers`. Pages jsou v bezplatném účtu jen pro veřejné repozitáře.
2. Nahraj do něj všechny soubory z tohoto balíčku (**Add file → Upload files**, přetáhni celou složku). Do kořene repozitáře patří `index.html`, `.nojekyll`, `css/`, `js/` a ostatní soubory.
3. Zvol **Settings → Pages → Build and deployment**: Source **Deploy from a branch**, branch **main**, složka **/ (root)** a dej **Save**.
4. Asi za minutu poběží hra na `https://<tvé-jméno>.github.io/moon-sweepers/`.
5. Doporučeno: ve Firebase v **Authentication → Settings → Authorized domains** přidej `<tvé-jméno>.github.io`.

## 3. Hraní s kamarády

1. **Hrát s ostatními → Založit vlastní svět** a vyber slot (uloženou hru nebo novou). Zaškrtnutím zvolíš, jestli se svět ukáže v seznamu lobby, nebo jen přes kód.
2. Ve hře klikni vpravo nahoře na **Pozvat · kopírovat odkaz**, nebo v menu (Esc) na **Kopírovat odkaz pro kamarády**. Odkaz vypadá jako `…/moon-sweepers/#k3x9p`.
3. Kamarád odkaz otevře a připojí se sám. Kód jde zadat i ručně v lobby, pole **Připojit kódem**.
4. Svět drží a ukládá hostitel. Když odejde, svět se zavře. Vybavení ostatních hráčů (nástroje, boty) zůstává v jejich prohlížeči.

**Ovládání:** W/S chůze a plyn, A/D otáčení, mezerník skok (ve vzduchu jetpack), Shift boost vozidla, 1–3 hotbar, X vyprázdnit políčko hotbaru, E akce (u Výkupu hologram a burza), R jiný cíl pásu, G přesunout depo, M mapa (WSAD / šipky otáčí, Q/E přibližuje), U úspěchy, T zrychlení času (v multiplayeru jen hostitel), Enter chat, Esc menu.

## Limity bezplatného tarifu

Firebase Spark: 100 současných připojení a 10 GB stažených dat měsíčně. Hra posílá jen to, co se změnilo, takže limit by měl vystačit na desítky hodin hraní ve čtyřech měsíčně. Skutečný provoz uvidíš v **Realtime Database → Usage**. Když limit dojde, multiplayer do konce měsíce nepoběží. Nic se ale nezaplatí a singleplayer funguje dál.

## Spuštění na vlastním počítači

ES moduly nejdou otevřít dvojklikem (`file://`), stránku je potřeba servírovat přes HTTP:

```bash
python -m http.server 8000
# potom otevři http://localhost:8000
```

## Struktura

| Složka / soubor | Obsah |
|---|---|
| `js/main.js` | start, menu, herní smyčka |
| `js/net.js` | logika multiplayeru (hostitel, tahy koštětem, nákupy, chat) |
| `js/platform/` | přenos dat: Firebase (`firebaseRoom.js`) nebo artefakt claude.ai |
| `js/firebase-config.js` | konfigurace Firebase projektu |
| `js/planet/` | Měsíc: hexy, prach, reliéf, stíny (bez three.js) |
| `js/scene/` | 3D scéna, modely, terén |
| `database.rules.json` | pravidla databáze, vložit do Firebase konzole |
