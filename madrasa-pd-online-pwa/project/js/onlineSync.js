import { createClient } from '@supabase/supabase-js';
import { t } from './translations.js';
import { db, STORES, setRemoteAdapter } from './database.js';

const syncStores = STORES.filter(store => store !== 'settings');
let client = null;
let authSubscription = null;
let currentConfig = {};
let currentSettings = null;
let syncPromise = null;
const listeners = new Set();
const state = { configured: false, status: 'offline', session: null, profile: null, error: '', lastSync: null, syncing: false };

function notify() { listeners.forEach(listener => { try { listener(snapshot()); } catch (error) { console.warn('Online state listener failed', error); } }); }
function update(patch) { Object.assign(state, patch); notify(); }
function snapshot() { return { ...state, config: { ...currentConfig }, client }; }
function definedConfig(source = {}) { return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined && value !== null && value !== '')); }
export function normalizeDistrictId(value) { return String(value || '').trim().toLocaleLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-'); }
export function tenantKey(provinceId, districtId) { return `${normalizeDistrictId(provinceId)}:${normalizeDistrictId(districtId)}`.replace(/^:+|:+$/g, ''); }
export function getOnlineConfig(settings = {}) {
  const runtime = typeof window !== 'undefined' ? (window.MADRASA_ONLINE_CONFIG || {}) : {};
  const local = settings.onlineConfig || {};
  return { ...runtime, ...definedConfig(local), enabled: local.enabled ?? runtime.enabled ?? Boolean(local.supabaseUrl || runtime.supabaseUrl) };
}
export function onlineSnapshot() { return snapshot(); }
export function subscribeOnline(listener) { listeners.add(listener); return () => listeners.delete(listener); }
export function isOnlineConfigured() { return Boolean(state.configured); }
export function canDelete() { return !(state.configured && state.session && state.profile?.role !== 'admin'); }
function districtId() { return state.profile?.tenant_id || state.profile?.district_id || currentConfig.districtId || ''; }
function accessToken() { return state.session?.access_token || ''; }
function isReady() { return Boolean(client && state.session && districtId()); }
function remoteError(error) { return error?.message || error?.details || error?.hint || t('onlineRequestFailed'); }
function friendlyAuthError(error) {
  const message = remoteError(error); const lower = message.toLowerCase();
  if (lower.includes('already registered') || lower.includes('already exists')) return t('emailAlreadyRegistered');
  if (lower.includes('invalid login credentials') || lower.includes('invalid credentials')) return t('invalidLogin');
  if (lower.includes('province and district') || lower.includes('not registered')) return t('signupDistrictNotAllowed');
  if (lower.includes('password')) return t('passwordRequirements');
  return message;
}
function timestamp(value) { const time = Date.parse(value || ''); return Number.isFinite(time) ? time : 0; }

async function fetchProfile() {
  if (!client || !state.session?.user?.id) return null;
  const { data, error } = await client.from('user_profiles').select('*').eq('user_id', state.session.user.id).maybeSingle();
  if (error) throw error;
  state.profile = data || null;
  return state.profile;
}
export async function listDistricts() {
  if (!client) return [];
  const { data, error } = await client.from('district_registry').select('province_id,province_name,district_id,district_name,tenant_id').eq('active', true).order('province_name').order('district_name');
  if (error) throw error;
  return data || [];
}
async function upsertRemoteRecord(store, item) {
  if (!isReady() || !syncStores.includes(store)) return;
  const { error } = await client.from('app_records').upsert({ district_id: districtId(), store, record_id: item.id, data: item, updated_at: item.updatedAt || new Date().toISOString(), updated_by: state.session.user.id, deleted_at: null }, { onConflict: 'district_id,store,record_id' });
  if (error) throw error;
}
async function upsertRemoteRecords(store, items) {
  if (!isReady() || !syncStores.includes(store) || !items.length) return;
  const payload = items.map(item => ({ district_id: districtId(), store, record_id: item.id, data: item, updated_at: item.updatedAt || new Date().toISOString(), updated_by: state.session.user.id, deleted_at: null }));
  for (let index = 0; index < payload.length; index += 500) {
    const { error } = await client.from('app_records').upsert(payload.slice(index, index + 500), { onConflict: 'district_id,store,record_id' });
    if (error) throw error;
  }
}
async function tombstone(store, id) {
  if (!isReady() || !syncStores.includes(store) || state.profile?.role !== 'admin') return;
  const now = new Date().toISOString();
  const { error } = await client.from('app_records').upsert({ district_id: districtId(), store, record_id: id, data: {}, updated_at: now, updated_by: state.session.user.id, deleted_at: now }, { onConflict: 'district_id,store,record_id' });
  if (error) throw error;
}
async function clearRemoteStore(store) {
  if (!isReady() || !syncStores.includes(store) || state.profile?.role !== 'admin') return;
  const { error } = await client.from('app_records').delete().eq('district_id', districtId()).eq('store', store);
  if (error) throw error;
}
async function pushSettings(item) {
  if (!isReady() || state.profile?.role !== 'admin') return;
  const { error } = await client.from('district_settings').upsert({ district_id: districtId(), data: item, updated_at: item.updatedAt || new Date().toISOString(), updated_by: state.session.user.id }, { onConflict: 'district_id' });
  if (error) throw error;
}
const adapter = { onPut: upsertRemoteRecord, onBulkPut: upsertRemoteRecords, onDelete: tombstone, onClear: clearRemoteStore };

async function remoteRows() {
  const { data, error } = await client.from('app_records').select('district_id,store,record_id,data,updated_at,deleted_at').eq('district_id', districtId()).range(0, 9999);
  if (error) throw error;
  return data || [];
}
async function syncSettings() {
  if (!isReady()) return;
  const { data, error } = await client.from('district_settings').select('district_id,data,updated_at').eq('district_id', districtId()).maybeSingle();
  if (error) throw error;
  const local = await db.getSettings();
  if (!data) { if (local && state.profile?.role === 'admin') await pushSettings(local); return; }
  const remoteTime = timestamp(data.updated_at);
  const localTime = timestamp(local?.updatedAt);
  if (data.data && (!local || remoteTime >= localTime)) await db.saveSettings({ ...data.data, id: 'app', updatedAt: data.updated_at }, { skipRemote: true, preserveUpdatedAt: true });
  else if (local && state.profile?.role === 'admin') await pushSettings(local);
}
async function syncRecords() {
  const rows = await remoteRows();
  const remoteMap = new Map(rows.map(row => [`${row.store}:${row.record_id}`, row]));
  for (const store of syncStores) {
    const localRows = await db.getAll(store);
    const localMap = new Map(localRows.map(row => [row.id, row]));
    for (const remote of rows.filter(row => row.store === store)) {
      const local = localMap.get(remote.record_id);
      const remoteTime = timestamp(remote.updated_at || remote.data?.updatedAt);
      const localTime = timestamp(local?.updatedAt);
      if (remote.deleted_at) {
        if (local && remoteTime >= localTime) await db.delete(store, remote.record_id, { skipRemote: true });
      } else if (!local || remoteTime > localTime) {
        await db.put(store, { ...(remote.data || {}), id: remote.record_id, updatedAt: remote.updated_at || remote.data?.updatedAt }, { skipRemote: true, preserveUpdatedAt: true });
      } else if (localTime > remoteTime) await upsertRemoteRecord(store, local);
    }
    const missing = localRows.filter(local => !remoteMap.has(`${store}:${local.id}`));
    if (missing.length) await upsertRemoteRecords(store, missing);
  }
}
export async function syncNow() {
  if (!isReady() || syncPromise) return syncPromise;
  syncPromise = (async () => {
    update({ status: 'syncing', syncing: true, error: '' });
    try { await syncSettings(); await syncRecords(); update({ status: 'online', lastSync: new Date().toISOString(), error: '' }); }
    catch (error) { update({ status: 'error', error: remoteError(error) }); throw error; }
    finally { update({ syncing: false }); syncPromise = null; }
  })();
  return syncPromise;
}
async function afterSession() {
  if (!state.session) { update({ status: state.configured ? 'login-required' : 'offline', profile: null }); return; }
  try {
    update({ status: 'loading', error: '' });
    await fetchProfile();
    if (!state.profile) { update({ status: 'profile-required', error: 'No online member profile is linked to this account.' }); return; }
    await syncNow();
  } catch (error) { update({ status: 'error', error: remoteError(error) }); }
}
export async function configure(settings = {}) {
  currentSettings = settings;
  currentConfig = getOnlineConfig(settings);
  const readyConfig = Boolean(currentConfig.enabled && currentConfig.supabaseUrl && currentConfig.supabaseAnonKey);
  if (!readyConfig) {
    if (authSubscription?.data?.subscription) authSubscription.data.subscription.unsubscribe();
    authSubscription = null; client = null; setRemoteAdapter(null); update({ configured: false, status: 'offline', session: null, profile: null, error: '' }); return snapshot();
  }
  const sameClient = Boolean(client && currentConfig.supabaseUrl === client.__madrasaSupabaseUrl && currentConfig.supabaseAnonKey === client.__madrasaSupabaseAnonKey);
  if (!sameClient) {
    if (authSubscription?.data?.subscription) authSubscription.data.subscription.unsubscribe();
    client = createClient(currentConfig.supabaseUrl, currentConfig.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    client.__madrasaSupabaseUrl = currentConfig.supabaseUrl; client.__madrasaSupabaseAnonKey = currentConfig.supabaseAnonKey;
    authSubscription = client.auth.onAuthStateChange((_event, session) => { state.session = session; setTimeout(() => afterSession(), 0); notify(); });
  }
  setRemoteAdapter(adapter); update({ configured: true, status: 'loading', error: '' });
  const { data, error } = await client.auth.getSession();
  if (error) update({ status: 'error', error: remoteError(error) });
  state.session = data?.session || null; await afterSession(); return snapshot();
}
export async function signUp({ email, password, provinceId, provinceName, districtId: selectedDistrictId, districtName, fullName, phone = '' }) {
  if (!client || !state.configured) throw new Error(t('onlineNotConfigured'));
  const province = normalizeDistrictId(provinceId || provinceName); const district = normalizeDistrictId(selectedDistrictId || districtName); const tenant = tenantKey(province, district);
  if (!province || !district || !tenant) throw new Error(t('provinceDistrictRequired'));
  const { data, error } = await client.auth.signUp({ email: String(email || '').trim().toLowerCase(), password, options: { data: { district_id: tenant, tenant_id: tenant, province_id: province, province_name: String(provinceName || province).trim(), district_id_short: district, district_name: String(districtName || district).trim(), full_name: String(fullName || '').trim(), phone: String(phone || '').trim() } } });
  if (error) throw new Error(friendlyAuthError(error)); state.session = data.session || null;
  if (state.session) await afterSession(); else update({ status: 'email-confirmation', error: '' });
  return { ...snapshot(), user: data.user, needsEmailConfirmation: !data.session };
}
export async function signIn(email, password) {
  if (!client || !state.configured) throw new Error(t('onlineNotConfigured'));
  const { data, error } = await client.auth.signInWithPassword({ email: String(email || '').trim(), password });
  if (error) throw new Error(friendlyAuthError(error)); state.session = data.session; await afterSession(); return snapshot();
}
export async function signOut() { if (client) await client.auth.signOut(); state.session = null; state.profile = null; update({ status: state.configured ? 'login-required' : 'offline', error: '' }); }
export async function inviteMember({ email, memberId, role = 'member' }) {
  if (!isReady() || state.profile?.role !== 'admin') throw new Error('Only an online administrator can invite members.');
  const response = await fetch('/api/invite-member', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken()}` }, body: JSON.stringify({ email, memberId, role, districtId: districtId() }) });
  const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || 'Invitation could not be sent.'); return payload;
}
export async function resetPassword(email) { if (!client) throw new Error('Online database is not configured.'); const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin }); if (error) throw error; }
export function onlineApi() { return { ...snapshot(), configure, listDistricts, signUp, signIn, signOut, inviteMember, resetPassword, syncNow, getConfig: () => ({ ...currentConfig }), canDelete, subscribe: subscribeOnline }; }
setRemoteAdapter(null);
