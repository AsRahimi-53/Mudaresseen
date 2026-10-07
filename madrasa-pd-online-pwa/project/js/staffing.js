import { safeNumber } from './utils.js';

function statusIsFilled(status) {
  return !['inactive', 'onLeave', 'vacant', 'left'].includes(String(status || '').trim());
}
function identityKeys(row) {
  const keys = [];
  const employeeId = row.employeeId || row.teacherId;
  if (employeeId) keys.push(`employee:${employeeId}|${row.madrasaId || ''}`);
  if (row.fullName || row.staffName) keys.push(`name:${row.fullName || row.staffName}|${row.madrasaId || ''}`);
  return keys;
}
function normalize(row, type, source) {
  const status = row.employmentStatus || row.status || 'active';
  const approvedPosts = row.approvedPosts === undefined || row.approvedPosts === '' ? 1 : Math.max(0, safeNumber(row.approvedPosts));
  const filledPosts = row.filledPosts === undefined || row.filledPosts === ''
    ? (statusIsFilled(status) ? 1 : 0)
    : Math.min(approvedPosts, Math.max(0, safeNumber(row.filledPosts)));
  return {
    id: `${source}:${row.id}`,
    source,
    sourceId: row.id,
    staffType: row.staffType === 'administrative' || type === 'administrative' ? 'administrative' : 'teacher',
    staffName: row.fullName || row.staffName || '—',
    employeeId: row.employeeId || row.teacherId || '',
    gender: row.gender || '',
    madrasaId: row.madrasaId || '',
    position: row.position || row.tashkilPosition || '—',
    subject: row.subject || '',
    status,
    appointmentDate: row.appointmentDate || '',
    approvedPosts,
    filledPosts,
    vacantPosts: Math.max(0, approvedPosts - filledPosts),
    notes: row.notes || ''
  };
}

/**
 * Build the read-only formation view from teacher and administrative-staff
 * registration records. Old records saved in the former Tashkil editor are
 * retained when they do not duplicate a current registration.
 */
export function formationRows(teachers = [], staff = [], legacy = []) {
  const rows = [];
  const identities = new Set();
  const add = (record, type, source) => {
    const row = normalize(record, type, source);
    rows.push(row);
    identityKeys(record).forEach(key => identities.add(key));
  };
  teachers.forEach(record => add(record, 'teacher', 'teacher'));
  staff.forEach(record => add(record, 'administrative', 'staff'));
  legacy.filter(record => record && (record.recordType === 'staffing' || record.staffType)).forEach(record => {
    const keys = identityKeys(record);
    if (!keys.some(key => identities.has(key))) add(record, record.staffType === 'administrative' ? 'administrative' : 'teacher', 'legacy');
  });
  return rows;
}

export function formationTotals(rows = []) {
  return rows.reduce((totals, row) => {
    totals.approved += safeNumber(row.approvedPosts);
    totals.filled += safeNumber(row.filledPosts);
    totals.vacant += safeNumber(row.vacantPosts);
    if (row.staffType === 'administrative') totals.administrative += 1;
    else totals.teachers += 1;
    return totals;
  }, { approved: 0, filled: 0, vacant: 0, teachers: 0, administrative: 0 });
}
