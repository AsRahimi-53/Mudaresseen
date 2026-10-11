-- =====================================================================
-- Cross-district isolation tests (SQL level).  Everything runs inside ONE transaction that is ROLLED BACK,
-- so no production row is kept.  Prefer a staging copy; if you use production, the temporary rows only exist
-- inside the transaction.  The script stops at the first failure with a message "FAIL: ...".
-- Run AFTER 20261009_super_admin.sql and 20261011_tenant_isolation_hardening.sql, in the SQL Editor.
-- NOT executed in the authoring sandbox (no PostgreSQL available) -- run it and read the NOTICE lines.
-- =====================================================================
begin;

-- Fixtures: two active districts and one user in each (created through the real signup trigger).
insert into public.provinces (province_id, name, active) values ('zz-test-p', 'ZZ Test Province', true) on conflict do nothing;
insert into public.district_registry (tenant_id, province_id, province_name, district_id, district_name, active) values
  ('zz-test-p:da', 'zz-test-p', 'ZZ Test Province', 'da', 'District A', true),
  ('zz-test-p:db', 'zz-test-p', 'ZZ Test Province', 'db', 'District B', true);
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000a1', 'zz-a@example.test', '{"province_id":"zz-test-p","province_name":"ZZ Test Province","district_id_short":"da","district_name":"District A","full_name":"Admin A"}'),
  ('00000000-0000-4000-8000-0000000000b1', 'zz-b@example.test', '{"province_id":"zz-test-p","province_name":"ZZ Test Province","district_id_short":"db","district_name":"District B","full_name":"Admin B"}');
-- One private record per district (written as the table owner, like a legitimate earlier sync).
insert into public.app_records (district_id, store, record_id, data) values
  ('zz-test-p:da', 'teachers', 'zz-a-teacher', '{"id":"zz-a-teacher","name":"A private"}'),
  ('zz-test-p:db', 'teachers', 'zz-b-teacher', '{"id":"zz-b-teacher","name":"B private"}');
insert into public.district_settings (district_id, data) values ('zz-test-p:da', '{"district":"A"}'), ('zz-test-p:db', '{"district":"B"}');

-- 0. Signup trigger produced exactly one trusted profile per user.
do $$
declare n int;
begin
  select count(*) into n from public.user_profiles where user_id in ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000b1');
  if n <> 2 then raise exception 'FAIL 0: expected 2 profiles, got %', n; end if;
  if (select tenant_id from public.user_profiles where user_id = '00000000-0000-4000-8000-0000000000a1') <> 'zz-test-p:da' then raise exception 'FAIL 0: A profile tenant wrong'; end if;
  raise notice 'PASS 0 signup trigger assigns the registered district';
end $$;

-- A + D. District A sees its own data and nothing of B.
do $$
declare own int; foreign_rows int; s int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-4000-8000-0000000000a1','role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into own from public.app_records where district_id = 'zz-test-p:da' and record_id = 'zz-a-teacher';
  select count(*) into foreign_rows from public.app_records where district_id <> 'zz-test-p:da';
  select count(*) into s from public.district_settings where district_id = 'zz-test-p:db';
  reset role;
  if own <> 1 then raise exception 'FAIL A: A cannot read its own record'; end if;
  if foreign_rows <> 0 then raise exception 'FAIL D: A can read % rows of other districts', foreign_rows; end if;
  if s <> 0 then raise exception 'FAIL D: A can read B settings'; end if;
  raise notice 'PASS A/D district A reads only its own data';
end $$;

-- B + C + E + F + G. District B: own data, no access to A, cannot write into A, cannot move rows.
do $$
declare own int; foreign_rows int; n int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-4000-8000-0000000000b1','role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into own from public.app_records where district_id = 'zz-test-p:db' and record_id = 'zz-b-teacher';
  select count(*) into foreign_rows from public.app_records where district_id <> 'zz-test-p:db';
  if own <> 1 then reset role; raise exception 'FAIL B: B cannot read its own record'; end if;
  if foreign_rows <> 0 then reset role; raise exception 'FAIL C: B can read % rows of other districts', foreign_rows; end if;

  -- E. update / delete of A's record touch 0 rows
  update public.app_records set data = '{"hacked":true}' where district_id = 'zz-test-p:da';
  get diagnostics n = row_count;
  if n <> 0 then reset role; raise exception 'FAIL E: B updated % rows of A', n; end if;
  delete from public.app_records where district_id = 'zz-test-p:da';
  get diagnostics n = row_count;
  if n <> 0 then reset role; raise exception 'FAIL E: B deleted % rows of A', n; end if;

  -- F. insert a record assigned to A -> rejected
  begin
    insert into public.app_records (district_id, store, record_id, data) values ('zz-test-p:da', 'teachers', 'zz-forged', '{}');
    reset role; raise exception 'FAIL F: B inserted a record into A';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.district_settings (district_id, data) values ('zz-test-p:da', '{}') on conflict (district_id) do update set data = excluded.data;
    reset role; raise exception 'FAIL F: B wrote settings of A';
  exception when insufficient_privilege then null; end;

  -- G. moving its OWN record to A (what a modified payload would try) -> rejected
  begin
    update public.app_records set district_id = 'zz-test-p:da' where district_id = 'zz-test-p:db' and record_id = 'zz-b-teacher';
    reset role; raise exception 'FAIL G: B moved a record into A';
  exception when insufficient_privilege then null; end;

  -- G. changing its own profile district / role -> rejected (no privilege)
  begin
    update public.user_profiles set tenant_id = 'zz-test-p:da', district_id = 'zz-test-p:da' where user_id = '00000000-0000-4000-8000-0000000000b1';
    reset role; raise exception 'FAIL G: B changed its own district';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.user_profiles (user_id, tenant_id, district_id, role) values (gen_random_uuid(), 'zz-test-p:da', 'zz-test-p:da', 'admin');
    reset role; raise exception 'FAIL G: B created a profile';
  exception when insufficient_privilege then null; end;

  -- J. ordinary district admin has no Super Admin power
  begin
    perform public.sa_overview();
    reset role; raise exception 'FAIL J: district admin executed sa_overview';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.district_registry (tenant_id, province_id, province_name, district_id, district_name) values ('zz-test-p:dx','zz-test-p','x','dx','x');
    reset role; raise exception 'FAIL J: district admin inserted into district_registry';
  exception when insufficient_privilege then null; end;
  begin
    update public.district_registry set active = false where tenant_id = 'zz-test-p:da';
    reset role; raise exception 'FAIL J: district admin updated district_registry';
  exception when insufficient_privilege then null; end;
  reset role;
  raise notice 'PASS B/C/E/F/G/J district B is fully isolated and has no Super Admin power';
end $$;

-- Anonymous visitors have no access to tenant tables.
do $$
begin
  set local role anon;
  begin
    perform count(*) from public.app_records;
    reset role; raise exception 'FAIL anon: anon can read app_records';
  exception when insufficient_privilege then null; end;
  reset role;
  raise notice 'PASS anon has no access to tenant tables';
end $$;

-- Users cannot see other districts' profiles.
do $$
declare foreign_profiles int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-4000-8000-0000000000b1','role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into foreign_profiles from public.user_profiles where tenant_id <> 'zz-test-p:db';
  reset role;
  if foreign_profiles <> 0 then raise exception 'FAIL: B can read % profiles of other districts', foreign_profiles; end if;
  raise notice 'PASS profiles are district scoped';
end $$;

rollback;   -- nothing above is kept
