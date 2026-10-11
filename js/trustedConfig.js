// Trusted Supabase connection settings.
//
// The URL and the public (anon/publishable) key come ONLY from the deployment:
// js/runtime-config.js, which is generated at build time from the Netlify
// environment variables SUPABASE_URL and SUPABASE_ANON_KEY. They are captured
// once, frozen, and are never read from IndexedDB, district settings, backups
// or any user-editable field. This module has no imports on purpose.
const raw = (typeof window !== 'undefined' && window.MADRASA_ONLINE_CONFIG && typeof window.MADRASA_ONLINE_CONFIG === 'object') ? window.MADRASA_ONLINE_CONFIG : {};

function jwtRole(key) {
  try {
    const part = String(key).split('.')[1];
    if (!part) return '';
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return String(json.role || '');
  } catch { return ''; }
}
function build(config) {
  const supabaseUrl = String(config.supabaseUrl || '').trim().replace(/\/+$/, '');
  const supabaseAnonKey = String(config.supabaseAnonKey || '').trim();
  let problem = '';
  if (supabaseUrl && !/^https:\/\/[^\s/]+$/i.test(supabaseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(supabaseUrl)) problem = 'invalid-url';
  if (supabaseAnonKey && (/^sb_secret_/i.test(supabaseAnonKey) || jwtRole(supabaseAnonKey) === 'service_role')) problem = 'secret-key-rejected';
  const wanted = config.enabled ?? Boolean(supabaseUrl);
  const enabled = Boolean(wanted && supabaseUrl && supabaseAnonKey && !problem);
  if (problem) console.error(`Online configuration rejected: ${problem}`);
  return Object.freeze({ enabled, supabaseUrl: enabled ? supabaseUrl : '', supabaseAnonKey: enabled ? supabaseAnonKey : '', problem });
}

const trusted = build(raw);
// Make later assignments to window.MADRASA_ONLINE_CONFIG ineffective. The application
// reads the captured copy above, never the window property.
try { Object.defineProperty(window, 'MADRASA_ONLINE_CONFIG', { value: Object.freeze({ enabled: trusted.enabled }), writable: false, configurable: false }); } catch { /* already locked */ }

export function trustedOnlineConfig() { return trusted; }
// Settings keys that must never be stored locally, synchronized, exported or restored.
export function stripLockedSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return settings;
  const { onlineConfig, ...rest } = settings; // eslint-disable-line no-unused-vars
  return rest;
}
