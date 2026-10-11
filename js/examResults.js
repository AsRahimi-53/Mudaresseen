import { db } from './database.js';
import { t } from './translations.js';
import { esc, attr, formatDate, formatNumber, badge, actionButtons, printTable, todayISO } from './utils.js';
import { moduleHeader, toolbar, tableHtml, openEntityForm, openRecordDetails, removeEntity, madrasaSelectOptions, madrasaName, memberSelectOptions } from './moduleHelpers.js';

const EXAMS = ['midterm', 'term1', 'term2', 'final', 'makeup'].map(k => `examType_${k}`);
const STATUSES = ['received', 'underReview', 'approved', 'rejected', 'correction'].map(k => `resultStatus_${k}`);
const TONES = { resultStatus_received: 'blue', resultStatus_underReview: 'amber', resultStatus_approved: 'green', resultStatus_rejected: 'red', resultStatus_correction: 'amber' };
const options = keys => () => keys.map(k => ({ value: k, label: t(k) }));

function fields(madrasas, members) {
  return [
    { type: 'section', label: 'examResults' },
    { key: 'madrasaId', label: 'madrasa', type: 'select', options: () => madrasaSelectOptions(madrasas), required: true },
    { key: 'academicYear', label: 'academicYear', required: true },
    { key: 'examType', label: 'examType', type: 'select', options: options(EXAMS), required: true },
    { key: 'className', label: 'class', hint: 'examClassHint' },
    { key: 'resultStatus', label: 'resultStatus', type: 'select', options: options(STATUSES), default: 'resultStatus_received', required: true },
    { key: 'tablesCount', label: 'resultTablesCount', type: 'number', min: 0 },
    { key: 'receivedDate', label: 'receivedDate', type: 'date' },
    { key: 'reviewedDate', label: 'reviewedDate', type: 'date' },
    { key: 'reviewerId', label: 'reviewer', type: 'select', options: () => memberSelectOptions(members) },
    { key: 'rejectionReason', label: 'rejectionReason', type: 'textarea', span: 2 },
    { key: 'notes', label: 'notes', type: 'textarea', span: 2 }
  ];
}

export async function render(ctx) {
  const [records, madrasas, members] = await Promise.all(['examResults', 'madrasas', 'members'].map(s => db.getAll(s)));
  const hasYear = Object.prototype.hasOwnProperty.call(ctx.params || {}, 'year');
  const year = hasYear ? String(ctx.params.year || '') : String(ctx.settings?.academicYear || '');
  const type = ctx.params?.type || '', status = ctx.params?.status || '', madrasaSel = ctx.params?.madrasa || '';
  const scope = records.filter(r => (!year || String(r.academicYear) === year) && (!type || r.examType === type) && (!madrasaSel || r.madrasaId === madrasaSel));
  const filtered = scope.filter(r => !status || r.resultStatus === status);
  const targets = madrasaSel ? madrasas.filter(m => m.id === madrasaSel) : madrasas;
  const got = new Set(scope.map(r => r.madrasaId));
  const missing = targets.filter(m => !got.has(m.id));
  const count = key => scope.filter(r => r.resultStatus === key).length;
  const kpi = (label, value, extra = '') => `<div class="card kpi-card"><div class="stat-number">${esc(formatNumber(value))}</div><div class="stat-label">${esc(label)}</div>${extra}</div>`;
  const rows = filtered.slice().sort((a, b) => String(b.receivedDate || '').localeCompare(String(a.receivedDate || ''))).map(r => `<tr data-row-search="${attr([madrasaName(madrasas, r.madrasaId), r.className, r.notes].join(' '))}"><td><strong>${esc(madrasaName(madrasas, r.madrasaId))}</strong></td><td>${esc(t(r.examType, r.examType || '—'))}</td><td>${esc(r.academicYear || '—')}</td><td>${esc(r.className || t('allClasses'))}</td><td>${badge(t(r.resultStatus, r.resultStatus || '—'), TONES[r.resultStatus] || 'gray')}</td><td>${esc(formatDate(r.receivedDate))}</td><td>${esc(formatDate(r.reviewedDate))}</td><td>${actionButtons(r.id, { store: 'examResults' })}</td></tr>`);
  const actions = `<button class="btn primary" data-exam-action="add">＋ ${esc(t('addExamResult'))}</button><button class="btn outline" data-exam-action="print">⎙ ${esc(t('print'))}</button><button class="btn outline" data-exam-action="export">⇩ ${esc(t('exportExcel'))}</button>`;
  const missingCard = madrasas.length ? `<section class="card" style="margin-bottom:17px"><div class="card-head"><div><h2>${esc(t('resultsNotReceived'))}</h2><p>${esc(formatNumber(missing.length))} / ${esc(formatNumber(targets.length))}</p></div></div><div class="card-body">${missing.length ? `<div class="choice-row">${missing.map(m => `<button type="button" class="btn outline small" data-exam-quick="${attr(m.id)}">＋ ${esc(m.name || m.madrasaName)}</button>`).join('')}</div>` : `<p class="muted" style="margin:0">${esc(t('allResultsReceived'))}</p>`}</div></section>` : '';
  return `${moduleHeader('examResults', t('examResultsIntro'), actions)}<div class="kpi-grid">${kpi(t('resultsNotReceived'), missing.length)}${kpi(t('resultStatus_received'), count('resultStatus_received'))}${kpi(t('resultStatus_underReview'), count('resultStatus_underReview'))}${kpi(t('resultStatus_approved'), count('resultStatus_approved'))}${kpi(t('resultStatus_rejected'), count('resultStatus_rejected'))}${kpi(t('resultStatus_correction'), count('resultStatus_correction'))}</div>${missingCard}<section class="card">${toolbar(t('search'), `<input class="select-control" id="exam-year" value="${attr(year)}" placeholder="${attr(t('academicYear'))}"><select class="select-control" id="exam-type"><option value="">${esc(t('examType'))}</option>${EXAMS.map(k => `<option value="${attr(k)}" ${k === type ? 'selected' : ''}>${esc(t(k))}</option>`).join('')}</select><select class="select-control" id="exam-status"><option value="">${esc(t('resultStatus'))}</option>${STATUSES.map(k => `<option value="${attr(k)}" ${k === status ? 'selected' : ''}>${esc(t(k))}</option>`).join('')}</select><select class="select-control" id="exam-madrasa"><option value="">${esc(t('allMadrasas'))}</option>${madrasaSelectOptions(madrasas).map(o => `<option value="${attr(o.value)}" ${o.value === madrasaSel ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`)}${tableHtml([t('madrasa'), t('examType'), t('academicYear'), t('class'), t('resultStatus'), t('receivedDate'), t('reviewedDate'), t('actions')], rows, t('noExamResults'), `<button class="btn primary small" data-exam-action="add">＋ ${esc(t('addExamResult'))}</button>`)}</section>`;
}

export async function bind(ctx, root) {
  const apply = () => {
    const params = { year: root.querySelector('#exam-year')?.value.trim() || '' };
    const type = root.querySelector('#exam-type')?.value, status = root.querySelector('#exam-status')?.value, madrasa = root.querySelector('#exam-madrasa')?.value;
    if (type) params.type = type; if (status) params.status = status; if (madrasa) params.madrasa = madrasa;
    ctx.navigate('exam-results', params, { replace: true });
  };
  ['#exam-year', '#exam-type', '#exam-status', '#exam-madrasa'].forEach(s => root.querySelector(s)?.addEventListener('change', apply));
  root.querySelector('[data-module-search]')?.addEventListener('input', e => { const q = e.target.value.toLocaleLowerCase(); root.querySelectorAll('[data-row-search]').forEach(row => { row.style.display = row.dataset.rowSearch.toLocaleLowerCase().includes(q) ? '' : 'none'; }); });
  root.addEventListener('click', async e => {
    const quick = e.target.closest('[data-exam-quick]');
    if (quick) return openResult(ctx, '', { madrasaId: quick.dataset.examQuick, academicYear: root.querySelector('#exam-year')?.value.trim() || ctx.settings?.academicYear || '', examType: root.querySelector('#exam-type')?.value || '' });
    const el = e.target.closest('[data-exam-action]');
    if (el) {
      const action = el.dataset.examAction;
      if (action === 'add') return openResult(ctx, '', { madrasaId: root.querySelector('#exam-madrasa')?.value || '', examType: root.querySelector('#exam-type')?.value || '' });
      if (action === 'export') return ctx.export('examResults');
      if (action === 'print') {
        const [records, madrasas] = await Promise.all([db.getAll('examResults'), db.getAll('madrasas')]);
        return ctx.printOfficial(t('examResults'), `<div class="print-section"><h3>${esc(t('examResults'))}</h3>${printTable([t('madrasa'), t('examType'), t('academicYear'), t('class'), t('resultStatus'), t('receivedDate'), t('reviewedDate')], records.map(r => [madrasaName(madrasas, r.madrasaId), t(r.examType, r.examType), r.academicYear, r.className || t('allClasses'), t(r.resultStatus, r.resultStatus), formatDate(r.receivedDate), formatDate(r.reviewedDate)]))}</div>`);
      }
    }
    const btn = e.target.closest('[data-action]'); if (!btn) return;
    const action = btn.dataset.action, id = btn.dataset.id;
    if (action === 'view') return openRecordDetails(ctx, 'examResults', id);
    if (action === 'edit') return openResult(ctx, id);
    if (action === 'delete') return removeEntity(ctx, 'examResults', id);
  });
}

async function openResult(ctx, id = '', preset = {}) {
  const [records, madrasas, members] = await Promise.all(['examResults', 'madrasas', 'members'].map(s => db.getAll(s)));
  const record = id ? records.find(r => r.id === id) || {} : { academicYear: ctx.settings?.academicYear || '', resultStatus: 'resultStatus_received', receivedDate: todayISO(), ...preset };
  return openEntityForm(ctx, {
    store: 'examResults', title: id ? `${t('edit')} · ${t('examResults')}` : t('addExamResult'), record, fields: fields(madrasas, members), wide: true,
    beforeSave: data => {
      if (!data.madrasaId || !data.academicYear || !data.examType || !data.resultStatus) { ctx.notify(t('invalid'), 'error'); return false; }
      if (data.tablesCount !== '' && data.tablesCount !== undefined) data.tablesCount = Number(data.tablesCount);
      if (['resultStatus_approved', 'resultStatus_rejected', 'resultStatus_correction'].includes(data.resultStatus) && !data.reviewedDate) data.reviewedDate = todayISO();
      return data;
    }
  });
}
export async function autoAdd(ctx) { return openResult(ctx); }
