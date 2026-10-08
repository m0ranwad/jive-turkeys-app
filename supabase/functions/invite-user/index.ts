// Sends a Supabase invite email to a new teammate.
// Any signed-in player can invite a player; only captains can invite captains.
// Deploy: npx supabase functions deploy invite-user
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// New-style secret key (sb_secret_...), falling back to the legacy service_role
// key that Supabase retires at the end of 2026.
function secretKey(): string {
  try {
    const key = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default;
    if (key) return key;
  } catch {
    // Not set on older projects.
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed' });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), { auth: { persistSession: false } });

  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth?.user) return reply(401, { error: 'Sign in to invite teammates.' });

  let body: { email?: string; role?: string; redirectTo?: string };
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: 'Invalid request.' });
  }

  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply(400, { error: 'Enter a valid email address.' });

  const wantsCaptain = body.role === 'admin';
  if (wantsCaptain) {
    const { data: caller } = await admin.from('users').select('role').eq('id', auth.user.id).maybeSingle();
    if (caller?.role !== 'admin') return reply(403, { error: 'Only captains can invite captains.' });
  }

  // Supabase only redirects to URLs on the project's allow list.
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: body.redirectTo });
  if (error) return reply(400, { error: error.message });

  if (wantsCaptain && data.user) {
    await admin.from('users').update({ role: 'admin' }).eq('id', data.user.id);
  }
  return reply(200, { ok: true });
});
