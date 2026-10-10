import { db } from './database.js';
import { t } from './translations.js';
import { esc, attr, formatNumber, badge, actionButtons, printTable, studentCount, effectiveStudentRows } from './utils.js';
import { moduleHeader, toolbar, tableHtml, openEntityForm, openRecordDetails, removeEntity, madrasaSelectOptions, madrasaName, genderTypeOptions } from './moduleHelpers.js';
import { formShell } from './formBuilder.js';

const tone = type => type === 'girls' ? 'amber' : type === 'boys' ? 'blue' : 'teal';
const same = (a, b) => String(a || '').trim() === String(b || '').trim();
function fields(madrasas) {
  return [
    { type: 'section', label: 'classes' },
    { key: 'madrasaId', label: 'madrasa', type: 'select', options: () => madrasaSelectOptions(madrasas), required: true },
    { key: 'className', label: 'class', required: true },
    { key: 'section', label: 'section' },
    { key: 'genderType', label: 'classGenderType', type: 'select', options: genderTypeOptions, required: true },
    { key: 'notes', label: 'notes', type: 'textarea', span: 2 }
  ];
}
function sortClasses(madrasas) {
  return (a, b) => madrasaName(madrasas, a.madrasaId).localeCompare(madrasaName(madrasas, b.madrasaId)) || String(a.className || '').localeCompare(String(b.className || ''), undefined, { numeric: true }) || String(a.section || '').localeCompare(String(b.section || ''));
}

export async function render(ctx) {
  const [classes, madrasas, students] = await Promise.all(['classes', 'madrasas', 'students'].map(s => db.getAll(s)));
  const selected = ctx.params?.madrasa || '';
  const eff = effectiveStudentRows(students, { year: ctx.settings?.academicYear });
  const count = (c, gender) => eff.filter(r => r.madrasaId === c.madrasaId && same(r.className, c.className) && same(r.section, c.section) && r.gender === gender).reduce((n, r) => n + studentCount(r), 0);
  const filtered = classes.filter(c => !selected || c.madrasaId === selected).sort(sortClasses(madrasas));
  const rows = filtered.map(c => {
    const male = count(c, 'male'), female = count(c, 'female');
    return `<tr data-row-search="${attr([c.className, c.section, madrasaName(madrasas, c.madrasaId)].join(' '))}"><td><strong>${esc(c.className || '—')}</strong><small>${esc(c.section || '')}</small></td><td>${esc(madrasaName(madrasas, c.madrasaId))}</td><td>${badge(t(c.genderType, c.genderType || '—'), tone(c.genderType))}</td><td>${esc(formatNumber(male))}</td><td>${esc(formatNumber(female))}</td><td><strong>${esc(formatNumber(male + female))}</strong></td><td>${actionButtons(c.id, { store: 'classes' })}</td></tr>`;
  });
  const countBy = type => filtered.filter(c => c.genderType === type).length;
  const actions = `<button class="btn primary" data-classes-action="add">＋ ${esc(t('addClass'))}</button><button class="btn outline" data-classes-action="bulk">⊞ ${esc(t('bulkCreateClasses'))}</button><button class="btn outline" data-classes-action="print">⎙ ${esc(t('print'))}</button><button class="btn outline" data-classes-action="export">⇩ ${esc(t('exportExcel'))}</button>`;
  return `${moduleHeader('classes', `${formatNumber(filtered.length)} ${t('classes')} · ${t('classesIntro')}`, actions)}<section class="card">${toolbar(t('search'), `<select class="select-control" id="class-madrasa"><option value="">${esc(t('allMadrasas'))}</option>${madrasaSelectOptions(madrasas).map(o => `<option value="${attr(o.value)}" ${o.value === selected ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`)}<div class="table-summary">${[['boys', countBy('boys')], ['girls', countBy('girls')], ['mixed', countBy('mixed')]].map(([k, v]) => `<div class="mini-stat"><div class="mini-value">${esc(formatNumber(v))}</div><div class="mini-label">${esc(t(k))}</div></div>`).join('')}</div>${tableHtml([t('class'), t('madrasa'), t('classGenderType'), t('maleStudents'), t('femaleStudents'), t('total'), t('actions')], rows, t('noClasses'), `<button class="btn primary small" data-classes-action="add">＋ ${esc(t('addClass'))}</button>`)}</section>`;
}

export async function bind(ctx, root) {
  root.querySelector('[data-module-search]')?.addEventListener('input', e => { const q = e.target.value.toLocaleLowerCase(); root.querySelectorAll('[data-row-search]').forEach(row => { row.style.display = row.dataset.rowSearch.toLocaleLowerCase().includes(q) ? '' : 'none'; }); });
  root.querySelector('#class-madrasa')?.addEventListener('change', e => ctx.navigate('classes', e.target.value ? { madrasa: e.target.value } : {}, { replace: true }));
  root.addEventListener('click', async e => {
    const el = e.target.closest('[data-classes-action]');
    if (el) {
      const action = el.dataset.classesAction;
      if (action === 'add') return openClass(ctx);
      if (action === 'bulk') return openBulk(ctx);
      if (action === 'export') return ctx.export('classes');
      if (action === 'print') {
        const [classes, madrasas] = await Promise.all([db.getAll('classes'), db.getAll('madrasas')]);
        return ctx.printOfficial(t('classes'), `<div class="print-section"><h3>${esc(t('classes'))}</h3>${printTable([t('madrasa'), t('class'), t('section'), t('classGenderType')], classes.sort(sortClasses(madrasas)).map(c => [madrasaName(madrasas, c.madrasaId), c.className, c.section || '—', t(c.genderType, c.genderType)]))}</div>`);
      }
    }
    const btn = e.target.closest('[data-action]'); if (!btn) return;
    const action = btn.dataset.action, id = btn.dataset.id;
    if (action === 'view') return openRecordDetails(ctx, 'classes', id);
    if (action === 'edit') return openClass(ctx, id);
    if (action === 'delete') return removeEntity(ctx, 'classes', id);
  });
}

async function openClass(ctx, id = '') {
  const [rows, madrasas] = await Promise.all([db.getAll('classes'), db.getAll('madrasas')]);
  const record = id ? rows.find(r => r.id === id) || {} : { madrasaId: ctx.params?.madrasa || '' };
  return openEntityForm(ctx, {
    store: 'classes', title: id ? `${t('edit')} · ${t('classes')}` : t('addClass'), record, fields: fields(madrasas),
    beforeSave: data => {
      data.className = String(data.className || '').trim(); data.section = String(data.section || '').trim();
      if (!data.madrasaId || !data.className || !data.genderType) { ctx.notify(t('invalid'), 'error'); return false; }
      if (rows.some(r => r.id !== id && r.madrasaId === data.madrasaId && same(r.className, data.className) && same(r.section, data.section))) { ctx.notify(t('duplicateClass'), 'warning'); return false; }
      return data;
    }
  });
}

async function openBulk(ctx) {
  const madrasas = await db.getAll('madrasas');
  if (!madrasas.length) { ctx.notify(t('noMadrasas'), 'warning'); return; }
  const f = [
    { key: 'madrasaId', label: 'madrasa', type: 'select', options: () => madrasaSelectOptions(madrasas), required: true },
    { key: 'genderType', label: 'classGenderType', type: 'select', options: genderTypeOptions, required: true },
    { key: 'fromClass', label: 'fromClass', type: 'number', min: 1, max: 20, required: true, default: 1 },
    { key: 'toClass', label: 'toClass', type: 'number', min: 1, max: 20, required: true, default: 12 }
  ];
  ctx.openModal(t('bulkCreateClasses'), formShell(f, {}, { id: 'class-bulk-form' }));
  const form = document.getElementById('class-bulk-form'); if (!form) return;
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!form.reportValidity()) return;
    const madrasaId = form.elements.madrasaId.value, genderType = form.elements.genderType.value;
    const from = Number(form.elements.fromClass.value), to = Number(form.elements.toClass.value);
    if (!(Number.isInteger(from) && Number.isInteger(to) && from >= 1 && to >= from && to <= 20)) { ctx.notify(t('invalid'), 'error'); return; }
    const existing = await db.getAll('classes'); let created = 0;
    for (let n = from; n <= to; n++) {
      const name = String(n);
      if (existing.some(x => x.madrasaId === madrasaId && same(x.className, name) && !String(x.section || '').trim())) continue;
      await db.put('classes', { madrasaId, className: name, section: '', genderType }); created++;
    }
    ctx.closeModal(); ctx.notify(`${t('saved')} (${formatNumber(created)})`, 'success'); await ctx.refresh();
  });
}
export async function autoAdd(ctx) { return openClass(ctx); }
