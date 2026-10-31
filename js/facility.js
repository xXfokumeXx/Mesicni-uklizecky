// Okna budov (Obchod s nástroji, Dílna, Garáž): mřížka karet vlevo, detail vpravo.
// Obsah se skládá z dat (catalog.js + stav hry), akce volají equipment.js přes econ.js
// (v multiplayeru schvaluje nákupy hostitel). Verze 2: Šatna v Dílně, Flotila v Garáži.
import {
  TOOLS, VEHICLES, TOOL_UPGRADES, VEHICLE_UPGRADES, GARAGE_PRICE, STATION, BOOTS, SILO, vehicleById,
  SUIT_COLORS, HELMET_PROPS, propById,
} from './catalog.js';
import { MOON, MAX_VEHICLES } from './config.js';
import { game } from './state.js';
import {
  toolStats, vehicleStats, ownsTool, buyTool, equipTool, toolUpgradeCost, upgradeTool,
  bootsLevel, walkSpeed, bootsUpgradeCost, upgradeBoots, vehicleCount, fleetFull,
  buildGarage, buyVehicle, vehicleUpgradeCost, upgradeVehicle, stationPrice,
  vehicleSellValue, sellVehicle,
} from './equipment.js';
import { purchase, callVehicle } from './econ.js';
import { vehicleTakenBy, isClient } from './net.js';
import { profile, saveProfile, sanitizeName } from './profile.js';
import { parkingSpot, distanceToBase } from './base.js';
import { angleBetween } from './planet/vec.js';
import { buildToolModel, buildBootsModel } from './scene/toolModels.js';
import { buildVehicle } from './scene/vehicles.js';
import { buildStation, buildSilo, buildGarage as buildGarageModel } from './scene/buildings.js';
import { fmt } from './format.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const m = v => (v < 1 ? `${Math.round(v * 100)} cm` : `${v.toFixed(2).replace(/\.?0+$/, '')} m`);
const kg = v => `${v < 10 ? v.toFixed(1) : Math.round(v)} kg`;
const money = v => '$' + fmt(v);
const hex = n => '#' + n.toString(16).padStart(6, '0');

const TITLES = { toolshop: 'Obchod s nástroji', workshop: 'Dílna', garage: 'Garáž' };

let thumb = null;            // generátor náhledů (scene/thumbs.js)
let hooks = null;            // { onOpen, onClose, onChange, onPlaceStation, onLook, wardrobe, headModel }
const view = { id: null, tab: null, sel: null };
let busy = false;            // čeká se na hostitele (multiplayer)

// Pořadové číslo vozidla stejného typu („Zametač se sedačkou #2“).
function vehicleName(i) {
  const v = game.s.vehicles[i];
  const base = vehicleById(v.type);
  const same = game.s.vehicles.filter(x => x.type === v.type);
  if (same.length < 2) return base.name;
  return `${base.name} #${game.s.vehicles.slice(0, i + 1).filter(x => x.type === v.type).length}`;
}

// ---------- obsah jednotlivých budov ----------

function toolsTab(forUpgrades) {
  const list = forUpgrades ? TOOLS.filter(t => ownsTool(t.id)) : TOOLS;
  return list.map(t => {
    const owned = ownsTool(t.id);
    const inHand = game.s.tool === t.id && game.s.driving < 0;
    const st = toolStats(t.id);
    const item = game.s.tools[t.id];
    const chip = inHand ? ['V RUCE', 'active'] : owned ? ['KOUPENO', 'owned'] : ['V OBCHODĚ', 'store'];
    const detail = {
      eyebrow: 'Ruční nástroj',
      title: t.name,
      desc: t.desc,
      stats: [
        ['Šířka pásu', m(st.width)],
        ['Zásobník', kg(st.hopper)],
        ['Síla', `${st.power} / tick`],
        ...(owned ? [['Náplň', `${kg(item.load)} / ${kg(st.hopper)}`]] : []),
      ],
    };
    if (forUpgrades) {
      detail.upgrades = Object.entries(TOOL_UPGRADES).map(([key, u]) => {
        const lv = item.lv[key];
        const cost = toolUpgradeCost(t.id, key);
        const next = { ...item.lv, [key]: lv + 1 };
        const after = key === 'width' ? m(t.width * (1 + u.step * next.width))
          : key === 'hopper' ? kg(t.hopper * (1 + u.step * next.hopper)) : `${t.power + u.step * next.power}`;
        const now = key === 'width' ? m(st.width) : key === 'hopper' ? kg(st.hopper) : `${st.power}`;
        return {
          name: u.name, lv, max: u.max, effect: cost === null ? now : `${now} → ${after}`,
          cost, run: () => purchase('tup', [t.id, key], cost, () => upgradeTool(t.id, key)),
        };
      });
    } else if (!owned) {
      detail.action = { label: `Koupit · ${money(t.price)}`, disabled: game.s.money < t.price, run: () => purchase('tool', [t.id], t.price, () => buyTool(t.id)) };
    } else if (!inHand) {
      detail.action = { label: 'Vzít do ruky', disabled: game.s.driving >= 0, run: () => equipTool(t.id) };
    } else {
      detail.action = { label: 'Máš v ruce', disabled: true };
    }
    return { key: t.id, name: t.name, chip, thumb: () => thumb(`tool-${t.id}`, () => buildToolModel(t.id)), detail };
  });
}

function stationsTab() {
  const price = stationPrice();
  return [{
    key: 'station',
    name: 'Stanice robota',
    chip: [`${game.s.stations.length}× POSTAVENO`, game.s.stations.length ? 'owned' : 'store'],
    thumb: () => thumb('station', () => buildStation().root),
    detail: {
      eyebrow: 'Automatizace',
      title: 'Stanice robota',
      desc: 'Po umístění vyrobí robota, který čistí hexy do vzdálenosti 2 hexů od stanice a sám se do ní vykládá.',
      stats: [
        ['Oblast', '19 hexů (2 kolem stanice)'],
        ['Šířka pásu robota', m(STATION.width)],
        ['Zásobník robota', kg(STATION.hopper)],
        ['Rychlost', `${STATION.speed} m/s`],
        ['Postaveno', `${game.s.stations.length}`],
      ],
      action: {
        label: `Koupit a umístit · ${money(price)}`,
        disabled: game.s.money < price,
        run: () => { hooks.onPlaceStation(); return 'close'; },
      },
    },
  }, {
    key: 'depot',
    name: 'Depo na prach',
    chip: [`${game.s.depots.length}× POSTAVENO`, game.s.depots.length ? 'owned' : 'store'],
    thumb: () => thumb('silo', () => buildSilo().root),
    detail: {
      eyebrow: 'Logistika',
      title: 'Depo na prach',
      desc: 'Sklad prachu daleko od základny: vysypeš do něj zásobník jako do Výkupu a nemusíš jezdit domů. '
        + 'U depa pak postavíš nadzemní pás, který prach odveze do Výkupu a prodá ho. Pás vede ve výšce, pod ním projedeš i s roverem.',
      stats: [
        ['Cena depa', money(SILO.price)],
        ['Pás do základny', `${money(SILO.beltPerHex)} za hex`],
        ['Výkon pásu', `${SILO.beltRate} kg/s · ${SILO.beltSpeed} m/s`],
        ['Postaveno', `${game.s.depots.length}`],
      ],
      action: {
        label: `Koupit a umístit · ${money(SILO.price)}`,
        disabled: game.s.money < SILO.price,
        run: () => { hooks.onPlaceDepot(); return 'close'; },
      },
    },
  }];
}

function vehiclesShopTab() {
  const full = fleetFull();
  return VEHICLES.map(v => {
    const count = vehicleCount(v.id);
    const chip = count ? [`VLASTNÍŠ ${count}×`, 'owned'] : ['V OBCHODĚ', 'store'];
    const stats = v.kind === 'transport'
      ? [['Max. rychlost', `${v.speed.toFixed(1)} m/s`], ['Zametání', 'ne – jen přesun']]
      : [['Šířka sání', m(v.width)], ['Zásobník', kg(v.hopper)], ['Max. rychlost', `${v.speed.toFixed(1)} m/s`]];
    stats.push(['Ve flotile', `${count}×`]);
    return {
      key: v.id, name: v.name, chip,
      thumb: () => thumb(`veh-${v.id}`, () => buildVehicle(v.id).root),
      detail: {
        eyebrow: v.kind === 'push' ? 'Zametací vozík' : v.kind === 'transport' ? 'Přepravní vozidlo' : 'Zametací vozidlo',
        title: v.name, desc: v.desc, stats,
        action: full
          ? { label: `Parkoviště je plné (${MAX_VEHICLES} vozidel)`, disabled: true }
          : { label: `${count ? 'Koupit další' : 'Koupit'} · ${money(v.price)}`, disabled: game.s.money < v.price, run: () => purchase('veh', [v.id], v.price, () => buyVehicle(v.id)) },
      },
    };
  });
}

// Kde vozidlo je a kdo s ním jede.
function vehicleStatus(i) {
  const v = game.s.vehicles[i];
  if (game.s.driving === i) return { chip: ['ŘÍDÍŠ TY', 'active'], text: 'Právě s ním jedeš ty', home: false, busy: true };
  const by = vehicleTakenBy(i);
  if (by) return { chip: [`ŘÍDÍ ${by.toUpperCase()}`, 'active'], text: `Řídí ${by}`, home: false, busy: true };
  const spot = parkingSpot(v.spot ?? i);
  if (angleBetween(v.p, spot.dir) * MOON.radius < 3) return { chip: ['NA PARKOVIŠTI', 'store'], text: `Na parkovišti, místo ${(v.spot ?? i) + 1}`, home: true, busy: false };
  return { chip: ['VENKU', 'owned'], text: `Stojí venku · ${Math.round(distanceToBase(v.p))} m od základny`, home: false, busy: false };
}

function fleetTab() {
  return game.s.vehicles.map((veh, i) => {
    const v = vehicleById(veh.type);
    const st = vehicleStats(veh);
    const status = vehicleStatus(i);
    const stats = [['Stav', status.text]];
    if (v.hopper) stats.push(['Náplň', `${kg(veh.load)} / ${kg(st.hopper)}`], ['Šířka sání', m(st.width)]);
    stats.push(['Max. rychlost', `${st.speed.toFixed(1)} m/s`], ['Vylepšení', `šířka ${veh.lv.width}/5 · rychlost ${veh.lv.speed}/5`]);
    return {
      key: `v${i}`, name: vehicleName(i), chip: status.chip,
      thumb: () => thumb(`veh-${v.id}`, () => buildVehicle(v.id).root),
      detail: {
        eyebrow: `Flotila · vozidlo ${i + 1} z ${game.s.vehicles.length}`,
        title: vehicleName(i), desc: v.desc, stats,
        action: status.home
          ? { label: 'Stojí na parkovišti', disabled: true }
          : { label: 'Přivolat na parkoviště', disabled: status.busy, run: () => callVehicle(i) },
        action2: sellAction(i, status.busy),
      },
    };
  });
}

// Prodej vozidla: první klik se zeptá, druhý prodá (75 % ceny včetně vylepšení).
let sellArmed = null;                // uid vozidla, u kterého se čeká na potvrzení prodeje
function sellAction(i, busyVeh) {
  const veh = game.s.vehicles[i];
  const value = vehicleSellValue(i);
  if (busyVeh) return { label: `Prodat · ${money(value)} (nejdřív z něj musí vystoupit)`, disabled: true, danger: true };
  if (sellArmed !== veh.uid) {
    return { label: `Prodat za ${money(value)} (75 % ceny)`, danger: true, run: () => { sellArmed = veh.uid; return 'stay'; } };
  }
  return {
    label: `Opravdu prodat? Vrátí se ${money(value)}`, danger: true, armed: true,
    run: () => {
      sellArmed = null;
      return purchase('vsell', [i, veh.uid], 0, () => !vehicleTakenBy(i) && sellVehicle(i));
    },
  };
}

function fleetSummary() {
  const list = game.s.vehicles;
  if (!list.length) return '';
  let cap = 0, load = 0, out = 0, moving = 0;
  list.forEach((v, i) => {
    cap += vehicleStats(v).hopper;
    load += v.load;
    const st = vehicleStatus(i);
    if (st.busy) moving++;
    else if (!st.home) out++;
  });
  return `${list.length} / ${MAX_VEHICLES} vozidel · zásobníky ${kg(cap)} · náplň ${kg(load)} · v jízdě ${moving} · venku ${out}`;
}

function vehiclesUpgradeTab() {
  return game.s.vehicles.map((veh, i) => {
    const v = vehicleById(veh.type);
    const st = vehicleStats(veh);
    const ups = Object.entries(VEHICLE_UPGRADES)
      .filter(([key]) => !(key === 'width' && !v.width))
      .map(([key, u]) => {
        const lv = veh.lv[key];
        const cost = vehicleUpgradeCost(i, key);
        const now = key === 'width' ? m(st.width) : `${st.speed.toFixed(1)} m/s`;
        const after = key === 'width' ? m(v.width * (1 + u.step * (lv + 1))) : `${(v.speed * (1 + u.step * (lv + 1))).toFixed(1)} m/s`;
        return { name: u.name, lv, max: u.max, effect: cost === null ? now : `${now} → ${after}`, cost, run: () => purchase('vup', [i, key], cost, () => upgradeVehicle(i, key)) };
      });
    return {
      key: `v${i}`, name: vehicleName(i), chip: [game.s.driving === i ? 'POUŽÍVÁŠ' : 'VLASTNÍŠ', 'owned'],
      thumb: () => thumb(`veh-${v.id}`, () => buildVehicle(v.id).root),
      detail: { eyebrow: 'Vozidlo', title: vehicleName(i), desc: v.desc, stats: [['Šířka sání', m(st.width)], ['Max. rychlost', `${st.speed.toFixed(1)} m/s`]], upgrades: ups },
    };
  });
}

function astronautTab() {
  const lv = bootsLevel();
  const max = BOOTS.levels.length - 1;
  const cost = bootsUpgradeCost();
  const ms = v => `${v.toFixed(2).replace(/\.?0+$/, '').replace('.', ',')} m/s`;
  const now = ms(walkSpeed(lv));
  return [{
    key: 'boots',
    name: BOOTS.name,
    chip: [lv ? `ÚROVEŇ ${lv}` : 'ZÁKLAD', lv ? 'owned' : 'store'],
    thumb: () => thumb(`boots-${lv}`, () => buildBootsModel(lv)),
    detail: {
      eyebrow: 'Astronaut',
      title: BOOTS.levels[lv].name,
      desc: BOOTS.desc,
      stats: [
        ['Rychlost chůze', now],
        ['Další úroveň', cost === null ? '–' : BOOTS.levels[lv + 1].name],
      ],
      upgrades: [{
        name: 'Rychlost chůze', lv, max,
        effect: cost === null ? now : `${now} → ${ms(walkSpeed(lv + 1))}`,
        cost, run: () => purchase('boots', [], cost, upgradeBoots),
      }],
    },
  }];
}

function garageSiteTab() {
  return [{
    key: 'garage',
    name: 'Garáž',
    chip: ['STAVENIŠTĚ', 'store'],
    thumb: () => thumb('garage', () => {
      const g = buildGarageModel();
      g.setBuilt(true);
      return g.root;
    }),
    detail: {
      eyebrow: 'Stavba',
      title: 'Garáž',
      desc: 'Hangár pro zametací vozidla. Po dostavbě tu koupíš vozík, zametače, rover i přepravník posádky a uvidíš celou flotilu.',
      stats: [['Vozidel v nabídce', `${VEHICLES.length}`], ['Parkovacích míst', `${MAX_VEHICLES}`]],
      action: { label: `Postavit garáž · ${money(GARAGE_PRICE)}`, disabled: game.s.money < GARAGE_PRICE, run: () => purchase('garage', [], GARAGE_PRICE, buildGarage) },
    },
  }];
}

function tabsFor(id) {
  if (id === 'toolshop') return [['tools', 'Nástroje', () => toolsTab(false)], ['stations', 'Roboti a depa', stationsTab]];
  if (id === 'workshop') {
    return [
      ['tools', 'Nástroje', () => toolsTab(true)], ['vehicles', 'Vozidla', vehiclesUpgradeTab],
      ['astronaut', 'Astronaut', astronautTab], ['wardrobe', 'Šatna', null],
    ];
  }
  if (id === 'garage') {
    return game.s.garage
      ? [['vehicles', 'Vozidla', vehiclesShopTab], ['fleet', `Flotila (${game.s.vehicles.length})`, fleetTab]]
      : [['build', 'Stavba', garageSiteTab]];
  }
  return [];
}

// ---------- šatna ----------

function wardrobeHtml() {
  const look = profile.look;
  const swatches = SUIT_COLORS.map((c, i) => `
    <button class="swatch${i === look.color ? ' swatch--active' : ''}" type="button" data-color="${i}"
      style="--swatch:${hex(c.hex)}" aria-pressed="${i === look.color}" title="${esc(c.name)}" aria-label="${esc(c.name)}"></button>`).join('');
  const cards = slot => HELMET_PROPS.filter(p => p.slot === slot).map(p => {
    const on = look[slot] === p.id;
    return `
      <button class="item-card item-card--compact${on ? ' item-card--selected' : ''}" type="button" data-prop="${p.id}" aria-pressed="${on}">
        <span class="item-card__chip item-card__chip--${on ? 'active' : 'store'}">${on ? 'NASAZENO' : slot === 'top' ? 'HELMA' : 'HLEDÍ'}</span>
        <img class="item-card__img" src="${hooks.headThumb(p.id)}" alt="">
        <span class="item-card__name">${esc(p.name)}</span>
      </button>`;
  }).join('');
  return `
    <div class="wardrobe">
      <h3 class="wardrobe__heading">Barva skafandru</h3>
      <div class="wardrobe__swatches" role="group" aria-label="Barva skafandru">${swatches}</div>
      <h3 class="wardrobe__heading">Na helmu</h3>
      <div class="facility__grid">${cards('top')}</div>
      <h3 class="wardrobe__heading">Na hledí</h3>
      <div class="facility__grid">${cards('face')}</div>
    </div>`;
}

function wardrobeDetailHtml() {
  const look = profile.look;
  const top = propById(look.top), face = propById(look.face);
  const spec = (k, v) => `<div class="spec"><span class="spec__label">${esc(k)}</span><span class="spec__value">${esc(v)}</span></div>`;
  return `
    <div class="detail__head">
      <div class="detail__heading">
        <p class="detail__eyebrow">Šatna</p>
        <h3 class="detail__title">${esc(profile.name)}</h3>
      </div>
    </div>
    <div class="wardrobe__stage" id="wardrobe-stage"></div>
    <p class="wardrobe__hint">Táhni myší = otočit astronauta</p>
    <div class="detail__specs">
      ${spec('Barva', SUIT_COLORS[look.color].name)}
      ${spec('Na helmě', top.name)}
      ${spec('Na hledí', face.name)}
    </div>
    <p class="detail__desc">${esc(look.top !== 'none' ? top.desc : face.desc)}</p>
    <label class="field">
      <span class="field__label">Jméno ve hře</span>
      <input class="field__input" id="wardrobe-name" type="text" maxlength="16" value="${esc(profile.name)}" autocomplete="off">
    </label>
    <button class="button" type="button" data-random>Náhodný outfit</button>`;
}

function setLook(patch) {
  Object.assign(profile.look, patch);
  saveProfile();
  hooks.onLook(profile.look);
  render();
}

// ---------- vykreslení ----------

function render() {
  const tabs = tabsFor(view.id);
  if (!tabs.some(t => t[0] === view.tab)) view.tab = tabs[0][0];
  $('facility-title').textContent = TITLES[view.id];
  $('facility-money').textContent = money(game.s.money);
  $('facility-tabs').innerHTML = tabs.map(([key, label]) =>
    `<button class="tabs__tab${key === view.tab ? ' tabs__tab--active' : ''}" type="button" role="tab"
       aria-selected="${key === view.tab}" data-tab="${key}">${esc(label)}</button>`).join('');

  const summary = $('facility-summary');
  summary.hidden = view.tab !== 'fleet' || !game.s.vehicles.length;
  if (view.tab === 'fleet') summary.textContent = fleetSummary();

  if (view.tab === 'wardrobe') {
    current = null;
    $('facility-grid').classList.add('facility__grid--plain');
    $('facility-grid').innerHTML = wardrobeHtml();
    $('facility-detail').innerHTML = wardrobeDetailHtml();
    hooks.wardrobe.mount($('wardrobe-stage'), profile.look);
    return;
  }
  hooks.wardrobe.unmount();
  $('facility-grid').classList.remove('facility__grid--plain');

  const items = tabs.find(t => t[0] === view.tab)[2]();
  if (!items.some(it => it.key === view.sel)) view.sel = items[0]?.key ?? null;
  $('facility-grid').innerHTML = items.length
    ? items.map(it => `
      <button class="item-card${it.key === view.sel ? ' item-card--selected' : ''}" type="button" data-sel="${it.key}">
        <span class="item-card__chip item-card__chip--${it.chip[1]}">${esc(it.chip[0])}</span>
        <img class="item-card__img" src="${it.thumb()}" alt="">
        <span class="item-card__name">${esc(it.name)}</span>
      </button>`).join('')
    : `<p class="facility__empty">${view.tab === 'fleet' ? 'Flotila je zatím prázdná. Vozidla koupíš na záložce Vozidla.' : 'Zatím tu nic není. Nástroje koupíš v Obchodě s nástroji, vozidla v Garáži.'}</p>`;

  const it = items.find(x => x.key === view.sel);
  $('facility-detail').innerHTML = it ? detailHtml(it) : '';
  current = it;
}

let current = null;

function detailHtml(it) {
  const d = it.detail;
  const stats = d.stats.map(([k, v]) =>
    `<div class="spec"><span class="spec__label">${esc(k)}</span><span class="spec__value">${esc(v)}</span></div>`).join('');
  const ups = (d.upgrades || []).map((u, i) => `
    <div class="upgrade">
      <div class="upgrade__head">
        <span class="upgrade__name">${esc(u.name)}</span>
        <span class="upgrade__pips" aria-label="úroveň ${u.lv} z ${u.max}">${
          Array.from({ length: u.max }, (_, k) => `<span class="upgrade__pip${k < u.lv ? ' upgrade__pip--on' : ''}"></span>`).join('')}</span>
      </div>
      <span class="upgrade__effect">${esc(u.effect)}</span>
      <button class="upgrade__button" type="button" data-up="${i}" ${busy || u.cost === null || game.s.money < u.cost ? 'disabled' : ''}>
        ${u.cost === null ? 'MAX' : `Vylepšit · ${money(u.cost)}`}
      </button>
    </div>`).join('');
  const label = busy ? 'Čekám na schválení hostitelem…' : d.action?.label;
  const action = d.action
    ? `<button class="detail__action" type="button" data-action ${busy || d.action.disabled ? 'disabled' : ''}>${esc(label)}</button>`
    : '';
  const a2 = d.action2;
  const action2 = a2
    ? `<button class="detail__action detail__action--secondary${a2.danger ? ' detail__action--danger' : ''}${a2.armed ? ' detail__action--armed' : ''}" type="button" data-action2 ${busy || a2.disabled ? 'disabled' : ''}>${esc(a2.label)}</button>`
    : '';
  const shared = isClient() ? '<p class="detail__note">Peníze jsou společné pro celý svět – nákup schvaluje hostitel.</p>' : '';
  return `
    <div class="detail__head">
      <div class="detail__heading">
        <p class="detail__eyebrow">${esc(d.eyebrow)}</p>
        <h3 class="detail__title">${esc(d.title)}</h3>
      </div>
      <img class="detail__img" src="${it.thumb()}" alt="">
    </div>
    <p class="detail__desc">${esc(d.desc)}</p>
    <div class="detail__specs">${stats}</div>
    ${ups ? `<div class="detail__upgrades">${ups}</div>` : ''}
    ${action}
    ${action2}
    ${shared}`;
}

// ---------- ovládání ----------

function finish(result) {
  if (result === 'close') { closeFacility(); return; }
  if (result === 'stay') { render(); return; }
  if (result && typeof result.then === 'function') {
    busy = true;
    render();
    result.then(ok => {
      busy = false;
      if (ok) hooks.onChange();
      else hooks.onDenied?.();
      if (facilityOpen()) render();
    });
    return;
  }
  if (result) hooks.onChange();
  render();
}

export function initFacility(renderThumb, h) {
  thumb = renderThumb;
  hooks = h;
  const root = $('facility');
  root.addEventListener('click', e => {
    const t = e.target.closest('[data-tab],[data-sel],[data-up],[data-action],[data-action2],[data-color],[data-prop],[data-random]');
    if (!t) return;
    if (!t.hasAttribute('data-action2')) sellArmed = null;      // potvrzení prodeje platí jen pro další klik
    if (t.dataset.tab) { view.tab = t.dataset.tab; view.sel = null; render(); return; }
    if (t.dataset.sel) { view.sel = t.dataset.sel; render(); return; }
    if (t.dataset.color !== undefined) { setLook({ color: Number(t.dataset.color) }); return; }
    if (t.dataset.prop) { const p = propById(t.dataset.prop); setLook({ [p.slot]: p.id }); return; }
    if (t.hasAttribute('data-random')) {
      const pick = a => a[Math.floor(Math.random() * a.length)];
      setLook({
        color: Math.floor(Math.random() * SUIT_COLORS.length),
        top: pick(HELMET_PROPS.filter(p => p.slot === 'top')).id,
        face: pick(HELMET_PROPS.filter(p => p.slot === 'face')).id,
      });
      return;
    }
    if (busy) return;
    if (t.dataset.up !== undefined) finish(current.detail.upgrades[Number(t.dataset.up)].run());
    else if (t.hasAttribute('data-action')) finish(current.detail.action.run?.());
    else if (t.hasAttribute('data-action2')) finish(current.detail.action2.run?.());
  });
  root.addEventListener('change', e => {
    if (e.target.id !== 'wardrobe-name') return;
    const name = sanitizeName(e.target.value);
    if (!name) { e.target.value = profile.name; return; }
    profile.name = name;
    saveProfile();
    hooks.onLook(profile.look);
    render();
  });
  $('facility-close').addEventListener('click', closeFacility);
  $('facility-backdrop').addEventListener('click', closeFacility);
  // E nebo Esc zavře okno (E, které okno otevřelo, se ignoruje; v textovém poli se E píše)
  addEventListener('keydown', e => {
    if (!facilityOpen() || performance.now() - openedAt < 250) return;
    if (e.target.matches?.('input, textarea')) { if (e.key === 'Escape') e.target.blur(); return; }
    if (e.key === 'Escape' || e.key.toLowerCase() === 'e') closeFacility();
  });
}

let openedAt = 0;

export const facilityOpen = () => !$('facility').hidden;

export function openFacility(id) {
  view.id = id;
  view.tab = null;
  view.sel = null;
  render();
  openedAt = performance.now();
  $('facility').hidden = false;
  hooks.onOpen();
  $('facility-close').focus();
}

export function closeFacility() {
  if ($('facility').hidden) return;
  $('facility').hidden = true;
  hooks.wardrobe.unmount();
  hooks.onClose();
}

// Obnoví obsah (peníze se mění, když pracují roboti nebo ostatní hráči).
export function refreshFacility() {
  if (!facilityOpen()) return;
  $('facility-money').textContent = money(game.s.money);
  if (view.tab === 'fleet') $('facility-summary').textContent = fleetSummary();
}
