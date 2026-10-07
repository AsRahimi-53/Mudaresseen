import { db, STORES } from './database.js';
import { downloadText, formatDateTime, todayISO, uid } from './utils.js';
import { t } from './translations.js';

export async function buildBackup() { return { schema: 'madrasa-pd-backup', version: 1, createdAt: new Date().toISOString(), stores: STORES, data: await db.getAllData() }; }
export async function createBackup() { const backup = await buildBackup(); const filename = `madrasa-pd-backup-${todayISO()}.json`; downloadText(JSON.stringify(backup, null, 2), filename, 'application/json;charset=utf-8'); return backup; }
export function validateBackup(payload) { if (!payload || payload.schema !== 'madrasa-pd-backup' || !payload.data) return { valid: false, reason: 'Invalid backup schema.' }; const available = STORES.filter(store => Array.isArray(payload.data[store])); if (!available.includes('settings')) return { valid: false, reason: 'Settings store is missing.' }; const bad = available.some(store => payload.data[store].some(record => !record || typeof record !== 'object' || !record.id)); return bad ? { valid: false, reason: 'One or more records are invalid.' } : { valid: true, stores: available }; }
export async function restoreBackup(file, confirmFn) { const text = await file.text(); let payload; try { payload = JSON.parse(text); } catch { throw new Error('Backup file is not valid JSON.'); } const result = validateBackup(payload); if (!result.valid) throw new Error(result.reason); const ok = await confirmFn(t('restoreWarning')); if (!ok) return false; await db.replaceAllData(payload.data); return true; }
export function backupSummary(data) { return STORES.map(store => ({ store, count: Array.isArray(data?.[store]) ? data[store].length : 0 })); }
