import { esc, attr } from './utils.js';

// District administrator panel: seats used and approval of pending sign-ups.
// All authorisation is enforced by the database functions my_district_members() / review_member().
export async function mountApprovals(ctx, root) {
  const box = root.querySelector('[data-approvals-root]');
  if (!box || !ctx.online?.memberApprovals) return;
  const draw = async () => {
    let info;
    try { info = await ctx.online.memberApprovals(); }
    catch (error) { box.innerHTML = ''; return; }   // not an approved administrator (or database not migrated yet)
    const pending = Array.isArray(info.pending) ? info.pending : [];
    const rows = pending.map(p => `<tr><td><strong>${esc(p.display_name || '—')}</strong><small>${esc(p.email || '')}</small></td><td>${esc(p.phone || '—')}</td><td><div class="table-actions"><button class="btn secondary small" type="button" data-approval="approve" data-user="${attr(p.user_id)}">✓ تایید</button><button class="btn outline small" type="button" data-approval="reject" data-user="${attr(p.user_id)}">✕ رد</button></div></td></tr>`).join('');
    box.innerHTML = `<div class="card" style="margin-top:12px"><div class="card-body"><strong>د ولسوالۍ د حسابونو تایید</strong><p class="muted">کارول شوي حسابونه: ${Number(info.used || 0)} / ${Number(info.max_users || 0)}</p>${pending.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>نوم</th><th>تلیفون</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">د تایید لپاره هېڅ نوې غوښتنه نشته.</p>'}</div></div>`;
  };
  if (!box.dataset.bound) {
    box.dataset.bound = '1';
    box.addEventListener('click', async e => {
      const button = e.target.closest('[data-approval]'); if (!button) return;
      const approve = button.dataset.approval === 'approve';
      if (!approve && !(await ctx.confirm('ایا دا غوښتنه رد کړئ؟'))) return;
      button.disabled = true;
      try { await ctx.online.reviewMember(button.dataset.user, approve); ctx.notify(approve ? 'حساب تایید شو' : 'غوښتنه رد شوه', 'success'); if (approve) { try { await ctx.online.syncNow(); } catch { /* next sync will retry */ } } }
      catch (error) { ctx.notify(error.message || 'کړنه ناکامه شوه', 'error'); }
      await draw();
    });
  }
  await draw();
}
