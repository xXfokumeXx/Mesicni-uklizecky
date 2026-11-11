# F-10 · Reset prachu při hostování cizího světa – rozbor a oprava (3.1, 10. 11.)

## Jak to fungovalo do 3.0.4

**Kde je prach:** mapa prachu (9,2 mil. bodů) se nikdy neukládá celá – planeta se vygeneruje vždy stejně a ukládá se jen **rozdíl** (kolik prachu kde ubylo), zkomprimovaný gzipem.
- **Slot hostitele** (IndexedDB `moonsweepers2/saves/slotN`, náhradně localStorage): stav `s` + rozdíl mapy, každých 30 s, při skrytí karty a při odchodu.
- **Cloud** (Firebase RTDB `w/<kód>/`): `state` (JSON stavu), `head` + `parts/pN` (rozdíl mapy v base64), `meta` (`at` čas, `d` hotové hexy). Zapisuje **každý hostitel** – vlastník i převzatý / ze cloudu: stav 1× za 20 s, mapu 1× za 60 s a při odchodu do menu. Při skrytí / zavření karty jen stav.

**Odkud se načítá:**
- *Otevření ze slotu jako hostitel:* porovnal se **čas** `meta.at` z cloudu s časem slotu `last` (hodiny dvou různých počítačů). Když byl cloud novější a měl víc hotových hexů, vzala se mapa z cloudu, jinak **jen mapa ze slotu** (+ stav z cloudu).
- *Otevření ze slotu přes „Hrát sám“:* cloud se **vůbec nečetl**.
- *Otevření z cloudu (B nemá slot):* stav i mapa z cloudu; když mapa v cloudu chyběla, hrálo se se zasypaným Měsícem.
- *Převzetí hostitele:* nový hostitel načetl stránku znovu a vzal mapu z cloudu (až 60 s starou).
- *Offline vývoj:* od `last` ze stavu, jen dopředu (záporný čas = nic). Prach se ve hře sám nevrací, offline výpočet jen čistí.

## Co se potvrdilo (chyby)

1. **Mapa se vybírala „buď – anebo“.** A má ve slotu svůj kus, cloud má kus A (až minutu starý) + kus B. Vybrala se jen jedna mapa, takže se ztratil kus druhé strany (Měsíc se „zasypal“). Typicky po „Hrát sám“: slot je novější podle času → vzal se jen slot → postup B zmizel a A ho pak hostováním přepsal i v cloudu.
2. **Porovnání podle hodin různých počítačů.** Když má A hodiny napřed, cloud od B vypadal starší → postup B se ignoroval a přepsal.
3. **„Hrát sám“ se sdíleným slotem cloud nečetl** → hra se rozdvojila a při dalším hostování se jedna větev přepsala druhou.
4. **Zavření karty hostitele** uložilo do cloudu jen stav, mapa chyběla až minutu zametání.
5. **Převzetí hostitele** zahodilo mapu, kterou nový hostitel měl v paměti (novější než cloud).
6. **Chyba zápisu do cloudu** jen v konzoli; hráč nic nevěděl.
7. Offline dopočet mohl dostat špatný čas: první zápis do cloudu po startu přepsal `last` dřív, než se dopočet spustil (ztráta offline práce robotů, ne prachu).

Mapa se nikdy negenerovala „nová“ pro existující svět – načtení z cloudu bez mapy hlásí hlášku, při chybě stažení se hra vůbec nespustí.

## Oprava (3.1)

- **Revize světa** `s.rev` roste s každým uložením (slot i cloud), v cloudu `meta/rv` + kdo zapsal (`meta/wu` = uid, `meta/ws` = karta). `s.crv` = revize cloudu při posledním zápisu / načtení.
- **Výběr stavu podle revize**, ne podle hodin (svět ze starší verze bez `rv` → podle času jako dřív).
- **Mapy prachu se vždy sloučí** (`mergeDustDiff`: v každém bodě méně prachu z obou). Prach se sám nevrací, takže sloučení nikdy nic nezasype – platí pro hostování i „Hrát sám“.
- **Rozdvojení** (Hrát sám ve slotu + jiný hráč v cloudu): stav z vyšší revize, vyčištění z obou, hláška.
- **Pojistky zápisu:** před zápisem se přečte `meta`; zápis se odmítne, když je v cloudu vyšší revize od jiné karty (hláška, další zápisy stop), a mapa se nezapíše, když by hotových hexů ubylo o víc než 5 % (`meta/dp` = planeta mapy; po odletu na Mars se `d` maže).
- **Skrytí karty** uloží i mapu (když je poslední snímek starší než 10 s); zavření karty pošle stav hned bez čekání ve frontě.
- **Převzetí hostitele:** před znovunačtením se mapa uloží do IndexedDB (`handoff`) a po načtení z cloudu se sloučí.
- **Chyba zápisu je vidět:** hláška (offline / odmítnuto pravidly / jiná, nejvýš 1× za 2 min), nový pokus za 15 s, hláška „zase funguje“. Firebase zůstává na Sparku, pravidla beze změny.
- **Konzole** při každém načtení: `[svět] prach z: místní slot | cloud | … sloučená | snímek hostitele | nový, rev …, vyčištěno … hexů`.
- **Test „druhý den“:** na localhostu `?dnyPosun=N` posune čas posledního uložení o N dní zpět.

## Ověřeno (Chrome, dev Firebase, svět f135h, slot 2; stejný profil = stejné uid)

| # | Test | Výsledek |
|---|---|---|
| 1–2 | A vyčistí 300 hexů, odejde; B otevře z cloudu | B vidí 300 ✓ (`prach z: cloud, rev 4`) |
| 3–4 | B vyčistí dalších 300, odejde; A otevře slot s `?dnyPosun=1` | 600 ✓, stav (peníze) od B ✓ |
| 6 | A „Hrát sám“ +200 (slot rev 14), B v cloudu +100 (rev 11); A hostuje ze slotu | 900 = obě větve ✓ (dřív by zbylo 800 a B by se přepsal) |
| 7a | v cloudu `d` uměle 2000, A zapisuje mapu s 900 | mapa se nezapsala, stav ano, hláška ✓ |
| 7b | v cloudu `rv` 9999 od jiné karty | zápis odmítnut, hláška, další zápisy stop ✓ |
| 7c | `goOffline()` | zápis po 30 s „offline“, po `goOnline()` nový pokus a „zase funguje“ ✓ |
| – | převzetí: klient má o 50 hexů víc než cloud, hostitel zavře kartu | nový hostitel zapsal 950 (cloud měl 900) ✓ |

**Neověřeno:** dva skutečně různí hráči (2 profily prohlížeče = různé uid → hlášky „kamarádi hráli bez tebe“ / „rozdvojení“), cizí hodiny počítače.
