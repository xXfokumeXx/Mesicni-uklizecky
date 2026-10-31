// Multiplayer přes Firebase Realtime Database (zdarma v tarifu Spark: 100 připojení, 10 GB stažených dat / měsíc).
// Napodobuje rozhraní `room` a `db` z artefaktů claude.ai, takže net.js funguje beze změny:
//   room.presence(patch), room.peers(), room.onPeers(fn), room.join(název), room.connected(), room.onConnection(fn)
//   db.doc(cesta).get() / .set(data)
//
// Uložení v databázi:
//   lobby/<peer>                  presence v lobby (kdo je online, otevřené světy)
//   rooms/<svet-kód>/peers/<peer> presence ve světě (poloha, tahy koštětem, chat…)
//   docs/<cesta s ~ místo />      snímky mapy pro nově příchozí
// <peer> = uid anonymního přihlášení + „_“ + náhodná přípona (každá karta prohlížeče je jiný hráč).
// Po odpojení (zavřená karta, výpadek sítě) Firebase záznam hráče sám smaže (onDisconnect).
//
// Šetření dat: presence se zapisuje po polích a jen to, co se změnilo. Tahy koštětem (pole `s`)
// se ukládají jako samostatné položky podle pořadového čísla, takže se posílají jen nové tahy.

const KEYED = { s: true };                  // pole, jehož položky [seq, …] se zapisují zvlášť

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const json = v => JSON.stringify(v ?? null);

// Firebase nepřijme undefined, NaN ani Infinity → null.
function sanitize(v) {
  if (v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (Array.isArray(v)) return v.map(sanitize);
  if (isObj(v)) {
    const out = {};
    for (const k in v) { const s = sanitize(v[k]); if (s !== null) out[k] = s; }
    return Object.keys(out).length ? out : null;
  }
  return v;
}

function encodeField(k, v) {
  if (KEYED[k] && Array.isArray(v)) {
    const out = {};
    for (const e of v) if (Array.isArray(e)) out['q' + e[0]] = e;
    return Object.keys(out).length ? out : null;
  }
  return v;
}

// Po načtení: pole `s` zpátky na seřazené pole, prázdné hodnoty pryč.
function decodePresence(val) {
  if (!isObj(val)) return {};
  const p = { ...val };
  for (const k in KEYED) {
    if (isObj(p[k])) p[k] = Object.values(p[k]).filter(Array.isArray).sort((a, b) => a[0] - b[0]);
  }
  return p;
}

const rand = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');

export async function createFirebasePlatform(config) {
  const fb = window.firebase;
  if (!fb?.initializeApp || !fb.auth || !fb.database) throw new Error('sdk');
  if (!fb.apps.length) fb.initializeApp(config);
  const auth = fb.auth();
  if (!auth.currentUser) await auth.signInAnonymously();
  const uid = auth.currentUser.uid;
  const database = fb.database();
  const me = `${uid}_${rand(5)}`;

  // ---------- spojení ----------
  let online = false;
  const connListeners = new Set();
  const rooms = new Set();
  database.ref('.info/connected').on('value', snap => {
    online = !!snap.val();
    if (online) for (const r of rooms) r.reconnected();
    for (const fn of connListeners) fn(online);
  });

  // ---------- místnost (lobby nebo svět) ----------
  function makeRoom(name, ref) {
    const myRef = ref.child(me);
    const local = {};                       // moje presence (sloučené patche)
    let written = {};                       // co už je zapsané ve Firebase (zakódované)
    let listening = false, closed = false;
    const peerMap = new Map();              // peer → zmrazený objekt Peer
    let snapshot = Object.freeze([]);
    const listeners = new Set();
    let pending = { joined: new Map(), left: new Map(), updated: new Map() }, scheduled = false;

    function peerObj(key, val, old) {
      return Object.freeze({
        peer: key, by: null, kind: 'viewer', guest: false,
        isMe: key === me, sameTab: key === me,
        presence: Object.freeze(decodePresence(val)),
        updatedAt: Date.now(),
        _new: !old,
      });
    }

    // změny se doručí najednou (nejvýš jednou za průchod smyčky událostí)
    function deliver() {
      scheduled = false;
      snapshot = Object.freeze([...peerMap.values()]);
      const change = {
        peers: snapshot,
        joined: [...pending.joined.values()],
        left: [...pending.left.values()],
        updated: [...pending.updated.values()],
      };
      pending = { joined: new Map(), left: new Map(), updated: new Map() };
      for (const fn of listeners) { try { fn(change); } catch (e) { console.error(e); } }
    }
    const schedule = () => { if (!scheduled) { scheduled = true; setTimeout(deliver, 0); } };

    function listen() {
      if (listening) return;
      listening = true;
      const onAdd = snap => {
        const p = peerObj(snap.key, snap.val(), null);
        peerMap.set(snap.key, p);
        pending.left.delete(snap.key);
        pending.joined.set(snap.key, p);
        schedule();
      };
      const onChange = snap => {
        const p = peerObj(snap.key, snap.val(), peerMap.get(snap.key));
        peerMap.set(snap.key, p);
        if (pending.joined.has(snap.key)) pending.joined.set(snap.key, p);
        else pending.updated.set(snap.key, p);
        schedule();
      };
      const onRemove = snap => {
        const p = peerMap.get(snap.key);
        peerMap.delete(snap.key);
        if (p) {
          if (pending.joined.has(snap.key)) pending.joined.delete(snap.key);
          else pending.left.set(snap.key, p);
        }
        pending.updated.delete(snap.key);
        schedule();
      };
      ref.on('child_added', onAdd);
      ref.on('child_changed', onChange);
      ref.on('child_removed', onRemove);
    }

    // Zapíše jen změněná pole (u objektů jen změněné podklíče, u tahů jen nové tahy).
    function write(patch) {
      const updates = {};
      for (const k of Object.keys(patch)) {
        const nv = sanitize(encodeField(k, patch[k]));
        const ov = written[k];
        if (nv === null) {
          if (ov !== undefined) updates[k] = null;
          delete written[k];
        } else if (isObj(nv) && isObj(ov)) {
          for (const sk in nv) if (json(nv[sk]) !== json(ov[sk])) updates[`${k}/${sk}`] = nv[sk];
          for (const sk in ov) if (!(sk in nv)) updates[`${k}/${sk}`] = null;
          written[k] = nv;
        } else if (json(nv) !== json(ov)) {
          updates[k] = nv;
          written[k] = nv;
        }
      }
      if (!Object.keys(updates).length) return Promise.resolve();
      return myRef.update(updates);
    }

    let disconnectSet = false;
    async function ensureDisconnect() {
      if (disconnectSet) return;
      disconnectSet = true;
      await myRef.onDisconnect().remove();
    }

    const api = {
      name,
      async presence(patch) {
        if (closed) throw Object.assign(new Error('closed'), { code: 'invalid_argument' });
        Object.assign(local, patch);
        for (const k in patch) if (patch[k] === null) delete local[k];
        await ensureDisconnect();
        return write(patch);
      },
      peers: () => snapshot,
      onPeers(fn) {
        listeners.add(fn);
        listen();
        // první doručení: všichni, kdo tu už jsou, jako „joined“
        setTimeout(() => {
          if (!listeners.has(fn)) return;
          fn({ peers: snapshot, joined: snapshot, left: [], updated: [] });
        }, 0);
        return () => listeners.delete(fn);
      },
      connected: () => online,
      onConnection(fn) {
        connListeners.add(fn);
        setTimeout(() => fn(online), 0);
        return () => connListeners.delete(fn);
      },
      async leave() {
        closed = true;
        rooms.delete(api);
        ref.off();
        await myRef.remove().catch(() => {});
      },
      // po výpadku spojení Firebase záznam smazal → zapsat celou presence znovu
      reconnected() {
        if (closed || !Object.keys(local).length) return;
        disconnectSet = false;
        written = {};
        ensureDisconnect().then(() => write({ ...local })).catch(() => {});
      },
    };
    rooms.add(api);
    return api;
  }

  const lobby = makeRoom('lobby', database.ref('lobby'));
  const named = new Map();
  const room = {
    ...lobby,
    async join(name) {
      if (!/^[a-z0-9][a-z0-9_.-]{0,47}$/.test(name)) throw Object.assign(new Error('name'), { code: 'invalid_argument' });
      if (!named.has(name)) named.set(name, makeRoom(name, database.ref(`rooms/${name}/peers`)));
      return named.get(name);
    },
  };

  // ---------- dokumenty (snímky mapy) ----------
  const docKey = path => 'docs/' + path.replace(/\//g, '~');
  const db = {
    doc(path) {
      const ref = database.ref(docKey(path));
      return {
        async get() {
          const snap = await ref.get();
          return { id: path.split('/').pop(), exists: snap.exists(), data: () => snap.val() ?? undefined };
        },
        set: data => ref.set(sanitize(data)),
      };
    },
  };

  return { room, db, me, kind: 'firebase' };
}
