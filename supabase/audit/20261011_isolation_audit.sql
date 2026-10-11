-- =====================================================================
-- READ-ONLY isolation audit. Every statement is a SELECT: nothing is changed.
-- Run in the Supabase SQL Editor (as postgres) BEFORE the migration, and again after it.
-- Send me the results of E, F and G if any of them returns rows.
-- =====================================================================

-- A. RLS must be ON for every tenant table (relrowsecurity = true).
select c.relname as table_name, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;

-- B. Policies actually installed (compare with 20261009_super_admin.sql section 11).
select tablename, policyname, cmd, roles, qual as using_expr, with_check
from pg_policies where schemaname = 'public' order by tablename, cmd, policyname;

-- C. Table privileges of the two API roles (anon must have none on tenant tables).
select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
  and table_name in ('app_records', 'district_settings', 'user_profiles', 'district_registry')
group by table_name, grantee order by table_name, grantee;

-- D. Current signup trigger must be the Super-Admin-era version (no "first signup creates the registry").
select pg_get_functiondef('public.handle_new_auth_user()'::regprocedure) ilike '%district_signup_eligible%' as signup_trigger_is_current;

-- E. Identity integrity ------------------------------------------------
-- E1. Auth users without a profile (expected: only the Super Admin).
select u.id, u.email from auth.users u
left join public.user_profiles p on p.user_id = u.id
where p.user_id is null and u.id not in (select user_id from public.super_admins);
-- E2. Profiles whose district is missing from the registry.
select p.user_id, p.tenant_id, p.district_id, p.role from public.user_profiles p
left join public.district_registry r on r.tenant_id = p.tenant_id where r.tenant_id is null;
-- E3. app_records whose district is missing from the registry.
select district_id, count(*) as records from public.app_records
where district_id not in (select tenant_id from public.district_registry) group by district_id;
-- E4. district_settings whose district is missing from the registry.
select district_id from public.district_settings
where district_id not in (select tenant_id from public.district_registry);
-- E5. Profiles where tenant_id and the legacy district_id alias differ.
select user_id, tenant_id, district_id from public.user_profiles where tenant_id is distinct from district_id;

-- F. Footprint of the browser copy bug (records that exist in TWO districts) ----------
-- F1. Identical records present in two districts.  Normal data never repeats a random record id
--     with identical content in another district.
select a.district_id as tenant_x, b.district_id as tenant_y, a.store, count(*) as identical_records,
       min(a.updated_at) as oldest_update, max(a.updated_at) as newest_update
from public.app_records a
join public.app_records b on b.store = a.store and b.record_id = a.record_id and b.district_id > a.district_id
where a.deleted_at is null and b.deleted_at is null and a.data = b.data
group by 1, 2, 3 order by identical_records desc;
-- F2. Member rows whose embedded tenantId belongs to a DIFFERENT district than the row.
select district_id as stored_in, data->>'tenantId' as claims_to_be, record_id, data->>'fullName' as full_name, data->>'email' as email
from public.app_records
where store = 'members' and coalesce(data->>'tenantId', '') <> '' and data->>'tenantId' <> district_id;
-- F3. District settings whose province/district names do not match the registry (review by eye:
--     spelling differences are normal, a completely different district is not).
select s.district_id, r.province_name as registry_province, r.district_name as registry_district,
       s.data->>'province' as settings_province, s.data->>'district' as settings_district, s.updated_at
from public.district_settings s join public.district_registry r on r.tenant_id = s.district_id
where lower(btrim(coalesce(s.data->>'district', ''))) <> lower(btrim(r.district_name))
   or lower(btrim(coalesce(s.data->>'province', ''))) <> lower(btrim(r.province_name));

-- G. Overview: records per district and store (eyeball: a new district should not hold hundreds of records).
select r.tenant_id, r.province_name, r.district_name, r.active, a.store, count(*) filter (where a.deleted_at is null) as live_records
from public.district_registry r left join public.app_records a on a.district_id = r.tenant_id
group by 1, 2, 3, 4, 5 order by 1, 5;

-- =====================================================================
-- CLEAN-UP TEMPLATE -- NOT EXECUTED.  Needs your explicit approval and a manual decision about which
-- district really owns each record (F1 cannot tell the original from the copy; the copy is normally in the
-- district created LATER, see district_registry.created_at).
--
-- 1) Safety copy (non-destructive):
--    create table if not exists public.app_records_isolation_backup as select now() as backed_up_at, * from public.app_records;
-- 2) Soft-delete (tombstone) ONLY the approved copies in the WRONG district; clients then drop them on next sync:
--    update public.app_records set deleted_at = now(), updated_at = now(), data = '{}'::jsonb
--    where district_id = '<WRONG_TENANT>' and store = '<STORE>' and record_id in (<APPROVED IDS>);
-- =====================================================================
