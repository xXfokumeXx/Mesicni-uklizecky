// Nákupy za (společné) peníze. Jeden hráč a hostitel nakupují rovnou,
// připojený hráč pošle žádost hostiteli a počká na potvrzení (peníze drží hostitel).
import { game, addStat } from './state.js';
import { profile } from './profile.js';
import { net, request, vehicleTakenBy, reportParked, myStatKey } from './net.js';
import { callBackVehicle } from './equipment.js';

// Osobní nákupy (nástroje, boty) si klient po schválení použije sám; sdílené (garáž, vozidla,
// stanice, depa) provede hostitel a klient je uvidí v dalším sdíleném stavu.
const PERSONAL = new Set(['tool', 'tup', 'boots']);

// kind = druh nákupu, args = parametry pro hostitele, cost = cena, local = funkce, která nákup
// provede a strhne peníze (equipment.js). Vrací true / false, nebo Promise (čeká na hostitele).
// Útratu (a výnos z prodeje) připíše do statistik hráče; u klienta to udělá hostitel.
export function purchase(kind, args, cost, local) {
  if (net.mode !== 'client') {
    const before = game.s.money;
    const ok = local();
    if (game.s.money < before) addStat(myStatKey(), profile.name, 'sp', before - game.s.money);
    else if (game.s.money > before) addStat(myStatKey(), profile.name, 'e', game.s.money - before);
    return ok;
  }
  if (game.s.money < cost) return false;
  return request(kind, args, cost).then(ok => {
    if (ok && PERSONAL.has(kind)) {
      game.s.money += cost;                    // hostitel už strhl → lokálně jen použít
      local();
    }
    return ok;
  });
}

// Přivolání vozidla na parkoviště: když v něm nikdo nesedí, může ho přivolat kdokoli hned,
// bez schvalování hostitelem. Klient vozidlo přesune u sebe a nahlásí novou polohu (jako zaparkování).
export function callVehicle(i) {
  if (game.s.driving === i || vehicleTakenBy(i) || !callBackVehicle(i)) return false;
  if (net.mode === 'client') reportParked(i);
  return true;
}
