#!/usr/bin/env bash
# Client-side isolation tests: runs the REAL js/database.js, js/onlineSync.js and js/backup.js against an
# in-memory IndexedDB / localStorage and an in-memory Supabase that emulates the RLS policies.
# No npm install and no network needed. Usage:  bash tests/client-isolation/run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/fixed/node_modules/@supabase/supabase-js"
cp -r "$root/js" "$root/package.json" "$tmp/fixed/"
echo '{"name":"@supabase/supabase-js","type":"module","main":"index.js"}' > "$tmp/fixed/node_modules/@supabase/supabase-js/package.json"
echo 'export function createClient(){ return globalThis.__makeClient(); }' > "$tmp/fixed/node_modules/@supabase/supabase-js/index.js"
cp "$here/harness.mjs" "$here/run.mjs" "$tmp/"
for s in signout-then-B legacy-cache-B legacy-cache-A unsynced-offline forged-owner backup-guard; do
  echo "== $s"; (cd "$tmp" && node run.mjs fixed "$s")
done
