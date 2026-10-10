-- Madrasa Professional Development: Supabase schema
--
-- !!! EXISTING DEPLOYMENTS: do NOT re-run this base script after applying
-- supabase/migrations/20261009_super_admin.sql. This file contains the OLD
-- signup trigger and OLD policies (first signup creates the registry); re-running
-- it would overwrite the Super Admin rules. New installations: run this file
-- first, then the migration. See SUPER_ADMIN_SETUP.md.
--
-- Run this script in the Supabase SQL Editor. It is safe to re-run after a
-- previous version: tables, policies, indexes and the signup trigger are
-- created or upgraded with IF NOT EXISTS / CREATE OR REPLACE statements.
-- The browser uses only the project URL and anon key. Never put the service
-- role key in this file, the frontend, a PWA cache, or GitHub.

create table if not exists public.district_registry (
  tenant_id text primary key,
  province_id text not null,
  province_name text not null,
  district_id text not null,
  district_name text not null,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (province_id, district_id)
);

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- tenant_id is the canonical province:district scope. district_id is kept
  -- as a compatibility alias for the existing client and older deployments.
  tenant_id text,
  district_id text not null,
  province_id text,
  province_name text,
  district_id_short text,
  district_name text,
  member_id text,
  role text not null default 'member' check (role in ('admin', 'member')),
  display_name text,
  phone text,
  created_at timestamptz not null default now()
);

create table if not exists public.app_records (
  district_id text not null,
  store text not null,
  record_id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  primary key (district_id, store, record_id)
);

create table if not exists public.district_settings (
  district_id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

-- Upgrade columns when this script is applied to the earlier district-only
-- schema. Existing district_id values remain valid compatibility tenant IDs.
alter table public.user_profiles add column if not exists tenant_id text;
alter table public.user_profiles add column if not exists province_id text;
alter table public.user_profiles add column if not exists province_name text;
alter table public.user_profiles add column if not exists district_id_short text;
alter table public.user_profiles add column if not exists district_name text;
alter table public.user_profiles add column if not exists phone text;
update public.user_profiles
set tenant_id = coalesce(nullif(tenant_id, ''), district_id)
where tenant_id is null or tenant_id = '';
alter table public.user_profiles alter column tenant_id set not null;

create index if not exists district_registry_name_idx on public.district_registry (province_name, district_name);
create index if not exists app_records_district_store_idx on public.app_records (district_id, store);
create index if not exists app_records_updated_at_idx on public.app_records (updated_at);
create index if not exists user_profiles_tenant_idx on public.user_profiles (tenant_id);

-- The client and the trigger use the same stable, lower-case scope format.
create or replace function public.normalize_scope_part(value text)
returns text
language sql
immutable
strict
as $$
  select regexp_replace(
           regexp_replace(lower(trim(value)), '\s+', '-', 'g'),
           '-+', '-', 'g'
         );
$$;

create or replace function public.make_tenant_id(province text, district text)
returns text
language sql
immutable
as $$
  select case
    when public.normalize_scope_part(coalesce(province, '')) = ''
      or public.normalize_scope_part(coalesce(district, '')) = '' then ''
    else public.normalize_scope_part(province) || ':' || public.normalize_scope_part(district)
  end;
$$;

create or replace function public.current_user_tenant()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(tenant_id, district_id)
  from public.user_profiles
  where user_id = auth.uid();
$$;

create or replace function public.current_user_district()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_tenant();
$$;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.user_profiles
  where user_id = auth.uid();
$$;

-- Self-signup onboarding. The first successful signup creates the first
-- registry entry and becomes that tenant's administrator. Later signups may
-- use only an active entry already present in district_registry. A transaction
-- advisory lock prevents two simultaneous first signups from creating two
-- different tenants.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  input_province_id text := public.normalize_scope_part(coalesce(meta->>'province_id', meta->>'province_name', ''));
  input_district_id text := public.normalize_scope_part(coalesce(meta->>'district_id_short', meta->>'district_name', ''));
  input_tenant_id text := public.make_tenant_id(input_province_id, input_district_id);
  tenant text;
  province_id_value text;
  province_name_value text;
  district_id_value text;
  district_name_value text;
  member_key text := coalesce(nullif(trim(meta->>'member_id'), ''), new.id::text);
  full_name_value text := coalesce(nullif(trim(meta->>'full_name'), ''), split_part(coalesce(new.email, ''), '@', 1));
  phone_value text := coalesce(meta->>'phone', '');
  registry_was_empty boolean;
  registry_row public.district_registry%rowtype;
  assigned_role text;
begin
  -- One global lock makes the empty-registry test and first insert atomic.
  perform pg_advisory_xact_lock(2147483647::bigint);

  if input_tenant_id = '' then
    raise exception 'Province and district are required for signup';
  end if;

  registry_was_empty := not exists (select 1 from public.district_registry);

  if registry_was_empty then
    insert into public.district_registry
      (tenant_id, province_id, province_name, district_id, district_name, created_by)
    values
      (
        input_tenant_id,
        input_province_id,
        coalesce(nullif(trim(meta->>'province_name'), ''), input_province_id),
        input_district_id,
        coalesce(nullif(trim(meta->>'district_name'), ''), input_district_id),
        new.id
      )
    returning * into registry_row;
    assigned_role := 'admin';
  else
    select * into registry_row
    from public.district_registry
    where tenant_id = input_tenant_id and active = true;

    if not found then
      raise exception 'This province and district are not registered';
    end if;
    assigned_role := 'member';
  end if;

  tenant := registry_row.tenant_id;
  province_id_value := registry_row.province_id;
  province_name_value := registry_row.province_name;
  district_id_value := registry_row.district_id;
  district_name_value := registry_row.district_name;

  insert into public.user_profiles as profile
    (user_id, tenant_id, district_id, province_id, province_name,
     district_id_short, district_name, member_id, role, display_name, phone)
  values
    (new.id, tenant, tenant, province_id_value, province_name_value,
     district_id_value, district_name_value, member_key, assigned_role,
     full_name_value, phone_value)
  on conflict (user_id) do update set
    tenant_id = excluded.tenant_id,
    district_id = excluded.district_id,
    province_id = excluded.province_id,
    province_name = excluded.province_name,
    district_id_short = excluded.district_id_short,
    district_name = excluded.district_name,
    member_id = coalesce(profile.member_id, excluded.member_id),
    display_name = coalesce(excluded.display_name, profile.display_name),
    phone = excluded.phone;

  -- Every self-signup is immediately visible in the shared Team/Member view,
  -- even when Supabase email confirmation is enabled.
  insert into public.app_records as app_record
    (district_id, store, record_id, data, updated_by)
  values
    (
      tenant,
      'members',
      member_key,
      jsonb_build_object(
        'id', member_key,
        'fullName', full_name_value,
        'email', coalesce(new.email, ''),
        'phone', phone_value,
        'status', 'active',
        'tenantId', tenant,
        'provinceId', province_id_value,
        'province', province_name_value,
        'districtId', district_id_value,
        'district', district_name_value,
        'source', 'online-signup',
        'createdAt', now(),
        'updatedAt', now()
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

-- RLS: registry names are intentionally public-read so an unauthenticated
-- signup form can populate its selector. It contains no private records.
alter table public.district_registry enable row level security;
alter table public.user_profiles enable row level security;
alter table public.app_records enable row level security;
alter table public.district_settings enable row level security;

drop policy if exists district_registry_select on public.district_registry;
create policy district_registry_select on public.district_registry
for select to anon, authenticated
using (active = true);

-- No browser insert/update/delete policy is provided for the registry. The
-- signup trigger (security definer) is the only normal onboarding writer.
grant usage on schema public to anon, authenticated;
revoke select on public.district_registry from anon, authenticated;
grant select (tenant_id, province_id, province_name, district_id, district_name, active)
  on public.district_registry to anon, authenticated;
grant select on public.user_profiles to authenticated;
grant select, insert, update, delete on public.app_records to authenticated;
grant select, insert, update on public.district_settings to authenticated;
drop policy if exists user_profiles_select on public.user_profiles;
create policy user_profiles_select on public.user_profiles
for select to authenticated
using (
  user_id = auth.uid()
  or (tenant_id = public.current_user_tenant() and public.current_user_role() = 'admin')
);

drop policy if exists app_records_select on public.app_records;
create policy app_records_select on public.app_records
for select to authenticated
using (district_id = public.current_user_tenant());

drop policy if exists app_records_insert on public.app_records;
create policy app_records_insert on public.app_records
for insert to authenticated
with check (district_id = public.current_user_tenant());

drop policy if exists app_records_update on public.app_records;
create policy app_records_update on public.app_records
for update to authenticated
using (district_id = public.current_user_tenant())
with check (district_id = public.current_user_tenant());

drop policy if exists app_records_delete on public.app_records;
create policy app_records_delete on public.app_records
for delete to authenticated
using (
  district_id = public.current_user_tenant()
  and public.current_user_role() = 'admin'
);

drop policy if exists district_settings_select on public.district_settings;
create policy district_settings_select on public.district_settings
for select to authenticated
using (district_id = public.current_user_tenant());

drop policy if exists district_settings_insert on public.district_settings;
create policy district_settings_insert on public.district_settings
for insert to authenticated
with check (
  district_id = public.current_user_tenant()
  and public.current_user_role() = 'admin'
);

drop policy if exists district_settings_update on public.district_settings;
create policy district_settings_update on public.district_settings
for update to authenticated
using (
  district_id = public.current_user_tenant()
  and public.current_user_role() = 'admin'
)
with check (
  district_id = public.current_user_tenant()
  and public.current_user_role() = 'admin'
);

-- Optional legacy invite endpoint compatibility:
-- the preferred onboarding path is public self-signup in the app. If the
-- endpoint is retained, pass tenant/province/district metadata and keep the
-- service-role key only in Netlify environment variables.
