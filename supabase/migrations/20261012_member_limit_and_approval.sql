-- =====================================================================
-- Per-district user limit (default 4) + district-administrator approval of new accounts.
-- Additive and re-runnable. Existing accounts stay APPROVED and keep working; nothing is deleted.
-- Districts that already have more users than the limit (e.g. 6 > 4) keep them, but get no NEW sign-ups
-- until the Super Admin raises the limit or accounts are removed.
-- Run after 20261009 and 20261011.
-- =====================================================================
begin;

alter table public.district_registry add column if not exists max_users integer not null default 4;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'district_registry_max_users_check') then
    alter table public.district_registry add constraint district_registry_max_users_check check (max_users between 1 and 500);
  end if;
end $$;

alter table public.user_profiles add column if not exists status text not null default 'approved';   -- existing rows -> approved
alter table public.user_profiles alter column status set default 'pending';                          -- new rows must be approved explicitly
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'user_profiles_status_check') then
    alter table public.user_profiles add constraint user_profiles_status_check check (status in ('pending', 'approved', 'rejected'));
  end if;
end $$;

-- A pending / rejected account has NO district: every RLS policy built on these helpers denies it.
create or replace function public.current_user_tenant() returns text language sql stable security definer set search_path = public as $$
  select coalesce(tenant_id, district_id) from public.user_profiles where user_id = auth.uid() and status = 'approved';
$$;
create or replace function public.current_user_role() returns text language sql stable security definer set search_path = public as $$
  select role from public.user_profiles where user_id = auth.uid() and status = 'approved';
$$;

-- Signup trigger: seat limit + pending status (see comments inside).
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  raw_province text := coalesce(nullif(trim(meta->>'province_id'), ''), nullif(trim(meta->>'province_name'), ''), '');
  raw_district text := coalesce(nullif(trim(meta->>'district_id_short'), ''), nullif(trim(meta->>'district_name'), ''), '');
  input_province_id text := public.normalize_scope_part(raw_province);
  input_district_id text := public.normalize_scope_part(raw_district);
  input_tenant_id text := public.make_tenant_id(input_province_id, input_district_id);
  member_key text := coalesce(nullif(trim(meta->>'member_id'), ''), new.id::text);
  full_name_value text := coalesce(nullif(trim(meta->>'full_name'), ''), split_part(coalesce(new.email, ''), '@', 1));
  phone_value text := coalesce(meta->>'phone', '');
  registry_row public.district_registry%rowtype;
  assigned_role text;
  assigned_status text;
  used_seats integer;
begin
  -- Owner bootstrap: only a district-less user whose e-mail was pre-authorised
  -- from the SQL Editor is accepted. It receives no profile and no privileges;
  -- promotion is a separate, manual SQL step (bootstrap_super_admin).
  if raw_province = '' and raw_district = ''
     and exists (select 1 from public.super_admin_invites i where lower(i.email) = lower(coalesce(new.email, ''))) then
    return new;
  end if;

  if input_tenant_id = '' then
    raise exception 'Province and district are required for signup';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('district-signup:' || input_tenant_id, 0));

  select r.* into registry_row
  from public.district_registry r
  where r.tenant_id = input_tenant_id and public.district_signup_eligible(r.tenant_id);

  if not found then
    raise exception 'This province and district are not registered';
  end if;

  -- Seat limit: approved + pending accounts count; rejected ones free their seat.
  select count(*) into used_seats from public.user_profiles up
   where up.tenant_id = registry_row.tenant_id and up.status in ('approved', 'pending');
  if used_seats >= registry_row.max_users then
    raise exception 'The user limit of this district has been reached';
  end if;

  -- The first member of a registered district becomes its approved administrator;
  -- everybody else waits for the district administrator's approval.
  if exists (select 1 from public.user_profiles up where up.tenant_id = registry_row.tenant_id) then
    assigned_role := 'member'; assigned_status := 'pending';
  else
    assigned_role := 'admin'; assigned_status := 'approved';
  end if;

  insert into public.user_profiles as profile
    (user_id, tenant_id, district_id, province_id, province_name,
     district_id_short, district_name, member_id, role, status, display_name, phone)
  values
    (new.id, registry_row.tenant_id, registry_row.tenant_id, registry_row.province_id, registry_row.province_name,
     registry_row.district_id, registry_row.district_name, member_key, assigned_role, assigned_status,
     full_name_value, phone_value)
  on conflict (user_id) do update set
    member_id = coalesce(profile.member_id, excluded.member_id),
    display_name = coalesce(excluded.display_name, profile.display_name),
    phone = excluded.phone;

  -- The shared member row is created only for approved accounts (pending ones get it on approval).
  if assigned_status = 'approved' then
  insert into public.app_records as app_record
    (district_id, store, record_id, data, updated_by)
  values
    (
      registry_row.tenant_id, 'members', member_key,
      jsonb_build_object(
        'id', member_key, 'fullName', full_name_value, 'email', coalesce(new.email, ''),
        'phone', phone_value, 'status', 'active', 'tenantId', registry_row.tenant_id,
        'provinceId', registry_row.province_id, 'province', registry_row.province_name,
        'districtId', registry_row.district_id, 'district', registry_row.district_name,
        'source', 'online-signup', 'createdAt', now(), 'updatedAt', now()
      ),
      new.id
    )
  on conflict (district_id, store, record_id) do update set
    data = app_record.data || excluded.data,
    updated_at = now(),
    updated_by = excluded.updated_by,
    deleted_at = null;
  end if;

  return new;
end;
$$;

-- Super Admin list now also returns max_users / users_used.
create or replace function public._sa_districts_json()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.province_name, x.district_name), '[]'::jsonb)
  from (
    select r.tenant_id, r.province_id, r.province_name, r.district_id, r.district_name, r.active,
           r.annual_fee, r.currency, r.subscription_start, r.subscription_end, r.access_exception,
           r.notes, r.created_at, r.max_users,
           (select count(*) from public.user_profiles u2 where u2.tenant_id = r.tenant_id and u2.status in ('approved','pending')) as users_used,
           case when not r.active then 'inactive'
                when r.subscription_end is not null and r.subscription_end < current_date then 'expired'
                else 'active' end as effective_status,
           coalesce((select sum(p.amount) from public.district_payments p
                     where p.tenant_id = r.tenant_id and p.status = 'confirmed' and p.period_end >= current_date), 0) as paid_current,
           greatest(0, r.annual_fee - coalesce((select sum(p.amount) from public.district_payments p
                     where p.tenant_id = r.tenant_id and p.status = 'confirmed' and p.period_end >= current_date), 0)) as outstanding,
           coalesce((select sum(p.amount) from public.district_payments p
                     where p.tenant_id = r.tenant_id and p.status = 'confirmed'), 0) as confirmed_total,
           (select count(*) from public.user_profiles u where u.tenant_id = r.tenant_id) as members_count
    from public.district_registry r
  ) x;
$$;

revoke all on function public._sa_districts_json() from public, anon, authenticated;

-- Public pre-check used by the signup form (returns only true/false).
create or replace function public.district_has_capacity(p_tenant text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (select count(*) from public.user_profiles u where u.tenant_id = r.tenant_id and u.status in ('approved','pending')) < r.max_users
                   from public.district_registry r where r.tenant_id = p_tenant), true);
$$;
revoke all on function public.district_has_capacity(text) from public;
grant execute on function public.district_has_capacity(text) to anon, authenticated;

-- District administrator: seats used + the pending requests of THEIR district only.
create or replace function public.my_district_members() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me public.user_profiles%rowtype; reg public.district_registry%rowtype;
begin
  select * into me from public.user_profiles where user_id = auth.uid() and status = 'approved' and role = 'admin';
  if not found then raise exception 'Only the district administrator can review members' using errcode = '42501'; end if;
  select * into reg from public.district_registry where tenant_id = me.tenant_id;
  return jsonb_build_object(
    'max_users', reg.max_users,
    'used', (select count(*) from public.user_profiles u where u.tenant_id = me.tenant_id and u.status in ('approved','pending')),
    'pending', coalesce((select jsonb_agg(jsonb_build_object('user_id', u.user_id, 'display_name', u.display_name, 'phone', u.phone,
                          'email', a.email, 'created_at', u.created_at) order by u.created_at)
                         from public.user_profiles u join auth.users a on a.id = u.user_id
                         where u.tenant_id = me.tenant_id and u.status = 'pending'), '[]'::jsonb));
end $$;
revoke all on function public.my_district_members() from public, anon;
grant execute on function public.my_district_members() to authenticated;

create or replace function public.review_member(p_user_id uuid, p_approve boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me public.user_profiles%rowtype; target public.user_profiles%rowtype; reg public.district_registry%rowtype; email_value text;
begin
  select * into me from public.user_profiles where user_id = auth.uid() and status = 'approved' and role = 'admin';
  if not found then raise exception 'Only the district administrator can review members' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('district-signup:' || me.tenant_id, 0));
  select * into target from public.user_profiles where user_id = p_user_id and tenant_id = me.tenant_id and status = 'pending' for update;
  if not found then raise exception 'No pending request was found'; end if;
  if p_approve then
    select * into reg from public.district_registry where tenant_id = me.tenant_id;
    select a.email into email_value from auth.users a where a.id = p_user_id;
    update public.user_profiles set status = 'approved' where user_id = p_user_id;
    insert into public.app_records as app_record (district_id, store, record_id, data, updated_by)
    values (me.tenant_id, 'members', coalesce(target.member_id, p_user_id::text),
      jsonb_build_object('id', coalesce(target.member_id, p_user_id::text), 'fullName', coalesce(target.display_name, ''), 'email', coalesce(email_value, ''),
        'phone', coalesce(target.phone, ''), 'status', 'active', 'tenantId', me.tenant_id, 'provinceId', reg.province_id, 'province', reg.province_name,
        'districtId', reg.district_id, 'district', reg.district_name, 'source', 'online-signup', 'createdAt', now(), 'updatedAt', now()), auth.uid())
    on conflict (district_id, store, record_id) do update set data = app_record.data || excluded.data, updated_at = now(), updated_by = excluded.updated_by, deleted_at = null;
  else
    update public.user_profiles set status = 'rejected' where user_id = p_user_id;
  end if;
  return jsonb_build_object('user_id', p_user_id, 'status', case when p_approve then 'approved' else 'rejected' end);
end $$;
revoke all on function public.review_member(uuid, boolean) from public, anon;
grant execute on function public.review_member(uuid, boolean) to authenticated;

-- Super Admin sets the limit of a district.
create or replace function public.sa_set_district_limit(p_tenant_id text, p_max_users integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare old_value integer;
begin
  perform public.assert_super_admin();
  if p_max_users is null or p_max_users < 1 or p_max_users > 500 then raise exception 'The limit must be between 1 and 500'; end if;
  select max_users into old_value from public.district_registry where tenant_id = btrim(p_tenant_id) for update;
  if not found then raise exception 'District not found'; end if;
  update public.district_registry set max_users = p_max_users where tenant_id = btrim(p_tenant_id);
  perform public._sa_audit('district_limit_changed', 'district', btrim(p_tenant_id), btrim(p_tenant_id), jsonb_build_object('old', old_value, 'new', p_max_users));
  return jsonb_build_object('tenant_id', btrim(p_tenant_id), 'max_users', p_max_users);
end $$;
revoke all on function public.sa_set_district_limit(text, integer) from public, anon;
grant execute on function public.sa_set_district_limit(text, integer) to authenticated;

commit;

-- Verify (read-only):
--   select tenant_id, max_users from public.district_registry;
--   select tenant_id, status, count(*) from public.user_profiles group by 1, 2;
-- ROLLBACK of behaviour (keeps data): update public.district_registry set max_users = 500;
--   and: update public.user_profiles set status = 'approved' where status = 'pending';
