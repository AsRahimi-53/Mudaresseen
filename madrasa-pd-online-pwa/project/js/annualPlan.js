import { db } from './database.js';
import { t } from './translations.js';
import { esc, attr, formatDate, formatNumber, badge, actionButtons, percent, printTable, todayISO } from './utils.js';
import { moduleHeader, toolbar, tableHtml, openEntityForm, openRecordDetails, removeEntity, memberSelectOptions, madrasaSelectOptions, memberNames, madrasaNames, idsOf, planStatusOptions, priorityOptions } from './moduleHelpers.js';

function fields(members, madrasas) {
  return [
    { type:'section', label:'annualPlan' },
    { key:'title', label:'planTitle', required:true },
    { key:'objective', label:'objective', type:'textarea' },
    { key:'activity', label:'activity', type:'textarea', required:true },
    { key:'expectedResult', label:'expectedResult', type:'textarea' },
    { key:'targetGroup', label:'targetGroup' },
    { key:'madrasaIds', label:'relatedMadrasa', type:'multi-select', options:() => madrasaSelectOptions(madrasas) },
    { key:'startDate', label:'startDate', type:'date', required:true },
    { key:'endDate', label:'endDate', type:'date', required:true },
    { key:'responsibleMembers', label:'responsibleMember', type:'multi-select', options:() => memberSelectOptions(members,'',true) },
    { key:'priority', label:'priority', type:'select', options:priorityOptions, default:'medium' },
    { key:'status', label:'status', type:'select', options:planStatusOptions, default:'planned' },
    { key:'resources', label:'resources', type:'textarea' },
    { key:'notes', label:'notes', type:'textarea' }
  ];
}

export async function render(ctx) {
  const [plans, members, madrasas] = await Promise.all(['annualPlans','members','madrasas'].map(s => db.getAll(s)));
  const q = ctx.params?.q || '';
  const filtered = q ? plans.filter(p => [p.title,p.objective,p.activity,p.targetGroup,p.status].some(v => String(v || '').toLocaleLowerCase().includes(q.toLocaleLowerCase()))) : plans;
  const rows = filtered.slice().sort((a,b) => String(a.startDate || '').localeCompare(String(b.startDate || ''))).map(p => {
    const responsible = memberNames(members,p,'responsibleMembers','responsibleMember');
    const madrasa = madrasaNames(madrasas,p,'madrasaIds','madrasaId');
    return `<tr data-row-search="${attr([p.title,p.activity,p.status,responsible,madrasa].join(' '))}"><td><strong>${esc(p.title || '—')}</strong><small>${esc(p.objective || '')}</small></td><td>${esc(responsible)}</td><td>${esc(madrasa)}</td><td>${esc(formatDate(p.startDate))} — ${esc(formatDate(p.endDate))}</td><td>${badge(t(p.priority,p.priority || '—'))}</td><td>${badge(t(p.status,p.status || '—'))}</td><td>${actionButtons(p.id,{store:'annualPlans'})}</td></tr>`;
  });
  return `${moduleHeader('annualPlan',`${formatNumber(plans.length)} ${t('annualPlan')}`,`<button class="btn primary" data-plan-action="add">＋ ${esc(t('addPlan'))}</button><button class="btn outline" data-plan-action="print">⎙ ${esc(t('print'))}</button><button class="btn outline" data-plan-action="export">⇩ ${esc(t('exportExcel'))}</button>`)}<section class="card">${toolbar(t('search'),`<select class="select-control" data-plan-status><option value="">${esc(t('status'))}</option>${planStatusOptions().map(o => `<option value="${attr(o.value)}">${esc(o.label)}</option>`).join('')}</select>`)}<div class="table-summary">${planStatusOptions().map(o => `<div class="mini-stat"><div class="mini-value">${esc(formatNumber(plans.filter(p => p.status === o.value).length))}</div><div class="mini-label">${esc(o.label)}</div></div>`).join('')}</div>${tableHtml([t('planTitle'),t('responsibleMember'),t('relatedMadrasa'),t('dateRange'),t('priority'),t('status'),t('actions')],rows,t('noData'),`<button class="btn primary small" data-plan-action="add">＋ ${esc(t('addPlan'))}</button>`)}</section>`;
}

export async function bind(ctx, root) {
  const filter = () => { const q = (root.querySelector('[data-module-search]')?.value || '').toLocaleLowerCase(), status = root.querySelector('[data-plan-status]')?.value || ''; root.querySelectorAll('[data-row-search]').forEach(row => row.style.display = (!q || row.dataset.rowSearch.toLocaleLowerCase().includes(q)) && (!status || row.textContent.toLocaleLowerCase().includes(t(status).toLocaleLowerCase())) ? '' : 'none'); };
  root.querySelector('[data-module-search]')?.addEventListener('input', filter);
  root.querySelector('[data-plan-status]')?.addEventListener('change', filter);
  root.addEventListener('click', async e => {
    const el = e.target.closest('[data-plan-action]');
    if (el) { const action = el.dataset.planAction; if (action === 'add') return openPlan(ctx); if (action === 'export') return ctx.export('annualPlans'); if (action === 'print') { const plans = await db.getAll('annualPlans'); return ctx.printOfficial(t('annualPlan'),`<div class="print-section"><h3>${esc(t('annualPlan'))}</h3>${printTable([t('planTitle'),t('activity'),t('startDate'),t('endDate'),t('status')],plans.map(p => [p.title,p.activity,formatDate(p.startDate),formatDate(p.endDate),t(p.status,p.status)]))}</div>`); } }
    const btn = e.target.closest('[data-action]'); if (!btn) return; const action = btn.dataset.action, id = btn.dataset.id; if (action === 'view') return openRecordDetails(ctx,'annualPlans',id); if (action === 'edit') return openPlan(ctx,id); if (action === 'delete') return removeEntity(ctx,'annualPlans',id);
  });
}

async function openPlan(ctx, id = '') {
  const [plans, members, madrasas] = await Promise.all(['annualPlans','members','madrasas'].map(s => db.getAll(s)));
  const source = id ? plans.find(p => p.id === id) || {} : {};
  const record = { ...source, startDate:source.startDate || todayISO(), endDate:source.endDate || todayISO(), responsibleMembers:idsOf(source,'responsibleMembers','responsibleMember'), madrasaIds:idsOf(source,'madrasaIds','madrasaId') };
  return openEntityForm(ctx,{store:'annualPlans',title:id ? `${t('edit')} · ${t('annualPlan')}` : t('addPlan'),record,fields:fields(members,madrasas),wide:true,beforeSave:data => { data.responsibleMembers = Array.isArray(data.responsibleMembers) ? data.responsibleMembers.filter(Boolean) : []; data.responsibleMember = data.responsibleMembers[0] || ''; data.madrasaIds = Array.isArray(data.madrasaIds) ? data.madrasaIds.filter(Boolean) : []; data.madrasaId = data.madrasaIds[0] || ''; return data; }});
}
export async function autoAdd(ctx) { return openPlan(ctx); }
