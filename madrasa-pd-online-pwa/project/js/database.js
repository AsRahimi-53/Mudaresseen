export const STORES = ['settings','members','madrasas','teachers','staff','students','statistics','tashkil','observations','annualPlans','monthlyPlans','duties','activities','professionalDevelopment','monitoring','reports'];
const DB_NAME = 'madrasa-professional-development-db';
const DB_VERSION = 2;
let connection;
let remoteAdapter = null;

export function setRemoteAdapter(adapter) { remoteAdapter = adapter || null; }
function notifyRemote(method, ...args) {
  try {
    const result = remoteAdapter?.[method]?.(...args);
    if (result?.catch) result.catch(error => console.warn(`Remote sync ${method} failed`, error));
  } catch (error) { console.warn(`Remote sync ${method} failed`, error); }
}

function openConnection() {
  if (connection) return connection;
  if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB is not supported in this browser.'));
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      STORES.forEach(store => {
        if (!database.objectStoreNames.contains(store)) database.createObjectStore(store, { keyPath: 'id' });
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Unable to open database'));
  });
  return connection;
}
function clone(value) {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}
function transaction(storeNames, mode = 'readonly') {
  return openConnection().then(database => database.transaction(storeNames, mode));
}
function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function complete(tx) { return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('Transaction aborted')); }); }
function withUpdatedAt(item, preserve = false) { return preserve ? item : { ...item, updatedAt: new Date().toISOString() }; }

export const db = {
  stores: STORES,
  async init() { await openConnection(); return this; },
  async get(store, id) { const tx = await transaction(store); return clone(await requestResult(tx.objectStore(store).get(id))); },
  async getAll(store) { const tx = await transaction(store); return clone(await requestResult(tx.objectStore(store).getAll())); },
  async count(store) { const tx = await transaction(store); return requestResult(tx.objectStore(store).count()); },
  async put(store, record, options = {}) {
    const item = withUpdatedAt(clone(record), options.preserveUpdatedAt);
    if (!item.id) item.id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const tx = await transaction(store, 'readwrite');
    await requestResult(tx.objectStore(store).put(item));
    await complete(tx);
    if (!options.skipRemote) notifyRemote('onPut', store, item);
    return item;
  },
  async add(store, record, options = {}) { return this.put(store, record, options); },
  async delete(store, id, options = {}) {
    const tx = await transaction(store, 'readwrite');
    await requestResult(tx.objectStore(store).delete(id));
    await complete(tx);
    if (!options.skipRemote) notifyRemote('onDelete', store, id);
  },
  async clear(store, options = {}) {
    const tx = await transaction(store, 'readwrite');
    await requestResult(tx.objectStore(store).clear());
    await complete(tx);
    if (!options.skipRemote) notifyRemote('onClear', store);
  },
  async bulkPut(store, records, options = {}) {
    const tx = await transaction(store, 'readwrite');
    const items = records.map(record => {
      const item = withUpdatedAt(clone(record), options.preserveUpdatedAt);
      if (!item.id) item.id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      tx.objectStore(store).put(item);
      return item;
    });
    await complete(tx);
    if (!options.skipRemote) notifyRemote('onBulkPut', store, items);
    return items;
  },
  async getSettings() { return (await this.get('settings', 'app')) || null; },
  async saveSettings(settings, options = {}) { return this.put('settings', { ...settings, id: 'app' }, options); },
  async getAllData() {
    const data = {};
    for (const store of STORES) data[store] = await this.getAll(store);
    return data;
  },
  async replaceAllData(data) {
    const validStores = STORES.filter(store => Array.isArray(data?.[store]));
    if (!validStores.length) throw new Error('No valid application stores found in backup.');
    const database = await openConnection();
    const tx = database.transaction(STORES, 'readwrite');
    STORES.forEach(store => tx.objectStore(store).clear());
    for (const store of validStores) {
      for (const record of data[store]) {
        if (record && record.id !== undefined) tx.objectStore(store).put(clone(record));
      }
    }
    await complete(tx);
  },
  async query(store, predicate) { const rows = await this.getAll(store); return rows.filter(predicate); },
  async exists(store, predicate) { const rows = await this.getAll(store); return rows.some(predicate); }
};

export function newId(prefix = 'id') { return `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`; }
