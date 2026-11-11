// Ladicí výpis výkonu (O-01): F3 = zapnout / vypnout panel, Shift+F3 = rozpad vykreslení podle skupin (i do konzole).
// Panel ukazuje průměr za 0,5 s: FPS, vykreslení (draw calls), trojúhelníky, čas logiky a vykreslení (CPU), paměť JS.
// Skupiny se poznají podle userData.dbg na objektech nejvyšší úrovně scény (terrain, astronaut, vehicle, building, rock, ostatní).

const GROUPS = ['terrain', 'astronaut', 'vehicle', 'building', 'rock'];
const LABEL = { terrain: 'terén', astronaut: 'astronauti', vehicle: 'vozidla', building: 'budovy', rock: 'kameny', other: 'ostatní' };

export function createDebug(renderer, scene, camera) {
  const el = document.createElement('pre');
  el.className = 'debug-panel';
  el.hidden = true;
  document.body.appendChild(el);

  const acc = { frames: 0, since: performance.now(), logic: 0, render: 0, calls: 0, tris: 0 };
  let frameStart = 0, renderStart = 0;
  let split = null;                         // poslední rozpad podle skupin

  // Kdo patří do skupiny: objekt nejvyšší úrovně nebo jeho předek s userData.dbg.
  const groupOf = o => o.userData.dbg || 'other';

  function breakdown() {
    const top = scene.children;
    const saved = top.map(o => o.visible);
    const measure = keep => {
      top.forEach((o, i) => { o.visible = saved[i] && keep(groupOf(o)); });
      renderer.render(scene, camera);
      return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
    };
    const all = measure(() => true);
    const parts = {};
    for (const g of [...GROUPS, 'other']) parts[g] = measure(x => x === g);
    top.forEach((o, i) => { o.visible = saved[i]; });
    split = { all, parts, at: new Date().toLocaleTimeString() };
    const rows = Object.entries(parts).map(([g, v]) => ({
      skupina: LABEL[g], vykresleni: v.calls, podil: all.calls ? `${Math.round(v.calls / all.calls * 100)} %` : '–', trojuhelniky: v.tris,
    }));
    console.log(`[debug] rozpad vykreslení ${split.at}: celkem ${all.calls} vykreslení, ${all.tris} trojúhelníků`);
    console.table(rows);
    el.hidden = false;
    show();
    return split;
  }

  let last = null;
  function show() {
    if (el.hidden || !last) return;
    const mem = performance.memory ? `${Math.round(performance.memory.usedJSHeapSize / 1048576)} MB` : '–';
    let text = `FPS ${last.fps.toFixed(0)}   (F3 skrýt, Shift+F3 rozpad)\n`
      + `vykreslení ${last.calls.toFixed(0)}   trojúhelníky ${Math.round(last.tris).toLocaleString('cs')}\n`
      + `logika ${last.logic.toFixed(2)} ms   vykreslení (CPU) ${last.render.toFixed(2)} ms\n`
      + `paměť JS ${mem}`;
    if (split) {
      text += `\n— rozpad ${split.at} —`;
      for (const [g, v] of Object.entries(split.parts)) {
        const pct = split.all.calls ? Math.round(v.calls / split.all.calls * 100) : 0;
        text += `\n${LABEL[g].padEnd(11)} ${String(v.calls).padStart(4)} (${String(pct).padStart(2)} %)  ${v.tris.toLocaleString('cs').padStart(9)} tr.`;
      }
    }
    el.textContent = text;
  }

  return {
    scene, camera, renderer,                // pro testy z konzole (umístění modelu do scény, počty vykreslení)
    get on() { return !el.hidden; },
    toggle() { el.hidden = !el.hidden; if (el.hidden) split = null; show(); },
    breakdown,
    frameStart(now) { frameStart = now; },
    beforeRender() { renderStart = performance.now(); },
    afterRender() {
      const end = performance.now();
      acc.frames++;
      acc.logic += renderStart - frameStart;
      acc.render += end - renderStart;
      acc.calls += renderer.info.render.calls;
      acc.tris += renderer.info.render.triangles;
      const span = end - acc.since;
      if (span < 500) return;
      const n = acc.frames;
      last = { fps: n * 1000 / span, logic: acc.logic / n, render: acc.render / n, calls: acc.calls / n, tris: acc.tris / n };
      acc.frames = acc.logic = acc.render = acc.calls = acc.tris = 0;
      acc.since = end;
      show();
    },
    // pro měření z konzole: (await import('/js/debug.js')) nemá stav – použij window.msDebug.stats()
    stats: () => ({ ...last, split }),
  };
}
