// Veri katmanı: Firebase ayarı varsa Firestore (ortak, gerçek zamanlı),
// yoksa tarayıcı içi deneme modu (veriler sadece bu cihazda).

const FB_VERSION = '10.12.2';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomId(len, alphabet = ALPHABET) {
  const a = crypto.getRandomValues(new Uint32Array(len));
  return Array.from(a, x => alphabet[x % alphabet.length]).join('');
}

export function createStore(config) {
  const configured = config && config.apiKey && !config.apiKey.startsWith('BURAYA');
  return configured ? firebaseStore(config) : localStore();
}

async function firebaseStore(config) {
  const base = `https://www.gstatic.com/firebasejs/${FB_VERSION}/`;
  const [appMod, authMod, fs] = await Promise.all([
    import(base + 'firebase-app.js'),
    import(base + 'firebase-auth.js'),
    import(base + 'firebase-firestore.js'),
  ]);
  const app = appMod.initializeApp(config);
  const auth = authMod.getAuth(app);
  await new Promise(resolve => {
    const off = authMod.onAuthStateChanged(auth, () => { off(); resolve(); });
  });
  if (!auth.currentUser) await authMod.signInAnonymously(auth);

  let db;
  try {
    db = fs.initializeFirestore(app, {
      localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
    });
  } catch {
    db = fs.getFirestore(app);
  }

  const houseRef = code => fs.doc(db, 'houses', code);
  const txCol = code => fs.collection(db, 'houses', code, 'tx');

  return {
    mode: 'firebase',
    async createHouse(data) {
      const code = randomId(10);
      await fs.setDoc(houseRef(code), { ...data, createdAt: Date.now() });
      return code;
    },
    watch(code, cb) {
      const offHouse = fs.onSnapshot(houseRef(code), { includeMetadataChanges: true }, snap => {
        if (snap.exists()) cb.house(snap.data());
        else if (!snap.metadata.fromCache) cb.house(null);
      }, cb.error);
      const offTx = fs.onSnapshot(txCol(code), snap => {
        cb.txs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }, cb.error);
      return () => { offHouse(); offTx(); };
    },
    updateHouse: (code, patch) => fs.updateDoc(houseRef(code), patch),
    addTx: (code, tx) => fs.addDoc(txCol(code), tx),
    updateTx: (code, id, tx) => fs.setDoc(fs.doc(txCol(code), id), tx),
    deleteTx: (code, id) => fs.deleteDoc(fs.doc(txCol(code), id)),
  };
}

function localStore() {
  const KEY = 'splithome:localdb';
  const load = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || { houses: {} }; }
    catch { return { houses: {} }; }
  };
  let db = load();
  const listeners = new Set();
  const emit = () => listeners.forEach(f => f());
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {}
    emit();
  };
  window.addEventListener('storage', e => {
    if (e.key === KEY) { db = load(); emit(); }
  });

  return {
    mode: 'local',
    async createHouse(data) {
      const code = randomId(10);
      db.houses[code] = { house: { ...data, createdAt: Date.now() }, tx: {} };
      save();
      return code;
    },
    watch(code, cb) {
      const f = () => {
        const h = db.houses[code];
        cb.house(h ? structuredClone(h.house) : null);
        if (h) cb.txs(Object.entries(h.tx).map(([id, t]) => ({ id, ...structuredClone(t) })));
      };
      listeners.add(f);
      queueMicrotask(f);
      return () => listeners.delete(f);
    },
    async updateHouse(code, patch) { Object.assign(db.houses[code].house, patch); save(); },
    async addTx(code, tx) { db.houses[code].tx[randomId(12)] = tx; save(); },
    async updateTx(code, id, tx) { db.houses[code].tx[id] = tx; save(); },
    async deleteTx(code, id) { delete db.houses[code].tx[id]; save(); },
  };
}
