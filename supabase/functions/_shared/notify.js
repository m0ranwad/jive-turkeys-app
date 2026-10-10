// What the notify-chat function does, kept free of Supabase specifics so it can
// be tested in Node (tests/unit/notify.test.js). index.ts wires it to the database.
import { sendPush } from './webpush.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "Jane Q Public" -> "Jane P." (same as the site's shortName). */
function shortName(name) {
  const parts = String(name ?? '').split(' ').filter(Boolean);
  if (parts.length === 0) return 'Player';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** What a chat notification says, and where tapping it goes. One per room is kept on screen (tag). */
export function chatNotification({ thread_id, thread_title, author_name, body }) {
  return {
    title: thread_id ? thread_title || 'Thread' : 'Team Chat',
    body: clip(`${shortName(author_name)}: ${String(body).replace(/\s+/g, ' ').trim()}`, 160),
    url: thread_id ? `/banter?thread=${thread_id}` : '/banter',
    tag: `chat-${thread_id || 'team'}`,
  };
}

export const TEST_NOTIFICATION = {
  title: 'Notifications are on 🦃',
  body: "You'll hear about new chat messages on this device.",
  url: '/banter',
  tag: 'test',
};

async function deliver(targets, messageFor, { vapid, db, fetch }) {
  const result = { sent: 0, forgotten: 0, failed: 0, statuses: [] };
  await Promise.all(
    targets.map(async (target) => {
      try {
        const res = await sendPush(target, messageFor(target), vapid, { fetch });
        result.statuses.push(res.status);
        if (res.ok) result.sent += 1;
        else if (res.gone) {
          // The phone turned notifications off or the subscription expired.
          await db.forget(target.subscription_id ?? target.id);
          result.forgotten += 1;
        } else result.failed += 1;
      } catch (err) {
        console.error('push failed', err);
        result.failed += 1;
      }
    }),
  );
  return result;
}

/**
 * Handles one request. Returns [status, json].
 * - { action: 'config' }: the public key the site needs to subscribe a phone.
 * - { action: 'test' }: sends a test to the signed-in player's own devices.
 * - { message_id }: sent by the database when a message is posted. The database
 *   decides who gets it, and hands each message out only once, so a repeated
 *   or forged request can't send anything extra.
 * deps: { vapid, db: { pushTargets, subscriptionsOf, forget }, userOf(token), fetch }
 */
export async function handleNotify(body, token, deps) {
  if (!deps.vapid?.publicKey || !deps.vapid?.privateKey) return [503, { error: "Notifications aren't set up yet." }];
  if (body?.action === 'config') return [200, { publicKey: deps.vapid.publicKey }];
  if (body?.action === 'test') {
    const user = await deps.userOf(token);
    if (!user) return [401, { error: 'Sign in first.' }];
    return [200, await deliver(await deps.db.subscriptionsOf(user.id), () => TEST_NOTIFICATION, deps)];
  }
  if (body?.message_id) {
    if (!UUID.test(body.message_id)) return [400, { error: 'Unknown message.' }];
    return [200, await deliver(await deps.db.pushTargets(body.message_id), chatNotification, deps)];
  }
  return [400, { error: 'Nothing to do.' }];
}
