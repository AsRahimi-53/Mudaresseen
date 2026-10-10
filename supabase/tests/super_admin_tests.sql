-- MANUAL authorization tests for the Super Admin migration.
-- Run in the Supabase SQL Editor AFTER applying 20261009_super_admin.sql.
-- Every block is rolled back, so nothing is changed. Replace the placeholders:
--   ORDINARY_USER_ID : id (uuid) of an existing normal member/district admin from auth.users
--   SUPER_ADMIN_ID   : id (uuid) of the Super Admin from public.super_admins

-- 1. Ordinary user: no Super Admin power, no payment access.
begin;
select set_config('request.jwt.claims', json_build_object('sub', 'ORDINARY_USER_ID', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.is_super_admin();                      -- EXPECT: false
select public.sa_overview();                         -- EXPECT: ERROR 42501 Super Admin permission required
select public.sa_save_province(null, 'Hack', true);  -- EXPECT: ERROR 42501
select * from public.district_payments;              -- EXPECT: ERROR permission denied
select * from public.super_admins;                   -- EXPECT: ERROR permission denied
insert into public.super_admins (user_id) values ('ORDINARY_USER_ID');  -- EXPECT: ERROR permission denied
update public.district_registry set active = true;   -- EXPECT: ERROR permission denied
rollback;

-- 2. Anonymous visitor.
begin;
set local role anon;
select * from public.district_registry;              -- EXPECT: only active, eligible districts, 6 public columns
select public.sa_overview();                         -- EXPECT: ERROR permission denied for function
select public.is_super_admin();                      -- EXPECT: ERROR permission denied for function
rollback;

-- 3. Super Admin.
begin;
select set_config('request.jwt.claims', json_build_object('sub', 'SUPER_ADMIN_ID', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.is_super_admin();                      -- EXPECT: true
select public.sa_overview();                         -- EXPECT: JSON summary
select public.sa_save_province(null, 'Test Province', true);   -- EXPECT: JSON (rolled back afterwards)
select public.sa_save_province(null, 'Test Province', true);   -- EXPECT: ERROR This province is already registered
rollback;

-- 4. Payment rules (as Super Admin). Replace TENANT with an existing tenant_id.
begin;
select set_config('request.jwt.claims', json_build_object('sub', 'SUPER_ADMIN_ID', 'role', 'authenticated')::text, true);
set local role authenticated;
-- the district needs annual_fee > 0 first (use sa_save_district), then:
-- select public.sa_record_payment('TENANT', 1000, 'cash', current_date, 'T-1', current_date, current_date + 364);
-- select public.sa_record_payment('TENANT', 1000, 'cash', current_date, 't-1', current_date, current_date + 364); -- EXPECT: duplicate reference ERROR
-- select public.sa_confirm_payment('<payment id>', true);
-- select public.sa_confirm_payment('<payment id>', true);   -- EXPECT: ERROR already processed
rollback;

-- 5. Deletion protection (as postgres): EXPECT errors.
begin;
-- delete from public.district_payments;        -- EXPECT: Payments cannot be deleted; reverse them instead
-- update public.admin_audit_logs set action = 'x';  -- EXPECT: Audit logs are append-only
rollback;

-- 6. Signup must not create districts: with a NEW (unregistered) province/district in the metadata,
--    sign-up in the app must fail with "not registered"; no row may appear in district_registry.
