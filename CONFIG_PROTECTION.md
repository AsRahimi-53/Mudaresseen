# Protecting the Supabase connection settings

## What was wrong (audit)
1. **Online Settings tab** showed editable `Supabase URL` / `Supabase Anon Key` fields to every user.
2. `getOnlineConfig()` let the values saved in the browser database (IndexedDB `settings.onlineConfig`) **override** the deployment values (this was also the cause of the earlier "Failed to fetch").
3. The app **copied** the deployment values into IndexedDB at startup and then pushed the whole local settings object to the shared table `district_settings` -> one district administrator could have written `onlineConfig` and every other user of the district would have pulled it (connection hijack).
4. **Backups** exported and restored `settings.onlineConfig`.
5. `districtId()` fell back to a district id taken from that local configuration.

## What changed
| File | Change |
|---|---|
| `js/trustedConfig.js` (new) | Captures the deployment config once, freezes it, rejects non-https URLs and secret/service-role keys, locks `window.MADRASA_ONLINE_CONFIG`, provides `stripLockedSettings()`. |
| `js/onlineSync.js` | `getOnlineConfig()` returns only the trusted values; settings are stripped when pushed to / pulled from `district_settings`; no local district-id fallback; the snapshot no longer exposes URL/key. |
| `js/database.js` | Every write to the `settings` store (put, bulkPut, restore, export) drops `onlineConfig`; old stored values are removed on first read. |
| `js/app.js` | Startup/setup no longer persist connection settings. |
| `js/settings.js` | The configuration form and its handler are **removed** (not hidden); only a short note remains. |
| `netlify/functions/superadmin.mjs` | New read-only action `config.status` (Super Admin only: 401/403 otherwise) returning host, key *type*, whether the deployed file matches Netlify, Auth reachability, and whether a service-role key is configured (never any value). There is deliberately **no** action that changes the configuration. |
| `js/superAdmin.js` | "Connection status" card in the Super Admin Settings tab (read-only). |
| `scripts/generate-runtime-config.mjs` (new) + `netlify.toml` | At build time `js/runtime-config.js` is generated from the Netlify variables `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Fails the build if a secret/service-role key or a non-https URL is supplied; keeps the committed file if the variables are not set. |
| `sw.js` | `runtime-config.js` is fetched network-first (cache only as offline fallback); cache v7. |
| `supabase/migrations/20261010_protect_online_config.sql` (new) | Trigger on `district_settings` that strips `onlineConfig` (adds a trigger only; no data changed). |
| `js/translations.js`, `js/app.bundle.js` | New texts; bundle rebuilt. |

## Manual steps (nothing is changed in production until you do them)
1. Netlify > Site configuration > Environment variables:
   * `SUPABASE_URL` = project URL, `SUPABASE_ANON_KEY` = the public `sb_publishable_...` key (scope: Builds + Functions).
   * `SUPABASE_SERVICE_ROLE_KEY` (only the existing invite-member function needs it): scope **Functions only**, not Builds.
2. Upload the project to GitHub; Netlify deploys. In the deploy log look for `[runtime-config] js/runtime-config.js generated for <your-project>.supabase.co`.
3. Optional hardening: run `supabase/migrations/20261010_protect_online_config.sql` in the SQL Editor (trigger only). Optionally clean old rows after checking them first (statements are in the file's comments; they remove only the `onlineConfig` key).
4. To change the project/key in the future: change the two Netlify variables and redeploy. Nothing in the app can change them.
5. Rollback: remove the `command` line from `netlify.toml` (the committed `js/runtime-config.js` is used again).

## Remaining risks / limits
* The Supabase URL and the **public** anon/publishable key must be delivered to every browser for the app to work; they remain visible in `js/runtime-config.js` and in network requests. Removing the UI fields and the local overrides stops users from *changing* or *discovering them through the interface*, but they are not secret. Security comes from RLS and the server-side checks, never from hiding the key.
* A user with developer tools can modify **their own** copy of the app; this only affects that user's own browser (the server still enforces RLS).
* Backup files made by older versions contain the public URL/key; they are ignored on restore, but treat such files as ordinary data files.
* The migration/trigger and the real Netlify build were not executed in this sandbox (see the test report).
