// Nákupy za (společné) peníze. Jeden hráč a hostitel nakupují rovnou,
// připojený hráč pošle žádost hostiteli a počká na potvrzení (peníze drží hostitel).
import { game } from './state.js';
import { net, request } from './net.js';

// Osobní nákupy (nástroje, boty) si klient po schválení použije sám; sdílené (garáž, vozidla,
// stanice) provede hostitel a klient je uvidí v dalším sdíleném stavu.
const PERSONAL = new Set(['tool', 'tup', 'boots']);

// kind = druh nákupu, args = parametry pro hostitele, cost = cena, local = funkce, která nákup
// provede a strhne peníze (equipment.js). Vrací true / false, nebo Promise (čeká na hostitele).
export function purchase(kind, args, cost, local) {
  if (net.mode !== 'client') return local();
  if (game.s.money < cost) return false;
  return request(kind, args, cost).then(ok => {
    if (ok && PERSONAL.has(kind)) {
      game.s.money += cost;                    // hostitel už strhl → lokálně jen použít
      local();
    }
    return ok;
  });
}
