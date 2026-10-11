-- ONE-TIME Super Admin bootstrap. Run each step by hand in the Supabase SQL Editor
-- (which runs as the trusted postgres role). There is NO public endpoint for this.
-- Replace owner@example.com with the owner's real e-mail everywhere.

-- STEP 1. Pre-authorise the owner's e-mail (only someone with database access can do this).
insert into public.super_admin_invites (email) values ('owner@example.com') on conflict do nothing;

-- STEP 2. In the Supabase Dashboard: Authentication > Users > Add user > Create new user.
--         Enter that e-mail and a strong password and tick "Auto Confirm User".
--         If the dashboard says the e-mail already exists, somebody else registered it first:
--         delete that user in the dashboard and repeat STEP 2.

-- STEP 3. Verify the account is the one you just created (check created_at) and is confirmed.
select id, email, created_at, email_confirmed_at from auth.users where lower(email) = lower('owner@example.com');

-- STEP 4. Promote it. Works only once: it refuses when a Super Admin already exists.
select public.bootstrap_super_admin('owner@example.com');

-- STEP 5. Confirm.
select user_id, created_at from public.super_admins;
-- Afterwards the invite row is deleted automatically.

-- To REMOVE or REPLACE the Super Admin later (SQL Editor only):
--   delete from public.super_admins;   -- then repeat STEPS 1-5 for the new owner account
