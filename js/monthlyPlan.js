import { db } from './database.js';
import { t } from './translations.js';
import { esc, attr, formatDate, formatNumber, badge, actionButtons, printTable, todayISO } from './utils.js';
import { moduleHeader, toolbar, tableHtml, openEntityForm, openRecordDetails, removeEntity, memberSelectOptions, madrasaSelectOptions, memberNames, madrasaNames, idsOf, planStatusOptions } from './moduleHelpers.js';

const solarMonthKeys = Array.from({length:12}, (_, i) => `solarMonth${i + 1}`);
function fields(members, madrasas) { return [
  {type:'section',label:'monthlyPlan'}, {key:'year',label:'year',required:true},
  {key:'month',label:'month',type:'select',options:[1,2,3,4,5,6,7,8,9,10,11,12].map(n => ({value:String(n),label:t(solarMonthKeys[n - 1])}))},
  {key:'activity',label:'activity',type:'textarea',required:true}, {key:'objective',label:'objective',type:'textarea'}, {key:'expectedResult',label:'expectedResult',type:'textarea'},
  {key:'responsibleMembers',label:'responsibleMember',type:'multi-select',options:() => memberSelectOptions(members,'',true)},
  {key:'madrasaIds',label:'relatedMadrasa',type:'multi-select',options:() => madrasaSelectOptions(madrasas)},
  {key:'date',label:'date',type:'date'}, {key:'deadline',label:'deadline',type:'date'}, {key:'status',label:'status',type:'select',options:planStatusOptions,default:'planned'}, {key:'result',label:'result',type:'textarea'}, {key:'notes',label:'notes',type:'textarea'}
]; }

export async function render(ctx) {
  const [plans,members,madrasas] = await Promise.all(['monthlyPlans','members','madrasas'].map(s => db.getAll(s)));
  const q = ctx.params?.q || '';
  const filtered = q ? plans.filter(p => [p.activity,p.objective,p.expectedResult,p.status].some(v => String(v || '').toLocaleLowerCase().includes(q.toLocaleLowerCase()))) : plans;
  const rows = filtered.slice().sort((a,b) => String(b.date || '').localeCompare(String(a.date || ''))).map(p => {
    const responsible = memberNames(members,p,'responsibleMembers','responsibleMember');
    const madrasa = madrasaNames(madrasas,p,'madrasaIds','madrasaId');
    return `<tr data-row-search="${attr([p.activity,p.objective,p.status,responsible,madrasa].join(' '))}"><td>${esc(p.year || '—')}</td><td>${esc(t(solarMonthKeys[Number(p.month) - 1],p.month || '—'))}</td><td><strong>${esc(p.activity || '—')}</strong><small>${esc(p.objective || '')}</small></td><td>${esc(responsible)}</td><td>${esc(madrasa)}</td><td>${esc(formatDate(p.deadline || p.date))}</td><td>${badge(t(p.status,p.status || '—'))}</td><td>${actionButtons(p.id,{store:'monthlyPlans'})}</td></tr>`;
  });
  return `${moduleHeader('monthlyPlan',`${formatNumber(plans.length)} ${t('monthlyPlan')}`,`<button class="btn primary" data-monthly-action="add">＋ ${esc(t('addPlan'))}</button><button class="btn outline" data-monthly-action="print">⎙ ${esc(t('print'))}</button><button class="btn outline" data-monthly-action="export">⇩ ${esc(t('exportExcel'))}</button>`)}<section class="card">${toolbar(t('search'),`<select class="select-control" data-monthly-status><option value="">${esc(t('status'))}</option>${planStatusOptions().map(o => `<option value="${attr(o.value)}">${esc(o.label)}</option>`).join('')}</select>`)}<div class="table-summary">${planStatusOptions().map(o => `<div class="mini-stat"><div class="mini-value">${esc(formatNumber(plans.filter(p => p.status === o.value).length))}</div><div class="mini-label">${esc(o.label)}</div></div>`).join('')}</div>${tableHtml([t('year'),t('month'),t('activity'),t('responsibleMember'),t('relatedMadrasa'),t('deadline'),t('status'),t('actions')],rows,t('noData'),`<button class="btn primary small" data-monthly-action="add">＋ ${esc(t('addPlan'))}</button>`)}</section>`;
}

export async function bind(ctx, root) {
  const filter = () => { const q = (root.querySelector('[data-module-search]')?.value || '').toLocaleLowerCase(), status = root.querySelector('[data-monthly-status]')?.value || ''; root.querySelectorAll('[data-row-search]').forEach(row => row.style.display = (!q || row.dataset.rowSearch.toLocaleLowerCase().includes(q)) && (!status || row.textContent.toLocaleLowerCase().includes(t(status).toLocaleLowerCase())) ? '' : 'none'); };
  root.querySelector('[data-module-search]')?.addEventListener('input',filter); root.querySelector('[data-monthly-status]')?.addEventListener('change',filter);
  root.addEventListener('click',async e => {
    const el = e.target.closest('[data-monthly-action]');
    if (el) { const action = el.dataset.monthlyAction; if (action === 'add') return openPlan(ctx); if (action === 'export') return ctx.export('monthlyPlans'); if (action === 'print') { const plans = await db.getAll('monthlyPlans'); return ctx.printOfficial(t('monthlyPlan'),`<div class="print-section"><h3>${esc(t('monthlyPlan'))}</h3>${printTable([t('year'),t('month'),t('activity'),t('deadline'),t('status')],plans.map(p => [p.year,t(solarMonthKeys[Number(p.month) - 1],p.month),p.activity,formatDate(p.deadline),t(p.status,p.status)]))}</div>`); } }
    const btn = e.target.closest('[data-action]'); if (!btn) return; const action = btn.dataset.action, id = btn.dataset.id; if (action === 'view') return openRecordDetails(ctx,'monthlyPlans',id); if (action === 'edit') return openPlan(ctx,id); if (action === 'delete') return removeEntity(ctx,'monthlyPlans',id);
  });
}

async function openPlan(ctx,id = '') {
  const [plans,members,madrasas] = await Promise.all(['monthlyPlans','members','madrasas'].map(s => db.getAll(s)));
  const source = id ? plans.find(p => p.id === id) || {} : {};
  const record = {...source,year:source.year || ctx.settings?.academicYear || todayISO().slice(0,4),date:source.date || todayISO(),deadline:source.deadline || todayISO(),responsibleMembers:idsOf(source,'responsibleMembers','responsibleMember'),madrasaIds:idsOf(source,'madrasaIds','madrasaId')};
  return openEntityForm(ctx,{store:'monthlyPlans',title:id ? `${t('edit')} · ${t('monthlyPlan')}` : t('monthlyPlan'),record,fields:fields(members,madrasas),wide:true,beforeSave:data => { data.responsibleMembers=Array.isArray(data.responsibleMembers)?data.responsibleMembers.filter(Boolean):[]; data.responsibleMember=data.responsibleMembers[0] || ''; data.madrasaIds=Array.isArray(data.madrasaIds)?data.madrasaIds.filter(Boolean):[]; data.madrasaId=data.madrasaIds[0] || ''; return data; }});
}
export async function autoAdd(ctx) { return openPlan(ctx); }
