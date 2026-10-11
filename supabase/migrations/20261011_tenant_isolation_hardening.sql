-- =====================================================================
-- Tenant (district) isolation hardening -- ADDITIVE and RE-RUNNABLE.
-- It does NOT insert, update or delete any application row, never drops a table,
-- and never disables or "forces" RLS.  Run AFTER 20261009 / 20261010.
--
-- Why this exists: the cross-district exposure was caused by the browser (one shared
-- IndexedDB copied the previous account's records into the next account's district),
-- not by a missing RLS policy.  The policies of 20261009 already pin every row to
-- current_user_tenant().  This file adds defence in depth so the same class of mistake
-- cannot be repeated through the public API.
-- =====================================================================
begin;

-- 1. Least privilege on tenant tables ----------------------------------
--    (Supabase default privileges may grant everything to anon/authenticated; RLS would still
--     deny, but a grant that is not needed should not exist.)
revoke all on public.app_records       from anon;
revoke all on public.district_settings from anon;
revoke all on public.user_profiles     from anon;
revoke insert, update, delete, truncate, references, trigger on public.user_profiles from authenticated;  -- profiles are written only by the signup trigger / service role
revoke truncate, references, trigger on public.app_records       from authenticated;
revoke delete, truncate, references, trigger on public.district_settings from authenticated;
-- the RLS helper functions are only meaningful for a signed-in user
revoke execute on function public.current_user_tenant()   from public, anon;
revoke execute on function public.current_user_district() from public, anon;
revoke execute on function public.current_user_role()     from public, anon;
grant  execute on function public.current_user_tenant()   to authenticated;
grant  execute on function public.current_user_district() to authenticated;
grant  execute on function public.current_user_role()     to authenticated;

-- 2. A record can never be moved to another district, store or id ------
create or replace function public.guard_app_records_identity()
returns trigger language plpgsql as $$
begin
  if new.district_id is distinct from old.district_id
     or new.store      is distinct from old.store
     or new.record_id  is distinct from old.record_id then
    raise exception 'district_id, store and record_id of a record cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists app_records_identity_guard on public.app_records;
create trigger app_records_identity_guard before update on public.app_records
for each row execute function public.guard_app_records_identity();

create or replace function public.guard_district_settings_identity()
returns trigger language plpgsql as $$
begin
  if new.district_id is distinct from old.district_id then
    raise exception 'district_id of district settings cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists district_settings_identity_guard on public.district_settings;
create trigger district_settings_identity_guard before update on public.district_settings
for each row execute function public.guard_district_settings_identity();

-- 3. A profile's district / role can not be changed through the API ----
--    Calls without a user JWT (SQL Editor, signup trigger, Netlify service-role function) are unaffected.
create or replace function public.guard_user_profile_identity()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and (
       new.user_id     is distinct from old.user_id
    or new.tenant_id   is distinct from old.tenant_id
    or new.district_id is distinct from old.district_id
    or new.province_id is distinct from old.province_id
    or new.role        is distinct from old.role) then
    raise exception 'district and role of a profile cannot be changed through the API' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists user_profiles_identity_guard on public.user_profiles;
create trigger user_profiles_identity_guard before update on public.user_profiles
for each row execute function public.guard_user_profile_identity();

-- 4. Index used by the per-district sync query (already present on most deployments) ----
create index if not exists app_records_district_updated_idx on public.app_records (district_id, updated_at);

commit;

-- =====================================================================
-- OPTIONAL -- REQUIRES YOUR APPROVAL.  Do NOT run before supabase/audit/20261011_isolation_audit.sql
-- reports ZERO rows for checks E2, E3 and E4 (profiles / records whose district is not in district_registry).
-- Reason: 20261009 deliberately keeps "unknown" legacy districts working; these foreign keys would make
-- writes for such legacy districts fail.  NOT VALID = existing rows are not checked, new rows are.
--
-- alter table public.user_profiles    add constraint user_profiles_tenant_fk
--   foreign key (tenant_id)   references public.district_registry (tenant_id) not valid;
-- alter table public.app_records      add constraint app_records_district_fk
--   foreign key (district_id) references public.district_registry (tenant_id) not valid;
-- alter table public.district_settings add constraint district_settings_district_fk
--   foreign key (district_id) references public.district_registry (tenant_id) not valid;
-- =====================================================================

-- ROLLBACK (only if something unexpected happens; none of these touch data):
--   drop trigger if exists app_records_identity_guard on public.app_records;
--   drop trigger if exists district_settings_identity_guard on public.district_settings;
--   drop trigger if exists user_profiles_identity_guard on public.user_profiles;
--   grant select, insert, update, delete on public.app_records to authenticated;
--   grant select, insert, update on public.district_settings to authenticated;
