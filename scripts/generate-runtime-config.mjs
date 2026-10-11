// Generates js/runtime-config.js from the Netlify environment variables
// SUPABASE_URL and SUPABASE_ANON_KEY at build time, so the shared connection
// settings live in the deployment configuration and not in the repository.
//
//  * Neither variable set  -> the committed js/runtime-config.js is kept (safe fallback).
//  * Only one set          -> the build fails (misconfiguration).
//  * A secret/service-role key is detected -> the build fails; it is never written.
import { writeFileSync } from 'node:fs';

const target = new URL('../js/runtime-config.js', import.meta.url);
const url = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const key = (process.env.SUPABASE_ANON_KEY || '').trim();
const fail = message => { console.error(`[runtime-config] ERROR: ${message}`); process.exit(1); };
function jwtRole(value) {
  try { return String(JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8')).role || ''); } catch { return ''; }
}

if (!url && !key) {
  console.log('[runtime-config] SUPABASE_URL / SUPABASE_ANON_KEY are not set: keeping the committed js/runtime-config.js.');
  process.exit(0);
}
if (!url || !key) fail('Set BOTH SUPABASE_URL and SUPABASE_ANON_KEY (or neither).');
if (!/^https:\/\/[^\s/]+$/i.test(url)) fail('SUPABASE_URL must look like https://<project>.supabase.co');
if (/^sb_secret_/i.test(key) || jwtRole(key) === 'service_role') fail('SUPABASE_ANON_KEY contains a secret/service-role key. Use the public anon/publishable key only.');

const body = `// Generated at build time from the Netlify environment variables. Do not edit by hand.
window.MADRASA_ONLINE_CONFIG = {
  enabled: true,
  supabaseUrl: ${JSON.stringify(url)},
  supabaseAnonKey: ${JSON.stringify(key)}
};
`;
writeFileSync(target, body);
console.log(`[runtime-config] js/runtime-config.js generated for ${new URL(url).host} (anon key not printed).`);
