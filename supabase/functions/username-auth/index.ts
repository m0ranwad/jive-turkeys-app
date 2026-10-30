import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handleUsernameAuth } from '../_shared/username-auth.js';
import { secretKey } from '../_shared/secret-key.ts';

Deno.serve((req) => {
  const url = Deno.env.get('SUPABASE_URL')!;
  const key = secretKey();
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  return handleUsernameAuth(req, {
    admin: createClient(url, key, options),
    createAuthClient: () => createClient(url, key, options),
  });
});
