import { t, getLanguage } from './translations.js';

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// All user-facing calendar dates use Afghanistan's Solar Hijri (Jalali) calendar.
// Stored date-only values use the unambiguous YYYY-MM-DD Solar Hijri form.
const JALALI_BREAKS = [-61,9,38,199,426,686,756,818,1111,1181,1210,1635,2060,2097,2192,2262,2324,2394,2456,3178];
const div = (a, b) => Math.floor(a / b);
const mod = (a, b) => a - Math.floor(a / b) * b;
function jalaliCalendar(year) {
  const bl = JALALI_BREAKS.length;
  const gy = year + 621;
  let leapJ = -14;
  let jp = JALALI_BREAKS[0];
  let jm = 0;
  let jump = 0;
  let i;
  if (year < jp || year >= JALALI_BREAKS[bl - 1]) return null;
  for (i = 1; i < bl; i += 1) {
    jm = JALALI_BREAKS[i];
    jump = jm - jp;
    if (year < jm) break;
    leapJ += div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = year - jp;
  leapJ += div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}
function gregorianToSolar(year, month, day) {
  const gDays = [0,31,59,90,120,151,181,212,243,273,304,334];
  const gy2 = month > 2 ? year + 1 : year;
  let days = 355666 + 365 * year + div(gy2 + 3, 4) - div(gy2 + 99, 100) + div(gy2 + 399, 400) + day + gDays[month - 1];
  let jy = -1595 + 33 * div(days, 12053);
  days %= 12053;
  jy += 4 * div(days, 1461);
  days %= 1461;
  if (days > 365) { jy += div(days - 1, 365); days = (days - 1) % 365; }
  const jm = days < 186 ? 1 + div(days, 31) : 7 + div(days - 186, 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return [jy, jm, jd];
}
function solarToGregorian(year, month, day) {
  year += 1595;
  let days = -355668 + 365 * year + div(year, 33) * 8 + div(mod(year, 33) + 3, 4) + day + (month < 7 ? (month - 1) * 31 : (month - 7) * 30 + 186);
  let gy = 400 * div(days, 146097);
  days %= 146097;
  if (days > 36524) { gy += 100 * div(--days, 36524); days %= 36524; if (days >= 365) days += 1; }
  gy += 4 * div(days, 1461);
  days %= 1461;
  if (days > 365) { gy += div(days - 1, 365); days = (days - 1) % 365; }
  let gd = days + 1;
  const leap = (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0;
  const monthDays = [0,31,leap ? 29 : 28,31,30,31,30,31,31,30,31,30,31];
  let gm = 1;
  while (gd > monthDays[gm]) { gd -= monthDays[gm]; gm += 1; }
  return [gy, gm, gd];
}
function latinDigits(value) { return String(value ?? '').replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))); }
function pad(value) { return String(value).padStart(2, '0'); }
function partsFrom(value) {
  if (value instanceof Date) return [value.getFullYear(), value.getMonth() + 1, value.getDate()];
  const raw = latinDigits(value).trim().replace(/\//g, '-').split('T')[0];
  const match = /^(\d{1,4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  return match ? match.slice(1).map(Number) : null;
}
function validSolarParts(parts) {
  if (!parts) return false;
  const [year, month, day] = parts;
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const max = month <= 6 ? 31 : month <= 11 ? 30 : (jalaliCalendar(year)?.leap === 0 ? 30 : 29);
  return day <= max;
}
export function toSolarDate(value) {
  const parts = partsFrom(value);
  if (!parts) return '';
  const [year, month, day] = parts;
  if (year >= 1700) {
    const solar = gregorianToSolar(year, month, day);
    return `${solar[0]}-${pad(solar[1])}-${pad(solar[2])}`;
  }
  if (!validSolarParts(parts)) return '';
  return `${year}-${pad(month)}-${pad(day)}`;
}
export function normalizeSolarDate(value) { return toSolarDate(value); }
export function isSolarDate(value) { return Boolean(toSolarDate(value)); }
export function solarDateCompare(a, b) { return toSolarDate(a).localeCompare(toSolarDate(b)); }
export const todayISO = () => toSolarDate(new Date());
export const nowISO = () => new Date().toISOString();
export const uid = (prefix = 'id') => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
export function esc(value) { return String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }
export function attr(value) { return esc(value).replace(/\n/g, ' '); }
export function formatDate(value) {
  const solar = toSolarDate(value);
  if (!solar) return value ? esc(value) : '—';
  const [year, month, day] = solar.split('-').map(Number);
  const monthKey = `solarMonth${month}`;
  const nf = new Intl.NumberFormat(getLanguage() === 'ps' ? 'ps-AF' : 'fa-AF', { useGrouping: false });
  return `${nf.format(day)} ${t(monthKey, String(month))} ${nf.format(year)}`;
}
export function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return esc(value);
  const time = new Intl.DateTimeFormat(getLanguage() === 'ps' ? 'ps-AF' : 'fa-AF', { hour: '2-digit', minute: '2-digit' }).format(date);
  return `${formatDate(date)} · ${time}`;
}
export function formatNumber(value) { const n = Number(value || 0); return new Intl.NumberFormat(getLanguage() === 'ps' ? 'ps-AF' : 'fa-AF').format(n); }
export function percent(value, digits = 0) { const n = Number(value || 0); return `${Number.isFinite(n) ? n.toFixed(digits) : '0'}%`; }
export function safeNumber(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
export function sum(rows, key) { return rows.reduce((total, row) => total + safeNumber(typeof key === 'function' ? key(row) : row?.[key]), 0); }
export function average(rows, key) { return rows.length ? sum(rows, key) / rows.length : 0; }
export function studentCount(row) { const raw = row?.count ?? row?.studentCount ?? row?.value; const n = Number(raw); return Number.isFinite(n) && n >= 0 ? n : 1; }
export function totalStudentCount(rows = []) { return rows.reduce((total, row) => total + studentCount(row), 0); }
export function groupCount(rows, keyFn) { return rows.reduce((acc, row) => { const key = keyFn(row) || '—'; acc[key] = (acc[key] || 0) + 1; return acc; }, {}); }
export function sortByDate(rows, key = 'date', desc = true) { return [...rows].sort((a, b) => { const av = a?.[key] || ''; const bv = b?.[key] || ''; return desc ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv)); }); }
export function initials(name = '') { return name.trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase() || '•'; }
export function getStatusTone(status = '') { const s = String(status).toLowerCase(); if (['active','completed','approved','prepared','good','excellent','filled','in progress','inprogress'].some(x => s.includes(x))) return s.includes('excellent') ? 'teal' : 'green'; if (['pending','planned','draft','average','submitted','reviewed','vacant'].some(x => s.includes(x))) return 'amber'; if (['delayed','cancelled','rejected','inactive','weak','on leave'].some(x => s.includes(x))) return 'red'; return 'gray'; }
export function badge(text, tone = getStatusTone(text)) { return `<span class="badge ${tone}">${esc(text || '—')}</span>`; }
export function actionButtons(id, options = {}) { const out = []; if (options.view !== false) out.push(`<button class="table-action" data-action="view" data-id="${attr(id)}" title="${esc(t('view'))}">↗</button>`); if (options.edit !== false) out.push(`<button class="table-action" data-action="edit" data-id="${attr(id)}" title="${esc(t('edit'))}">✎</button>`); if (options.delete !== false) out.push(`<button class="table-action danger" data-action="delete" data-id="${attr(id)}" title="${esc(t('delete'))}">⌫</button>`); if (options.store && options.print !== false) out.push(`<button class="table-action" data-record-print data-store="${attr(options.store)}" data-id="${attr(id)}" title="${esc(t('print'))}">⎙</button>`); return `<div class="table-actions">${out.join('')}</div>`; }
export function emptyState(title, description = '', action = '') { return `<div class="empty-state"><div class="empty-icon">⌁</div><h3>${esc(title)}</h3>${description ? `<p>${esc(description)}</p>` : ''}${action}</div>`; }
export function optionList(options, selected = '', includeBlank = true) { const blank = includeBlank ? `<option value="">${esc(t('select'))}</option>` : ''; return blank + options.map(o => { const value = typeof o === 'string' ? o : o.value; const label = typeof o === 'string' ? o : o.label; return `<option value="${attr(value)}" ${String(value) === String(selected ?? '') ? 'selected' : ''}>${esc(label)}</option>`; }).join(''); }
export function renderSelect(name, options, selected = '', attrs = '', includeBlank = true) { return `<select name="${attr(name)}" ${attrs}>${optionList(options, selected, includeBlank)}</select>`; }
export function readForm(form) { const data = {}; [...form.elements].forEach(el => { if (!el.name || el.disabled) return; if (el.type === 'file') return; if (el.type === 'checkbox') data[el.name] = el.checked; else if (el.type === 'radio') { if (el.checked) data[el.name] = el.value; } else data[el.name] = el.value.trim(); }); return data; }
export function setForm(form, data = {}) { [...form.elements].forEach(el => { if (!el.name || data[el.name] === undefined) return; if (el.type === 'checkbox') el.checked = Boolean(data[el.name]); else if (el.type === 'radio') el.checked = el.value === data[el.name]; else el.value = data[el.name] ?? ''; }); }
export function formValue(form, name) { return form?.elements?.[name]?.value || ''; }
export async function compressImage(file, maxSize = 900, quality = .78) {
  if (!file) return '';
  if (!file.type.startsWith('image/')) throw new Error('Selected file is not an image.');
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => { const img = new Image(); img.onload = () => { const scale = Math.min(1, maxSize / Math.max(img.width, img.height)); const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(img.width * scale)); canvas.height = Math.max(1, Math.round(img.height * scale)); const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, canvas.width, canvas.height); resolve(canvas.toDataURL('image/jpeg', quality)); }; img.onerror = () => reject(new Error('Could not read image.')); img.src = reader.result; }; reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
}
export function downloadBlob(blob, filename) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); }
export function downloadText(text, filename, mime = 'text/plain;charset=utf-8') { downloadBlob(new Blob([text], { type: mime }), filename); }
export function slug(text = 'file') { return text.toString().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/(^-|-$)/g, '') || 'file'; }
export function monthName(month) { return t(`solarMonth${Math.max(1, Number(month))}`); }
export function calculateQuality(pct, ranges) { const value = safeNumber(pct); const list = Array.isArray(ranges) ? ranges : []; const found = list.find(r => value >= safeNumber(r.min) && value <= safeNumber(r.max)); return found?.label || (value >= 90 ? t('excellent') : value >= 75 ? t('good') : value >= 50 ? t('average') : t('weak')); }
export function normalize(text = '') { return String(text).toLocaleLowerCase().normalize('NFKD'); }
export function matchesSearch(row, query, fields = []) { const q = normalize(query); if (!q) return true; return fields.some(field => normalize(row?.[field]).includes(q)); }
export function todayLabel() { const weekday = new Intl.DateTimeFormat(getLanguage() === 'ps' ? 'ps-AF' : 'fa-AF', { weekday: 'long' }).format(new Date()); return `${weekday} · ${formatDate(todayISO())}`; }
export function escapeCsv(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
export function officialDocument(settings = {}, title, body, options = {}) {
  const logo = settings.logo ? `<img class="print-logo" src="${attr(settings.logo)}" alt="">` : `<div class="print-logo-fallback">✦</div>`;
  const reportNo = options.reportNo || `MDPD-${todayISO().slice(0,4)}-${String(Date.now()).slice(-5)}`;
  return `<article class="print-document"><header class="print-header"><div>${logo}</div><div class="print-org"><strong>${esc(settings.province || '')} — ${esc(settings.district || '')}</strong><span>${esc(settings.department || '')} ${settings.section ? `· ${esc(settings.section)}` : ''}</span><span>${esc(settings.officeAddress || '')}${settings.officePhone ? ` · ${esc(settings.officePhone)}` : ''}</span></div><div></div></header><h1 class="print-title">${esc(title)}</h1><div class="print-meta"><span>${esc(t('reportNumber'))}: ${esc(reportNo)}</span><span>${esc(t('generatedOn'))}: ${esc(formatDate(todayISO()))}</span><span>${esc(t('academicYear'))}: ${esc(settings.academicYear || '—')}</span></div>${body}<div class="print-signatures"><div>${esc(t('preparedBy'))}<br><br></div><div>${esc(t('observerSignature'))}<br><br></div><div>${esc(t('approvedStatus'))}<br><br></div></div><footer class="print-footer"><span>${esc(t('officialDocument'))} · ${esc(settings.department || '')}</span><span>${esc(t('page'))} 1</span></footer></article>`;
}
export function kvTable(items = []) { return `<dl class="print-kv">${items.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value || '—')}</dd></div>`).join('')}</dl>`; }
export function printTable(headers, rows) { return `<table class="print-table"><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(row => `<tr>${row.map(cell => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}">—</td></tr>`}</tbody></table>`; }
