# Madrasa Teachers Professional Development – Scientific Members Management System

A Pashto-first, RTL, **Hybrid Online + Offline** web/PWA application for the Scientific Members team responsible for Madrasa Teachers Professional Development.

## Offline mode

1. Keep this folder on the target computer.
2. Serve it with any local static server (or open it in an offline desktop wrapper):

```bash
python3 -m http.server 4173 --bind 0.0.0.0
```

3. Open `http://localhost:4173`.

IndexedDB is the primary local cache. The bundled `js/app.bundle.js` works without internet when Online mode is disabled. Printing, export, backup/restore and the application modules remain available offline.

## Online / Hybrid mode

The project uses Supabase for a central, tenant-scoped database while preserving local IndexedDB and automatic reconnect sync.

- `js/runtime-config.js` contains only the public Supabase URL and anon key placeholders.
- `supabase/schema.sql` creates `district_registry`, signup trigger, profiles, shared records and RLS.
- `netlify/functions/invite-member.mjs` is optional legacy compatibility; self-signup is the normal onboarding path.
- `netlify.toml` configures the optional Netlify function.
- `ONLINE_DEPLOYMENT.md` contains Supabase, self-signup, tenant isolation and Netlify setup.

### Self-signup and tenant scope

- The first signup may register the first province/district and becomes that tenant's online admin.
- Later users see only active province/district combinations already in `district_registry`.
- Each signup creates a `user_profiles` row and a shared `members` record automatically.
- Users in the same `province:district` tenant share records; RLS prevents cross-tenant visibility.
- Authenticated members can read/add/edit shared records; online delete is admin-only.

## PWA

- `manifest.webmanifest` enables installable standalone display with Pashto RTL metadata.
- `sw.js` caches only same-origin static shell assets and deliberately bypasses Supabase/API traffic.
- `assets/icons/icon-192.png`, `icon-512.png` and `apple-touch-icon.png` provide install icons.
- `PWA_GUIDE.md` explains HTTPS/Netlify deployment and Android Chrome/iOS Safari installation.

PWA install requires an HTTPS deployment and one initial visit so the shell can be cached. IndexedDB continues to support offline writes; reconnect uses the existing sync logic.

## Included modules

- First-run organization setup, Pashto/Dari RTL switching, local logo, and Solar Hijri (Jalali) date entry/display
- Team members with unlimited records and individual work dashboards
- Separate general overview dashboard and member-selectable Team Dashboard
- Madrasa and teacher CRUD; student registration is statistical only
- Administrative-staff register with special information, photos, search, filters, profiles, printing and Excel export
- Read-only Tashkil report with automatic teacher/staff summary
- Student statistics with comprehensive summaries by madrasa, class, gender, academic year and date
- Formal teacher observations with 0–4 criterion scores, up to 25 criteria, default total score 100, configurable criteria and quality levels
- Annual/monthly plans, multi-member duties, activities, professional development, monitoring and report management
- Automatic detailed report builder from IndexedDB data
- Browser A4 printing with official headers, metadata, tables and signature areas
- Local `.xlsx` export with Pashto/Dari labels
- Complete JSON backup/validated restore and safe clear operations
- Compressed local photos for members, teachers, staff, madrasas and organization logo

## Data safety

Use **Backup** before moving the installation or restoring data. In online mode, never put the Supabase service-role key in `js/runtime-config.js`, the frontend bundle, the PWA cache or GitHub; keep it only in Netlify environment variables.
