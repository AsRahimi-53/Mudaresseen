import { createClient } from '@supabase/supabase-js';
import { t } from './translations.js';
import { db, STORES, setRemoteAdapter, setLocalOwner } from './database.js';
import { trustedOnlineConfig, stripLockedSettings } from './trustedConfig.js';

const syncStores = STORES.filter(store => store !== 'settings');
let client = null;
let authSubscription = null;
let currentConfig = {};
let currentSettings = null;
let syncPromise = null;
const listeners = new Set();
const state = { configured: false, status: 'offline', session: null, profile: null, isSuperAdmin: false, error: '', lastSync: null, syncing: false, ownerVerified: false };

function notify() { listeners.forEach(listener => { try { listener(snapshot()); } catch (error) { console.warn('Online state listener failed', error); } }); }
function update(patch) { Object.assign(state, patch); notify(); }
function snapshot() { return { ...state, config: { enabled: Boolean(currentConfig.enabled) }, client }; }
function definedConfig(source = {}) { return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined && value !== null && value !== '')); }
export function normalizeDistrictId(value) { return String(value || '').trim().toLocaleLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-'); }
export function tenantKey(provinceId, districtId) { return `${normalizeDistrictId(provinceId)}:${normalizeDistrictId(districtId)}`.replace(/^:+|:+$/g, ''); }
// Connection settings are trusted deployment values only; stored settings are ignored on purpose.
export function getOnlineConfig() {
  const trusted = trustedOnlineConfig();
  return { enabled: trusted.enabled, supabaseUrl: trusted.supabaseUrl, supabaseAnonKey: trusted.supabaseAnonKey };
}
export function onlineSnapshot() { return snapshot(); }
export function subscribeOnline(listener) { listeners.add(listener); return () => listeners.delete(listener); }
export function isOnlineConfigured() { return Boolean(state.configured); }
export function canDelete() { return !(state.configured && state.session && state.profile?.role !== 'admin'); }
function districtId() { return state.profile?.tenant_id || state.profile?.district_id || ''; }
function accessToken() { return state.session?.access_token || ''; }
// Remote reads/writes are allowed only after the server-side profile AND the local-data owner were verified.
function isReady() { return Boolean(client && state.session && districtId() && state.ownerVerified); }
function remoteError(error) { return error?.message || error?.details || error?.hint || t('onlineRequestFailed'); }
function friendlyAuthError(error) {
  const message = remoteError(error); const lower = message.toLowerCase();
  if (lower.includes('already registered') || lower.includes('already exists')) return t('emailAlreadyRegistered');
  if (lower.includes('invalid login credentials') || lower.includes('invalid credentials')) return t('invalidLogin');
  if (lower.includes('province and district') || lower.includes('not registered') || lower.includes('database error saving new user')) return t('signupDistrictNotAllowed');
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
  const { error } = await client.from('district_settings').upsert({ district_id: districtId(), data: stripLockedSettings(item), updated_at: item.updatedAt || new Date().toISOString(), updated_by: state.session.user.id }, { onConflict: 'district_id' });
  if (error) throw error;
}
const adapter = { onPut: upsertRemoteRecord, onBulkPut: upsertRemoteRecords, onDelete: tombstone, onClear: clearRemoteStore };

async function remoteRows() {
  const { data, error } = await client.from('app_records').select('district_id,store,record_id,data,updated_at,deleted_at').eq('district_id', districtId()).range(0, 9999);
  if (error) throw error;
  return (data || []).filter(row => row.district_id === districtId());
}
async function syncSettings() {
  if (!isReady()) return;
  const { data, error } = await client.from('district_settings').select('district_id,data,updated_at').eq('district_id', districtId()).maybeSingle();
  if (error) throw error;
  const local = await db.getSettings();
  if (!data) { if (local && state.profile?.role === 'admin') await pushSettings(local); return; }
  const remoteTime = timestamp(data.updated_at);
  const localTime = timestamp(local?.updatedAt);
  if (data.data && (!local || remoteTime >= localTime)) await db.saveSettings({ ...stripLockedSettings(data.data), id: 'app', updatedAt: data.updated_at }, { skipRemote: true, preserveUpdatedAt: true });
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
// The Super Admin flag is decided by the database (is_super_admin()) for the
// current session on every login/refresh and lives only in memory.
async function checkSuperAdmin() {
  if (!client || !state.session) { state.isSuperAdmin = false; return false; }
  try { const { data, error } = await client.rpc('is_super_admin'); state.isSuperAdmin = !error && data === true; }
  catch { state.isSuperAdmin = false; }
  return state.isSuperAdmin;
}
// ---- Local data ownership (tenant isolation on this device) ----
// A local database may only be reused by an account of the SAME district (tenant taken from the
// server-side profile). Foreign or unknown local data is archived on this device (never uploaded,
// never deleted in the cloud) and replaced by a clean copy before any synchronisation can happen.
const OWNER_KEY = "madrasa:local-owner";
function readOwner() { try { const value = JSON.parse(localStorage.getItem(OWNER_KEY) || "null"); return value && typeof value.tenant === "string" && value.tenant ? value : null; } catch { return null; } }
function clearOwner() { try { localStorage.removeItem(OWNER_KEY); } catch { /* storage unavailable */ } setLocalOwner(null); }
function sameName(a, b) { const x = normalizeDistrictId(a); const y = normalizeDistrictId(b); return Boolean(x && y && x === y); }
async function enforceLocalOwnership() {
  state.ownerVerified = false;
  const tenant = districtId(); const userId = state.session?.user?.id || "";
  if (!tenant || !userId || !state.profile) return false;
  const previous = readOwner();
  let reuse = Boolean(previous && previous.tenant === tenant);
  if (!reuse && !previous) {
    // Legacy / unknown owner: reuse only when the local settings name exactly this district (or nothing is stored).
    const local = await db.getSettings();
    reuse = !(await db.hasData()) || Boolean(local && sameName(local.province, state.profile.province_name) && sameName(local.district, state.profile.district_name));
  }
  if (!reuse) await db.resetLocalData({ archive: true, reason: `owner-mismatch:${previous?.tenant || "unknown"}->${tenant}` });
  const owner = { tenant, userId, province: state.profile.province_name || "", district: state.profile.district_name || "" };
  try { localStorage.setItem(OWNER_KEY, JSON.stringify(owner)); } catch { /* storage unavailable */ }
  setLocalOwner(owner); state.ownerVerified = true; return true;
}
async function seedSettingsIfMissing() {
  if (!state.ownerVerified || !state.profile) return;
  if (await db.getSettings()) return;
  await db.saveSettings({ id: "app", province: state.profile.province_name || "", district: state.profile.district_name || "", createdAt: new Date().toISOString() }, { skipRemote: true });
}
let deniedMessage = "";
const PENDING_MESSAGE = "ستاسو حساب جوړ شو، خو د ولسوالۍ د مدیر تایید ته اړتیا لري. وروسته له تایید بیا ننوځئ.";
const REJECTED_MESSAGE = "ستاسو غوښتنه د ولسوالۍ مدیر رد کړې ده.";
const FULL_MESSAGE = "د دې ولسوالۍ د حسابونو حد ډک شوی دی. له خپل ولسوالۍ مدیر سره اړیکه ونیسئ.";
async function runAfterSession() {
  state.ownerVerified = false;
  if (!state.session) { update({ status: state.configured ? "login-required" : "offline", profile: null, isSuperAdmin: false, ownerVerified: false }); return; }
  try {
    update({ status: "loading", error: "", isSuperAdmin: false });
    await checkSuperAdmin();
    await fetchProfile();
    if (!state.profile) {
      // An account without a district profile must never see cached data of another account.
      await db.resetLocalData({ archive: true, reason: "no-district-profile" }); clearOwner();
      if (state.isSuperAdmin) { update({ status: "superadmin", error: "" }); return; }
      update({ status: "profile-required", error: "No online member profile is linked to this account." }); return;
    }
    if ((state.profile.status || "approved") !== "approved") {
      // Pending / rejected accounts get no district data: clear the device and sign out.
      deniedMessage = state.profile.status === "rejected" ? REJECTED_MESSAGE : PENDING_MESSAGE;
      await db.resetLocalData({ archive: true, reason: "not-approved" }); clearOwner();
      try { if (client) await client.auth.signOut(); } catch { /* ignore */ }
      state.session = null; state.profile = null;
      update({ status: state.configured ? "login-required" : "offline", error: "", isSuperAdmin: false, ownerVerified: false });
      return;
    }
    await enforceLocalOwnership();
    await syncNow();
    await seedSettingsIfMissing();
  } catch (error) { update({ status: "error", error: remoteError(error) }); }
}
// Session changes are processed one at a time so ownership checks and synchronisation never overlap.
let sessionQueue = Promise.resolve();
function afterSession() { const run = sessionQueue.then(runAfterSession, runAfterSession); sessionQueue = run.catch(() => {}); return run; }
export async function configure(settings = {}) {
  currentSettings = settings;
  currentConfig = getOnlineConfig(settings);
  const readyConfig = Boolean(currentConfig.enabled && currentConfig.supabaseUrl && currentConfig.supabaseAnonKey);
  if (!readyConfig) {
    if (authSubscription?.data?.subscription) authSubscription.data.subscription.unsubscribe();
    authSubscription = null; client = null; setRemoteAdapter(null); update({ configured: false, status: 'offline', session: null, profile: null, error: '', ownerVerified: false }); return snapshot();
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
  deniedMessage = ""; let capacity = null;
  try { const result = await client.rpc("district_has_capacity", { p_tenant: tenant }); if (!result.error) capacity = result.data; } catch { /* pre-check unavailable */ }
  if (capacity === false) throw new Error(FULL_MESSAGE);
  const { data, error } = await client.auth.signUp({ email: String(email || '').trim().toLowerCase(), password, options: { data: { district_id: tenant, tenant_id: tenant, province_id: province, province_name: String(provinceName || province).trim(), district_id_short: district, district_name: String(districtName || district).trim(), full_name: String(fullName || '').trim(), phone: String(phone || '').trim() } } });
  if (error) throw new Error(friendlyAuthError(error)); state.session = data.session || null;
  if (state.session) { await afterSession(); if (deniedMessage) { const message = deniedMessage; deniedMessage = ""; throw new Error(message); } } else update({ status: 'email-confirmation', error: '' });
  return { ...snapshot(), user: data.user, needsEmailConfirmation: !data.session };
}
export async function signIn(email, password) {
  if (!client || !state.configured) throw new Error(t('onlineNotConfigured'));
  deniedMessage = "";
  const { data, error } = await client.auth.signInWithPassword({ email: String(email || '').trim(), password });
  if (error) throw new Error(friendlyAuthError(error)); state.session = data.session; await afterSession();
  if (deniedMessage) { const message = deniedMessage; deniedMessage = ""; throw new Error(message); }
  return snapshot();
}
export async function signOut() {
  const hadSession = Boolean(state.session); let flushed = false;
  // Push unsynced changes first; if that is impossible the local data is archived (not lost) before it is cleared.
  try { if (isReady()) { await syncNow(); flushed = true; } } catch (error) { console.warn("Final sync before sign-out failed; local data will be archived", error); }
  state.isSuperAdmin = false; state.ownerVerified = false;
  try { if (client) await client.auth.signOut(); }
  finally {
    state.session = null; state.profile = null;
    if (hadSession) { try { await db.resetLocalData({ archive: !flushed, reason: "sign-out" }); clearOwner(); } catch (error) { console.warn("Local data could not be cleared at sign-out", error); } }
    update({ status: state.configured ? "login-required" : "offline", error: "", isSuperAdmin: false, ownerVerified: false });
  }
}
export async function inviteMember({ email, memberId, role = 'member' }) {
  if (!isReady() || state.profile?.role !== 'admin') throw new Error('Only an online administrator can invite members.');
  const response = await fetch('/api/invite-member', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken()}` }, body: JSON.stringify({ email, memberId, role, districtId: districtId() }) });
  const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || 'Invitation could not be sent.'); return payload;
}
export async function superAdminRequest(action, params = {}) {
  let token = '';
  if (client) { const { data } = await client.auth.getSession(); token = data?.session?.access_token || ''; }
  if (!token) { const error = new Error('Authentication is required.'); error.status = 401; throw error; }
  const response = await fetch('/api/superadmin', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action, params }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(payload.error || 'Request failed.'); error.status = response.status; throw error; }
  return payload.data;
}
export async function resetPassword(email) { if (!client) throw new Error('Online database is not configured.'); const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin }); if (error) throw error; }
// District administrator: seats used and pending sign-ups of the administrator's own district (server-enforced).
export async function memberApprovals() {
  if (!client || !state.session) throw new Error(t('onlineNotConfigured'));
  const { data, error } = await client.rpc("my_district_members");
  if (error) throw new Error(remoteError(error));
  return data || { pending: [], used: 0, max_users: 0 };
}
export async function reviewMember(userId, approve) {
  if (!client || !state.session) throw new Error(t('onlineNotConfigured'));
  const { error } = await client.rpc("review_member", { p_user_id: userId, p_approve: Boolean(approve) });
  if (error) throw new Error(remoteError(error));
}
export function onlineApi() { return { ...snapshot(), memberApprovals, reviewMember, configure, listDistricts, signUp, signIn, signOut, inviteMember, resetPassword, syncNow, superAdminRequest, getConfig: () => ({ enabled: Boolean(currentConfig.enabled) }), canDelete, subscribe: subscribeOnline }; }
setRemoteAdapter(null);
