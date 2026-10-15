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
  body: "You'll get chat messages and game alerts on this device.",
  url: '/banter',
  tag: 'test',
};

/** A Player of the Match notification: the database writes the words. One per game is kept on screen. */
export function potmNotification({ title, body, url }, gameId) {
  return { title, body: clip(String(body), 160), url, tag: `potm-${gameId}` };
}

const POTM_KINDS = ['open', 'reminder'];

/**
 * Each phone's unread chat count, for the number on the app icon. If the database
 * can't say (say, the function went live before the database update), the
 * notifications go out without it and the icon keeps its number.
 */
async function unreadCounts(targets, db) {
  if (!targets.length) return new Map();
  try {
    const rows = await db.unreadCounts(targets.map((t) => t.subscription_id));
    return new Map(rows.map((row) => [row.subscription_id, Number(row.unread)]));
  } catch (err) {
    console.error('unread counts failed', err);
    return new Map();
  }
}

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
 *   or forged request can't send anything extra. Each one carries that player's
 *   unread chat count (badge) for the app icon.
 * - { potm_game_id, kind }: sent by the database when Player of the Match voting
 *   opens ('open') or is about to close ('reminder'). Same rules: the database
 *   decides who, what it says, and that it goes out once.
 * deps: { vapid, db: { pushTargets, unreadCounts, potmTargets, subscriptionsOf, forget }, userOf(token), fetch }
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
    const targets = await deps.db.pushTargets(body.message_id);
    const unread = await unreadCounts(targets, deps.db);
    const messageFor = (target) => {
      const message = chatNotification(target);
      const badge = unread.get(target.subscription_id);
      return badge === undefined ? message : { ...message, badge };
    };
    return [200, await deliver(targets, messageFor, deps)];
  }
  if (body?.potm_game_id) {
    if (!UUID.test(body.potm_game_id) || !POTM_KINDS.includes(body.kind)) return [400, { error: 'Unknown game.' }];
    const targets = await deps.db.potmTargets(body.potm_game_id, body.kind);
    return [200, await deliver(targets, (t) => potmNotification(t, body.potm_game_id), deps)];
  }
  return [400, { error: 'Nothing to do.' }];
}
