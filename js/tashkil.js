import { db } from './database.js';
import { t } from './translations.js';
import { esc, attr, formatNumber, percent, printTable } from './utils.js';
import { moduleHeader, toolbar, madrasaName } from './moduleHelpers.js';
import { formationRows, formationTotals } from './staffing.js';

function staffTypeOptions() {
  return [{ value:'teacher', label:t('teacherStaff') }, { value:'administrative', label:t('administrativeStaff') }];
}
function statusOptions(rows) {
  return [...new Set(rows.map(row => row.status).filter(Boolean))].map(value => ({ value, label:t(value, value) }));
}
function rowText(row, madrasas) {
  return [row.staffName, row.employeeId, madrasaName(madrasas, row.madrasaId), row.position, row.subject, row.status].join(' ');
}
function summaryTable(rows, madrasas) {
  const groups = new Map();
  rows.forEach(row => {
    const key = row.madrasaId || '__none__';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  const ordered = madrasas.map(madrasa => [madrasa.id, madrasa.name]).filter(([id]) => groups.has(id));
  if (groups.has('__none__')) ordered.push(['__none__', '—']);
  const body = ordered.map(([id, name]) => {
    const group = groups.get(id) || [];
    const totals = formationTotals(group);
    return `<tr><td>${esc(name)}</td><td>${esc(formatNumber(totals.teachers))}</td><td>${esc(formatNumber(totals.administrative))}</td><td>${esc(formatNumber(totals.approved))}</td><td>${esc(formatNumber(totals.filled))}</td><td>${esc(formatNumber(totals.vacant))}</td><td>${esc(percent(totals.approved ? totals.vacant / totals.approved * 100 : 0))}</td></tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th>${esc(t('madrasa'))}</th><th>${esc(t('teacherStaffing'))}</th><th>${esc(t('administrativeStaffing'))}</th><th>${esc(t('approvedPosts'))}</th><th>${esc(t('filledPosts'))}</th><th>${esc(t('vacantPosts'))}</th><th>${esc(t('vacancyPercent'))}</th></tr></thead><tbody>${body || `<tr><td colspan="7" class="no-data">${esc(t('noData'))}</td></tr>`}</tbody></table></div>`;
}

export async function render(ctx) {
  const [teachers, staff, madrasas, legacy] = await Promise.all(['teachers', 'staff', 'madrasas', 'tashkil'].map(store => db.getAll(store)));
  const rows = formationRows(teachers, staff, legacy);
  const query = String(ctx.params?.q || '').toLocaleLowerCase();
  const type = ctx.params?.staffType || '';
  const madrasa = ctx.params?.madrasa || '';
  const status = ctx.params?.status || '';
  const filtered = rows.filter(row => (!query || rowText(row, madrasas).toLocaleLowerCase().includes(query)) && (!type || row.staffType === type) && (!madrasa || row.madrasaId === madrasa) && (!status || row.status === status));
  const totals = formationTotals(rows);
  const tableRows = filtered.map(row => `<tr data-row-search="${attr(rowText(row, madrasas))}" data-row-type="${attr(row.staffType)}" data-row-madrasa="${attr(row.madrasaId)}" data-row-status="${attr(row.status)}"><td>${esc(t(row.staffType === 'administrative' ? 'administrativeStaff' : 'teacherStaff'))}</td><td><strong>${esc(row.staffName)}</strong><small>${esc(row.employeeId || '')}</small></td><td>${esc(madrasaName(madrasas, row.madrasaId))}</td><td>${esc(row.position || '—')}</td><td>${esc(row.subject || '—')}</td><td>${esc(formatNumber(row.approvedPosts))}</td><td>${esc(formatNumber(row.filledPosts))}</td><td>${esc(formatNumber(row.vacantPosts))}</td><td>${esc(t(row.status, row.status || '—'))}</td></tr>`);
  const statusSelect = statusOptions(rows).map(option => `<option value="${attr(option.value)}" ${option.value === status ? 'selected' : ''}>${esc(option.label)}</option>`).join('');
  return `${moduleHeader('tashkil', t('formationReport'), `<button class="btn outline" data-tashkil-action="print">⎙ ${esc(t('print'))}</button>`)}<div class="kpi-grid"><div class="card kpi-card"><div class="stat-number">${esc(formatNumber(rows.length))}</div><div class="stat-label">${esc(t('overallStaff'))}</div></div><div class="card kpi-card"><div class="stat-number">${esc(formatNumber(totals.teachers))}</div><div class="stat-label">${esc(t('totalTeacherStaff'))}</div></div><div class="card kpi-card"><div class="stat-number">${esc(formatNumber(totals.administrative))}</div><div class="stat-label">${esc(t('totalAdministrativeStaff'))}</div></div><div class="card kpi-card"><div class="stat-number">${esc(formatNumber(totals.approved))}</div><div class="stat-label">${esc(t('approvedPosts'))}</div></div><div class="card kpi-card"><div class="stat-number">${esc(formatNumber(totals.filled))}</div><div class="stat-label">${esc(t('filledPosts'))}</div></div><div class="card kpi-card"><div class="stat-number">${esc(formatNumber(totals.vacant))}</div><div class="stat-label">${esc(t('vacantPosts'))}</div></div></div><section class="card"><div class="card-head"><div><h2>${esc(t('formationReport'))}</h2><p>${esc(t('tashkilSummary'))}</p></div></div>${toolbar(t('search'), `<select class="select-control" data-tashkil-type><option value="">${esc(t('staffType'))}</option>${staffTypeOptions().map(option => `<option value="${attr(option.value)}" ${option.value === type ? 'selected' : ''}>${esc(option.label)}</option>`).join('')}</select><select class="select-control" data-tashkil-madrasa><option value="">${esc(t('allMadrasas'))}</option>${madrasaSelectOptionsForRows(madrasas, madrasa)}</select><select class="select-control" data-tashkil-status><option value="">${esc(t('status'))}</option>${statusSelect}</select>`)}<div class="table-wrap"><table class="data-table"><thead><tr><th>${esc(t('staffType'))}</th><th>${esc(t('staffName'))}</th><th>${esc(t('madrasa'))}</th><th>${esc(t('position'))}</th><th>${esc(t('subject'))}</th><th>${esc(t('approvedPosts'))}</th><th>${esc(t('filledPosts'))}</th><th>${esc(t('vacantPosts'))}</th><th>${esc(t('status'))}</th></tr></thead><tbody>${tableRows.join('') || `<tr><td colspan="9" class="no-data">${esc(t('noStaff'))}</td></tr>`}</tbody></table></div></section><section class="card" style="margin-top:17px"><div class="card-head"><div><h2>${esc(t('tashkilSummary'))}</h2><p>${esc(t('byMadrasa'))}</p></div></div>${summaryTable(rows, madrasas)}</section>`;
}
function madrasaSelectOptionsForRows(madrasas, selected) {
  return madrasas.map(row => `<option value="${attr(row.id)}" ${row.id === selected ? 'selected' : ''}>${esc(row.name || row.madrasaName || '—')}</option>`).join('');
}

export async function bind(ctx, root) {
  const filter = () => {
    const query = (root.querySelector('[data-module-search]')?.value || '').toLocaleLowerCase();
    const type = root.querySelector('[data-tashkil-type]')?.value || '';
    const madrasa = root.querySelector('[data-tashkil-madrasa]')?.value || '';
    const status = root.querySelector('[data-tashkil-status]')?.value || '';
    root.querySelectorAll('[data-row-search]').forEach(row => {
      row.style.display = (!query || row.dataset.rowSearch.toLocaleLowerCase().includes(query)) && (!type || row.dataset.rowType === type) && (!madrasa || row.dataset.rowMadrasa === madrasa) && (!status || row.dataset.rowStatus === status) ? '' : 'none';
    });
  };
  root.querySelector('[data-module-search]')?.addEventListener('input', filter);
  root.querySelector('[data-tashkil-type]')?.addEventListener('change', filter);
  root.querySelector('[data-tashkil-madrasa]')?.addEventListener('change', filter);
  root.querySelector('[data-tashkil-status]')?.addEventListener('change', filter);
  root.addEventListener('click', async event => {
    if (!event.target.closest('[data-tashkil-action="print"]')) return;
    const [teachers, staff, madrasas, legacy] = await Promise.all(['teachers', 'staff', 'madrasas', 'tashkil'].map(store => db.getAll(store)));
    const rows = formationRows(teachers, staff, legacy);
    const totals = formationTotals(rows);
    const body = `<div class="print-section"><h3>${esc(t('tashkilSummary'))}</h3>${printTable([t('overallStaff'), t('totalTeacherStaff'), t('totalAdministrativeStaff'), t('approvedPosts'), t('filledPosts'), t('vacantPosts')], [[rows.length, totals.teachers, totals.administrative, totals.approved, totals.filled, totals.vacant]])}</div><div class="print-section"><h3>${esc(t('formationReport'))}</h3>${printTable([t('staffType'), t('staffName'), t('madrasa'), t('position'), t('subject'), t('approvedPosts'), t('filledPosts'), t('vacantPosts'), t('status')], rows.map(row => [t(row.staffType === 'administrative' ? 'administrativeStaff' : 'teacherStaff'), row.staffName, madrasaName(madrasas, row.madrasaId), row.position, row.subject || '—', row.approvedPosts, row.filledPosts, row.vacantPosts, t(row.status, row.status)]))}</div>`;
    return ctx.printOfficial(t('tashkil'), body);
  });
}
