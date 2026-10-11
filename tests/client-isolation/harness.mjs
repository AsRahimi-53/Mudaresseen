// In-memory IndexedDB / localStorage / Supabase (with RLS emulation) to exercise the real client modules.
export function installGlobals() {
  const dbs = new Map();
  class Req { constructor(){ this.onsuccess=null; this.onerror=null; this.result=undefined; } }
  const fire = (req, result) => setTimeout(() => { req.result = result; req.onsuccess && req.onsuccess(); }, 0);
  const idb = {
    _dbs: dbs,
    open(name) {
      const req = new Req(); const isNew = !dbs.has(name);
      if (isNew) dbs.set(name, { stores: new Map(), keyPaths: new Map() });
      const rec = dbs.get(name);
      const database = {
        objectStoreNames: { contains: n => rec.stores.has(n) },
        createObjectStore(n, o) { rec.stores.set(n, new Map()); rec.keyPaths.set(n, o.keyPath); },
        close() {},
        transaction(names) {
          const tx = { oncomplete: null, onerror: null, onabort: null };
          const arr = Array.isArray(names) ? names : [names];
          const kick = () => setTimeout(() => tx.oncomplete && tx.oncomplete(), 5);
          tx.objectStore = n => { if (!arr.includes(n)) throw new Error('store not in tx'); const m = rec.stores.get(n); const kp = rec.keyPaths.get(n);
            const mk = fn => { const r = new Req(); let out; try { out = fn(); } catch (e) { setTimeout(() => r.onerror && r.onerror(), 0); return r; } fire(r, out); kick(); return r; };
            return { put: v => mk(() => { m.set(v[kp], JSON.parse(JSON.stringify(v))); return v[kp]; }), get: k => mk(() => m.has(k) ? JSON.parse(JSON.stringify(m.get(k))) : undefined), getAll: () => mk(() => [...m.values()].map(v => JSON.parse(JSON.stringify(v)))), delete: k => mk(() => { m.delete(k); }), clear: () => mk(() => { m.clear(); }), count: () => mk(() => m.size) }; };
          return tx;
        }
      };
      req.result = database;
      setTimeout(() => { if (isNew && req.onupgradeneeded) { req.result = database; req.onupgradeneeded(); } req.result = database; req.onsuccess && req.onsuccess(); }, 0);
      return req;
    }
  };
  const ls = new Map();
  globalThis.window = globalThis;
  globalThis.indexedDB = idb;
  globalThis.localStorage = { getItem: k => ls.has(k) ? ls.get(k) : null, setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k) };
  globalThis.document = { documentElement: {}, querySelectorAll: () => [], getElementById: () => null, addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {} }) };
  globalThis.MADRASA_ONLINE_CONFIG = { enabled: true, supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'sb_publishable_test' };
  return { idb, ls };
}
export function makeServer() {
  const server = { users: {}, profiles: {}, records: new Map(), settings: new Map(), log: [], down: false };
  const tenantOf = uid => server.profiles[uid]?.tenant_id;
  server.addUser = (email, id, tenant, role = 'admin', names = {}) => { server.users[email] = { id }; server.profiles[id] = { user_id: id, tenant_id: tenant, district_id: tenant, role, province_name: names.province, district_name: names.district }; };
  globalThis.__makeClient = () => {
    let session = null; const listeners = [];
    const emit = (ev, s) => setTimeout(() => listeners.forEach(cb => cb(ev, s)), 0);
    class Q {
      constructor(table) { this.table = table; this.f = []; this.op = 'select'; }
      select() { return this; } order() { return this; } range() { return this; } eq(c, v) { this.f.push([c, v]); return this; }
      maybeSingle() { this.single = true; return this; }
      upsert(rows) { this.op = 'upsert'; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
      delete() { this.op = 'delete'; return this; }
      then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej); }
      run() {
        if (server.down) return { data: null, error: { message: 'network down' } };
        const uid = session?.user?.id; const tenant = tenantOf(uid);
        const match = row => this.f.every(([c, v]) => row[c] === v);
        if (this.table === 'user_profiles') { const row = server.profiles[uid]; const ok = row && match(row); return { data: this.single ? (ok ? row : null) : (ok ? [row] : []), error: null }; }
        const store = this.table === 'app_records' ? server.records : server.settings;
        const keyOf = r => this.table === 'app_records' ? `${r.district_id}|${r.store}|${r.record_id}` : r.district_id;
        if (this.op === 'select') { const rows = [...store.values()].filter(r => r.district_id === tenant && match(r)); return { data: this.single ? (rows[0] || null) : rows, error: null }; }
        if (this.op === 'upsert') { for (const r of this.rows) { if (r.district_id !== tenant) return { data: null, error: { message: 'RLS: new row violates row-level security policy' } }; } for (const r of this.rows) { store.set(keyOf(r), JSON.parse(JSON.stringify(r))); server.log.push({ by: uid, tenant, table: this.table, key: keyOf(r) }); } return { data: null, error: null }; }
        if (this.op === 'delete') { for (const [k, r] of [...store]) if (r.district_id === tenant && match(r)) store.delete(k); return { data: null, error: null }; }
      }
    }
    return {
      auth: {
        getSession: async () => ({ data: { session }, error: null }),
        onAuthStateChange(cb) { listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
        signInWithPassword: async ({ email }) => { const u = server.users[email]; session = { access_token: 'tok-' + u.id, user: { id: u.id } }; emit('SIGNED_IN', session); return { data: { session }, error: null }; },
        signOut: async () => { session = null; emit('SIGNED_OUT', null); return { error: null }; }
      },
      rpc: async () => ({ data: false, error: null }),
      from: t => new Q(t)
    };
  };
  return server;
}
