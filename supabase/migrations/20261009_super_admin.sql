-- =====================================================================
-- Super Admin, provinces, district subscriptions and payments
-- Incremental, re-runnable migration. It NEVER drops tables, deletes rows,
-- deletes users or resets anything. Run it ONCE in the Supabase SQL Editor
-- (after the base supabase/schema.sql that is already applied).
--
-- Existing districts in district_registry stay active (grandfathered) so the
-- current users keep working. Only NEW districts start inactive.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. Provinces (backfilled from the existing registry)
-- ---------------------------------------------------------------------
create table if not exists public.provinces (
  province_id text primary key,
  name text not null,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.provinces (province_id, name)
select distinct on (province_id) province_id, province_name
from public.district_registry
order by province_id, created_at
on conflict (province_id) do nothing;

-- ---------------------------------------------------------------------
-- 2. District registry: subscription columns (existing rows untouched)
-- ---------------------------------------------------------------------
alter table public.district_registry add column if not exists annual_fee numeric(12,2) not null default 0;
alter table public.district_registry add column if not exists currency text not null default 'AFN';
alter table public.district_registry add column if not exists subscription_start date;
alter table public.district_registry add column if not exists subscription_end date;
alter table public.district_registry add column if not exists access_exception boolean not null default false;
alter table public.district_registry add column if not exists notes text;
alter table public.district_registry add column if not exists activated_at timestamptz;
alter table public.district_registry add column if not exists activated_by uuid references auth.users(id) on delete set null;

-- New districts are inactive until the Super Admin activates them.
-- (This changes only the default for future rows, not existing rows.)
alter table public.district_registry alter column active set default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'district_registry_province_fk') then
    alter table public.district_registry
      add constraint district_registry_province_fk
      foreign key (province_id) references public.provinces(province_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'district_registry_fee_check') then
    alter table public.district_registry add constraint district_registry_fee_check check (annual_fee >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'district_registry_period_check') then
    alter table public.district_registry add constraint district_registry_period_check
      check (subscription_end is null or subscription_start is null or subscription_end >= subscription_start);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. Global settings (policy for expired subscriptions)
-- ---------------------------------------------------------------------
create table if not exists public.system_settings (
  id boolean primary key default true check (id),
  -- read_only: expired districts can read but not write
  -- block:     expired districts can neither read nor write
  -- grace:     expired districts keep full access for grace_days after expiry
  expired_policy text not null default 'read_only' check (expired_policy in ('read_only', 'block', 'grace')),
  grace_days integer not null default 0 check (grace_days between 0 and 365),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.system_settings (id) values (true) on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 4. Super Admin role (separate from the district 'admin' role)
-- ---------------------------------------------------------------------
create table if not exists public.super_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
-- Only ONE Super Admin (the application owner) can ever exist.
create unique index if not exists super_admins_single_idx on public.super_admins ((true));

-- E-mail pre-authorisation used only by the one-time bootstrap procedure.
create table if not exists public.super_admin_invites (
  email text primary key,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 5. Payments, subscription history and audit log
-- ---------------------------------------------------------------------
create table if not exists public.district_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.district_registry(tenant_id),
  period_start date not null,
  period_end date not null,
  fee_amount numeric(12,2) not null check (fee_amount > 0),
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'AFN',
  method text not null check (method in ('cash', 'bank_transfer')),
  payment_date date not null,
  reference_no text not null check (length(btrim(reference_no)) > 0),
  notes text,
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'reversed')),
  recorded_by uuid references auth.users(id) on delete set null,
  recorded_at timestamptz not null default now(),
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  reversed_by uuid references auth.users(id) on delete set null,
  reversed_at timestamptz,
  reversal_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end > period_start)
);
-- A receipt/reference number can be used only once (reversed payments release it).
create unique index if not exists district_payments_reference_uidx
  on public.district_payments (method, lower(btrim(reference_no))) where status <> 'reversed';
create index if not exists district_payments_tenant_idx on public.district_payments (tenant_id, period_start, period_end);
create index if not exists district_payments_date_idx on public.district_payments (payment_date);
create index if not exists district_payments_status_idx on public.district_payments (status);

create table if not exists public.district_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.district_registry(tenant_id),
  period_start date not null,
  period_end date not null,
  fee_amount numeric(12,2) not null,
  payment_id uuid references public.district_payments(id),
  action text not null check (action in ('activation', 'renewal')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists district_subscriptions_tenant_idx on public.district_subscriptions (tenant_id, period_end);

create table if not exists public.admin_audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  actor_email text,
  action text not null,
  entity text not null,
  entity_id text,
  tenant_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_logs_created_idx on public.admin_audit_logs (created_at desc);
create index if not exists admin_audit_logs_tenant_idx on public.admin_audit_logs (tenant_id);

-- ---------------------------------------------------------------------
-- 6. Table protection: RLS on, no policies, no direct privileges.
--    Super Admin data is reachable ONLY through the sa_* functions below.
-- ---------------------------------------------------------------------
alter table public.provinces enable row level security;
alter table public.system_settings enable row level security;
alter table public.super_admins enable row level security;
alter table public.super_admin_invites enable row level security;
alter table public.district_payments enable row level security;
alter table public.district_subscriptions enable row level security;
alter table public.admin_audit_logs enable row level security;

revoke all on public.provinces from anon, authenticated;
revoke all on public.system_settings from anon, authenticated;
revoke all on public.super_admins from anon, authenticated;
revoke all on public.super_admin_invites from anon, authenticated;
revoke all on public.district_payments from anon, authenticated;
revoke all on public.district_subscriptions from anon, authenticated;
revoke all on public.admin_audit_logs from anon, authenticated;
revoke insert, update, delete on public.district_registry from anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. Integrity triggers
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists provinces_touch on public.provinces;
create trigger provinces_touch before update on public.provinces for each row execute function public.touch_updated_at();
drop trigger if exists district_registry_touch on public.district_registry;
create trigger district_registry_touch before update on public.district_registry for each row execute function public.touch_updated_at();
drop trigger if exists district_payments_touch on public.district_payments;
create trigger district_payments_touch before update on public.district_payments for each row execute function public.touch_updated_at();
drop trigger if exists system_settings_touch on public.system_settings;
create trigger system_settings_touch before update on public.system_settings for each row execute function public.touch_updated_at();

-- Confirmed payments are immutable except for the confirmed -> reversed
-- transition; reversed payments are frozen; payments are never deleted.
create or replace function public.guard_district_payments()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Payments cannot be deleted; reverse them instead';
  end if;
  if old.status = 'reversed' then
    raise exception 'A reversed payment cannot be changed';
  end if;
  if old.status = 'confirmed' then
    if new.status <> 'reversed' and new.status <> 'confirmed' then
      raise exception 'A confirmed payment can only be reversed';
    end if;
    if new.tenant_id <> old.tenant_id or new.amount <> old.amount or new.method <> old.method
       or new.payment_date <> old.payment_date or new.reference_no <> old.reference_no
       or new.period_start <> old.period_start or new.period_end <> old.period_end
       or new.fee_amount <> old.fee_amount then
      raise exception 'Confirmed payment details cannot be edited';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists district_payments_guard on public.district_payments;
create trigger district_payments_guard before update or delete on public.district_payments
for each row execute function public.guard_district_payments();

create or replace function public.guard_audit_logs()
returns trigger language plpgsql as $$
begin
  raise exception 'Audit logs are append-only';
end;
$$;
drop trigger if exists admin_audit_logs_guard on public.admin_audit_logs;
create trigger admin_audit_logs_guard before update or delete on public.admin_audit_logs
for each row execute function public.guard_audit_logs();

-- ---------------------------------------------------------------------
-- 8. Authorisation helpers
-- ---------------------------------------------------------------------
create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.super_admins where user_id = auth.uid());
$$;
revoke all on function public.is_super_admin() from public, anon;
grant execute on function public.is_super_admin() to authenticated;

create or replace function public.assert_super_admin()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not exists (select 1 from public.super_admins where user_id = auth.uid()) then
    raise exception 'Super Admin permission required' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.assert_super_admin() from public, anon, authenticated;

create or replace function public._sa_audit(p_action text, p_entity text, p_entity_id text, p_tenant text, p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.admin_audit_logs (actor_id, actor_email, action, entity, entity_id, tenant_id, details)
  values (auth.uid(), (select u.email from auth.users u where u.id = auth.uid()), p_action, p_entity, p_entity_id, p_tenant, coalesce(p_details, '{}'::jsonb));
$$;
revoke all on function public._sa_audit(text, text, text, text, jsonb) from public, anon, authenticated;

-- One-time owner bootstrap. Callable ONLY from the SQL Editor (postgres role).
create or replace function public.bootstrap_super_admin(p_email text)
returns text language plpgsql security definer set search_path = public as $$
declare
  uid uuid;
  confirmed timestamptz;
begin
  if exists (select 1 from public.super_admins) then
    raise exception 'A Super Admin already exists. Bootstrap is a one-time operation.';
  end if;
  if not exists (select 1 from public.super_admin_invites where lower(email) = lower(btrim(p_email))) then
    raise exception 'This e-mail has not been pre-authorised in super_admin_invites.';
  end if;
  select id, email_confirmed_at into uid, confirmed from auth.users where lower(email) = lower(btrim(p_email));
  if uid is null then
    raise exception 'No auth user with this e-mail exists. Create it in Authentication > Users first.';
  end if;
  if confirmed is null then
    raise exception 'The e-mail of this user is not confirmed. Use "Auto Confirm User" when creating it.';
  end if;
  insert into public.super_admins (user_id) values (uid);
  delete from public.super_admin_invites where lower(email) = lower(btrim(p_email));
  insert into public.admin_audit_logs (actor_id, actor_email, action, entity, entity_id, details)
  values (uid, lower(btrim(p_email)), 'super_admin_bootstrap', 'super_admins', uid::text, '{}'::jsonb);
  return 'Super Admin created for ' || lower(btrim(p_email));
end;
$$;
revoke all on function public.bootstrap_super_admin(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 9. District access rules (used by signup and by RLS policies)
-- ---------------------------------------------------------------------
-- Unknown tenants (legacy data without a registry row) stay allowed so that
-- existing deployments keep working.
create or replace function public.district_write_allowed(p_tenant text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select r.active and (
      r.access_exception
      or r.subscription_end is null
      or r.subscription_end >= current_date
      or (s.expired_policy = 'grace' and r.subscription_end + s.grace_days >= current_date)
    )
    from public.district_registry r cross join public.system_settings s
    where r.tenant_id = p_tenant
  ), true);
$$;

create or replace function public.district_read_allowed(p_tenant text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when (select s.expired_policy from public.system_settings s limit 1) = 'block'
      then public.district_write_allowed(p_tenant)
    else true
  end;
$$;

-- Eligible for public signup: registered, activated, province active, not expired.
create or replace function public.district_signup_eligible(p_tenant text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.district_registry r
    join public.provinces p on p.province_id = r.province_id
    where r.tenant_id = p_tenant and p.active and public.district_write_allowed(r.tenant_id)
  );
$$;

revoke all on function public.district_write_allowed(text) from public;
revoke all on function public.district_read_allowed(text) from public;
revoke all on function public.district_signup_eligible(text) from public;
grant execute on function public.district_write_allowed(text) to authenticated;
grant execute on function public.district_read_allowed(text) to authenticated;
grant execute on function public.district_signup_eligible(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 10. Signup trigger: districts are registered ONLY by the Super Admin.
--     The old "first signup creates the registry" behaviour is removed.
-- ---------------------------------------------------------------------
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

  -- The first member of a registered district becomes its administrator.
  if exists (select 1 from public.user_profiles up where up.tenant_id = registry_row.tenant_id) then
    assigned_role := 'member';
  else
    assigned_role := 'admin';
  end if;

  insert into public.user_profiles as profile
    (user_id, tenant_id, district_id, province_id, province_name,
     district_id_short, district_name, member_id, role, display_name, phone)
  values
    (new.id, registry_row.tenant_id, registry_row.tenant_id, registry_row.province_id, registry_row.province_name,
     registry_row.district_id, registry_row.district_name, member_key, assigned_role,
     full_name_value, phone_value)
  on conflict (user_id) do update set
    member_id = coalesce(profile.member_id, excluded.member_id),
    display_name = coalesce(excluded.display_name, profile.display_name),
    phone = excluded.phone;

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

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------
-- 11. RLS policies: signup list shows only eligible districts; district
--     data follows the subscription policy.
-- ---------------------------------------------------------------------
drop policy if exists district_registry_select on public.district_registry;
create policy district_registry_select on public.district_registry
for select to anon, authenticated
using (public.district_signup_eligible(tenant_id));

drop policy if exists app_records_select on public.app_records;
create policy app_records_select on public.app_records
for select to authenticated
using (district_id = public.current_user_tenant() and public.district_read_allowed(district_id));

drop policy if exists app_records_insert on public.app_records;
create policy app_records_insert on public.app_records
for insert to authenticated
with check (district_id = public.current_user_tenant() and public.district_write_allowed(district_id));

drop policy if exists app_records_update on public.app_records;
create policy app_records_update on public.app_records
for update to authenticated
using (district_id = public.current_user_tenant() and public.district_write_allowed(district_id))
with check (district_id = public.current_user_tenant() and public.district_write_allowed(district_id));

drop policy if exists app_records_delete on public.app_records;
create policy app_records_delete on public.app_records
for delete to authenticated
using (
  district_id = public.current_user_tenant()
  and public.current_user_role() = 'admin'
  and public.district_write_allowed(district_id)
);

drop policy if exists district_settings_select on public.district_settings;
create policy district_settings_select on public.district_settings
for select to authenticated
using (district_id = public.current_user_tenant() and public.district_read_allowed(district_id));

drop policy if exists district_settings_insert on public.district_settings;
create policy district_settings_insert on public.district_settings
for insert to authenticated
with check (
  district_id = public.current_user_tenant()
  and public.current_user_role() = 'admin'
  and public.district_write_allowed(district_id)
);

drop policy if exists district_settings_update on public.district_settings;
create policy district_settings_update on public.district_settings
for update to authenticated
using (
  district_id = public.current_user_tenant()
  and public.current_user_role() = 'admin'
  and public.district_write_allowed(district_id)
)
with check (
  district_id = public.current_user_tenant()
  and public.current_user_role() = 'admin'
  and public.district_write_allowed(district_id)
);

-- ---------------------------------------------------------------------
-- 12. Super Admin functions (every one checks the role first)
-- ---------------------------------------------------------------------
create or replace function public._sa_districts_json()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.province_name, x.district_name), '[]'::jsonb)
  from (
    select r.tenant_id, r.province_id, r.province_name, r.district_id, r.district_name, r.active,
           r.annual_fee, r.currency, r.subscription_start, r.subscription_end, r.access_exception,
           r.notes, r.created_at,
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

create or replace function public.sa_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d jsonb;
begin
  perform public.assert_super_admin();
  d := public._sa_districts_json();
  return jsonb_build_object(
    'provinces_total', (select count(*) from public.provinces),
    'provinces_active', (select count(*) from public.provinces where active),
    'districts_total', jsonb_array_length(d),
    'districts_active', (select count(*) from jsonb_array_elements(d) e where e->>'effective_status' = 'active'),
    'districts_inactive', (select count(*) from jsonb_array_elements(d) e where e->>'effective_status' = 'inactive'),
    'districts_expired', (select count(*) from jsonb_array_elements(d) e where e->>'effective_status' = 'expired'),
    'districts_unpaid', (select count(*) from jsonb_array_elements(d) e where (e->>'outstanding')::numeric > 0),
    'payments_received_total', (select coalesce(sum(amount), 0) from public.district_payments where status = 'confirmed'),
    'cash_total', (select coalesce(sum(amount), 0) from public.district_payments where status = 'confirmed' and method = 'cash'),
    'bank_total', (select coalesce(sum(amount), 0) from public.district_payments where status = 'confirmed' and method = 'bank_transfer'),
    'draft_total', (select coalesce(sum(amount), 0) from public.district_payments where status = 'draft'),
    'reversed_total', (select coalesce(sum(amount), 0) from public.district_payments where status = 'reversed'),
    'outstanding_total', (select coalesce(sum((e->>'outstanding')::numeric), 0) from jsonb_array_elements(d) e),
    'revenue_by_year', (select coalesce(jsonb_agg(jsonb_build_object('year', q.y, 'total', q.t) order by q.y desc), '[]'::jsonb)
                        from (select extract(year from payment_date)::int as y, sum(amount) as t
                              from public.district_payments where status = 'confirmed' group by 1) q)
  );
end;
$$;

create or replace function public.sa_list_provinces()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_super_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'province_id', p.province_id, 'name', p.name, 'active', p.active, 'created_at', p.created_at,
      'districts_count', (select count(*) from public.district_registry r where r.province_id = p.province_id)
    ) order by p.name) from public.provinces p
  ), '[]'::jsonb);
end;
$$;

create or replace function public.sa_save_province(p_province_id text default null, p_name text default null, p_active boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  clean_name text := btrim(coalesce(p_name, ''));
  pid text;
  row_out public.provinces%rowtype;
begin
  perform public.assert_super_admin();
  if clean_name = '' then raise exception 'Province name is required'; end if;
  if length(clean_name) > 120 then raise exception 'Province name is too long'; end if;
  if p_province_id is null or btrim(p_province_id) = '' then
    pid := public.normalize_scope_part(clean_name);
    if pid = '' then raise exception 'Province name is invalid'; end if;
    if exists (select 1 from public.provinces where province_id = pid or lower(name) = lower(clean_name)) then
      raise exception 'This province is already registered';
    end if;
    insert into public.provinces (province_id, name, active, created_by)
    values (pid, clean_name, coalesce(p_active, true), auth.uid()) returning * into row_out;
    perform public._sa_audit('province_created', 'province', pid, null, jsonb_build_object('name', clean_name));
  else
    pid := btrim(p_province_id);
    if not exists (select 1 from public.provinces where province_id = pid) then raise exception 'Province not found'; end if;
    if exists (select 1 from public.provinces where lower(name) = lower(clean_name) and province_id <> pid) then
      raise exception 'Another province already has this name';
    end if;
    update public.provinces set name = clean_name, active = coalesce(p_active, active) where province_id = pid returning * into row_out;
    update public.district_registry set province_name = clean_name where province_id = pid;
    perform public._sa_audit('province_updated', 'province', pid, null, jsonb_build_object('name', clean_name, 'active', row_out.active));
  end if;
  return to_jsonb(row_out);
end;
$$;

create or replace function public.sa_list_districts()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_super_admin();
  return public._sa_districts_json();
end;
$$;

create or replace function public.sa_save_district(
  p_tenant_id text default null, p_province_id text default null, p_district_name text default null,
  p_annual_fee numeric default null, p_notes text default null, p_access_exception boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  clean_name text := btrim(coalesce(p_district_name, ''));
  prov public.provinces%rowtype;
  old_row public.district_registry%rowtype;
  new_row public.district_registry%rowtype;
  did text;
  tid text;
begin
  perform public.assert_super_admin();
  if clean_name = '' then raise exception 'District name is required'; end if;
  if length(clean_name) > 120 then raise exception 'District name is too long'; end if;
  if p_annual_fee is null or p_annual_fee <= 0 then raise exception 'The annual fee must be greater than zero'; end if;

  if p_tenant_id is null or btrim(p_tenant_id) = '' then
    select * into prov from public.provinces where province_id = p_province_id;
    if not found then raise exception 'Province not found'; end if;
    did := public.normalize_scope_part(clean_name);
    tid := public.make_tenant_id(prov.province_id, did);
    if did = '' or tid = '' then raise exception 'District name is invalid'; end if;
    if exists (select 1 from public.district_registry where tenant_id = tid) then
      raise exception 'This district is already registered under this province';
    end if;
    insert into public.district_registry
      (tenant_id, province_id, province_name, district_id, district_name, active, annual_fee, notes, access_exception, created_by)
    values (tid, prov.province_id, prov.name, did, clean_name, false, p_annual_fee, nullif(btrim(coalesce(p_notes, '')), ''), coalesce(p_access_exception, false), auth.uid())
    returning * into new_row;
    perform public._sa_audit('district_created', 'district', tid, tid, jsonb_build_object('fee', p_annual_fee));
  else
    select * into old_row from public.district_registry where tenant_id = btrim(p_tenant_id) for update;
    if not found then raise exception 'District not found'; end if;
    update public.district_registry
       set district_name = clean_name, annual_fee = p_annual_fee,
           notes = nullif(btrim(coalesce(p_notes, '')), ''), access_exception = coalesce(p_access_exception, false)
     where tenant_id = old_row.tenant_id returning * into new_row;
    if old_row.annual_fee <> new_row.annual_fee then
      perform public._sa_audit('fee_changed', 'district', new_row.tenant_id, new_row.tenant_id,
        jsonb_build_object('old', old_row.annual_fee, 'new', new_row.annual_fee));
    end if;
    if old_row.access_exception <> new_row.access_exception then
      perform public._sa_audit('access_exception_changed', 'district', new_row.tenant_id, new_row.tenant_id,
        jsonb_build_object('enabled', new_row.access_exception));
    end if;
    perform public._sa_audit('district_updated', 'district', new_row.tenant_id, new_row.tenant_id, jsonb_build_object('name', clean_name));
  end if;
  return to_jsonb(new_row);
end;
$$;

-- Internal: apply a fully paid period to a district (activation or renewal).
create or replace function public._sa_apply_period(p_tenant text, p_start date, p_end date, p_payment uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.district_registry%rowtype;
  contiguous boolean;
  new_start date;
  new_end date;
  was_active boolean;
begin
  select * into r from public.district_registry where tenant_id = p_tenant for update;
  if not found then raise exception 'District not found'; end if;
  was_active := r.active and (r.subscription_end is null or r.subscription_end >= current_date);
  contiguous := r.active and r.subscription_end is not null and r.subscription_end >= current_date
                and r.subscription_start is not null and p_start <= r.subscription_end + 1;
  if contiguous then
    new_start := least(r.subscription_start, p_start);
    new_end := greatest(r.subscription_end, p_end);
  else
    new_start := p_start;
    new_end := p_end;
  end if;
  update public.district_registry
     set active = true, subscription_start = new_start, subscription_end = new_end,
         activated_at = coalesce(case when was_active then r.activated_at end, now()),
         activated_by = coalesce(case when was_active then r.activated_by end, auth.uid())
   where tenant_id = p_tenant;
  insert into public.district_subscriptions (tenant_id, period_start, period_end, fee_amount, payment_id, action, created_by)
  values (p_tenant, p_start, p_end, r.annual_fee, p_payment, case when was_active then 'renewal' else 'activation' end, auth.uid());
  perform public._sa_audit(case when was_active then 'subscription_renewed' else 'district_activated' end,
    'district', p_tenant, p_tenant,
    jsonb_build_object('period_start', p_start, 'period_end', p_end, 'new_start', new_start, 'new_end', new_end, 'payment_id', p_payment));
end;
$$;
revoke all on function public._sa_apply_period(text, date, date, uuid) from public, anon, authenticated;

create or replace function public.sa_activate_district(p_tenant_id text, p_period_start date, p_period_end date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.district_registry%rowtype;
  paid numeric;
  pay uuid;
begin
  perform public.assert_super_admin();
  if p_period_start is null or p_period_end is null or p_period_end <= p_period_start then
    raise exception 'A valid subscription period is required';
  end if;
  select * into r from public.district_registry where tenant_id = p_tenant_id for update;
  if not found then raise exception 'District not found'; end if;
  if r.annual_fee <= 0 then raise exception 'Set the annual fee before activating the district'; end if;
  select coalesce(sum(amount), 0), (array_agg(id order by confirmed_at desc))[1] into paid, pay
    from public.district_payments
   where tenant_id = r.tenant_id and status = 'confirmed' and period_start = p_period_start and period_end = p_period_end;
  if paid < r.annual_fee then
    raise exception 'Confirmed payments (%) do not cover the annual fee (%) for this period', paid, r.annual_fee;
  end if;
  perform public._sa_apply_period(r.tenant_id, p_period_start, p_period_end, pay);
  return (select to_jsonb(x) from public.district_registry x where x.tenant_id = r.tenant_id);
end;
$$;

create or replace function public.sa_deactivate_district(p_tenant_id text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.district_registry%rowtype;
begin
  perform public.assert_super_admin();
  update public.district_registry set active = false where tenant_id = p_tenant_id returning * into r;
  if not found then raise exception 'District not found'; end if;
  perform public._sa_audit('district_deactivated', 'district', r.tenant_id, r.tenant_id, jsonb_build_object('reason', nullif(btrim(coalesce(p_reason, '')), '')));
  return to_jsonb(r);
end;
$$;

create or replace function public.sa_list_payments(
  p_tenant_id text default null, p_from date default null, p_to date default null, p_status text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_super_admin();
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.payment_date desc, x.recorded_at desc)
    from (
      select p.id, p.tenant_id, r.province_name, r.district_name, p.period_start, p.period_end, p.fee_amount, p.amount,
             p.currency, p.method, p.payment_date, p.reference_no, p.notes, p.status, p.recorded_at, p.confirmed_at,
             p.reversed_at, p.reversal_reason,
             (select u.email from auth.users u where u.id = p.recorded_by) as recorded_by_email,
             (select u.email from auth.users u where u.id = p.confirmed_by) as confirmed_by_email
        from public.district_payments p
        join public.district_registry r on r.tenant_id = p.tenant_id
       where (p_tenant_id is null or p.tenant_id = p_tenant_id)
         and (p_from is null or p.payment_date >= p_from)
         and (p_to is null or p.payment_date <= p_to)
         and (p_status is null or p.status = p_status)
       order by p.payment_date desc, p.recorded_at desc
       limit 5000
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.sa_record_payment(
  p_tenant_id text, p_amount numeric, p_method text, p_payment_date date, p_reference_no text,
  p_period_start date, p_period_end date, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.district_registry%rowtype;
  row_out public.district_payments%rowtype;
begin
  perform public.assert_super_admin();
  select * into r from public.district_registry where tenant_id = p_tenant_id;
  if not found then raise exception 'District not found'; end if;
  if r.annual_fee <= 0 then raise exception 'Set the annual fee before recording payments'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'The amount must be greater than zero'; end if;
  if p_method is null or p_method not in ('cash', 'bank_transfer') then raise exception 'Payment method must be cash or bank transfer'; end if;
  if p_payment_date is null then raise exception 'Payment date is required'; end if;
  if p_reference_no is null or btrim(p_reference_no) = '' then raise exception 'Receipt/reference number is required'; end if;
  if p_period_start is null or p_period_end is null or p_period_end <= p_period_start then raise exception 'A valid subscription period is required'; end if;
  begin
    insert into public.district_payments
      (tenant_id, period_start, period_end, fee_amount, amount, method, payment_date, reference_no, notes, recorded_by)
    values
      (r.tenant_id, p_period_start, p_period_end, r.annual_fee, p_amount, p_method, p_payment_date, btrim(p_reference_no),
       nullif(btrim(coalesce(p_notes, '')), ''), auth.uid())
    returning * into row_out;
  exception when unique_violation then
    raise exception 'This receipt/reference number is already recorded';
  end;
  perform public._sa_audit('payment_recorded', 'payment', row_out.id::text, r.tenant_id,
    jsonb_build_object('amount', p_amount, 'method', p_method, 'reference', btrim(p_reference_no), 'period_start', p_period_start, 'period_end', p_period_end));
  return to_jsonb(row_out);
end;
$$;

create or replace function public.sa_confirm_payment(p_payment_id uuid, p_activate boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p public.district_payments%rowtype;
  paid numeric;
  applied boolean := false;
begin
  perform public.assert_super_admin();
  select * into p from public.district_payments where id = p_payment_id for update;
  if not found then raise exception 'Payment not found'; end if;
  if p.status <> 'draft' then raise exception 'This payment was already processed (status: %)', p.status; end if;
  update public.district_payments
     set status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now()
   where id = p.id returning * into p;
  perform public._sa_audit('payment_confirmed', 'payment', p.id::text, p.tenant_id,
    jsonb_build_object('amount', p.amount, 'method', p.method, 'reference', p.reference_no));
  select coalesce(sum(amount), 0) into paid from public.district_payments
   where tenant_id = p.tenant_id and status = 'confirmed' and period_start = p.period_start and period_end = p.period_end;
  if coalesce(p_activate, false) and paid >= p.fee_amount then
    perform public._sa_apply_period(p.tenant_id, p.period_start, p.period_end, p.id);
    applied := true;
  end if;
  return jsonb_build_object('payment', to_jsonb(p), 'activated', applied, 'paid_for_period', paid, 'fee', p.fee_amount);
end;
$$;

create or replace function public.sa_reverse_payment(p_payment_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p public.district_payments%rowtype;
  r public.district_registry%rowtype;
  paid numeric;
  suspended boolean := false;
begin
  perform public.assert_super_admin();
  if p_reason is null or btrim(p_reason) = '' then raise exception 'A reason is required to reverse a payment'; end if;
  select * into p from public.district_payments where id = p_payment_id for update;
  if not found then raise exception 'Payment not found'; end if;
  if p.status = 'reversed' then raise exception 'This payment is already reversed'; end if;
  update public.district_payments
     set status = 'reversed', reversed_by = auth.uid(), reversed_at = now(), reversal_reason = btrim(p_reason)
   where id = p.id returning * into p;
  perform public._sa_audit('payment_reversed', 'payment', p.id::text, p.tenant_id,
    jsonb_build_object('amount', p.amount, 'reference', p.reference_no, 'reason', btrim(p_reason)));
  select * into r from public.district_registry where tenant_id = p.tenant_id for update;
  if found and r.active and r.subscription_end = p.period_end then
    select coalesce(sum(amount), 0) into paid from public.district_payments
     where tenant_id = p.tenant_id and status = 'confirmed' and period_start = p.period_start and period_end = p.period_end;
    if paid < p.fee_amount then
      update public.district_registry set active = false where tenant_id = p.tenant_id;
      perform public._sa_audit('district_deactivated', 'district', p.tenant_id, p.tenant_id,
        jsonb_build_object('reason', 'payment reversed; period no longer fully paid'));
      suspended := true;
    end if;
  end if;
  return jsonb_build_object('payment', to_jsonb(p), 'district_deactivated', suspended);
end;
$$;

create or replace function public.sa_list_audit(p_limit integer default 200, p_tenant_id text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_super_admin();
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.created_at desc)
    from (select id, actor_email, action, entity, entity_id, tenant_id, details, created_at
            from public.admin_audit_logs
           where (p_tenant_id is null or tenant_id = p_tenant_id)
           order by created_at desc, id desc
           limit least(greatest(coalesce(p_limit, 200), 1), 1000)) x
  ), '[]'::jsonb);
end;
$$;

create or replace function public.sa_get_settings()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_super_admin();
  return (select jsonb_build_object('expired_policy', expired_policy, 'grace_days', grace_days) from public.system_settings limit 1);
end;
$$;

create or replace function public.sa_save_settings(p_expired_policy text, p_grace_days integer default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_super_admin();
  if p_expired_policy not in ('read_only', 'block', 'grace') then raise exception 'Invalid policy'; end if;
  if coalesce(p_grace_days, 0) < 0 or coalesce(p_grace_days, 0) > 365 then raise exception 'Grace days must be between 0 and 365'; end if;
  update public.system_settings set expired_policy = p_expired_policy, grace_days = coalesce(p_grace_days, 0), updated_by = auth.uid() where id = true;
  perform public._sa_audit('settings_changed', 'settings', 'expired_policy', null,
    jsonb_build_object('expired_policy', p_expired_policy, 'grace_days', coalesce(p_grace_days, 0)));
  return jsonb_build_object('expired_policy', p_expired_policy, 'grace_days', coalesce(p_grace_days, 0));
end;
$$;

-- Only signed-in users may call the sa_* functions, and each one re-checks the
-- Super Admin role itself. Anonymous callers cannot reach them at all.
do $$
declare fn text;
begin
  foreach fn in array array[
    'sa_overview()', 'sa_list_provinces()', 'sa_save_province(text, text, boolean)', 'sa_list_districts()',
    'sa_save_district(text, text, text, numeric, text, boolean)', 'sa_activate_district(text, date, date)',
    'sa_deactivate_district(text, text)', 'sa_list_payments(text, date, date, text)',
    'sa_record_payment(text, numeric, text, date, text, date, date, text)', 'sa_confirm_payment(uuid, boolean)',
    'sa_reverse_payment(uuid, text)', 'sa_list_audit(integer, text)', 'sa_get_settings()', 'sa_save_settings(text, integer)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

commit;
