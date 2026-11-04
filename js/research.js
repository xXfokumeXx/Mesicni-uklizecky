// Výzkum (L-30, L-31, L-32): strom technologií, jeden výzkum naráz + fronta (nejvýš 3), platí se až při spuštění.
// Výzkumné centrum spotřebovává 5 ⚡/s; bez energie se výzkum zastaví (průběh se neztratí). Offline běží dál (chill hra).
// Stav: s.research = { done: [id…], current: { id, progress (s) } | null, queue: [id…] }. Počítá hostitel / hráč sám.
import { game } from './state.js';

export const RESEARCH_POWER = 5;           // ⚡/s během výzkumu
export const QUEUE_MAX = 3;

export const BRANCHES = [
  { id: 'energy', name: 'Energie' },
  { id: 'automation', name: 'Automatizace' },
  { id: 'vehicles', name: 'Vozidla' },
];

// Strom technologií (L-31 + rozhodnutí 3. 11.: soláry T4/T5, přejmenované baterie). time v sekundách.
export const TECH = [
  { id: 'solarRoof', branch: 'energy', name: 'Solární střecha', price: 3000, time: 60, desc: 'Panely na střechu vozidel: na přímém Slunci pokryjí část spotřeby a ve stání dobíjejí.', unlocks: 'vylepšení vozidel „Solární střecha“ (Dílna)' },
  { id: 'batteryT3', branch: 'energy', name: 'Baterie Kontejner', price: 8000, time: 90, desc: 'Průmyslové úložiště s chlazením a lepší články do vozidel.', unlocks: 'baterie Kontejner (3 500 ⚡), Větší baterie úroveň 3–4' },
  { id: 'fastCharge3', branch: 'energy', name: 'Rychlonabíjení III', price: 12000, time: 120, req: ['batteryT3'], desc: 'Silnější stojany nabíječek.', unlocks: 'rychlonabíjení III – 40 ⚡/s na slot' },
  { id: 'solarT3', branch: 'energy', name: 'Sledovač Slunce', price: 10000, time: 120, desc: 'Panel na otočném kloubu – vyrábí plně i při nízkém Slunci.', unlocks: 'solár Sledovač (10 ⚡/s)' },
  { id: 'solarT4', branch: 'energy', name: 'Slunečnice', price: 18000, time: 150, req: ['solarT3'], desc: 'Dvouosý hexagonální květ panelů.', unlocks: 'solár Slunečnice (16 ⚡/s)' },
  { id: 'solarT5', branch: 'energy', name: 'Koruna', price: 40000, bricks: 50, time: 240, req: ['solarT4'], desc: 'Zrcadla soustředí Slunce do věže s jádrem.', unlocks: 'solár Koruna (25 ⚡/s)' },
  { id: 'batterySwap', branch: 'energy', name: 'Výměna baterií', price: 20000, time: 150, req: ['batteryT3'], desc: 'Jeřáb vymění vybitou baterii vozidla za nabitou za 2 s.', unlocks: 'stavba Výměník baterií' },
  { id: 'batteryT4', branch: 'energy', name: 'Baterie Trojčata', price: 30000, time: 180, req: ['batteryT3'], desc: 'Tři tlakové články s pevným elektrolytem.', unlocks: 'baterie Trojčata (8 750 ⚡)' },
  { id: 'batteryT5', branch: 'energy', name: 'Plazmové jádro', price: 50000, bricks: 100, time: 240, req: ['batteryT4'], desc: 'Plazma držená v gyroskopu – největší úložiště energie.', unlocks: 'baterie Jádro (21 000 ⚡)' },
  { id: 'vacuumMk2', branch: 'automation', name: 'Vysavač MK2', price: 25000, bricks: 50, time: 180, desc: 'Nejrychlejší robot, uklízí o prstenec hexů dál.', unlocks: 'stanice MK2 a vylepšení MK1 na MK2 (5 m/s, okruh 3 hexy = 37 hexů, 120 kg)' },
  { id: 'beltSpeed1', branch: 'automation', name: 'Rychlejší pásy I', price: 5000, time: 60, desc: 'Silnější motory pásových dopravníků.', unlocks: 'všechny pásy o 25 % rychlejší' },
  { id: 'beltSpeed2', branch: 'automation', name: 'Rychlejší pásy II', price: 15000, time: 120, req: ['beltSpeed1'], desc: 'Pásy s převodovkou a lehčím pryžovým pásem.', unlocks: 'všechny pásy o dalších 25 % rychlejší' },
  { id: 'droneUfo', branch: 'automation', name: 'Dron UFO', price: 25000, time: 120, desc: 'Létající uklízeč, který sám hledá nedočištěné hexy na celé planetě.', unlocks: 'nákup dronů ve Výzkumném centru' },
  { id: 'cruise', branch: 'vehicles', name: 'Autocruise', price: 5000, time: 60, desc: 'Vozidlo jede samo vpřed nastavenou rychlostí a zastaví před překážkou.', unlocks: 'vylepšení vozidel Autocruise (Dílna → Vozidla, klávesa C)' },
  { id: 'edgeFollow', branch: 'vehicles', name: 'Sledování hrany prachu', price: 18000, time: 150, req: ['cruise'], desc: 'Asistent drží vozidlo podél hrany prachu, kterou už máš – jako asistent jízdy v pruhu.', unlocks: 'vylepšení vozidel Sledování hrany prachu (Dílna → Vozidla, C 2×)' },
];
export const techById = id => TECH.find(t => t.id === id) || null;
// Model pro náhled v okně a hologram nad centrem (D-10)
export const TECH_MODEL = {
  solarRoof: 'vehicle-lunar', batteryT3: 'battery-t3', fastCharge3: 'charger', solarT3: 'solar-t3', solarT4: 'solar-t4', solarT5: 'solar-t5',
  batterySwap: 'swapper', batteryT4: 'battery-t4', batteryT5: 'battery-t5', vacuumMk2: 'robot', droneUfo: 'drone',
  cruise: 'vehicle-rideon', edgeFollow: 'vehicle-mega', beltSpeed1: 'belt-piece', beltSpeed2: 'belt-piece',
};

const R = () => game.s.research || (game.s.research = { done: [], current: null, queue: [] });
export const isDone = id => R().done.includes(id);
export const isQueued = id => R().queue.includes(id);
export const isCurrent = id => R().current?.id === id;
export const researchCenter = () => (game.s.buildings || []).find(b => b.type === 'research') || null;

// Stav technologie pro okno: 'done' | 'running' | 'queued' | 'available' | 'locked' + důvod
export function techState(id) {
  const t = techById(id);
  if (!t) return { state: 'locked', reason: 'neznámý výzkum' };
  if (isDone(id)) return { state: 'done', reason: '' };
  if (isCurrent(id)) return { state: 'running', reason: '' };
  if (isQueued(id)) return { state: 'queued', reason: '' };
  const miss = (t.req || []).filter(r => !isDone(r) && !isCurrent(r) && !isQueued(r));
  if (miss.length) return { state: 'locked', reason: `nejdřív: ${miss.map(r => techById(r).name).join(', ')}` };
  return { state: 'available', reason: '' };
}

// Co se stane po kliknutí: { kind: 'start' | 'queue', reason } (reason = proč nejde)
export function researchOffer(id) {
  const t = techById(id), st = techState(id), s = game.s, r = R();
  if (!researchCenter()) return { kind: null, reason: 'Postav Výzkumné centrum' };
  if (st.state !== 'available') return { kind: null, reason: st.reason || '' };
  if (r.current) {
    if (r.queue.length >= QUEUE_MAX) return { kind: 'queue', reason: `Fronta je plná (${QUEUE_MAX})` };
    return { kind: 'queue', reason: '' };
  }
  if ((t.req || []).some(x => !isDone(x))) return { kind: 'queue', reason: 'Čeká na předchozí výzkum' };
  if (s.money < t.price) return { kind: 'start', reason: 'Chybí peníze' };
  if (t.bricks && (s.bricks || 0) < t.bricks) return { kind: 'start', reason: `Chybí ${t.bricks} cihel` };
  return { kind: 'start', reason: '' };
}

// Spustí výzkum, nebo ho zařadí do fronty (sám / hostitel). Vrací true / false.
export function startResearch(id) {
  const o = researchOffer(id);
  if (!o.kind || o.reason) return false;
  const r = R();
  if (o.kind === 'queue') { r.queue.push(id); return true; }
  const t = techById(id);
  game.s.money -= t.price;
  if (t.bricks) game.s.bricks -= t.bricks;
  r.current = { id, progress: 0 };
  return true;
}
export function unqueueResearch(id) {
  const r = R();
  const n = r.queue.length;
  r.queue = r.queue.filter(x => x !== id);
  return r.queue.length < n;
}

// Krok výzkumu: f = podíl energie, který centrum dostalo (0–1). Vrací id dokončeného výzkumu, nebo null.
export function researchTick(dt, f) {
  const r = R();
  let finished = null;
  if (r.current && researchCenter()) {
    r.current.progress += dt * Math.max(0, Math.min(1, f));
    const t = techById(r.current.id);
    if (!t) r.current = null;
    else if (r.current.progress >= t.time) {
      r.done.push(t.id);
      finished = t.id;
      r.current = null;
    }
  }
  // další z fronty – zaplatí se teprve teď; když nejsou peníze, počká ve frontě
  if (!r.current && r.queue.length && researchCenter()) {
    const next = r.queue[0], t = techById(next);
    const ready = t && (t.req || []).every(isDone) && game.s.money >= t.price && (!t.bricks || (game.s.bricks || 0) >= t.bricks);
    if (!t) r.queue.shift();
    else if (ready) {
      r.queue.shift();
      game.s.money -= t.price;
      if (t.bricks) game.s.bricks -= t.bricks;
      r.current = { id: next, progress: 0 };
    }
  }
  return finished;
}

// Za dobu nepřítomnosti běží aktuální výzkum dál (energie se offline nesimuluje). Vrací dokončené id, nebo null.
// Fronta pokračuje (další výzkum se zaplatí, když jsou peníze). Vrací pole dokončených id.
export function researchOffline(seconds) {
  const r = R(), out = [];
  let left = seconds;
  while (left > 0 && r.current && researchCenter()) {
    const t = techById(r.current.id);
    const step = t ? Math.min(left, Math.max(0, t.time - r.current.progress)) : left;
    left -= step;
    const done = researchTick(Math.max(step, 0.001), 1);
    if (done) out.push(done);
    else break;
  }
  return out;
}

export const researching = () => !!R().current && !!researchCenter();
export function researchProgress() {
  const r = R();
  if (!r.current) return null;
  const t = techById(r.current.id);
  return t ? { tech: t, k: Math.min(1, r.current.progress / t.time), left: Math.max(0, t.time - r.current.progress) } : null;
}

// Síť (H.rs): jeden řetězec „hotové,…|aktuální:průběh×10|fronta,…“ (Firebase neuloží prázdná pole).
export const encodeResearch = () => {
  const r = R();
  return `${r.done.join(',')}|${r.current ? `${r.current.id}:${Math.round(r.current.progress * 10)}` : ''}|${r.queue.join(',')}`;
};
export function applyResearch(e) {
  if (typeof e !== 'string') return;
  const [d = '', c = '', q = ''] = e.split('|');
  const r = R();
  const ids = x => x.split(',').filter(id => techById(id));
  r.done = ids(d);
  const [cid, cp] = c.split(':');
  r.current = techById(cid) ? { id: cid, progress: (Number(cp) || 0) / 10 } : null;
  r.queue = ids(q);
}
