import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handleUsernameAuth } from '../_shared/username-auth.js';

function secretKey(): string {
  try {
    const key = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default;
    if (key) return key;
  } catch { /* Older projects use the built-in service role key. */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}

Deno.serve((req) => {
  const url = Deno.env.get('SUPABASE_URL')!;
  const key = secretKey();
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  return handleUsernameAuth(req, {
    admin: createClient(url, key, options),
    createAuthClient: () => createClient(url, key, options),
  });
});
