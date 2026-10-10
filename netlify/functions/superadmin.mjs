// Super Admin gateway.
//
// Every request is authenticated and authorised on the server:
//   * no / invalid session            -> 401
//   * valid session, not Super Admin  -> 403
//   * Super Admin                     -> the action is forwarded to a Postgres
//                                        function that checks the role AGAIN.
// The user's own access token is forwarded, so no service-role key is needed or
// used here. Only SUPABASE_URL and SUPABASE_ANON_KEY (both public values) are
// read from the Netlify environment.
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });

// action -> Postgres function. Anything else is rejected.
const ACTIONS = {
  whoami: null,
  'overview': 'sa_overview',
  'provinces.list': 'sa_list_provinces',
  'provinces.save': 'sa_save_province',
  'districts.list': 'sa_list_districts',
  'districts.save': 'sa_save_district',
  'districts.activate': 'sa_activate_district',
  'districts.deactivate': 'sa_deactivate_district',
  'payments.list': 'sa_list_payments',
  'payments.record': 'sa_record_payment',
  'payments.confirm': 'sa_confirm_payment',
  'payments.reverse': 'sa_reverse_payment',
  'audit.list': 'sa_list_audit',
  'settings.get': 'sa_get_settings',
  'settings.save': 'sa_save_settings'
};

function cleanParams(input) {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) return null;
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (!/^p_[a-z_]{1,40}$/.test(key)) return null;
    if (value === null || typeof value === 'boolean' || typeof value === 'number') { out[key] = value; continue; }
    if (typeof value === 'string' && value.length <= 2000) { out[key] = value; continue; }
    return null;
  }
  return out;
}

async function rest(url, anonKey, token, path, init = {}) {
  return fetch(`${url}${path}`, { ...init, headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
}

export default async function handler(request) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const anonKey = process.env.SUPABASE_ANON_KEY || '';
  if (!supabaseUrl || !anonKey) return json({ error: 'Server is not configured.' }, 500);

  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'Authentication is required.' }, 401);

  // 1. Is this a valid, current session?
  let userResponse;
  try { userResponse = await rest(supabaseUrl, anonKey, token, '/auth/v1/user'); }
  catch { return json({ error: 'Authentication service unavailable.' }, 502); }
  if (!userResponse.ok) return json({ error: 'Invalid or expired session.' }, 401);

  // 2. Is this user the Super Admin? (decided by the database, never by the client)
  let roleResponse;
  try { roleResponse = await rest(supabaseUrl, anonKey, token, '/rest/v1/rpc/is_super_admin', { method: 'POST', body: '{}' }); }
  catch { return json({ error: 'Authorization service unavailable.' }, 502); }
  if (!roleResponse.ok) return json({ error: 'Forbidden.' }, 403);
  const isSuperAdmin = await roleResponse.json().catch(() => false);
  if (isSuperAdmin !== true) return json({ error: 'Forbidden.' }, 403);

  // 3. Validate the request.
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body.' }, 400); }
  const action = String(body?.action || '');
  if (!Object.prototype.hasOwnProperty.call(ACTIONS, action)) return json({ error: 'Unknown action.' }, 400);
  if (action === 'whoami') return json({ superAdmin: true });
  const params = cleanParams(body?.params);
  if (!params) return json({ error: 'Invalid parameters.' }, 400);

  // 4. Forward to the database function with the user's own token.
  let response;
  try { response = await rest(supabaseUrl, anonKey, token, `/rest/v1/rpc/${ACTIONS[action]}`, { method: 'POST', body: JSON.stringify(params) }); }
  catch { return json({ error: 'Database unavailable.' }, 502); }
  const payload = await response.json().catch(() => null);
  if (response.ok) return json({ data: payload });
  // Business-rule violations raised by our functions (plain "raise exception") use SQLSTATE P0001.
  if (payload?.code === 'P0001') return json({ error: String(payload.message || 'Request rejected.').slice(0, 300) }, 400);
  if (payload?.code === '42501' || payload?.code === '28000') return json({ error: 'Forbidden.' }, 403);
  return json({ error: 'The operation could not be completed.' }, 500);
}
