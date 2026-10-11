import { installGlobals, makeServer } from './harness.mjs';
const [dir, scenario] = process.argv.slice(2);
const env = installGlobals(); const server = makeServer();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const online = await import(`./${dir}/js/onlineSync.js`);
const { db } = await import(`./${dir}/js/database.js`);
server.addUser('a@x', 'uA', 'kabul:a', 'admin', { province: 'Kabul', district: 'A' });
server.addUser('b@x', 'uB', 'herat:b', 'admin', { province: 'Herat', district: 'B' });
const rowsOf = tenant => [...server.records.values()].filter(r => r.district_id === tenant && !r.deleted_at && r.store !== 'members');
const ids = tenant => rowsOf(tenant).map(r => r.record_id).sort().join(',') || '(none)';
const localIds = async () => (await db.getAll('teachers')).map(r => r.id).sort().join(',') || '(none)';
const out = (k, v) => console.log(`  ${k}: ${v}`);
await db.init(); await online.configure({});
if (scenario === 'signout-then-B') {
  await db.saveSettings({ id: 'app', province: 'Kabul', district: 'A' }, { skipRemote: true });
  await online.signIn('a@x', 'pw');
  await db.put('teachers', { id: 't-A1', name: 'A teacher 1' }); await db.put('teachers', { id: 't-A2', name: 'A teacher 2' }); await sleep(60);
  out('A cloud records', ids('kabul:a'));
  await online.signOut(); await sleep(30);
  out('local DB after A signs out', await localIds());
  await online.signIn('b@x', 'pw'); await sleep(80);
  out('local DB visible to B', await localIds());
  out('B cloud records (must be none)', ids('herat:b'));
  out('A cloud records still intact', ids('kabul:a'));
}
if (scenario === 'legacy-cache-B') {
  // Device cache created by the OLD app: district A data, no owner tag.
  await db.saveSettings({ id: 'app', province: 'Kabul', district: 'A' }, { skipRemote: true });
  await db.put('teachers', { id: 't-A1', name: 'A teacher 1' }, { skipRemote: true }); await db.put('teachers', { id: 't-A2', name: 'A teacher 2' }, { skipRemote: true });
  await online.signIn('b@x', 'pw'); await sleep(80);
  out('local DB visible to B', await localIds());
  out('B cloud records (must be none)', ids('herat:b'));
  out('B cloud settings', server.settings.get('herat:b') ? JSON.stringify(server.settings.get('herat:b').data) : '(none)');
  out('quarantine DBs', [...env.idb._dbs.keys()].filter(n => n.includes('quarantine')).length);
}
if (scenario === 'legacy-cache-A') {
  await db.saveSettings({ id: 'app', province: 'Kabul', district: 'A' }, { skipRemote: true });
  await db.put('teachers', { id: 't-A1', name: 'A teacher 1' }, { skipRemote: true });
  await online.signIn('a@x', 'pw'); await sleep(80);
  out('local DB visible to A', await localIds());
  out('A cloud records (legit owner keeps data)', ids('kabul:a'));
}
if (scenario === 'unsynced-offline') {
  await online.signIn('a@x', 'pw'); await sleep(30);
  server.down = true; await db.put('teachers', { id: 't-A-offline', name: 'unsynced' }); await sleep(30);
  await online.signOut(); await sleep(30); server.down = false;
  out('local DB after sign-out', await localIds());
  const q = [...env.idb._dbs.entries()].filter(([n]) => n.includes('quarantine'));
  out('quarantine archives', q.length);
  out('archive contains unsynced record', q.some(([, d]) => JSON.stringify([...d.stores.get('snapshot').values()]).includes('t-A-offline')));
  out('cloud untouched / no rows lost', ids('kabul:a'));
}
if (scenario === 'forged-owner') {
  // Tampered local owner tag + A's data, B signs in: server profile (herat:b) decides.
  await db.put('teachers', { id: 't-A1', name: 'A' }, { skipRemote: true });
  localStorage.setItem('madrasa:local-owner', JSON.stringify({ tenant: 'kabul:a', userId: 'uB' }));
  await online.signIn('b@x', 'pw'); await sleep(80);
  out('B cloud records (must be none)', ids('herat:b'));
  out('RLS-rejected writes recorded', server.log.filter(l => l.by === 'uB' && l.tenant !== 'herat:b').length);
}
if (scenario === 'backup-guard') {
  await online.signIn('b@x', 'pw'); await sleep(40);
  const { restoreBackup } = await import(`./${dir}/js/backup.js`);
  const file = { text: async () => JSON.stringify({ schema: 'madrasa-pd-backup', version: 1, tenantId: 'kabul:a', data: { settings: [{ id: 'app', province: 'Kabul', district: 'A' }], teachers: [{ id: 'x1' }] } }) };
  try { const r = await restoreBackup(file, async () => true); out('restore of district A backup into B', r === true ? 'ALLOWED (leak path)' : 'cancelled'); } catch (e) { out('restore of district A backup into B', 'REFUSED: ' + e.message.slice(0, 40)); }
  out('local after attempt', await localIds());
}
process.exit(0);
