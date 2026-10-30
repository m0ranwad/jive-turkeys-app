// Sends chat notifications to players' phones (Web Push).
// The database calls it when a message is posted (see the chat_push migration)
// for Player of the Match voting (the potm_voting_window migration), game
// reminders (the game_reminders migration) and "Playing session N?" (the
// session_question_notifications migration); the
// site calls it for the public key and for "Send a test".
// Deployed by .github/workflows/functions.yml. The logic lives in ../_shared/notify.js.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { handleNotify } from '../_shared/notify.js';
import { secretKey } from '../_shared/secret-key.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// Set once by the deploy workflow (scripts/vapid-keys.mjs); never in the code.
const vapid = {
  publicKey: Deno.env.get('VAPID_PUBLIC_KEY'),
  privateKey: Deno.env.get('VAPID_PRIVATE_KEY'),
  subject: Deno.env.get('VAPID_SUBJECT') || 'mailto:team@jiveturkeys.app',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed' });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), { auth: { persistSession: false } });
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // Treated as "nothing to do".
  }
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');

  const deps = {
    vapid,
    fetch,
    async userOf(jwt: string) {
      if (!jwt) return null;
      const { data } = await admin.auth.getUser(jwt);
      return data?.user ?? null;
    },
    db: {
      async pushTargets(messageId: string) {
        const { data, error } = await admin.rpc('chat_push_targets', { p_message_id: messageId });
        if (error) throw error;
        return data ?? [];
      },
      async unreadCounts(subscriptionIds: string[]) {
        const { data, error } = await admin.rpc('chat_push_unread', { p_subscription_ids: subscriptionIds });
        if (error) throw error;
        return data ?? [];
      },
      async reminderTargets(gameId: string, kind: string) {
        const { data, error } = await admin.rpc('game_reminder_targets', { p_game_id: gameId, p_kind: kind });
        if (error) throw error;
        return data ?? [];
      },
      async sessionAskTargets(year: number, session: number, kind: string) {
        const { data, error } = await admin.rpc('session_ask_targets', { p_year: year, p_session: session, p_kind: kind });
        if (error) throw error;
        return data ?? [];
      },
      async potmTargets(gameId: string, kind: string) {
        const { data, error } = await admin.rpc('potm_push_targets', { p_game_id: gameId, p_kind: kind });
        if (error) throw error;
        return data ?? [];
      },
      async subscriptionsOf(userId: string) {
        const { data, error } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', userId);
        if (error) throw error;
        return data ?? [];
      },
      async forget(subscriptionId: string) {
        await admin.from('push_subscriptions').delete().eq('id', subscriptionId);
      },
    },
  };

  try {
    const [status, json] = await handleNotify(body, token, deps);
    return reply(status, json);
  } catch (err) {
    console.error(err);
    return reply(500, { error: 'Something went wrong.' });
  }
});
