// Pozemní vozidla z GLB (07, fáze A): model z registru (ground-<typ>) zabalený do „view“ vozidla, jaký čeká actors.js
// { root, wheels, brushes, seat, passengers, pusher, radius, wheelR, headlight } – stejně jako scene/vehicles.js.
// Polohy sedadel, rukou, světel… jsou prázdné uzly modelu (inst.empties), rozměry v extras kořenového uzlu.
// Navíc (pro další fáze): hands, battery { p, q }, hang, plug, beacon, sweep, head (sací hlava), nodes, extras.
// Když GLB není načtený nebo se nenačetl, vrátí starý model v kódu (buildVehicle).
import { instantiate, isReady } from '../assets/models.js';
import { buildVehicle } from './vehicles.js';

const byNumber = (nodes, prefix) => Object.keys(nodes)
  .filter(n => n.startsWith(prefix) && /^\d+$/.test(n.slice(prefix.length)))
  .sort((a, b) => +a.slice(prefix.length) - +b.slice(prefix.length));

export function buildGroundVehicle(type) {
  const id = `ground-${type}`;
  // záloha bez GLB: starý model v kódu; Prachocuc starý model nemá → půjčí si Měsíční vůz, ať hra nespadne
  const old = () => { try { return buildVehicle(type); } catch { return buildVehicle('lunar'); } };
  if (!isReady(id)) return old();
  const inst = instantiate(id);
  if (inst.failed) return old();
  const E = inst.empties, X = inst.extras || {};
  const at = name => (E[name] ? E[name].p.clone() : null);
  const list = prefix => byNumber(E, prefix).map(n => E[n].p.clone());

  const wheelR = X.polomer_kol || 0.4;
  const wheels = byNumber(inst.nodes, 'kolo_').map((n, i) => {
    const w = inst.nodes[n];
    const r = X.polomery_kol?.[i] || wheelR;
    w.userData.spinK = wheelR / r;                       // kolo s jiným poloměrem se točí jinak rychle
    return w;
  });
  const brushes = byNumber(inst.nodes, 'kartac_').map(n => inst.nodes[n]);

  const seats = E.sedadlo ? [E.sedadlo.p.clone()] : list('sedadlo_');
  const grip = E.ruka_L ? ['ruka_L', 'ruka_P'] : E.madlo_L ? ['madlo_L', 'madlo_P'] : null;
  const lights = [at('svetlo_L'), at('svetlo_P')];
  inst.root.userData.dbg = 'vehicle';                    // skupina pro ladicí výpis F3 (debug.js)

  // Prachocuc: sběrná ramena. arm(lv, t, tilt) – lv = úroveň vylepšení (kolik dílů je vidět), t = 0 nahoře … 1 dole,
  // tilt = { L, P } náklon konců podle terénu (rad, + = nahoru). Osa sklápění Z; v modelu jsou ramena vodorovně.
  let arm = null, armLen = null;
  if (X.rameno && inst.nodes.rameno_L && inst.nodes.rameno_P) {
    const sides = [['L', -1], ['P', 1]].map(([tag, sign]) => ({
      tag, sign, root: inst.nodes[`rameno_${tag}`],
      parts: ['', '_u1', '_u2', '_u3'].map(sfx => ({ node: inst.nodes[`rameno_${tag}${sfx}`], tip: inst.nodes[`rameno_${tag}${sfx}_opora`] })),
    }));
    arm = (lv, t, tilt) => {
      for (const a of sides) {
        a.root.rotation.z = a.sign * (Math.PI / 2 * (1 - t) + (tilt?.[a.tag] || 0) * t);
        a.parts.forEach((p, k) => { if (p.node) p.node.visible = k <= lv; if (p.tip) p.tip.visible = k === lv; });
      }
    };
    arm(0, 0, null);
    const d = X.rameno.dily_m || [1.5, 0.75, 0.75, 0.75];
    armLen = lv => d.slice(0, lv + 1).reduce((n, x) => n + x, 0);      // délka jedné strany od kloubu
  }

  return {
    root: inst.root, wheels, brushes, wheelR, glb: true,
    radius: X.radius || 2,
    seat: seats[0] || null,
    passengers: seats.length > 1 ? seats.slice(1) : undefined,
    pusher: !seats.length,
    hands: grip && grip.map(n => E[n].p.toArray()),      // [L, P], L = levá ruka astronauta = +x
    headlight: lights[0] && lights[1] ? lights[0].add(lights[1]).multiplyScalar(0.5) : undefined,
    battery: E.baterie ? { p: E.baterie.p.clone(), q: E.baterie.q.clone() } : null,
    hang: at('zaves'), plug: at('nabijeni'), beacon: at('majak'), sweep: at('zametani'),
    head: inst.nodes.saci_hlava || null,
    arm, armLen, armJoint: X.rameno?.kloub || null,      // Prachocuc (actors.js)
    hitch: at('tazne'), hose: at('hadice'),              // tažný bod přívěsu, konec hadice
    nodes: inst.nodes, extras: X,
  };
}
