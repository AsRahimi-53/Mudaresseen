// Super Admin dashboard. All data comes from /api/superadmin, which verifies the
// session and the Super Admin role on the server. Nothing is cached in the
// browser (no localStorage/sessionStorage/IndexedDB) and nothing is decided here.
import { t } from './translations.js';
import { esc, attr, formatDate, formatNumber, badge, todayISO, solarToIso, toSolarDate, printTable, kvTable } from './utils.js';
import { moduleHeader } from './moduleHelpers.js';
import { exportRows } from './export.js';

const TABS = ['overview', 'provinces', 'districts', 'payments', 'reports', 'audit', 'settings'];
const TAB_LABEL = { overview: 'saOverview', provinces: 'saProvinces', districts: 'saDistricts', payments: 'saPayments', reports: 'saReports', audit: 'saAudit', settings: 'saSettings' };
const money = value => `${formatNumber(Number(value || 0))} ${t('saCurrency')}`;
const api = (ctx, action, params) => ctx.online.superAdminRequest(action, params || {});
const METHOD = { cash: 'saCash', bank_transfer: 'saBankTransfer' };
const PAY_TONE = { draft: 'amber', confirmed: 'green', reversed: 'red' };
const PAY_LABEL = { draft: 'saDraft', confirmed: 'saConfirmed', reversed: 'saReversed' };
const DIST_TONE = { active: 'green', inactive: 'gray', expired: 'red' };
const DIST_LABEL = { active: 'saActive', inactive: 'saInactive', expired: 'saExpired' };
const option = (value, label, selected) => `<option value="${attr(value)}" ${String(value) === String(selected ?? '') ? 'selected' : ''}>${esc(label)}</option>`;
const field = (label, control, span = '') => `<label class="field ${span}"><span>${esc(label)}</span>${control}</label>`;
const solarInput = (name, value = '', required = true) => `<input name="${attr(name)}" type="text" inputmode="numeric" class="solar-date-input" data-solar-date value="${attr(toSolarDate(value))}" maxlength="10" placeholder="${attr(t('solarDatePlaceholder'))}" ${required ? 'required' : ''} pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}">`;

function addYear(iso) { const d = new Date(`${iso}T00:00:00Z`); d.setUTCFullYear(d.getUTCFullYear() + 1); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }
function addDay(iso) { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }
function suggestPeriod(district) {
  const today = new Date().toISOString().slice(0, 10);
  const end = district?.subscription_end;
  const start = district?.active && end && end >= today ? addDay(end) : today;
  return [start, addYear(start)];
}
function wireDates(form) {
  form.querySelectorAll('[data-solar-date]').forEach(input => input.addEventListener('input', () => {
    input.value = input.value.replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/\//g, '-').replace(/[^0-9-]/g, '').slice(0, 10);
  }));
}
function formActions() { return `<div class="form-actions"><button type="submit" class="btn primary">✓ ${esc(t('save'))}</button><button type="button" class="btn outline" data-modal-close>${esc(t('cancel'))}</button></div>`; }
async function guarded(ctx, task) {
  try { return await task(); }
  catch (error) {
    if (error.status === 401 || error.status === 403) { ctx.navigate('dashboard', {}, { replace: true }); return undefined; }
    ctx.notify(error.message || t('error'), 'error');
    return undefined;
  }
}

export async function render(ctx) {
  const tab = TABS.includes(ctx.params?.tab) ? ctx.params.tab : 'overview';
  try { await api(ctx, 'whoami'); }
  catch (error) {
    if (error.status === 401 || error.status === 403) { ctx.navigate('dashboard', {}, { replace: true }); return ''; }
    return `<div class="card"><div class="card-body no-data">${esc(error.message || t('error'))}</div></div>`;
  }
  let body = '';
  try {
    body = await ({ overview: renderOverview, provinces: renderProvinces, districts: renderDistricts, payments: renderPayments, reports: renderReports, audit: renderAudit, settings: renderSettings }[tab])(ctx);
  } catch (error) {
    if (error.status === 401 || error.status === 403) { ctx.navigate('dashboard', {}, { replace: true }); return ''; }
    body = `<div class="card"><div class="card-body no-data">${esc(error.message || t('error'))}</div></div>`;
  }
  const tabs = TABS.map(key => `<button class="tab-btn ${key === tab ? 'active' : ''}" data-sa-tab="${key}">${esc(t(TAB_LABEL[key]))}</button>`).join('');
  return `${moduleHeader('superAdminDashboard', t('saIntro'))}<div class="tab-row" style="margin-bottom:16px">${tabs}</div><div data-sa-root>${body}</div>`;
}

/* ------------------------------------------------------------------ overview */
async function renderOverview(ctx) {
  const o = await api(ctx, 'overview');
  const kpi = (label, value, note = '') => `<div class="card kpi-card"><div class="stat-number">${esc(typeof value === 'number' && !note ? formatNumber(value) : value)}</div><div class="stat-label">${esc(label)}</div>${note ? `<small class="muted">${esc(note)}</small>` : ''}</div>`;
  const years = (o.revenue_by_year || []).map(y => [String(y.year), money(y.total)]);
  return `<div class="kpi-grid">${kpi(t('saTotalProvinces'), o.provinces_total)}${kpi(t('saTotalDistricts'), o.districts_total)}${kpi(t('saActiveDistricts'), o.districts_active)}${kpi(t('saInactiveDistricts'), o.districts_inactive)}${kpi(t('saExpiredDistricts'), o.districts_expired)}${kpi(t('saUnpaidDistricts'), o.districts_unpaid)}${kpi(t('saTotalReceived'), money(o.payments_received_total), t('saConfirmedOnly'))}${kpi(t('saOutstanding'), money(o.outstanding_total))}${kpi(t('saCash'), money(o.cash_total))}${kpi(t('saBankTransfer'), money(o.bank_total))}${kpi(t('saDraft'), money(o.draft_total), t('saNotCounted'))}${kpi(t('saReversed'), money(o.reversed_total), t('saNotCounted'))}</div><section class="card" style="margin-top:17px"><div class="card-head"><div><h2>${esc(t('saAnnualRevenue'))}</h2><p>${esc(t('saConfirmedOnly'))}</p></div></div>${years.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>${esc(t('year'))}</th><th>${esc(t('saTotalReceived'))}</th></tr></thead><tbody>${years.map(r => `<tr><td>${esc(r[0])}</td><td><strong>${esc(r[1])}</strong></td></tr>`).join('')}</tbody></table></div>` : `<div class="no-data">${esc(t('noData'))}</div>`}</section>`;
}

/* ----------------------------------------------------------------- provinces */
async function renderProvinces(ctx) {
  const rows = await api(ctx, 'provinces.list');
  const body = rows.map(p => `<tr><td><strong>${esc(p.name)}</strong></td><td>${esc(formatNumber(p.districts_count))}</td><td>${badge(t(p.active ? 'saActive' : 'saInactive'), p.active ? 'green' : 'gray')}</td><td><div class="table-actions"><button class="table-action" data-sa-action="province-edit" data-id="${attr(p.province_id)}" title="${esc(t('edit'))}">✎</button><button class="table-action" data-sa-action="province-toggle" data-id="${attr(p.province_id)}" title="${esc(t(p.active ? 'saDeactivate' : 'saActivate'))}">⏻</button><button class="table-action" data-sa-action="province-districts" data-name="${attr(p.name)}" data-id="${attr(p.province_id)}" title="${esc(t('saDistricts'))}">↗</button></div></td></tr>`).join('');
  return `<div class="page-actions" style="margin-bottom:14px"><button class="btn primary" data-sa-action="province-add">＋ ${esc(t('saAddProvince'))}</button></div><section class="card"><div class="table-wrap"><table class="data-table"><thead><tr><th>${esc(t('saProvince'))}</th><th>${esc(t('saDistricts'))}</th><th>${esc(t('status'))}</th><th>${esc(t('actions'))}</th></tr></thead><tbody>${body || `<tr><td colspan="4" class="no-data">${esc(t('noData'))}</td></tr>`}</tbody></table></div></section>`;
}
function openProvinceForm(ctx, province) {
  ctx.openModal(province ? t('saEditProvince') : t('saAddProvince'), `<form class="form-grid" id="sa-form" novalidate>${field(t('saProvince'), `<input name="name" required maxlength="120" value="${attr(province?.name || '')}">`, 'span-2')}<div class="form-actions" style="grid-column:1/-1"><button type="submit" class="btn primary">✓ ${esc(t('save'))}</button><button type="button" class="btn outline" data-modal-close>${esc(t('cancel'))}</button></div></form>`);
  const form = document.getElementById('sa-form');
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!form.reportValidity()) return;
    await guarded(ctx, async () => {
      await api(ctx, 'provinces.save', { p_province_id: province?.province_id || null, p_name: form.elements.name.value.trim(), p_active: province ? province.active : true });
      ctx.closeModal(); ctx.notify(t('saved'), 'success'); await ctx.refresh();
    });
  });
}

/* ----------------------------------------------------------------- districts */
function districtFilters(ctx, provinces, rows) {
  const p = ctx.params || {};
  return rows.filter(d => (!p.province || d.province_id === p.province)
    && (!p.status || d.effective_status === p.status)
    && (!p.q || [d.province_name, d.district_name].join(' ').toLocaleLowerCase().includes(String(p.q).toLocaleLowerCase()))
    && (!p.before || (d.subscription_end && d.subscription_end <= solarToIso(p.before))));
}
async function renderDistricts(ctx) {
  const [all, provinces] = await Promise.all([api(ctx, 'districts.list'), api(ctx, 'provinces.list')]);
  const p = ctx.params || {};
  const rows = districtFilters(ctx, provinces, all);
  const body = rows.map(d => `<tr><td>${esc(d.province_name)}</td><td><strong>${esc(d.district_name)}</strong>${d.access_exception ? `<small>${esc(t('saAccessException'))}</small>` : ''}</td><td>${esc(money(d.annual_fee))}</td><td>${d.subscription_start ? `${esc(formatDate(d.subscription_start))} → ${esc(formatDate(d.subscription_end))}` : '—'}</td><td>${badge(t(DIST_LABEL[d.effective_status]), DIST_TONE[d.effective_status])}</td><td>${esc(money(d.paid_current))}</td><td>${esc(money(d.outstanding))}</td><td><div class="table-actions"><button class="table-action" data-sa-action="district-edit" data-id="${attr(d.tenant_id)}" title="${esc(t('edit'))}">✎</button><button class="table-action" data-sa-action="payment-add" data-id="${attr(d.tenant_id)}" title="${esc(t('saRecordPayment'))}">＋</button>${d.effective_status === 'active' ? `<button class="table-action danger" data-sa-action="district-deactivate" data-id="${attr(d.tenant_id)}" title="${esc(t('saDeactivate'))}">⏻</button>` : `<button class="table-action" data-sa-action="district-activate" data-id="${attr(d.tenant_id)}" title="${esc(t('saActivate'))}">⏻</button>`}<button class="table-action" data-sa-action="district-history" data-id="${attr(d.tenant_id)}" title="${esc(t('saHistory'))}">☰</button></div></td></tr>`).join('');
  const filters = `<div class="toolbar"><input class="search-control" id="sa-q" value="${attr(p.q || '')}" placeholder="${attr(t('search'))}"><select class="select-control" id="sa-province"><option value="">${esc(t('saAllProvinces'))}</option>${provinces.map(x => option(x.province_id, x.name, p.province)).join('')}</select><select class="select-control" id="sa-status"><option value="">${esc(t('saAllStatuses'))}</option>${['active', 'inactive', 'expired'].map(k => option(k, t(DIST_LABEL[k]), p.status)).join('')}</select><input class="select-control solar-date-input" id="sa-before" data-solar-date value="${attr(p.before || '')}" placeholder="${attr(t('saExpiresBefore'))}" maxlength="10"></div>`;
  return `<div class="page-actions" style="margin-bottom:14px"><button class="btn primary" data-sa-action="district-add">＋ ${esc(t('saAddDistrict'))}</button></div><section class="card">${filters}<div class="table-wrap"><table class="data-table"><thead><tr><th>${esc(t('saProvince'))}</th><th>${esc(t('saDistrict'))}</th><th>${esc(t('saAnnualFee'))}</th><th>${esc(t('saPeriod'))}</th><th>${esc(t('status'))}</th><th>${esc(t('saAmountReceived'))}</th><th>${esc(t('saRemaining'))}</th><th>${esc(t('actions'))}</th></tr></thead><tbody>${body || `<tr><td colspan="8" class="no-data">${esc(t('noData'))}</td></tr>`}</tbody></table></div></section>`;
}
async function openDistrictForm(ctx, tenantId) {
  await guarded(ctx, async () => {
    const [districts, provinces] = await Promise.all([api(ctx, 'districts.list'), api(ctx, 'provinces.list')]);
    const d = tenantId ? districts.find(x => x.tenant_id === tenantId) : null;
    const provinceField = d ? field(t('saProvince'), `<input value="${attr(d.province_name)}" disabled>`) : field(t('saProvince'), `<select name="province" required><option value="">${esc(t('select'))}</option>${provinces.filter(x => x.active).map(x => option(x.province_id, x.name)).join('')}</select>`);
    ctx.openModal(d ? t('saEditDistrict') : t('saAddDistrict'), `<form class="form-grid" id="sa-form" novalidate>${provinceField}${field(t('saDistrict'), `<input name="name" required maxlength="120" value="${attr(d?.district_name || '')}">`)}${field(`${t('saAnnualFee')} (${t('saCurrency')})`, `<input name="fee" type="number" min="1" step="0.01" required value="${attr(d?.annual_fee || '')}">`)}${field(t('saAccessException'), `<div class="choice-row"><label class="choice"><input type="checkbox" name="exception" ${d?.access_exception ? 'checked' : ''}> <span>${esc(t('saAccessExceptionHint'))}</span></label></div>`)}${field(t('notes'), `<textarea name="notes" rows="3">${esc(d?.notes || '')}</textarea>`, 'span-2')}${formActions()}</form>`);
    const form = document.getElementById('sa-form');
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (!form.reportValidity()) return;
      await guarded(ctx, async () => {
        await api(ctx, 'districts.save', { p_tenant_id: d?.tenant_id || null, p_province_id: d ? d.province_id : form.elements.province.value, p_district_name: form.elements.name.value.trim(), p_annual_fee: Number(form.elements.fee.value), p_notes: form.elements.notes.value.trim() || null, p_access_exception: form.elements.exception.checked });
        ctx.closeModal(); ctx.notify(t('saved'), 'success'); await ctx.refresh();
      });
    });
  });
}
async function openActivateForm(ctx, tenantId) {
  await guarded(ctx, async () => {
    const districts = await api(ctx, 'districts.list');
    const d = districts.find(x => x.tenant_id === tenantId); if (!d) return;
    const [start, end] = suggestPeriod(d);
    ctx.openModal(`${t('saActivate')} · ${d.district_name}`, `<form class="form-grid" id="sa-form" novalidate><p class="form-hint" style="grid-column:1/-1">${esc(t('saActivateHint'))} ${esc(money(d.annual_fee))}</p>${field(t('saPeriodStart'), solarInput('start', start))}${field(t('saPeriodEnd'), solarInput('end', end))}${formActions()}</form>`);
    const form = document.getElementById('sa-form'); wireDates(form);
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (!form.reportValidity()) return;
      const s = solarToIso(form.elements.start.value), e = solarToIso(form.elements.end.value);
      if (!s || !e) { ctx.notify(t('invalid'), 'error'); return; }
      await guarded(ctx, async () => { await api(ctx, 'districts.activate', { p_tenant_id: tenantId, p_period_start: s, p_period_end: e }); ctx.closeModal(); ctx.notify(t('saved'), 'success'); await ctx.refresh(); });
    });
  });
}
async function openHistory(ctx, tenantId) {
  await guarded(ctx, async () => {
    const [districts, payments, audit] = await Promise.all([api(ctx, 'districts.list'), api(ctx, 'payments.list', { p_tenant_id: tenantId }), api(ctx, 'audit.list', { p_limit: 100, p_tenant_id: tenantId })]);
    const d = districts.find(x => x.tenant_id === tenantId); if (!d) return;
    const payRows = payments.map(p => `<tr><td>${esc(formatDate(p.payment_date))}</td><td>${esc(money(p.amount))}</td><td>${esc(t(METHOD[p.method]))}</td><td>${esc(p.reference_no)}</td><td>${esc(formatDate(p.period_start))} → ${esc(formatDate(p.period_end))}</td><td>${badge(t(PAY_LABEL[p.status]), PAY_TONE[p.status])}</td></tr>`).join('');
    const auditRows = audit.map(a => `<tr><td>${esc(formatDate(a.created_at))}</td><td>${esc(a.action)}</td><td>${esc(a.actor_email || '—')}</td></tr>`).join('');
    ctx.openModal(`${d.province_name} · ${d.district_name}`, `<p class="form-hint">${esc(t('saPeriod'))}: ${d.subscription_start ? `${esc(formatDate(d.subscription_start))} → ${esc(formatDate(d.subscription_end))}` : '—'} · ${esc(t('saAnnualFee'))}: ${esc(money(d.annual_fee))}</p><h3>${esc(t('saPayments'))}</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>${esc(t('date'))}</th><th>${esc(t('saAmountReceived'))}</th><th>${esc(t('saPaymentMethod'))}</th><th>${esc(t('saReference'))}</th><th>${esc(t('saPeriod'))}</th><th>${esc(t('status'))}</th></tr></thead><tbody>${payRows || `<tr><td colspan="6" class="no-data">${esc(t('noData'))}</td></tr>`}</tbody></table></div><h3 style="margin-top:18px">${esc(t('saAudit'))}</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>${esc(t('date'))}</th><th>${esc(t('saAction'))}</th><th>${esc(t('saActor'))}</th></tr></thead><tbody>${auditRows || `<tr><td colspan="3" class="no-data">${esc(t('noData'))}</td></tr>`}</tbody></table></div>`, { wide: true });
  });
}

/* ------------------------------------------------------------------ payments */
function paymentRows(payments) {
  return payments.map(p => {
    const actions = [];
    if (p.status === 'draft') actions.push(`<button class="table-action" data-sa-action="payment-confirm" data-id="${attr(p.id)}" title="${esc(t('saConfirm'))}">✓</button><button class="table-action" data-sa-action="payment-confirm-activate" data-id="${attr(p.id)}" title="${esc(t('saConfirmActivate'))}">★</button>`);
    if (p.status !== 'reversed') actions.push(`<button class="table-action danger" data-sa-action="payment-reverse" data-id="${attr(p.id)}" title="${esc(t('saReverse'))}">↩</button>`);
    actions.push(`<button class="table-action" data-sa-action="payment-receipt" data-id="${attr(p.id)}" title="${esc(t('saReceipt'))}">⎙</button>`);
    return `<tr><td>${esc(formatDate(p.payment_date))}</td><td><strong>${esc(p.district_name)}</strong><small>${esc(p.province_name)}</small></td><td>${esc(money(p.amount))}</td><td>${esc(t(METHOD[p.method]))}</td><td>${esc(p.reference_no)}</td><td>${esc(formatDate(p.period_start))} → ${esc(formatDate(p.period_end))}</td><td>${badge(t(PAY_LABEL[p.status]), PAY_TONE[p.status])}</td><td><div class="table-actions">${actions.join('')}</div></td></tr>`;
  }).join('');
}
async function renderPayments(ctx) {
  const p = ctx.params || {};
  const [payments, districts] = await Promise.all([
    api(ctx, 'payments.list', { p_tenant_id: p.tenant || null, p_from: p.from ? solarToIso(p.from) || null : null, p_to: p.to ? solarToIso(p.to) || null : null, p_status: p.status || null }),
    api(ctx, 'districts.list')
  ]);
  const totals = ['confirmed', 'draft', 'reversed'].map(k => [k, payments.filter(x => x.status === k).reduce((n, x) => n + Number(x.amount), 0)]);
  const filters = `<div class="toolbar"><select class="select-control" id="sa-tenant"><option value="">${esc(t('saAllDistricts'))}</option>${districts.map(d => option(d.tenant_id, `${d.province_name} · ${d.district_name}`, p.tenant)).join('')}</select><select class="select-control" id="sa-pstatus"><option value="">${esc(t('saAllStatuses'))}</option>${['confirmed', 'draft', 'reversed'].map(k => option(k, t(PAY_LABEL[k]), p.status)).join('')}</select><input class="select-control solar-date-input" id="sa-from" data-solar-date value="${attr(p.from || '')}" placeholder="${attr(t('saDateFrom'))}" maxlength="10"><input class="select-control solar-date-input" id="sa-to" data-solar-date value="${attr(p.to || '')}" placeholder="${attr(t('saDateTo'))}" maxlength="10"></div>`;
  return `<div class="page-actions" style="margin-bottom:14px"><button class="btn primary" data-sa-action="payment-add">＋ ${esc(t('saRecordPayment'))}</button><button class="btn outline" data-sa-action="payments-export">⇩ ${esc(t('exportExcel'))}</button></div><section class="card">${filters}<div class="table-summary">${totals.map(([k, v]) => `<div class="mini-stat"><div class="mini-value">${esc(money(v))}</div><div class="mini-label">${esc(t(PAY_LABEL[k]))}${k === 'confirmed' ? '' : ` · ${esc(t('saNotCounted'))}`}</div></div>`).join('')}</div><div class="table-wrap"><table class="data-table"><thead><tr><th>${esc(t('date'))}</th><th>${esc(t('saDistrict'))}</th><th>${esc(t('saAmountReceived'))}</th><th>${esc(t('saPaymentMethod'))}</th><th>${esc(t('saReference'))}</th><th>${esc(t('saPeriod'))}</th><th>${esc(t('status'))}</th><th>${esc(t('actions'))}</th></tr></thead><tbody>${paymentRows(payments) || `<tr><td colspan="8" class="no-data">${esc(t('noData'))}</td></tr>`}</tbody></table></div></section>`;
}
async function openPaymentForm(ctx, presetTenant = '') {
  await guarded(ctx, async () => {
    const [districts, provinces] = await Promise.all([api(ctx, 'districts.list'), api(ctx, 'provinces.list')]);
    const preset = districts.find(d => d.tenant_id === presetTenant) || null;
    const [start, end] = suggestPeriod(preset);
    const districtOptions = province => districts.filter(d => !province || d.province_id === province).map(d => option(d.tenant_id, d.district_name, preset?.tenant_id)).join('');
    ctx.openModal(t('saRecordPayment'), `<form class="form-grid" id="sa-form" novalidate>${field(t('saProvince'), `<select name="province"><option value="">${esc(t('saAllProvinces'))}</option>${provinces.map(x => option(x.province_id, x.name, preset?.province_id)).join('')}</select>`)}${field(t('saDistrict'), `<select name="tenant" required><option value="">${esc(t('select'))}</option>${districtOptions(preset?.province_id)}</select>`)}${field(t('saAnnualFee'), `<input name="fee" disabled value="${attr(preset ? money(preset.annual_fee) : '')}">`)}${field(`${t('saAmountReceived')} (${t('saCurrency')})`, `<input name="amount" type="number" min="1" step="0.01" required>`)}${field(t('saPaymentMethod'), `<select name="method" required><option value="">${esc(t('select'))}</option>${Object.entries(METHOD).map(([k, v]) => option(k, t(v))).join('')}</select>`)}${field(t('saPaymentDate'), solarInput('date', todayISO()))}${field(t('saReference'), `<input name="reference" required maxlength="80">`)}${field(t('saPeriodStart'), solarInput('start', start))}${field(t('saPeriodEnd'), solarInput('end', end))}${field(t('notes'), `<textarea name="notes" rows="2"></textarea>`, 'span-2')}<p class="form-hint" style="grid-column:1/-1">${esc(t('saDraftHint'))}</p>${formActions()}</form>`, { wide: true });
    const form = document.getElementById('sa-form'); wireDates(form);
    if (preset) form.elements.tenant.value = preset.tenant_id;
    form.elements.province.addEventListener('change', () => { form.elements.tenant.innerHTML = `<option value="">${esc(t('select'))}</option>${districtOptions(form.elements.province.value)}`; form.elements.fee.value = ''; });
    form.elements.tenant.addEventListener('change', () => { const d = districts.find(x => x.tenant_id === form.elements.tenant.value); form.elements.fee.value = d ? money(d.annual_fee) : ''; if (d) { const [s, e] = suggestPeriod(d); form.elements.start.value = toSolarDate(s); form.elements.end.value = toSolarDate(e); } });
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (!form.reportValidity()) return;
      const date = solarToIso(form.elements.date.value), s = solarToIso(form.elements.start.value), e = solarToIso(form.elements.end.value);
      if (!date || !s || !e) { ctx.notify(t('invalid'), 'error'); return; }
      await guarded(ctx, async () => {
        await api(ctx, 'payments.record', { p_tenant_id: form.elements.tenant.value, p_amount: Number(form.elements.amount.value), p_method: form.elements.method.value, p_payment_date: date, p_reference_no: form.elements.reference.value.trim(), p_period_start: s, p_period_end: e, p_notes: form.elements.notes.value.trim() || null });
        ctx.closeModal(); ctx.notify(t('saPaymentRecorded'), 'success'); ctx.navigate('super-admin', { tab: 'payments' }, { replace: true });
      });
    });
  });
}
async function confirmPayment(ctx, id, activate) {
  const ok = await ctx.confirm(t(activate ? 'saConfirmActivatePrompt' : 'saConfirmPrompt')); if (!ok) return;
  await guarded(ctx, async () => {
    const result = await api(ctx, 'payments.confirm', { p_payment_id: id, p_activate: activate });
    ctx.notify(activate && !result.activated ? t('saConfirmedNotCovered') : t('saPaymentConfirmed'), activate && !result.activated ? 'warning' : 'success');
    await ctx.refresh();
  });
}
function openReverseForm(ctx, id) {
  ctx.openModal(t('saReverse'), `<form class="form-grid" id="sa-form" novalidate><p class="form-hint" style="grid-column:1/-1">${esc(t('saReverseHint'))}</p>${field(t('saReason'), `<textarea name="reason" rows="3" required maxlength="500"></textarea>`, 'span-2')}${formActions()}</form>`);
  const form = document.getElementById('sa-form');
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!form.reportValidity()) return;
    await guarded(ctx, async () => { await api(ctx, 'payments.reverse', { p_payment_id: id, p_reason: form.elements.reason.value.trim() }); ctx.closeModal(); ctx.notify(t('saved'), 'success'); await ctx.refresh(); });
  });
}
async function printReceipt(ctx, id) {
  await guarded(ctx, async () => {
    const list = await api(ctx, 'payments.list', {});
    const p = list.find(x => x.id === id); if (!p) return;
    const body = `<div class="print-section"><h3>${esc(t('saPaymentReceipt'))}</h3>${kvTable([[t('appShortName'), t('appShortName')], [t('saProvince'), p.province_name], [t('saDistrict'), p.district_name], [t('saAmountReceived'), money(p.amount)], [t('saPaymentMethod'), t(METHOD[p.method])], [t('saPaymentDate'), formatDate(p.payment_date)], [t('saReference'), p.reference_no], [t('saPeriod'), `${formatDate(p.period_start)} → ${formatDate(p.period_end)}`], [t('status'), t(PAY_LABEL[p.status])], [t('saRecordedBy'), p.recorded_by_email || '—'], [t('saConfirmedBy'), p.confirmed_by_email || '—']])}</div>`;
    await ctx.printOfficial(t('saPaymentReceipt'), body);
  });
}

/* ------------------------------------------------------------------- reports */
const REPORTS = ['subscriptions', 'activeInactive', 'expiring', 'byDistrict', 'byRange', 'cashBank', 'outstanding', 'annual'];
function buildReport(kind, districts, payments, p) {
  const confirmed = payments.filter(x => x.status === 'confirmed');
  const dist = d => [d.province_name, d.district_name, money(d.annual_fee), d.subscription_start ? `${formatDate(d.subscription_start)} → ${formatDate(d.subscription_end)}` : '—', t(DIST_LABEL[d.effective_status])];
  const distHead = [t('saProvince'), t('saDistrict'), t('saAnnualFee'), t('saPeriod'), t('status')];
  const payHead = [t('date'), t('saProvince'), t('saDistrict'), t('saAmountReceived'), t('saPaymentMethod'), t('saReference'), t('status')];
  const pay = x => [formatDate(x.payment_date), x.province_name, x.district_name, money(x.amount), t(METHOD[x.method]), x.reference_no, t(PAY_LABEL[x.status])];
  const today = new Date().toISOString().slice(0, 10), soon = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  switch (kind) {
    case 'subscriptions': return { headers: distHead, rows: districts.map(dist) };
    case 'activeInactive': return { headers: [...distHead, t('saAmountReceived')], rows: districts.slice().sort((a, b) => a.effective_status.localeCompare(b.effective_status)).map(d => [...dist(d), money(d.paid_current)]) };
    case 'expiring': return { headers: distHead, rows: districts.filter(d => d.subscription_end && (d.effective_status === 'expired' || (d.effective_status === 'active' && d.subscription_end <= soon))).sort((a, b) => a.subscription_end.localeCompare(b.subscription_end)).map(dist) };
    case 'byDistrict': return { headers: payHead, rows: payments.map(pay), totals: confirmedTotals(payments) };
    case 'byRange': return { headers: payHead, rows: payments.map(pay), totals: confirmedTotals(payments) };
    case 'cashBank': return { headers: [t('saPaymentMethod'), t('saConfirmed'), t('saDraft'), t('saReversed')], rows: Object.keys(METHOD).map(m => [t(METHOD[m]), ...['confirmed', 'draft', 'reversed'].map(s => money(payments.filter(x => x.method === m && x.status === s).reduce((n, x) => n + Number(x.amount), 0)))]), totals: confirmedTotals(payments) };
    case 'outstanding': return { headers: [t('saProvince'), t('saDistrict'), t('saAnnualFee'), t('saAmountReceived'), t('saRemaining')], rows: districts.filter(d => Number(d.outstanding) > 0).map(d => [d.province_name, d.district_name, money(d.annual_fee), money(d.paid_current), money(d.outstanding)]) };
    case 'annual': { const byYear = {}; confirmed.forEach(x => { const y = String(x.payment_date).slice(0, 4); byYear[y] = (byYear[y] || 0) + Number(x.amount); }); return { headers: [t('year'), t('saTotalReceived')], rows: Object.entries(byYear).sort((a, b) => b[0].localeCompare(a[0])).map(([y, v]) => [y, money(v)]), totals: confirmedTotals(payments) }; }
    default: return { headers: [], rows: [] };
  }
}
function confirmedTotals(payments) {
  const sum = s => payments.filter(x => x.status === s).reduce((n, x) => n + Number(x.amount), 0);
  return `${t('saConfirmed')}: ${money(sum('confirmed'))} · ${t('saDraft')}: ${money(sum('draft'))} (${t('saNotCounted')}) · ${t('saReversed')}: ${money(sum('reversed'))} (${t('saNotCounted')})`;
}
async function loadReport(ctx) {
  const p = ctx.params || {};
  const kind = REPORTS.includes(p.report) ? p.report : 'subscriptions';
  const districts = await api(ctx, 'districts.list');
  const payments = ['byDistrict', 'byRange', 'cashBank', 'annual'].includes(kind)
    ? await api(ctx, 'payments.list', { p_tenant_id: kind === 'byDistrict' ? (p.tenant || null) : null, p_from: kind === 'byRange' && p.from ? solarToIso(p.from) || null : null, p_to: kind === 'byRange' && p.to ? solarToIso(p.to) || null : null })
    : [];
  return { kind, districts, payments, report: buildReport(kind, districts, payments, p) };
}
async function renderReports(ctx) {
  const p = ctx.params || {};
  const { kind, districts, report } = await loadReport(ctx);
  const controls = `<div class="toolbar"><select class="select-control" id="sa-report">${REPORTS.map(k => option(k, t(`saReport_${k}`), kind)).join('')}</select>${kind === 'byDistrict' ? `<select class="select-control" id="sa-rtenant"><option value="">${esc(t('saAllDistricts'))}</option>${districts.map(d => option(d.tenant_id, `${d.province_name} · ${d.district_name}`, p.tenant)).join('')}</select>` : ''}${kind === 'byRange' ? `<input class="select-control solar-date-input" id="sa-rfrom" data-solar-date value="${attr(p.from || '')}" placeholder="${attr(t('saDateFrom'))}" maxlength="10"><input class="select-control solar-date-input" id="sa-rto" data-solar-date value="${attr(p.to || '')}" placeholder="${attr(t('saDateTo'))}" maxlength="10">` : ''}<button class="btn outline small" data-sa-action="report-print">⎙ ${esc(t('print'))}</button><button class="btn outline small" data-sa-action="report-export">⇩ ${esc(t('exportExcel'))}</button></div>`;
  return `<section class="card">${controls}<div class="table-wrap"><table class="data-table"><thead><tr>${report.headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${report.rows.length ? report.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${report.headers.length}" class="no-data">${esc(t('noData'))}</td></tr>`}</tbody></table></div>${report.totals ? `<p class="form-hint" style="padding:12px 16px">${esc(report.totals)} — ${esc(t('saConfirmedOnly'))}</p>` : ''}</section>`;
}

/* --------------------------------------------------------------- audit & settings */
async function renderAudit(ctx) {
  const rows = await api(ctx, 'audit.list', { p_limit: 300 });
  const body = rows.map(a => `<tr><td>${esc(formatDate(a.created_at))}</td><td>${esc(a.action)}</td><td>${esc(a.actor_email || '—')}</td><td>${esc(a.tenant_id || '—')}</td><td><small>${esc(JSON.stringify(a.details || {}))}</small></td></tr>`).join('');
  return `<section class="card"><div class="table-wrap"><table class="data-table"><thead><tr><th>${esc(t('date'))}</th><th>${esc(t('saAction'))}</th><th>${esc(t('saActor'))}</th><th>${esc(t('saDistrict'))}</th><th>${esc(t('details'))}</th></tr></thead><tbody>${body || `<tr><td colspan="5" class="no-data">${esc(t('noData'))}</td></tr>`}</tbody></table></div></section>`;
}
async function renderSettings(ctx) {
  const s = await api(ctx, 'settings.get');
  return `<section class="card"><div class="card-body"><form class="form-grid" id="sa-settings" novalidate>${field(t('saExpiredPolicy'), `<select name="policy">${[['read_only', 'saPolicyReadOnly'], ['block', 'saPolicyBlock'], ['grace', 'saPolicyGrace']].map(([k, l]) => option(k, t(l), s.expired_policy)).join('')}</select>`, 'span-2')}${field(t('saGraceDays'), `<input name="grace" type="number" min="0" max="365" value="${attr(s.grace_days)}">`)}<p class="form-hint" style="grid-column:1/-1">${esc(t('saPolicyHint'))}</p><div class="form-actions" style="grid-column:1/-1"><button type="submit" class="btn primary">✓ ${esc(t('save'))}</button></div></form></div></section>`;
}

/* ------------------------------------------------------------------ bindings */
export async function bind(ctx, root) {
  const go = patch => ctx.navigate('super-admin', { ...(ctx.params || {}), ...patch }, { replace: true });
  const fix = el => { if (el) el.value = el.value.replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/\//g, '-').replace(/[^0-9-]/g, '').slice(0, 10); };
  root.querySelectorAll('[data-solar-date]').forEach(input => input.addEventListener('input', () => fix(input)));
  root.querySelectorAll('[data-sa-tab]').forEach(btn => btn.addEventListener('click', () => ctx.navigate('super-admin', { tab: btn.dataset.saTab }, { replace: true })));
  const on = (selector, event, handler) => root.querySelector(selector)?.addEventListener(event, handler);
  on('#sa-q', 'change', e => go({ q: e.target.value.trim() }));
  on('#sa-province', 'change', e => go({ province: e.target.value }));
  on('#sa-status', 'change', e => go({ status: e.target.value }));
  on('#sa-before', 'change', e => go({ before: e.target.value.trim() }));
  on('#sa-tenant', 'change', e => go({ tenant: e.target.value }));
  on('#sa-pstatus', 'change', e => go({ status: e.target.value }));
  on('#sa-from', 'change', e => go({ from: e.target.value.trim() }));
  on('#sa-to', 'change', e => go({ to: e.target.value.trim() }));
  on('#sa-report', 'change', e => go({ report: e.target.value, tenant: '', from: '', to: '' }));
  on('#sa-rtenant', 'change', e => go({ tenant: e.target.value }));
  on('#sa-rfrom', 'change', e => go({ from: e.target.value.trim() }));
  on('#sa-rto', 'change', e => go({ to: e.target.value.trim() }));
  on('#sa-settings', 'submit', async event => {
    event.preventDefault();
    const form = event.target;
    await guarded(ctx, async () => { await api(ctx, 'settings.save', { p_expired_policy: form.elements.policy.value, p_grace_days: Number(form.elements.grace.value || 0) }); ctx.notify(t('saved'), 'success'); });
  });
  root.addEventListener('click', async event => {
    const el = event.target.closest('[data-sa-action]'); if (!el) return;
    const action = el.dataset.saAction, id = el.dataset.id;
    if (action === 'province-add') return openProvinceForm(ctx, null);
    if (action === 'province-edit' || action === 'province-toggle') {
      return guarded(ctx, async () => {
        const province = (await api(ctx, 'provinces.list')).find(x => x.province_id === id); if (!province) return;
        if (action === 'province-edit') return openProvinceForm(ctx, province);
        if (!(await ctx.confirm(t(province.active ? 'saDeactivateProvincePrompt' : 'saActivatePrompt')))) return;
        await api(ctx, 'provinces.save', { p_province_id: id, p_name: province.name, p_active: !province.active }); await ctx.refresh();
      });
    }
    if (action === 'province-districts') return ctx.navigate('super-admin', { tab: 'districts', province: id }, { replace: true });
    if (action === 'district-add') return openDistrictForm(ctx, '');
    if (action === 'district-edit') return openDistrictForm(ctx, id);
    if (action === 'district-activate') return openActivateForm(ctx, id);
    if (action === 'district-history') return openHistory(ctx, id);
    if (action === 'district-deactivate') {
      if (!(await ctx.confirm(t('saDeactivatePrompt')))) return;
      return guarded(ctx, async () => { await api(ctx, 'districts.deactivate', { p_tenant_id: id, p_reason: null }); ctx.notify(t('saved'), 'success'); await ctx.refresh(); });
    }
    if (action === 'payment-add') return openPaymentForm(ctx, id || '');
    if (action === 'payment-confirm') return confirmPayment(ctx, id, false);
    if (action === 'payment-confirm-activate') return confirmPayment(ctx, id, true);
    if (action === 'payment-reverse') return openReverseForm(ctx, id);
    if (action === 'payment-receipt') return printReceipt(ctx, id);
    if (action === 'payments-export' || action === 'report-export' || action === 'report-print') {
      return guarded(ctx, async () => {
        if (action === 'payments-export') {
          const p = ctx.params || {};
          const rows = await api(ctx, 'payments.list', { p_tenant_id: p.tenant || null, p_from: p.from ? solarToIso(p.from) || null : null, p_to: p.to ? solarToIso(p.to) || null : null, p_status: p.status || null });
          return exportRows(`payments-${todayISO()}.xlsx`, 'Payments', ['Date', 'Province', 'District', 'Amount AFN', 'Method', 'Reference', 'Period start', 'Period end', 'Status', 'Recorded by', 'Confirmed by'], rows.map(x => [x.payment_date, x.province_name, x.district_name, Number(x.amount), x.method, x.reference_no, x.period_start, x.period_end, x.status, x.recorded_by_email || '', x.confirmed_by_email || '']));
        }
        const { kind, report } = await loadReport(ctx);
        if (action === 'report-export') return exportRows(`report-${kind}-${todayISO()}.xlsx`, 'Report', report.headers, report.rows);
        return ctx.printOfficial(t(`saReport_${kind}`), `<div class="print-section"><h3>${esc(t(`saReport_${kind}`))}</h3>${printTable(report.headers, report.rows)}${report.totals ? `<p>${esc(report.totals)}</p>` : ''}</div>`);
      });
    }
  });
}
