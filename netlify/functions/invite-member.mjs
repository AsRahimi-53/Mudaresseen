import { createClient } from '@supabase/supabase-js';

// Legacy compatibility endpoint. The app's primary onboarding path is public
// self-signup; this route remains only for installations that still need an
// administrator invitation. The service-role key is read from Netlify
// environment variables and is never sent to the browser.
const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });

export default async function handler(request) {
  if (request.method === 'OPTIONS') return new Response('', { status: 204, headers });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: 'Supabase server environment variables are not configured.' }, 500);
  const authorization = request.headers.get('authorization') || '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'Authentication is required.' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body.' }, 400); }
  const email = String(body.email || '').trim().toLowerCase();
  const memberId = String(body.memberId || '').trim();
  const requestedTenant = String(body.districtId || '').trim();
  if (!email || !memberId || !requestedTenant || !email.includes('@')) return json({ error: 'Email, member and district are required.' }, 400);

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  if (authError || !authData?.user) return json({ error: 'Invalid or expired session.' }, 401);
  const { data: inviter, error: inviterError } = await adminClient.from('user_profiles').select('tenant_id,district_id,province_id,province_name,district_id_short,district_name,role').eq('user_id', authData.user.id).maybeSingle();
  const inviterTenant = inviter?.tenant_id || inviter?.district_id;
  if (inviterError || !inviter || inviter.role !== 'admin' || inviterTenant !== requestedTenant) return json({ error: 'Only the district administrator can invite members.' }, 403);

  const metadata = {
    tenant_id: inviterTenant,
    district_id: inviterTenant,
    province_id: inviter.province_id || '',
    province_name: inviter.province_name || '',
    district_id_short: inviter.district_id_short || '',
    district_name: inviter.district_name || '',
    member_id: memberId,
    full_name: String(body.displayName || email.split('@')[0]).trim(),
    phone: String(body.phone || '').trim()
  };
  const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, { data: metadata, redirectTo: request.headers.get('origin') || undefined });
  if (inviteError) return json({ error: inviteError.message }, 400);
  // The auth trigger normally creates this profile and shared member row. The
  // upsert keeps old databases compatible if the trigger was installed later.
  const { error: profileError } = await adminClient.from('user_profiles').upsert({
    user_id: invited.user.id,
    tenant_id: inviterTenant,
    district_id: inviterTenant,
    province_id: inviter.province_id,
    province_name: inviter.province_name,
    district_id_short: inviter.district_id_short,
    district_name: inviter.district_name,
    member_id: memberId,
    role: body.role === 'admin' ? 'admin' : 'member',
    display_name: metadata.full_name,
    phone: metadata.phone
  }, { onConflict: 'user_id' });
  if (profileError) return json({ error: profileError.message }, 500);
  return json({ ok: true, userId: invited.user.id, email });
}
