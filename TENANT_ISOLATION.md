# Cross-district data isolation — audit, root cause and fix

Status legend: **VERIFIED** = executed in the authoring sandbox · **NOT RUN** = written but needs your Supabase project.

## 1. Root cause (confirmed by reproduction)

The database policies were **not** the hole. `20261009_super_admin.sql` pins every `app_records` / `district_settings`
row to `current_user_tenant()` for SELECT, INSERT, UPDATE and DELETE, and `user_profiles` has no write privilege.

The leak is in the **browser**:

| # | Finding | Where |
|---|---|---|
| 1 | One global IndexedDB (`madrasa-professional-development-db`) is shared by every account on the device. | `js/database.js` |
| 2 | Sign-out never clears it. | `onlineSync.signOut()` |
| 3 | After sign-in, `syncRecords()` uploads every local row that is "missing" in the cloud (`upsertRemoteRecords(store, missing)`) using **the new user's** `district_id`. RLS accepts it, because that *is* the new user's district. Local settings are pushed the same way (`syncSettings → pushSettings`). | `js/onlineSync.js` |
| 4 | Restoring a backup from another district was allowed and then synced the same way. | `js/backup.js` |

Result: a new district account on a device that had district A's cache **receives copies of A's records and settings in its own district** — exactly the reported symptom. **Rows that were already copied are now stored in the cloud under the wrong district** (see §5).

Reproduced with the original code (**VERIFIED**, `tests/client-isolation`): after A signs out and B signs in, B's cloud district contained A's records and A's settings. With the fix: nothing is copied.

Netlify functions were audited: `superadmin.mjs` re-checks `is_super_admin()` in the database and uses the caller's token (no service key); `invite-member.mjs` derives the district from the inviter's server-side profile. No change needed.

## 2. Files changed

| File | Change |
|---|---|
| `js/database.js` | `hasData()`, `resetLocalData()` (local-only wipe, optional archive to a never-read quarantine DB, never calls the remote adapter), owner helpers. |
| `js/onlineSync.js` | `enforceLocalOwnership()` runs after the server profile is loaded and **before any sync**; `isReady()` now also requires `ownerVerified`; `signOut()` flushes then wipes local data; accounts without a district profile (e.g. Super Admin) get no cached data; session changes are serialised; remote rows are re-checked against `district_id`; missing settings are seeded from the server profile. |
| `js/backup.js` | Backups carry `tenantId`; restoring a backup of another district is refused (old backups without `tenantId` need an extra confirmation if the names differ). |
| `js/app.bundle.js` | Same edits applied to the committed bundle (hand-patched, syntax-checked). **Please run `npm run build` to regenerate it properly** — Netlify does not run esbuild. |
| `sw.js` | Cache `v7 → v8` so clients load the new bundle. |
| `supabase/migrations/20261011_tenant_isolation_hardening.sql` (new) | Additive: least-privilege grants, identity-immutability triggers, index. No data touched. FK constraints are provided **commented out** (need approval, see file). |
| `supabase/audit/20261011_isolation_audit.sql` (new) | Read-only audit of RLS, policies, grants, orphan data and cross-district copies. |
| `supabase/tests/tenant_isolation_tests.sql` (new) | Rolled-back SQL tests for A–G and J. **NOT RUN.** |
| `tests/client-isolation/*` (new) | Runnable client tests (`bash tests/client-isolation/run.sh`). |

No visual design, module or feature was removed. `app.js` is unchanged.

## 3. How local data is treated now

* Local data may be reused only by an account of the **same district** (tenant from the server profile, never from the browser).
* Unknown legacy cache (no owner tag): reused only if its settings name exactly the signed-in district; otherwise archived.
* Foreign cache: archived on the device into `madrasa-professional-development-db-quarantine-<time>` (never read, never synced, never deleted in the cloud), then cleared.
* Sign-out: unsynced changes are pushed first; if that fails the data is archived before it is cleared.

## 4. Deployment sequence (safe order)

1. **Backup**: Supabase → Database → Backups (or export `app_records`, `district_settings`, `user_profiles`).
2. Run `supabase/audit/20261011_isolation_audit.sql`. Check A–D (RLS on, policies present, `anon` has no grants, signup trigger current).
3. Check **F1 / F2 / F3** for existing cross-district copies (§5). Do not delete anything yet.
4. Run `20261011_tenant_isolation_hardening.sql` (additive, re-runnable).
5. Run `supabase/tests/tenant_isolation_tests.sql` (staging preferred) and read the `PASS` notices.
6. `npm install && npm run build`, commit, deploy to Netlify (new service-worker cache `v8`).
7. On each shared device: users sign in once; foreign cache is archived automatically.
8. Only after your approval: clean up copies using the template at the end of the audit file (tombstones, not deletes).

## 5. Existing data — manual review required

Because of the bug, district B (and any later district) may already hold copies of district A's records/settings.
Ownership **cannot be decided automatically** (the copy keeps the original id and timestamps). F1 lists identical records
that exist in two districts (the copy is normally in the district created later), F2 lists `members` rows whose `tenantId`
is another district, F3 lists settings that name another district. Nothing was deleted or reassigned. Tell me the results
and I will prepare the exact, approved clean-up.

## 6. Test checklist

SQL (`tenant_isolation_tests.sql`) covers A, B, C, D, E, F, G, J and anonymous access. Client tests (**VERIFIED** here):

| Case | Expected | Result |
|---|---|---|
| H/I: A signs out, B signs in | B sees nothing of A locally; nothing uploaded to B; A's cloud data intact | pass |
| Legacy A cache, B signs in (no sign-out) | cache archived, B district stays clean, B settings seeded from B's profile | pass |
| Legacy A cache, A signs in | A keeps data and it syncs | pass |
| A edits offline, then signs out | no data lost: archived copy contains the unsynced record | pass |
| Forged local owner tag | server profile decides; B's district stays clean | pass |
| Restore district A backup into B | refused | pass |

Manual UI checks (**NOT RUN**): K — signup with an inactive/unknown district is rejected, activation by Super Admin still works,
district admin cannot open the Super Admin page or call `/api/superadmin` (expect 403), invite-member only for own district.

## 7. Known limits / decisions for you

* RLS and the SQL tests were **not executed** against your live project; I cannot claim the database is verified until you run steps 2 and 5.
* After sign-out the device is empty; reloading the app then shows the first-run setup form until the next login (same as a fresh browser). I can change this if you prefer.
* A new district admin now gets a minimal settings record (province/district from the registry); `academicYear` etc. are set in Settings. Tell me if you want the setup form shown instead.
* Passive session expiry / "use offline" does not wipe the device; only explicit sign-out and account switching do. Anyone with physical access to a logged-in device can still see that device's local cache.
* `invite-member.mjs` sends `Access-Control-Allow-Origin: *` (token is still required). Consider restricting it to your Netlify origin.
