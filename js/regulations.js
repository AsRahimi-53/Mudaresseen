import { db } from './database.js';
import { t } from './translations.js';
import { esc, attr, formatDate, formatNumber, badge, actionButtons, printTable } from './utils.js';
import { moduleHeader, toolbar, tableHtml, openEntityForm, openRecordDetails, removeEntity } from './moduleHelpers.js';

const TYPES = ['principle', 'regulation', 'procedure', 'law', 'bill', 'guideline', 'decree', 'circular', 'other'].map(k => `regType_${k}`);
const STATUSES = ['active', 'amended', 'repealed', 'draft'].map(k => `regStatus_${k}`);
const CATEGORIES = ['education', 'admin', 'hr', 'finance', 'curriculum', 'exams', 'other'].map(k => `regCat_${k}`);
const options = keys => () => keys.map(k => ({ value: k, label: t(k) }));
const tone = status => ({ regStatus_active: 'green', regStatus_amended: 'amber', regStatus_repealed: 'red', regStatus_draft: 'gray' })[status] || 'gray';
const safeLink = value => /^https?:\/\//i.test(String(value || '').trim()) ? String(value).trim() : '';

function fields() {
  return [
    { type: 'section', label: 'regulations' },
    { key: 'title', label: 'regulationTitle', required: true, span: 2 },
    { key: 'docType', label: 'documentType', type: 'select', options: options(TYPES), required: true },
    { key: 'documentNumber', label: 'documentNumber' },
    { key: 'issuingAuthority', label: 'issuingAuthority' },
    { key: 'regCategory', label: 'regCategory', type: 'select', options: options(CATEGORIES) },
    { key: 'issueDate', label: 'issueDate', type: 'date' },
    { key: 'effectiveDate', label: 'effectiveDate', type: 'date' },
    { key: 'status', label: 'status', type: 'select', options: options(STATUSES), default: 'regStatus_active', required: true },
    { key: 'summary', label: 'summary', type: 'textarea', rows: 5, span: 2 },
    { key: 'documentLink', label: 'documentLink', type: 'url', placeholder: 'https://', span: 2 },
    { key: 'notes', label: 'notes', type: 'textarea', span: 2 }
  ];
}

export async function render(ctx) {
  const items = await db.getAll('regulations');
  const rows = items.slice().sort((a, b) => String(b.issueDate || '').localeCompare(String(a.issueDate || ''))).map(r => {
    const link = safeLink(r.documentLink);
    return `<tr data-row-search="${attr([r.title, r.documentNumber, r.issuingAuthority, r.summary].join(' '))}" data-type="${attr(r.docType || '')}" data-status="${attr(r.status || '')}"><td><strong>${esc(r.title || '—')}</strong><small>${esc(r.documentNumber ? `${t('documentNumber')}: ${r.documentNumber}` : '')}${link ? ` <a href="${attr(link)}" target="_blank" rel="noopener">↗</a>` : ''}</small></td><td>${esc(t(r.docType, r.docType || '—'))}</td><td>${esc(r.regCategory ? t(r.regCategory, r.regCategory) : '—')}</td><td>${esc(r.issuingAuthority || '—')}</td><td>${esc(formatDate(r.issueDate))}</td><td>${badge(t(r.status, r.status || '—'), tone(r.status))}</td><td>${actionButtons(r.id, { store: 'regulations' })}</td></tr>`;
  });
  const actions = `<button class="btn primary" data-reg-action="add">＋ ${esc(t('addRegulation'))}</button><button class="btn outline" data-reg-action="print">⎙ ${esc(t('print'))}</button><button class="btn outline" data-reg-action="export">⇩ ${esc(t('exportExcel'))}</button>`;
  const stats = TYPES.map(k => [k, items.filter(r => r.docType === k).length]).filter(([, n]) => n);
  return `${moduleHeader('regulations', `${formatNumber(items.length)} ${t('regulations')} · ${t('regulationsIntro')}`, actions)}<section class="card">${toolbar(t('search'), `<select class="select-control" data-reg-type><option value="">${esc(t('documentType'))}</option>${TYPES.map(k => `<option value="${attr(k)}">${esc(t(k))}</option>`).join('')}</select><select class="select-control" data-reg-status><option value="">${esc(t('status'))}</option>${STATUSES.map(k => `<option value="${attr(k)}">${esc(t(k))}</option>`).join('')}</select>`)}<div class="table-summary"><div class="mini-stat"><div class="mini-value">${esc(formatNumber(items.filter(r => r.status === 'regStatus_active').length))}</div><div class="mini-label">${esc(t('regStatus_active'))}</div></div>${stats.map(([k, n]) => `<div class="mini-stat"><div class="mini-value">${esc(formatNumber(n))}</div><div class="mini-label">${esc(t(k))}</div></div>`).join('')}</div>${tableHtml([t('regulationTitle'), t('documentType'), t('regCategory'), t('issuingAuthority'), t('issueDate'), t('status'), t('actions')], rows, t('noRegulations'), `<button class="btn primary small" data-reg-action="add">＋ ${esc(t('addRegulation'))}</button>`)}</section>`;
}

export async function bind(ctx, root) {
  const filter = () => {
    const q = (root.querySelector('[data-module-search]')?.value || '').toLocaleLowerCase(), type = root.querySelector('[data-reg-type]')?.value || '', status = root.querySelector('[data-reg-status]')?.value || '';
    root.querySelectorAll('[data-row-search]').forEach(row => { row.style.display = (!q || row.dataset.rowSearch.toLocaleLowerCase().includes(q)) && (!type || row.dataset.type === type) && (!status || row.dataset.status === status) ? '' : 'none'; });
  };
  ['[data-module-search]'].forEach(s => root.querySelector(s)?.addEventListener('input', filter));
  ['[data-reg-type]', '[data-reg-status]'].forEach(s => root.querySelector(s)?.addEventListener('change', filter));
  root.addEventListener('click', async e => {
    const el = e.target.closest('[data-reg-action]');
    if (el) {
      const action = el.dataset.regAction;
      if (action === 'add') return openRegulation(ctx);
      if (action === 'export') return ctx.export('regulations');
      if (action === 'print') {
        const items = await db.getAll('regulations');
        return ctx.printOfficial(t('regulations'), `<div class="print-section"><h3>${esc(t('regulations'))}</h3>${printTable([t('regulationTitle'), t('documentType'), t('documentNumber'), t('issuingAuthority'), t('issueDate'), t('status')], items.map(r => [r.title, t(r.docType, r.docType), r.documentNumber || '—', r.issuingAuthority || '—', formatDate(r.issueDate), t(r.status, r.status)]))}</div>`);
      }
    }
    const btn = e.target.closest('[data-action]'); if (!btn) return;
    const action = btn.dataset.action, id = btn.dataset.id;
    if (action === 'view') return openRecordDetails(ctx, 'regulations', id);
    if (action === 'edit') return openRegulation(ctx, id);
    if (action === 'delete') return removeEntity(ctx, 'regulations', id);
  });
}

async function openRegulation(ctx, id = '') {
  const items = await db.getAll('regulations');
  const record = id ? items.find(r => r.id === id) || {} : {};
  return openEntityForm(ctx, {
    store: 'regulations', title: id ? `${t('edit')} · ${t('regulations')}` : t('addRegulation'), record, fields: fields(), wide: true,
    beforeSave: data => {
      data.title = String(data.title || '').trim();
      if (!data.title || !data.docType) { ctx.notify(t('invalid'), 'error'); return false; }
      if (data.documentLink && !safeLink(data.documentLink)) { ctx.notify(t('invalidLink'), 'error'); return false; }
      return data;
    }
  });
}
export async function autoAdd(ctx) { return openRegulation(ctx); }
