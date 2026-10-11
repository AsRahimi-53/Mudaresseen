import { db } from './database.js';
import { t } from './translations.js';
import { esc, attr, formatDate, formatNumber, percent, badge, actionButtons, printTable, kvTable, initials } from './utils.js';
import { moduleHeader, toolbar, tableHtml, openEntityForm, removeEntity, genderOptions, statusOptions, madrasaSelectOptions, madrasaNames, idsOf, photoAvatar } from './moduleHelpers.js';

function fields(madrasas) {
  return [
    { type:'section', label:'staffDirectory', hint:'staffInformation' },
    { key:'fullName', label:'fullName', required:true },
    { key:'fatherName', label:'fatherName', required:true },
    { key:'grandfatherName', label:'grandfatherName' },
    { key:'employeeId', label:'employeeId', required:true },
    { key:'gender', label:'gender', type:'select', options:genderOptions, required:true },
    { key:'dateOfBirth', label:'dateOfBirth', type:'date' },
    { key:'madrasaIds', label:'madrasa', type:'multi-select', options:()=>madrasaSelectOptions(madrasas), required:true },
    { key:'position', label:'position', required:true },
    { key:'department', label:'department' },
    { key:'specialization', label:'specialization' },
    { key:'qualification', label:'qualification' },
    { key:'professionalQualification', label:'professionalQualification' },
    { key:'experience', label:'experience' },
    { key:'appointmentDate', label:'appointmentDate', type:'date' },
    { key:'employmentStatus', label:'employmentStatus', type:'select', options:statusOptions, default:'active' },
    { key:'phone', label:'phone', type:'tel' },
    { key:'email', label:'email', type:'email' },
    { key:'address', label:'address', span:2 },
    { key:'photo', label:'photo', type:'file' },
    { key:'notes', label:'notes', type:'textarea', span:2 }
  ];
}

function searchable(row, madrasas) {
  return [row.fullName, row.fatherName, row.grandfatherName, row.employeeId, row.position, row.department, row.specialization, row.phone, madrasaNames(madrasas, row, 'madrasaIds', 'madrasaId')].join(' ');
}
function summaryRows(records, madrasas) {
  const groups = Object.entries(records.reduce((acc, row) => {
    const key = madrasaNames(madrasas, row, 'madrasaIds', 'madrasaId');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {})).sort((a,b) => b[1] - a[1]);
  return groups.map(([name, count]) => `<tr><td>${esc(name)}</td><td>${esc(formatNumber(count))}</td><td>${esc(percent(count / Math.max(1, records.length) * 100))}</td></tr>`).join('') || `<tr><td colspan="3" class="no-data">${esc(t('noData'))}</td></tr>`;
}

export async function render(ctx) {
  const [records, madrasas] = await Promise.all([db.getAll('staff'), db.getAll('madrasas')]);
  if (ctx.params?.id) return profile(ctx, ctx.params.id, records, madrasas);
  const query = String(ctx.params?.q || '').toLocaleLowerCase();
  const filtered = query ? records.filter(row => searchable(row, madrasas).toLocaleLowerCase().includes(query)) : records;
  const active = records.filter(row => row.employmentStatus !== 'inactive' && row.employmentStatus !== 'onLeave').length;
  const male = records.filter(row => row.gender === 'male').length;
  const female = records.filter(row => row.gender === 'female').length;
  const rows = filtered.map(row => `<tr data-row-search="${attr(searchable(row, madrasas))}"><td><div class="member-mini"><div class="mini-avatar">${row.photo ? `<img src="${attr(row.photo)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : esc(initials(row.fullName))}</div><div><strong>${esc(row.fullName || '—')}</strong><small>${esc(row.employeeId || '')} · ${esc(row.fatherName || '')}</small></div></div></td><td>${esc(madrasaNames(madrasas, row, 'madrasaIds', 'madrasaId'))}</td><td>${esc(row.position || '—')}</td><td>${esc(row.department || '—')}</td><td>${esc(row.gender ? t(row.gender, row.gender) : '—')}</td><td>${badge(t(row.employmentStatus || 'active', row.employmentStatus || 'active'))}</td><td>${esc(formatDate(row.appointmentDate))}</td><td>${actionButtons(row.id,{store:'staff'})}</td></tr>`);
  return `${moduleHeader('staff', `${formatNumber(records.length)} ${t('staff')}`, `<button class="btn primary" data-staff-action="add">＋ ${esc(t('addStaff'))}</button><button class="btn outline" data-staff-action="print">⎙ ${esc(t('print'))}</button><button class="btn outline" data-staff-action="export">⇩ ${esc(t('exportExcel'))}</button>`)}<section class="card">${toolbar(t('search'), `<select class="select-control" data-staff-gender><option value="">${esc(t('gender'))}</option><option value="male">${esc(t('male'))}</option><option value="female">${esc(t('female'))}</option></select><select class="select-control" data-staff-status><option value="">${esc(t('status'))}</option>${statusOptions().map(option => `<option value="${attr(option.value)}">${esc(option.label)}</option>`).join('')}</select>`)}<div class="table-summary"><div class="mini-stat"><div class="mini-value">${esc(formatNumber(records.length))}</div><div class="mini-label">${esc(t('overallStaff'))}</div></div><div class="mini-stat"><div class="mini-value">${esc(formatNumber(active))}</div><div class="mini-label">${esc(t('active'))}</div></div><div class="mini-stat"><div class="mini-value">${esc(formatNumber(male))}</div><div class="mini-label">${esc(t('male'))}</div></div><div class="mini-stat"><div class="mini-value">${esc(formatNumber(female))}</div><div class="mini-label">${esc(t('female'))}</div></div></div>${tableHtml([t('fullName'), t('madrasa'), t('position'), t('department'), t('gender'), t('status'), t('appointmentDate'), t('actions')], rows, t('noStaff'), `<button class="btn primary small" data-staff-action="add">＋ ${esc(t('addStaff'))}</button>`)}</section><section class="card" style="margin-top:17px"><div class="card-head"><div><h2>${esc(t('staffSummary'))}</h2><p>${esc(t('byMadrasa'))}</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>${esc(t('madrasa'))}</th><th>${esc(t('total'))}</th><th>${esc(t('percentage'))}</th></tr></thead><tbody>${summaryRows(records, madrasas)}</tbody></table></div></section>`;
}

async function profile(ctx, id, records, madrasas) {
  const record = records.find(row => row.id === id);
  if (!record) { ctx.navigate('staff'); return ''; }
  return `${moduleHeader('profile', `${esc(record.fullName)} · ${esc(record.employeeId || '')}`, `<button class="btn outline" data-staff-action="back">← ${esc(t('staff'))}</button><button class="btn outline" data-staff-action="print-profile" data-id="${attr(id)}">⎙ ${esc(t('print'))}</button><button class="btn primary" data-staff-action="edit" data-id="${attr(id)}">✎ ${esc(t('edit'))}</button>`)}<section class="card"><div class="profile-head">${photoAvatar(record)}<div><h2>${esc(record.fullName)}</h2><div class="profile-meta"><span>${esc(record.position || '—')}</span><span>·</span><span>${esc(record.employeeId || '—')}</span><span>${badge(t(record.employmentStatus || 'active', record.employmentStatus || 'active'))}</span></div><div class="profile-meta" style="margin-top:7px"><span>${esc(madrasaNames(madrasas, record, 'madrasaIds', 'madrasaId'))}</span><span>·</span><span>${esc(record.department || '—')}</span></div></div></div><div class="card-body"><dl class="detail-grid"><div class="detail-item"><dt>${esc(t('fatherName'))}</dt><dd>${esc(record.fatherName || '—')}</dd></div><div class="detail-item"><dt>${esc(t('grandfatherName'))}</dt><dd>${esc(record.grandfatherName || '—')}</dd></div><div class="detail-item"><dt>${esc(t('gender'))}</dt><dd>${esc(t(record.gender, record.gender) || '—')}</dd></div><div class="detail-item"><dt>${esc(t('dateOfBirth'))}</dt><dd>${esc(formatDate(record.dateOfBirth))}</dd></div><div class="detail-item"><dt>${esc(t('qualification'))}</dt><dd>${esc(record.qualification || '—')}</dd></div><div class="detail-item"><dt>${esc(t('professionalQualification'))}</dt><dd>${esc(record.professionalQualification || '—')}</dd></div><div class="detail-item"><dt>${esc(t('experience'))}</dt><dd>${esc(record.experience || '—')}</dd></div><div class="detail-item"><dt>${esc(t('appointmentDate'))}</dt><dd>${esc(formatDate(record.appointmentDate))}</dd></div><div class="detail-item"><dt>${esc(t('phone'))}</dt><dd>${esc(record.phone || '—')}</dd></div><div class="detail-item"><dt>${esc(t('email'))}</dt><dd>${esc(record.email || '—')}</dd></div><div class="detail-item"><dt>${esc(t('address'))}</dt><dd>${esc(record.address || '—')}</dd></div><div class="detail-item"><dt>${esc(t('notes'))}</dt><dd>${esc(record.notes || '—')}</dd></div></dl></div></section>`;
}

export async function bind(ctx, root) {
  const filter = () => {
    const query = (root.querySelector('[data-module-search]')?.value || '').toLocaleLowerCase();
    const gender = root.querySelector('[data-staff-gender]')?.value || '';
    const status = root.querySelector('[data-staff-status]')?.value || '';
    root.querySelectorAll('[data-row-search]').forEach(row => {
      const genderOk = !gender || row.querySelector('td:nth-child(5)')?.textContent === t(gender, gender);
      const statusOk = !status || row.querySelector('td:nth-child(6)')?.textContent.toLocaleLowerCase().includes(t(status, status).toLocaleLowerCase());
      row.style.display = (!query || row.dataset.rowSearch.toLocaleLowerCase().includes(query)) && genderOk && statusOk ? '' : 'none';
    });
  };
  root.querySelector('[data-module-search]')?.addEventListener('input', filter);
  root.querySelector('[data-staff-gender]')?.addEventListener('change', filter);
  root.querySelector('[data-staff-status]')?.addEventListener('change', filter);
  root.addEventListener('click', async event => {
    const actionEl = event.target.closest('[data-staff-action]');
    if (actionEl) {
      const action = actionEl.dataset.staffAction;
      const id = actionEl.dataset.id || ctx.params?.id || '';
      if (action === 'add') return openStaff(ctx);
      if (action === 'export') return ctx.export('staff');
      if (action === 'print') {
        const [rows, madrasas] = await Promise.all([db.getAll('staff'), db.getAll('madrasas')]);
        return ctx.printOfficial(t('staff'), `<div class="print-section"><h3>${esc(t('staffInformation'))}</h3>${printTable([t('fullName'), t('employeeId'), t('madrasa'), t('position'), t('department'), t('gender'), t('status'), t('appointmentDate')], rows.map(row => [row.fullName, row.employeeId, madrasaNames(madrasas, row, 'madrasaIds', 'madrasaId'), row.position, row.department || '—', t(row.gender, row.gender), t(row.employmentStatus, row.employmentStatus), formatDate(row.appointmentDate)]))}</div>`);
      }
      if (action === 'back') return ctx.navigate('staff');
      if (action === 'print-profile') {
        const [rows, madrasas] = await Promise.all([db.getAll('staff'), db.getAll('madrasas')]);
        const row = rows.find(item => item.id === id);
        if (!row) return;
        const body = `<div class="print-section"><h3>${esc(t('staffInformation'))}</h3>${kvTable([[t('fullName'), row.fullName], [t('fatherName'), row.fatherName], [t('employeeId'), row.employeeId], [t('madrasa'), madrasaNames(madrasas, row, 'madrasaIds', 'madrasaId')], [t('position'), row.position], [t('department'), row.department], [t('gender'), t(row.gender, row.gender)], [t('qualification'), row.qualification], [t('appointmentDate'), formatDate(row.appointmentDate)], [t('phone'), row.phone], [t('status'), t(row.employmentStatus, row.employmentStatus)]])}</div>`;
        return ctx.printOfficial(t('staff'), body);
      }
      if (action === 'edit') return openStaff(ctx, id);
    }
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    const id = button.dataset.id;
    if (action === 'view') return ctx.navigate('staff', { id });
    if (action === 'edit') return openStaff(ctx, id);
    if (action === 'delete') return removeEntity(ctx, 'staff', id);
  });
}

async function openStaff(ctx, id = '') {
  const [records, madrasas] = await Promise.all([db.getAll('staff'), db.getAll('madrasas')]);
  const source = id ? records.find(row => row.id === id) : { employmentStatus: 'active' };
  const record = { ...source, madrasaIds: idsOf(source, 'madrasaIds', 'madrasaId') };
  return openEntityForm(ctx, {
    store: 'staff',
    title: id ? `${t('edit')} · ${t('staff')}` : t('addStaff'),
    record,
    fields: fields(madrasas),
    photoField: 'photo',
    wide: true,
    beforeSave: data => {
      if (!data.fullName || !data.fatherName || !data.employeeId || !data.madrasaIds?.length || !data.position) {
        ctx.notify(t('invalid'), 'error');
        return false;
      }
      if (records.some(row => row.id !== id && row.employeeId === data.employeeId)) {
        ctx.notify(t('duplicateEmployeeId'), 'warning');
        return false;
      }
      data.madrasaIds = Array.isArray(data.madrasaIds) ? data.madrasaIds.filter(Boolean) : [];
      data.madrasaId = data.madrasaIds[0] || '';
      data.staffType = 'administrative';
      data.recordType = 'staff';
      data.employmentStatus = data.employmentStatus || 'active';
      return data;
    }
  });
}

export async function autoAdd(ctx) { return openStaff(ctx); }
