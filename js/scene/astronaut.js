// Astronaut 3.1 (AST-01–11, O-20, O-21): model assets/models/astronaut.glb převedený na tuhou kostru + paletu
// (assets/character.js) → 1 vykreslení postavy, + nástroj / kladivo a rekvizita na helmě.
// Rozhraní je stejné jako u astronauta 3.0 (model v kódu, smazaný v 3.1 – AST-11), zbytek hry rozdíl nepozná.
// Model: stojí na y = 0, dívá se ve směru +z. L / P = levá / pravá strana postavy (L = +x).
// Animace: klipy z modelu (klid, chuze) + z assets/anim/astronaut-klipy.json (A-12) přes AnimationMixer.
// Každý klip je rozdělený na nohy a horní část těla → vrstvení (nohy z chůze + paže ze zametání / kladiva).
// Po mixeru procedurálně: pohupování pánve, držení nástroje, natočení hlavy k cíli, IK rukou na volant / madlo.
import { SUIT_COLORS, DEFAULT_LOOK, skinById } from '../catalog.js';
import { RG, RG_COUNT } from '../ragdoll.js';
import { buildProp } from './props.js';
import { buildToolModel, buildHammerModel } from './toolModels.js';
import { mergeObject } from './mergeParts.js';
import { characterData } from '../assets/models.js';
import { TOOL_GRIPS } from '../assets/registry.js';
import { paletteMaterial, SLOT } from '../assets/character.js';

const THREE = window.THREE;

// ---------- rekvizity na helmu (AST-05) ----------
// Rekvizity z 3.0 jsou stavěné na helmu se středem (0; 0,17; 0,01) nad kloubem hlavy a poloměrem 0,175.
// Nová helma: střed (0; 0,273; 0), poloměr 0,29 → měřítko 1,66 a posun. PROPS_FIT = úpravy pro jednotlivé rekvizity:
// s = další měřítko, p = další posun [x,y,z] (m, v prostoru hlavy), hide = sloty modelu, které rekvizita skryje.
const OLD_CENTER = [0, 0.17, 0.01], OLD_R = 0.175;
export const PROPS_FIT = {
  horns: {},
  cowboy: { hide: ['antena-svetlo'] },         // krempa by procházela světlem antény na batohu
  tophat: { hide: ['antena-svetlo'] },
  crown: {},
  propeller: {},
  antennae: {},
  catears: {},
  halo: {},
  chef: { hide: ['antena-svetlo'] },
  duck: {},
  cone: {},
  moustache: {},
  glasses: {},
};
const BUILT_IN = { mohawk: ['cyro-2', 'cyro-3', 'cyro-4', 'cyro-5', 'cyro-6'], whiskers: ['fousky', 'cumak'] };

// Maska skrytých slotů pro vzhled: vestavěné číro a fousky jen když jsou vybrané, plus co skryje rekvizita.
function maskFor(look) {
  let m = 0;
  const hide = n => { m |= 1 << SLOT[n]; };
  if (look.top !== 'mohawk') BUILT_IN.mohawk.forEach(hide);
  if (look.face !== 'whiskers') BUILT_IN.whiskers.forEach(hide);
  for (const id of [look.top, look.face]) for (const n of PROPS_FIT[id]?.hide || []) hide(n);
  return m;
}

// Rekvizita převedená na novou helmu (statická = 1 díl). Vrací { root, update } nebo null.
function fittedProp(id, helmCenter, helmR) {
  if (BUILT_IN[id]) return null;                        // číro a fousky jsou přímo v modelu
  const p = buildProp(id);
  if (!p) return null;
  if (!p.update) mergeObject(p.root);
  const fit = PROPS_FIT[id] || {};
  const k = (helmR / OLD_R) * (fit.s || 1);
  const g = new THREE.Group();
  g.scale.setScalar(k);
  g.position.set(helmCenter[0] - OLD_CENTER[0] * k + (fit.p?.[0] || 0), helmCenter[1] - OLD_CENTER[1] * k + (fit.p?.[1] || 0), helmCenter[2] - OLD_CENTER[2] * k + (fit.p?.[2] || 0));
  g.add(p.root);
  return { root: g, update: p.update };
}

// ---------- paleta (AST-04) ----------
const _hsl = {};
const lum = c => c.r + c.g + c.b;
function applyPalette(data, look, palette, emissive) {
  data.base.forEach((c, i) => palette[i].copy(c));
  data.emis.forEach((c, i) => emissive[i].copy(c));
  const skin = skinById(look.skin);
  for (const [name, hex] of Object.entries(skin.pal || {})) {
    const i = SLOT[name];
    if (i == null) continue;
    const glow = lum(data.base[i]) > 0 ? lum(data.emis[i]) / lum(data.base[i]) : 0;   // svítící díly svítí v nové barvě stejně silně
    palette[i].setHex(hex);
    emissive[i].copy(palette[i]).multiplyScalar(glow);
  }
  // barva obleku ze šatny (16 barev) oblečení dobarví – jen když se liší od barvy, ke které oblečení patří
  if (look.color !== skin.color && SUIT_COLORS[look.color]) {
    const c = new THREE.Color(SUIT_COLORS[look.color].hex);
    palette[SLOT.oblek].copy(c);
    palette[SLOT['oblek-stin']].copy(c).multiplyScalar(0.8);
    c.getHSL(_hsl);
    if (_hsl.l < 0.3) palette[SLOT.jetpack].copy(c).multiplyScalar(1.15);   // tmavý oblek → i batoh
  }
}

// Náhled hlavy s rekvizitou (karty v šatně): hlava modelu bez kostry + rekvizita. null = model není načtený.
export function createHeadModel(look = DEFAULT_LOOK) {
  const data = characterData('astronaut');
  if (!data) return null;
  const { material, palette, emissive } = paletteMaterial(false);
  applyPalette(data, look, palette, emissive);
  const g = new THREE.Group();
  g.add(new THREE.Mesh(data.headGeometry(maskFor(look)), material));
  const helm = helmetOf(data);
  for (const id of [look.top, look.face]) {
    const p = fittedProp(id, helm.center, helm.r);
    if (p) g.add(p.root);
  }
  return g;
}

// Střed a poloměr helmy vůči kloubu hlavy (z modelu: helma ~ y 1,60 ve světě, poloměr 0,29).
function helmetOf(data) {
  const hw = data.joint('hlava').world;
  return { center: [0, 1.60 - hw[1], 0], r: 0.29 };
}

// ---------- klipy: rozdělení na nohy a horní část (sdílené všemi instancemi) ----------
const LEGS = new Set(['panev', 'stehno_L', 'stehno_P', 'holen_L', 'holen_P']);
const BASE_CLIPS = ['klid', 'chuze', 'poskok', 'skok_let', 'sed', 'tlaceni'];   // základní pohyb (prolínají se)
const HOP_SPEED = 2.2;                    // nad touto rychlostí (m/s) měsíční poskok místo chůze
const FADE = 10;                          // rychlost prolínání (~0,25 s)
function clipParts(data) {
  if (data.parts) return data.parts;
  const split = (c, legs) => new THREE.AnimationClip(`${c.name}_${legs ? 'nohy' : 'horni'}`, c.duration, c.tracks.filter(t => LEGS.has(t.name.split('.')[0]) === legs));
  data.parts = {};
  for (const c of data.clips) {
    const meta = data.clipMeta?.[c.name] || {};
    data.parts[c.name] = { legs: split(c, true), upper: split(c, false), dur: c.duration, krok: meta.krok, vrstva: meta.vrstva || 'cele', smycka: meta.smycka !== false };
  }
  return data.parts;
}

// Náhradní postava, když se model nenačte (A-04): kapsle se stejným rozhraním, bez animací.
function fallbackAstronaut() {
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.9, 10).translate(0, 0.95, 0), new THREE.MeshLambertMaterial({ color: 0xff00ff }));
  root.add(body);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.45, 12).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.35, depthWrite: false }));
  shadow.userData.blob = true;
  root.add(shadow);
  const head = new THREE.Object3D();
  head.position.y = 1.33;
  root.add(head);
  const v = new THREE.Vector3();
  const OFF = [[0, 0.7, 0], [0, 1.15, 0], [0, 1.6, 0], [0.35, 1.23, 0], [0.35, 0.94, 0], [0.35, 0.62, 0], [-0.35, 1.23, 0], [-0.35, 0.94, 0], [-0.35, 0.62, 0],
    [0.14, 0.64, 0], [0.14, 0.35, 0], [0.14, 0.03, 0.05], [-0.14, 0.64, 0], [-0.14, 0.35, 0], [-0.14, 0.03, 0.05], [0, 1.1, -0.32]];
  const noop = () => {};
  let rag = false, detail = 0;
  return {
    root, hipHeight: 0.64, head, update: noop, setLook: noop, setTool: noop, setToolSize: noop, setJetpack: noop, setHammer: noop, hammerSwing: noop,
    setHands: noop, setLookAt: noop, dump: noop, wave: noop, waveOnce: noop,
    ragdollPose: () => { root.updateMatrixWorld(true); return OFF.map(p => v.set(...p).applyMatrix4(root.matrixWorld).toArray()); },
    applyRagdoll: pts => { rag = true; if (pts?.[0]) root.position.set(...pts[0]).multiplyScalar(1); },
    endRagdoll: () => { rag = false; },
    get ragdolling() { return rag; }, get gettingUp() { return false; },
    arms: null, bones: {},
    setDetail: l => { detail = l; root.visible = l !== 3; }, get detail() { return detail; },
    setLamp: noop, lampIntensity: () => 0,
    lampPosition: out => head.getWorldPosition(out), lampDirection: out => out.set(0, 0, 1).transformDirection(head.matrixWorld),
    blob: shadow, toolTip: () => head.getWorldPosition(new THREE.Vector3()), mesh: body,
  };
}

// ---------- astronaut ----------

export function createAstronaut(look = DEFAULT_LOOK) {
  const data = characterData('astronaut');
  if (!data) return fallbackAstronaut();                    // GLB se nenačetl → náhradní kapsle (A-04), hra nespadne

  const root = new THREE.Group();
  root.userData.dbg = 'astronaut';                       // skupina pro ladicí výpis F3 (debug.js)
  const bones = data.bones.map(b => {
    const o = new THREE.Bone();
    o.name = b.name;
    o.position.fromArray(b.p);
    o.quaternion.fromArray(b.q);
    return o;
  });
  data.bones.forEach((b, i) => (b.parent < 0 ? root : bones[b.parent]).add(bones[i]));
  const B = Object.fromEntries(bones.map(b => [b.name, b]));
  const REST = Object.fromEntries(bones.map(b => [b.name, { p: b.position.clone(), q: b.quaternion.clone() }]));
  const W = name => new THREE.Vector3().fromArray(data.joint(name).world);   // kloub ve světě v klidové póze
  const restPose = () => { for (const b of bones) { b.position.copy(REST[b.name].p); b.quaternion.copy(REST[b.name].q); } };

  const { material, palette, emissive } = paletteMaterial(true);
  const mesh = new THREE.SkinnedMesh(data.geometryFor(0), material);
  mesh.userData.keep = true;                             // mergeParts nesmí slučovat
  mesh.userData.noReceive = true;                        // stín vrhá, ale nepřijímá – skinovaná postava by stínila sama sebe (tmavá)
  mesh.frustumCulled = false;                            // póza (ragdoll, sezení) mění tvar – 1 vykreslení, nevadí
  root.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));

  // falešný stín (když jsou stíny vypnuté) – větší kvůli batohu
  const shadowGeo = new THREE.CircleGeometry(0.45, 18);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadow = new THREE.Mesh(shadowGeo, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
  shadow.position.y = 0.05;
  shadow.userData.blob = true;
  root.add(shadow);

  // čelovka: žlutý váleček vlevo na helmě (x +0,33), světlo kousek před ním (AST-02)
  const lamp = new THREE.Object3D();
  lamp.position.set(0.33, 1.59 - W('hlava').y, 0.22);
  B.hlava.add(lamp);
  let lampK = 0;

  // ---------- animace (AST-07) ----------
  const mixer = new THREE.AnimationMixer(root);
  const parts = clipParts(data);
  const ACT = {};
  for (const [name, p] of Object.entries(parts)) {
    const mk = clip => {
      if (!clip.tracks.length) return null;
      const a = mixer.clipAction(clip);
      if (!p.smycka) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      a.play();
      a.setEffectiveWeight(0);
      return a;
    };
    ACT[name] = { legs: mk(p.legs), upper: mk(p.upper), dur: p.dur, krok: p.krok, vrstva: p.vrstva };
  }
  const has = n => !!ACT[n];
  const setW = (n, legs, upper) => { const a = ACT[n]; if (!a) return; a.legs?.setEffectiveWeight(legs); a.upper?.setEffectiveWeight(upper); };
  const setTS = (n, ts) => { const a = ACT[n]; if (!a) return; a.legs?.setEffectiveTimeScale(ts); a.upper?.setEffectiveTimeScale(ts); };
  const restart = n => { const a = ACT[n]; a?.legs?.reset(); a?.upper?.reset(); };
  const walkDur = ACT.chuze?.dur || 1;
  if (data.stride === undefined) data.stride = measureStride();   // jednou pro všechny instance

  // Délka kroku z klipu chuze: o kolik se chodidlo posune za cyklus (2 kroky) → timeScale = rychlost / délka.
  function measureStride() {
    if (!ACT.chuze?.legs) return 1.2;
    ACT.chuze.legs.setEffectiveWeight(1);
    const foot = new THREE.Vector3();
    let min = Infinity, max = -Infinity;
    for (let k = 0; k <= 40; k++) {
      mixer.setTime((k / 40) * walkDur);
      root.updateMatrixWorld(true);
      B.holen_L.localToWorld(foot.set(0, -0.32, 0.05));
      min = Math.min(min, foot.z); max = Math.max(max, foot.z);
    }
    ACT.chuze.legs.setEffectiveWeight(0);
    mixer.setTime(0);
    restPose();
    return Math.max(0.4, (max - min) * 2);
  }

  // Výstup mixeru z minulého snímku: AnimationMixer zapíše do kosti jen ZMĚNĚNOU hodnotu, takže kosti se před mixerem
  // vrací na jeho minulý výstup (ne do klidové pózy – neměnná póza by pak „spadla“ do klidu, např. ruka při mávání).
  const mixQ = bones.map(b => b.quaternion.clone()), mixP = bones.map(b => b.position.clone());
  const baseW = Object.fromEntries(BASE_CLIPS.map(n => [n, n === 'klid' ? 1 : 0]));
  let one = null;          // jednorázový klip přes celé tělo { name, t, dur, fadeIn }
  let ovl = null;          // jednorázový / smyčkový klip horní části { name, t, dur, reps, loop }
  let ovlW = 0, sweepW = 0, holdW = 0, handsW = 0, airAmp = 0, sweepAmp = 0, wasAir = false;
  let forcedBase = null;   // náhled animací: pevný základní klip
  let flameUntil = 0, flameWeak = false;
  let lookYaw = 0, lookPitch = 0, lookTarget = null;
  let handTargets = null;  // [L, P] ve světě (IK) nebo null
  let detail = 0, halfAcc = 0;

  function playOnce(name, fadeIn = 0.06) {
    if (!has(name)) return;
    restart(name);
    one = { name, t: 0, dur: ACT[name].dur, fadeIn };
  }
  function playOverlay(name, reps = 1, loop = false) {
    if (!has(name)) return;
    restart(name);
    if (ACT[name].upper && reps > 1) { ACT[name].upper.setLoop(THREE.LoopRepeat, reps); }
    ovl = { name, t: 0, dur: ACT[name].dur * reps, loop };
  }
  const ramp = (t, dur, inT, outT) => Math.max(0, Math.min(1, inT > 0 ? t / inT : 1, outT > 0 ? (dur - t) / outT : 1));

  const _q = new THREE.Quaternion(), _e = new THREE.Euler();
  // Natočení kosti k póze (Euler vůči klidové póze) s vahou w.
  function pose(name, x, y, z, w) {
    if (w <= 1e-3) return;
    _q.setFromEuler(_e.set(x, y, z)).premultiply(REST[name].q);
    B[name].quaternion.slerp(_q, Math.min(1, w));
  }

  // st: { moving, speed, swept, airborne, alt, vel, landed, seated, pushing }
  function update(dt, time, st) {
    if (detail >= 2) return;                              // vzdálený / skrytý: pevná póza (O-21)
    if (detail === 1) {                                   // 25–60 m: mixer jen 30× za sekundu
      halfAcc += dt;
      if (halfAcc < 1 / 30) return;
      dt = halfAcc; halfAcc = 0;
    }
    for (const p of props) p.update?.(dt, time);
    if (ragdolling) return;
    const ease = s => 1 - Math.exp(-dt * s);

    // jednorázové spouštěče: odraz, dopad, záblesk jetpacku
    if (st.airborne && !wasAir && st.vel > 0.5 && !st.seated) { playOnce('skok_odraz'); flameUntil = performance.now() + 300; }
    if (st.landed && !st.seated) playOnce('skok_dopad');
    wasAir = st.airborne;
    flameWeak = st.airborne && st.alt > 3 && st.vel < -1.5;
    airAmp += ((st.airborne ? 1 : 0) - airAmp) * ease(7);
    sweepAmp += ((st.swept && !st.airborne ? 1 : 0) - sweepAmp) * ease(6);

    // základní pohyb: klid / chůze / poskok / let / sed / tlačení
    const base = forcedBase || (st.seated ? 'sed' : st.pushing ? 'tlaceni' : st.airborne ? 'skok_let'
      : st.moving && st.speed > 0.05 ? (st.speed > HOP_SPEED && has('poskok') ? 'poskok' : 'chuze') : 'klid');
    let sum = 0;
    for (const n of BASE_CLIPS) { baseW[n] += ((n === (has(base) ? base : 'klid') ? 1 : 0) - baseW[n]) * ease(FADE); sum += baseW[n]; }
    for (const n of BASE_CLIPS) baseW[n] /= sum || 1;
    const sp = Math.max(0, st.speed || 0);
    setTS('chuze', Math.min(3, Math.max(0.35, (sp / data.stride) * walkDur)));
    if (has('poskok')) setTS('poskok', Math.min(2.5, Math.max(0.5, (sp / (ACT.poskok.krok || 2.2)) * ACT.poskok.dur)));
    if (has('tlaceni')) setTS('tlaceni', st.moving ? Math.min(3, (sp / (ACT.tlaceni.krok || 1.3)) * ACT.tlaceni.dur) : 0);

    // jednorázový klip přes celé tělo
    let oneW = 0;
    if (one) {
      one.t += dt * mixer.timeScale;
      oneW = ramp(one.t, one.dur, one.fadeIn, 0.1);
      if (one.t >= one.dur) { setW(one.name, 0, 0); one = null; oneW = 0; }
    }
    // horní vrstva: kladivo / vysypávání / mávání, jinak zametání (nohy zůstávají z chůze)
    let ovlTarget = 0;
    if (ovl) {
      ovl.t += dt * mixer.timeScale;
      if (!ovl.loop && ovl.t >= ovl.dur) { setW(ovl.name, 0, 0); ovl = null; }
      else ovlTarget = ovl.loop ? 1 : ramp(ovl.t, ovl.dur, 0.08, 0.12);
    }
    ovlW = ovlTarget;
    const sweeping = sweepAmp * (1 - baseW.sed) * (1 - baseW.tlaceni) * (1 - airAmp) * (toolRoot.visible ? 1 : 0);
    sweepW += (sweeping - sweepW) * ease(8);
    const sw = has('zametani') ? sweepW * (1 - ovlW) : 0;
    const U = Math.min(1, ovlW + sw);                     // kolik horní části patří vrstvě
    for (const n of BASE_CLIPS) setW(n, baseW[n] * (1 - oneW), baseW[n] * (1 - oneW) * (1 - U));
    if (one) setW(one.name, oneW, oneW * (1 - U));
    if (ovl) setW(ovl.name, 0, ovlW);
    if (has('zametani') && (!ovl || ovl.name !== 'zametani')) setW('zametani', 0, sw);

    for (let i = 0; i < bones.length; i++) { bones[i].quaternion.copy(mixQ[i]); bones[i].position.copy(mixP[i]); }
    mixer.update(dt);
    for (let i = 0; i < bones.length; i++) { mixQ[i].copy(bones[i].quaternion); mixP[i].copy(bones[i].position); }

    // pohupování pánve při chůzi (klip chuze ho nemá) a dýchání v klidu
    const walkW = baseW.chuze * (1 - oneW);
    const hop = ACT.chuze?.legs ? Math.pow(Math.abs(Math.sin((ACT.chuze.legs.time / walkDur) * Math.PI * 2)), 0.6) : 0;
    B.panev.position.y += hop * 0.06 * walkW + Math.sin(time * 1.7) * 0.005 * baseW.klid;

    // držení nástroje / kladiva v pravé ruce (bez zametání a bez kladivového úderu)
    const holding = !toolOff && !!toolObj && !st.seated && !st.pushing && !(hammer?.visible);
    holdW += ((holding || hammer?.visible ? 1 : 0) - holdW) * ease(8);
    const wh = holdW * (1 - U) * (1 - baseW.sed) * (1 - baseW.tlaceni) * (1 - oneW);
    if (wh > 1e-3) {
      if (hammer?.visible) { pose('paze_P', -0.35, 0, -0.18, wh); pose('predlokti_P', -0.5, 0, 0, wh); }
      else { pose('paze_P', -0.55, 0, -0.12, wh); pose('predlokti_P', -0.55, 0, 0, wh); }
    }

    // natočení hlavy k cíli kliknutí (nejvýš ±35° do stran, ±20° nahoru / dolů)
    let wantYaw = 0, wantPitch = 0;
    if (lookTarget && !st.seated && !one) {
      root.updateMatrixWorld(true);
      const d = B.trup.worldToLocal(_lt.copy(lookTarget)).sub(B.hlava.position);
      if (d.lengthSq() > 0.25) {
        wantYaw = Math.max(-0.61, Math.min(0.61, Math.atan2(d.x, d.z)));
        wantPitch = Math.max(-0.35, Math.min(0.35, -Math.atan2(d.y - 0.3, Math.hypot(d.x, d.z))));
        if (Math.abs(Math.atan2(d.x, d.z)) > 2) wantYaw = 0;   // cíl za zády → nekroutit hlavou
      }
    }
    lookYaw += (wantYaw - lookYaw) * ease(5);
    lookPitch += (wantPitch - lookPitch) * ease(5);
    if (Math.abs(lookYaw) + Math.abs(lookPitch) > 1e-3) B.hlava.quaternion.multiply(_q.setFromEuler(_e.set(lookPitch, lookYaw, 0)));

    // ruce na volantu / madle (AST-08): analytická IK dvou kostí
    handsW += ((handTargets && detail === 0 ? 1 : 0) - handsW) * ease(8);
    if (handTargets && handsW > 1e-3) {
      root.updateMatrixWorld(true);
      ikArm(B.paze_L, B.predlokti_L, B.ruka_L, handTargets[0], handsW, 1);
      ikArm(B.paze_P, B.predlokti_P, B.ruka_P, handTargets[1], handsW, -1);
    }

    shadow.visible = !st.seated;
    const sh = 1 / (1 + st.alt * 0.5);
    shadow.scale.set(sh, 1, sh);
    shadow.position.y = 0.05 - st.alt;
    placeTool(dt, time, st);
    updateFlames();
  }
  const _lt = new THREE.Vector3();

  // ---------- IK paže (AST-08) ----------
  const _S = new THREE.Vector3(), _E = new THREE.Vector3(), _T = new THREE.Vector3(), _dir = new THREE.Vector3(), _n = new THREE.Vector3();
  const _pq = new THREE.Quaternion(), _iq = new THREE.Quaternion(), _qq = new THREE.Quaternion(), _cd = new THREE.Vector3();
  // Kost natočí tak, aby směr k jejímu dítěti (v klidové póze) mířil na bod p ve světě; w = váha.
  function aimAt(bone, child, p, w) {
    bone.parent.getWorldQuaternion(_pq);
    bone.getWorldPosition(_cd);
    const want = _dir.copy(p).sub(_cd);
    if (want.lengthSq() < 1e-8) return;
    want.normalize().applyQuaternion(_iq.copy(_pq).invert());
    _cd.copy(child.position).normalize();
    _qq.setFromUnitVectors(_cd, want);
    bone.quaternion.slerp(_qq, w);
    bone.updateMatrixWorld(true);
  }
  function ikArm(sh, el, hand, target, w, side) {
    const a = el.position.length(), b = hand.position.length();
    sh.getWorldPosition(_S);
    _T.copy(target);
    const d = _dir.copy(_T).sub(_S);
    const len = Math.max(0.05, Math.min(a + b - 0.002, d.length()));
    d.normalize();
    // loket míří dolů, dozadu a od těla
    _n.set(side * 0.45, -0.7, -0.35).transformDirection(root.matrixWorld);
    _n.addScaledVector(d, -_n.dot(d)).normalize();
    const cosA = Math.max(-1, Math.min(1, (a * a + len * len - b * b) / (2 * a * len)));
    _E.copy(_S).addScaledVector(d, a * cosA).addScaledVector(_n, a * Math.sqrt(1 - cosA * cosA));
    const T2 = _T.copy(_S).addScaledVector(d, len);
    aimAt(sh, el, _E, w);
    aimAt(el, hand, T2, w);
  }

  // ---------- nástroj v ruce (AST-06) ----------
  // Hlava nástroje leží na zemi před astronautem (tam, kde se opravdu zametá – player.js TOOL_AHEAD),
  // násada míří z hlavy k pravé ruce. Při zametání kmitá do stran, ve vzduchu visí pod rukou.
  // 11. 11.: hlava a násada jsou zvlášť – plocha hlavy leží rovnoběžně s terénem pod ní (i do kopce, podle normály
  // svahu z actors.js st.toolGround / toolNormal), šířkou napříč pohledu; násada vede od hlavy k ruce.
  const toolRoot = new THREE.Group();
  toolRoot.visible = false;
  root.add(toolRoot);
  let toolObj = null, toolId = null, toolOff = true, toolRadius = 0.15;
  const toolBaseWidth = { toothbrush: 0.3, handbrush: 0.6, broom: 1.0, handvac: 1.4, squeegee: 2.0 };
  function setTool(id) {
    const want = TOOL_GRIPS[id] ? id : null;
    if (want === toolId) return;
    toolId = want;
    if (toolObj) { toolRoot.remove(toolObj.head, toolObj.shaft); toolObj = null; }
    if (!want) return;
    const model = buildToolModel(want);
    const head = new THREE.Group(), shaft = new THREE.Group();
    // první díl = násada (válec podél +y); díly výš než 0,5 m (nádoba vysavače) patří k násadě, zbytek je hlava
    [...model.children].forEach((c, k) => (k === 0 || c.position.y > 0.5 ? shaft : head).add(c));
    mergeObject(head);
    mergeObject(shaft);
    toolObj = { head, shaft };
    toolRoot.add(head, shaft);
  }
  function setToolSize(radius) {
    toolOff = !(radius > 0);
    if (radius > 0) toolRadius = radius;
  }
  const _h = new THREE.Vector3(), _t = new THREE.Vector3(), _d = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  const _tn = new THREE.Vector3(), _fz = new THREE.Vector3(), _fx = new THREE.Vector3(), _bm = new THREE.Matrix4(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _tq = new THREE.Quaternion();
  function placeTool(dt, time, st) {
    toolRoot.visible = !!toolObj && !toolOff && !st.seated && !st.pushing && !(hammer?.visible) && !gettingUp() && !(ovl && ovl.name === 'mavani');
    if (!toolRoot.visible) return;
    const grip = TOOL_GRIPS[toolId];
    root.updateMatrixWorld(true);
    root.worldToLocal(B.ruka_P.getWorldPosition(_h));
    // na zemi před tělem (kmitání do stran při zametání) ↔ ve vzduchu pod rukou
    const sway = Math.sin(time * 11) * 0.22 * sweepAmp * (has('zametani') ? 0.5 : 1);
    // na zemi: bod terénu pod hlavou (z actors.js, místní souřadnice postavy), jinak rovina chodidel
    if (st.toolGround) {
      root.worldToLocal(_t.copy(st.toolGround));
      _t.x = _h.x * 0.4 + sway;                             // do stran podle ruky a kmitání, výška a vzdálenost z terénu
    } else _t.set(_h.x * 0.4 + sway, 0.02 - st.alt, grip.reach);
    _d.set(_h.x, _h.y - grip.len * 0.95, _h.z + 0.25);
    _t.lerp(_d, airAmp);
    toolRoot.position.copy(_t);
    toolRoot.quaternion.identity();
    _d.subVectors(_h, _t).normalize();                       // násada: od hlavy k ruce
    toolObj.shaft.quaternion.setFromUnitVectors(UP, _d);
    // hlava: osa Y = normála svahu, šířka (X) napříč pohledu postavy; ve vzduchu postupně jako násada
    if (st.toolNormal) _tn.copy(st.toolNormal).applyQuaternion(root.getWorldQuaternion(_tq).invert()).normalize();
    else _tn.copy(UP);
    _fz.set(0, 0, 1).addScaledVector(_tn, -_tn.z).normalize();
    _fx.crossVectors(_tn, _fz).normalize();
    _bm.makeBasis(_fx, _tn, _fz);
    _q1.setFromRotationMatrix(_bm);
    _q2.copy(toolObj.shaft.quaternion);
    toolObj.head.quaternion.copy(_q1).slerp(_q2, airAmp);
    const k = (toolRadius * 2) / (toolBaseWidth[toolId] || 0.3);   // vylepšená šířka = širší hlava
    toolRoot.scale.set(1, 1, 1);
    toolObj.head.scale.set(Math.max(0.5, k), 1, 1);
  }
  const tip = new THREE.Vector3();

  // ---------- kladivo ----------
  let hammer = null;
  function setHammer(on) {
    if (!on && !hammer) return;
    if (!hammer) {
      const model = buildHammerModel();
      mergeObject(model);
      model.rotation.y = Math.PI / 2;                      // hlava kladiva otočená kolem násady (úder dopředu)
      hammer = new THREE.Group();
      hammer.add(model);
      hammer.position.set(0, -0.03, 0.02);
      hammer.rotation.set(Math.PI / 2 - 0.15, 0, 0);       // násada z dlaně dopředu
      B.ruka_P.add(hammer);
    }
    hammer.visible = !!on;
  }
  const hammerSwing = () => playOverlay('kladivo', 3);    // stavba = 3 údery

  // ---------- jetpack: plamen z trysek tryska_L / tryska_P (batoh je součástí modelu) ----------
  const flameMat = new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const flameGeo = new THREE.ConeGeometry(0.07, 0.38, 8);
  flameGeo.rotateX(Math.PI);
  flameGeo.translate(0, -0.2, 0);
  const flames = ['tryska_L', 'tryska_P'].map(n => {
    const f = new THREE.Mesh(flameGeo, flameMat);
    f.visible = false;
    f.userData.noShadow = true;
    B[n].add(f);
    return f;
  });
  let jetState = 0;
  // state: 0 = jetpack nemá, 1 = má, 2 = právě hoří (výstřel jetpackem)
  function setJetpack(state) { jetState = state | 0; updateFlames(); }
  // Plamen: výstřel jetpackem, krátce při odrazu ze skoku, slabě při pádu z výšky, záblesk při srážce (jen vzhled).
  function updateFlames() {
    const now = performance.now();
    const k = jetState === 2 ? 1 : now < flameUntil ? 0.75 : flameWeak ? 0.45 : 0;
    for (const f of flames) {
      f.visible = k > 0;
      if (k > 0) f.scale.set(k, k * (0.8 + Math.random() * 0.5), k);
    }
  }

  // ---------- vzhled ----------
  let props = [];
  const helm = helmetOf(data);
  function setLook(l) {
    applyPalette(data, l, palette, emissive);
    mesh.geometry = data.geometryFor(maskFor(l));
    for (const p of props) B.hlava.remove(p.root);
    props = [l.top, l.face].map(id => fittedProp(id, helm.center, helm.r)).filter(Boolean);
    for (const p of props) B.hlava.add(p.root);
  }
  setLook(look);

  // ---------- úroveň detailu (O-21): 0 = plná (do 25 m), 1 = mixer 30×/s (do 60 m), 2 = pevná póza bez mixeru
  // (do 120 m), 3 = nekreslí se ----------
  function setDetail(level) {
    if (level === detail) return;
    detail = level;
    root.visible = level !== 3;
    if (level >= 2) {
      restPose();                                          // klidová póza (≈ klid, snímek 0)
      toolRoot.visible = false;
      for (const f of flames) f.visible = false;
    }
  }

  // ---------- ragdoll (AST-09): 16 bodů na kloubech nového modelu ----------
  const local = (bone, worldPoint) => new THREE.Vector3().fromArray(worldPoint).sub(W(bone));
  const LOCAL = [];
  LOCAL[RG.pelvis] = [B.panev, new THREE.Vector3()];
  LOCAL[RG.chest] = [B.trup, local('trup', [0, 1.15, -0.02])];
  LOCAL[RG.head] = [B.hlava, local('hlava', [0, 1.60, 0])];
  LOCAL[RG.pack] = [B.trup, local('trup', [0, 1.10, -0.32])];
  LOCAL[RG.shL] = [B.paze_L, new THREE.Vector3()];
  LOCAL[RG.elL] = [B.predlokti_L, new THREE.Vector3()];
  LOCAL[RG.haL] = [B.ruka_L, new THREE.Vector3()];
  LOCAL[RG.shR] = [B.paze_P, new THREE.Vector3()];
  LOCAL[RG.elR] = [B.predlokti_P, new THREE.Vector3()];
  LOCAL[RG.haR] = [B.ruka_P, new THREE.Vector3()];
  LOCAL[RG.hipL] = [B.stehno_L, new THREE.Vector3()];
  LOCAL[RG.knL] = [B.holen_L, new THREE.Vector3()];
  LOCAL[RG.ftL] = [B.holen_L, local('holen_L', [0.14, 0.03, 0.05])];
  LOCAL[RG.hipR] = [B.stehno_P, new THREE.Vector3()];
  LOCAL[RG.knR] = [B.holen_P, new THREE.Vector3()];
  LOCAL[RG.ftR] = [B.holen_P, local('holen_P', [-0.14, 0.03, 0.05])];

  function ragdollPose() {
    root.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    return LOCAL.map(([bone, p]) => v.copy(p).applyMatrix4(bone.matrixWorld).toArray());
  }

  let ragdolling = false, lastPts = null;
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
  const _qa = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _m = new THREE.Matrix4();
  const DOWN = new THREE.Vector3(0, -1, 0);
  const P = pts => (i, out) => out.set(pts[i][0], pts[i][1], pts[i][2]);
  // Kost natočí tak, aby její osa (klidově „dolů“ u končetin, „nahoru“ u hlavy) mířila z bodu a do bodu b.
  function aim(bone, parentQ, from, to, axis = DOWN) {
    _c.subVectors(to, from);
    if (_c.lengthSq() < 1e-8) return _qa.copy(parentQ).multiply(bone.quaternion);
    _c.normalize().applyQuaternion(_qi.copy(parentQ).invert());
    bone.quaternion.setFromUnitVectors(axis, _c);
    return parentQ.clone().multiply(bone.quaternion);
  }
  const headAxis = new THREE.Vector3().copy(LOCAL[RG.head][1]).normalize();

  function applyRagdoll(pts) {
    if (!pts || pts.length < RG_COUNT) return;
    if (!ragdolling) flameUntil = performance.now() + 200;   // záblesk jetpacku při srážce
    ragdolling = true;
    lastPts = pts;
    one = null; ovl = null;
    toolRoot.visible = false;
    shadow.visible = false;
    const g = P(pts);
    const pelvis = g(RG.pelvis, new THREE.Vector3()), chest = g(RG.chest, new THREE.Vector3());
    const up = new THREE.Vector3().subVectors(chest, pelvis).normalize();
    const right = g(RG.shR, new THREE.Vector3()).sub(g(RG.shL, _a)).add(g(RG.hipR, _b).sub(g(RG.hipL, _c))).negate();   // L = +x
    right.addScaledVector(up, -right.dot(up)).normalize();
    const fwd = new THREE.Vector3().crossVectors(right, up);
    _m.makeBasis(right, up, fwd);
    const rootQ = new THREE.Quaternion().setFromRotationMatrix(_m);
    root.quaternion.copy(rootQ);
    root.position.copy(pelvis).addScaledVector(up, -REST.panev.p.y);
    restPose();
    const v = i => g(i, new THREE.Vector3());
    aim(B.hlava, rootQ, v(RG.chest), v(RG.head), headAxis);
    const shLq = aim(B.paze_L, rootQ, v(RG.shL), v(RG.elL));
    aim(B.predlokti_L, shLq, v(RG.elL), v(RG.haL));
    const shRq = aim(B.paze_P, rootQ, v(RG.shR), v(RG.elR));
    aim(B.predlokti_P, shRq, v(RG.elR), v(RG.haR));
    const hLq = aim(B.stehno_L, rootQ, v(RG.hipL), v(RG.knL));
    aim(B.holen_L, hLq, v(RG.knL), v(RG.ftL));
    const hRq = aim(B.stehno_P, rootQ, v(RG.hipR), v(RG.knR));
    aim(B.holen_P, hRq, v(RG.knR), v(RG.ftR));
    updateFlames();
  }

  // Konec ragdollu: vstávání klipem (AST-09). Na zádech = batoh blíž zemi než hruď → vstavani_zada, jinak z břicha.
  // Směr postavy po vstávání nastaví player.js stejně (na zádech čelem k nohám, na břiše k hlavě).
  function endRagdoll() {
    if (!ragdolling) return;
    ragdolling = false;
    restPose();
    const onBack = lastPts ? Math.hypot(...lastPts[RG.pack]) < Math.hypot(...lastPts[RG.chest]) : true;
    for (const n of BASE_CLIPS) baseW[n] = n === 'klid' ? 1 : 0;
    playOnce(onBack ? 'vstavani_zada' : 'vstavani_bricho', 0);
  }
  const gettingUp = () => !!one && one.name.startsWith('vstavani');

  const view = {
    root,
    hipHeight: W('stehno_L').y,                         // kyčle z modelu (sezení: kyčle na bodě sedadla)
    update,
    head: B.hlava,
    setLook,
    ragdollPose,
    applyRagdoll,
    endRagdoll,
    get ragdolling() { return ragdolling; },
    get gettingUp() { return gettingUp(); },
    setTool,
    setToolSize,
    // klouby rukou pro pózu v lobby (stejné strany jako ve 3.0: L = −x, R = +x)
    arms: { L: { shoulder: B.paze_P, elbow: B.predlokti_P }, R: { shoulder: B.paze_L, elbow: B.predlokti_L } },
    bones: B,
    setJetpack,
    setHammer,
    hammerSwing,
    // ruce na volant / madlo: [L, P] body ve světě (THREE.Vector3) nebo null (AST-08)
    setHands: t => { handTargets = t && t[0] && t[1] ? t : null; },
    // cíl, kam se astronaut dívá (bod ve světě) nebo null
    setLookAt: p => { lookTarget = p ? (lookTarget || new THREE.Vector3()).copy(p) : null; },
    dump: () => playOverlay('vysypavani'),
    waveOnce: () => playOverlay('mavani', 1, false),          // šatna: zamávání po změně vzhledu                // vysypání zásobníku ve Výkupu / depu
    wave: on => { if (on) { if (!ovl || ovl.name !== 'mavani') playOverlay('mavani', 1, true); } else if (ovl?.name === 'mavani') { setW('mavani', 0, 0); ovl = null; } },
    // náhled animací (tools/anim-nahled.html)
    clips: () => Object.keys(ACT),
    playClip: name => { const a = ACT[name]; if (!a) return; if (BASE_CLIPS.includes(name)) { forcedBase = name; one = null; ovl = null; } else if (a.vrstva === 'horni') playOverlay(name, name === 'kladivo' ? 3 : 1, name === 'zametani' || name === 'mavani'); else playOnce(name, name.startsWith('vstavani') ? 0 : 0.06); },
    clearClip: () => { forcedBase = null; ovl = null; one = null; },
    setSpeed: k => { mixer.timeScale = k; },
    setDetail,
    get detail() { return detail; },
    setLamp: k => { lampK = k; },
    lampIntensity: () => lampK,
    lampPosition: out => lamp.getWorldPosition(out),
    lampDirection: out => out.set(0, 0, 1).transformDirection(lamp.matrixWorld),
    blob: shadow,
    toolTip: () => (toolRoot.visible ? toolRoot.localToWorld(tip.set(0, 0.03, 0)) : B.ruka_P.getWorldPosition(tip)),
    mesh,
  };
  root.userData.view = view;                             // ladění v konzoli (F3 / msDebug.scene)
  return view;
}
