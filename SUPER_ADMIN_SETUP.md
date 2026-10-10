# Super Admin, district subscriptions and payments

Status: code written and tested against a **mock** backend in a sandbox. The SQL migration has **not**
been executed anywhere and nothing has been deployed. Follow the steps below to apply it.

## 1. Existing architecture (as inspected)
* Front end: static HTML/CSS/ES modules bundled to `js/app.bundle.js` (esbuild); PWA service worker; IndexedDB first, optional online sync.
* Supabase: `district_registry` (tenants), `user_profiles` (role `admin|member`), `app_records` (all synced data, one JSON row per record, scoped by `district_id` = tenant id), `district_settings`.
* Tenant isolation: RLS compares `app_records.district_id` with `current_user_tenant()`.
* Signup: `auth.users` trigger `handle_new_auth_user`.
* Netlify: `/api/*` -> `netlify/functions/*` (only `invite-member.mjs`, which uses the service-role key server-side).

### Problems found in the existing signup/registry flow
1. The old trigger let the **first signup ever create and activate the first district** (and become its only admin). Later signups were always `member`, so a newly added district would have had no administrator.
2. Supabase hides trigger errors as "Database error saving new user"; the client now maps this to the "district not registered" message.
3. Profiles of older deployments may point to a tenant that has no registry row. These stay allowed (not blocked) so nothing breaks; register those districts in the Super Admin dashboard.

## 2. What changed
**New files**
* `supabase/migrations/20261009_super_admin.sql` – incremental migration (no drops, no deletes).
* `supabase/bootstrap_super_admin.sql` – one-time owner bootstrap (SQL Editor only).
* `supabase/tests/super_admin_tests.sql` – manual authorization tests (rolled back).
* `netlify/functions/superadmin.mjs` – authenticated gateway (401 / 403 / validated actions).
* `js/superAdmin.js` – the dashboard (Overview, Provinces, Districts, Payments, Reports, Audit, Settings).

**Modified files**
* `js/onlineSync.js` – asks the database `is_super_admin()` per session (kept in memory only), `superAdminRequest`, super admin without a district profile no longer treated as "profile required", friendlier signup error.
* `js/app.js` – route `super-admin`; the menu is **created in the page only for a confirmed Super Admin** and removed on logout; navigation to the route is refused otherwise.
* `js/settings.js`, `js/translations.js`, `js/utils.js` (solar->ISO date, used for DB dates), `js/mobile.js` (the "More" sheet is emptied while closed and shows role-specific items only), `index.html` (unchanged nav; no Super Admin markup), `supabase/schema.sql` (warning header only), `ONLINE_DEPLOYMENT.md`.
* `js/app.bundle.js` – rebuilt.

## 3. Security design
* The role lives in `public.super_admins` (one row at most - unique index - the owner). RLS is on with **no policies** and all privileges are revoked from `anon`/`authenticated`: nobody can read or change it from the browser.
* Every `sa_*` Postgres function is `SECURITY DEFINER`, calls `assert_super_admin()` first (error 42501 otherwise) and is executable only by signed-in users. Payments, subscriptions, audit log, provinces and settings tables are not reachable directly by anyone but through these functions.
* The Netlify function checks the session (`401`), then `is_super_admin()` (`403`), validates the action against a whitelist and parameter names/types, then forwards **the user's own token** to the database function (second check). No service-role key is used or needed; only `SUPABASE_URL` and `SUPABASE_ANON_KEY` (both public) are read.
* Payments: `draft -> confirmed -> reversed`. Confirmed payments are immutable (trigger); nothing is deleted; audit log is append-only; a receipt/reference number can be used once; confirmation locks the row so double confirmation fails; revenue counts **confirmed** payments only.
* Districts start **inactive**. Activation/renewal requires confirmed payments that cover the annual fee for the exact period; renewal extends the period when contiguous; history is kept in `district_subscriptions` + audit log.
* Expired subscriptions never delete data. Policy (Settings tab): `read_only` (default), `block`, or `grace` (full access for N days). Enforced in RLS on `app_records`/`district_settings`, so it cannot be bypassed from the browser. `access_exception` per district lets the owner allow an exception.
* Signup: only `active` districts of an active province with a valid subscription appear in the signup list and are accepted by the trigger; the first member of a registered district becomes its administrator.
* The PWA service worker never caches `/api/*` or cross-origin (Supabase) requests; the dashboard fetches with `no-store`, keeps nothing in localStorage/IndexedDB, and the page contains no Super Admin markup for other users.

## 4. Apply the migration (existing production database)
1. Back up: Supabase > Database > Backups (or `pg_dump`).
2. Supabase > SQL Editor > paste `supabase/migrations/20261009_super_admin.sql` > Run. It is one transaction: if anything fails nothing is applied. Do **not** re-run the old `schema.sql` afterwards.
3. Existing districts stay active (grandfathered, no end date) so current users keep working. In the dashboard, set a fee and record/confirm a payment with a period to put them on a subscription.

## 5. Create the first Super Admin (one time)
Follow `supabase/bootstrap_super_admin.sql` step by step in the SQL Editor (pre-authorise the e-mail, create the user in Authentication > Users with "Auto Confirm User", verify, run `select public.bootstrap_super_admin(...)`). It works once and refuses if a Super Admin exists. There is no public endpoint and public signup can never create a Super Admin.

## 6. Netlify
Environment variables (Site settings > Environment variables) - these are public values, not secrets:
* `SUPABASE_URL` = your project URL
* `SUPABASE_ANON_KEY` = your publishable/anon key

`SUPABASE_SERVICE_ROLE_KEY` is only used by the existing `invite-member` function; never put it anywhere else. `netlify.toml` is unchanged. Commit/push the whole project to GitHub (`js/app.bundle.js` is already rebuilt). Netlify redeploys automatically; then reload the app twice so the service worker updates.

## 7. Test report
Legend: **V** = verified by automated tests in the sandbox against a mock backend + the real Netlify function code and the real UI in Chromium. **S** = needs the SQL run in Supabase (use `supabase/tests/super_admin_tests.sql`); I could not execute SQL here.

| # | Scenario | Status |
|---|---|---|
| 1 | Visitor cannot reach Super Admin functions (401) | V |
| 2-4 | Member / district admin cannot use Super Admin functions, register districts or confirm payments (403, menu absent, forced navigation refused) | V (gateway + UI); database enforcement **S** |
| 5-6 | Super Admin registers province and district; duplicates rejected | V (mock) / **S** |
| 7 | New district inactive | V (mock) / **S** |
| 8-9 | Cash / bank payment recorded as draft and confirmed | V (mock) / **S** |
| 10 | Confirmed full payment activates | V (mock) / **S** |
| 11 | Draft payments not counted as revenue | V (mock) / **S** |
| 12, 19 | Public signup cannot activate or create districts | **S** |
| 14-15 | Expiry policy, renewal keeps history | **S** |
| 16-18 | Tenant isolation, existing users/records preserved | **S** |
| 20 | No service-role key in frontend assets (`js/app.bundle.js`, `index.html`, `runtime-config.js`, `sw.js`) | V (grep: no key value and no `SUPABASE_SERVICE_ROLE_KEY`; the word `service_role` appears only in supabase-js library comments) |
| 21 | Migration applies without deleting data | by design (no DROP/DELETE of data; one transaction) - **S** |
| 22 | Double confirmation rejected | V (mock) / **S** |
| F1-F3, F9 | Super Admin sees dashboard; members/district admins never; logout leaves no dashboard markup or menu entry for the next user in the same browser | V |
| F4-F5 | Manual URL / direct function call by ordinary user | V (403) |
| F6-F8 | Direct DB reads, role self-promotion | **S** (policies written; verify with the SQL test file) |

Existing regression tests (members, statistics, back button, Dari, database upgrade) were re-run after the changes.

## 8. Known limitations
* Currency is AFN only; payments are manual; no payment gateway or bank integration.
* "Outstanding" = annual fee minus confirmed payments whose period has not ended; partial payments are allowed, and activation needs the full fee for the exact period.
* Expiry is evaluated at read time (no scheduled job), so there is no e-mail reminder.
* Dates are stored as Gregorian `date` in the database and shown as Solar Hijri.
* The dashboard needs an internet connection (it is online-only by design); the rest of the app still works offline.
* A Super Admin account has no district profile, so district modules on that device are local-only (nothing syncs for it).
* `sa_*` errors are shown in English as returned by the database functions.
