import dayjs from 'dayjs';
import { shortName } from '@/lib/format';

/** One-tap reactions; the + button opens the full emoji picker. */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '🔥', '🦃'];

export const EMOJI_GROUPS = [
  {
    label: 'Faces',
    icon: '😀',
    emojis:
      '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😜 🤪 😎 🤓 🥳 😏 😬 🙄 😮 😲 😳 🥺 😢 😭 😤 😡 🤯 🥵 🥶 😱 🤔 🫡 🤫 🤭 🫠 😴 🤒 🤕 🤮 😷 💀',
  },
  {
    label: 'Hands',
    icon: '👍',
    emojis: '👍 👎 👏 🙌 🙏 💪 👊 🤜 🤛 ✌️ 🤞 🤙 👌 🤘 👋 ☝️ 👆 👇 👉 👈 🫶 🤝 👀 🙋 🙋‍♀️ 🙋‍♂️ 🤷 🤷‍♀️ 🤷‍♂️ 🏃 🏃‍♀️ 🧍',
  },
  {
    label: 'Game day',
    icon: '⚽',
    emojis: '⚽ 🥅 🦃 🏆 🥇 🥈 🥉 🏅 🎽 👟 🧤 🟨 🟥 🟦 📣 🎉 🎊 🔥 💯 ⭐ 🌟 ⚡ 💥 🚀 🎯 🏈 🏀 ⚾ 🎾 🏐 🏒 ⛳',
  },
  {
    label: 'Food',
    icon: '🍕',
    emojis: '🍕 🍔 🌭 🌮 🌯 🍟 🍗 🍖 🥗 🍣 🍜 🍝 🥯 🍩 🍪 🎂 🍰 🍺 🍻 🥂 🍷 🍹 🥤 ☕ 💧 🧊',
  },
  {
    label: 'Other',
    icon: '❤️',
    emojis: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 ❤️‍🔥 ✅ ❌ ❓ ❗ ⚠️ 💸 💰 📅 ⏰ 📍 🚗 🅿️ 🩹 ☀️ 🌧️ ❄️ 🎵 📸 🐐',
  },
].map((group) => ({ ...group, emojis: group.emojis.split(' ') }));

const MS = (iso) => new Date(iso).getTime();

/** True when b is later than a. Compares instants, since timestamps come in more than one format. */
export const isAfter = (b, a) => !!b && (!a || MS(b) > MS(a));

export function dayLabel(iso) {
  const d = dayjs(iso);
  if (d.isSame(dayjs(), 'day')) return 'Today';
  if (d.isSame(dayjs().subtract(1, 'day'), 'day')) return 'Yesterday';
  return d.isSame(dayjs(), 'year') ? d.format('dddd, MMM D') : d.format('MMM D, YYYY');
}

export const timeLabel = (iso) => dayjs(iso).format('h:mm A');

/** Short "when" for room lists: 4:05 PM today, then Mon, then Oct 5. */
export function shortWhen(iso) {
  if (!iso) return '';
  const d = dayjs(iso);
  if (d.isSame(dayjs(), 'day')) return d.format('h:mm A');
  if (d.isAfter(dayjs().subtract(6, 'day'), 'day')) return d.format('ddd');
  return d.isSame(dayjs(), 'year') ? d.format('MMM D') : d.format('M/D/YY');
}

const PICTOGRAPH = /\p{Extended_Pictographic}/u;
const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|️|‍|\s)+$/u;

function graphemes(text) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map((s) => s.segment);
  }
  return Array.from(text);
}

/** "🔥🔥🔥" gets shown big, without a bubble. */
export function isEmojiOnly(text) {
  const trimmed = text.trim();
  if (!trimmed || !EMOJI_ONLY.test(trimmed)) return false;
  return graphemes(trimmed.replace(/\s/g, '')).length <= 3;
}

/** "⚽ Sunday pickup?" -> { emoji: '⚽', text: 'Sunday pickup?' } */
export function splitLeadingEmoji(title = '') {
  const [first] = graphemes(title.trim());
  if (first && PICTOGRAPH.test(first)) return { emoji: first, text: title.trim().slice(first.length).trim() || title.trim() };
  return { emoji: null, text: title.trim() };
}

const URL_PATTERN = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g;

/** "https://www.example.com/a/very/long/path" -> "example.com/a/very/long/pa…" */
function shortUrl(href) {
  const text = href.replace(/^https?:\/\/(www\.)?/, '');
  return text.length > 36 ? `${text.slice(0, 35)}…` : text;
}

/** Splits text into plain and link parts so links can be tapped. */
export function linkParts(text) {
  return text.split(URL_PATTERN).map((part, i) => (i % 2 ? { href: part, text: shortUrl(part) } : { text: part }));
}

const GROUP_GAP_MS = 5 * 60 * 1000;

/**
 * Turns messages into what the list draws: day separators, a "new messages"
 * line after the reader's last visit, and messages grouped by sender so the
 * name shows once per run of messages.
 */
export function buildTimeline(messages, { unreadAfter, me }) {
  const items = [];
  let unreadPlaced = false;
  messages.forEach((m, i) => {
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const newDay = !prev || !dayjs(prev.created_date).isSame(m.created_date, 'day');
    if (newDay) items.push({ type: 'day', key: `day-${m.id}`, label: dayLabel(m.created_date) });

    const unreadStart = !unreadPlaced && unreadAfter && !m.pending && m.user_id !== me && isAfter(m.created_date, unreadAfter);
    if (unreadStart) {
      unreadPlaced = true;
      items.push({ type: 'unread', key: 'unread' });
    }

    const joinsPrev =
      prev && !newDay && !unreadStart && prev.user_id === m.user_id && MS(m.created_date) - MS(prev.created_date) < GROUP_GAP_MS;
    const joinsNext =
      next &&
      next.user_id === m.user_id &&
      dayjs(next.created_date).isSame(m.created_date, 'day') &&
      MS(next.created_date) - MS(m.created_date) < GROUP_GAP_MS &&
      !(!unreadPlaced && unreadAfter && !next.pending && next.user_id !== me && isAfter(next.created_date, unreadAfter));
    items.push({ type: 'message', key: m.id, message: m, first: !joinsPrev, last: !joinsNext });
  });
  return items;
}

/** Reaction rows for one message -> [{ emoji, count, mine, userIds }] in first-used order. */
export function summarizeReactions(rows, me) {
  const byEmoji = new Map();
  for (const r of rows) {
    if (!byEmoji.has(r.emoji)) byEmoji.set(r.emoji, { emoji: r.emoji, count: 0, mine: false, userIds: [] });
    const entry = byEmoji.get(r.emoji);
    entry.count += 1;
    entry.userIds.push(r.user_id);
    if (r.user_id === me) entry.mine = true;
  }
  return [...byEmoji.values()];
}

/** Rooms are keyed by thread id; the main Team Chat is null. */
export const roomOf = (message) => message.thread_id ?? null;

/** Fired after a room is marked read, so the unread badge refreshes. */
export const CHAT_READ_EVENT = 'jt:chat-read';

// ---------------------------------------------------------------------------
// Kinds of room (chat_threads.visibility): threads are for the whole team,
// private chats for the teammates in them, and the Captains' Lounge for
// captains. Team Chat itself isn't a thread.
// ---------------------------------------------------------------------------

export const isPrivate = (thread) => thread?.visibility === 'private';
export const isLounge = (thread) => thread?.visibility === 'captains';

/** Rooms whose messages always count as unread, like Team Chat's: private chats and the Lounge. */
const countsLikeTeamChat = (room) => room.thread_id === null || (!!room.visibility && room.visibility !== 'team');

/** Unread count for the Chat tab: Team Chat, private chats and the Lounge, plus threads the player has opened. */
export const unreadTotal = (overview) =>
  overview.reduce((n, room) => (countsLikeTeamChat(room) || room.last_read_at ? n + room.unread : n), 0);

/**
 * Who can rename, close and delete a room: a thread's starter or a captain; a
 * private chat's starter only (captains have no say there); nobody for the Lounge.
 */
export function canManageRoom(thread, me, isCaptain) {
  if (!thread || isLounge(thread)) return false;
  if (isPrivate(thread)) return thread.created_by === me;
  return thread.created_by === me || !!isCaptain;
}

/** Captains delete anyone's message, except in private chats, where everyone deletes only their own. */
export const canDeleteAny = (thread, isCaptain) => !!isCaptain && !isPrivate(thread);

/**
 * A list of chat names, the way a private chat with no name is called: up to
 * four names, then "& N more". ['Jordan R.', 'Sam O.'] -> "Jordan R. & Sam O."
 * The same as chat_room_label() in the database. At most 80 characters.
 */
export function privateChatTitle(names) {
  const list = names.filter(Boolean);
  if (!list.length) return 'Private chat';
  const parts = list.length > 4 ? [...list.slice(0, 3), `${list.length - 3} more`] : list;
  const title = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} & ${parts.at(-1)}` : parts[0];
  return title.length > 80 ? `${title.slice(0, 79)}…` : title;
}

/**
 * A room's name as this player sees it: its title, or for a private chat
 * nobody named, the other people in it now, by chat name ("Jordan R.",
 * "Jordan R. & Sam O."; "Just you" when nobody else is left).
 * `members`: chat_thread_members rows; `nameOf(userId)`: their name.
 */
export function roomTitle(thread, { members = [], me, nameOf } = {}) {
  if (!thread || !isPrivate(thread) || thread.named !== false) return thread?.title ?? '';
  const others = members
    .filter((m) => m.thread_id === thread.id && m.user_id !== me)
    .map((m) => shortName(nameOf(m.user_id)))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return others.length ? privateChatTitle(others) : 'Just you';
}

/** Adds someone's place in a private chat to the list, or replaces the copy of it. */
export const upsertMember = (list, row) => [
  ...(list || []).filter((m) => m.id !== row.id && !(m.thread_id === row.thread_id && m.user_id === row.user_id)),
  row,
];

/** The open private chat with just these two players, if there is one. */
export function directChat(threads, members, me, other) {
  return (
    threads.find((t) => {
      if (!isPrivate(t) || t.archived) return false;
      const ids = members.filter((m) => m.thread_id === t.id).map((m) => m.user_id);
      return ids.length === 2 && ids.includes(me) && ids.includes(other);
    }) || null
  );
}

/** The Chat tab's @ count: unread messages that mention the player, in any room (threads they haven't opened too). */
export const mentionTotal = (overview) => overview.reduce((n, room) => n + (room.mentions || 0), 0);

// ---------------------------------------------------------------------------
// Keeping the chat screen's lists up to date as messages, reactions and
// threads arrive (from this player or live from others).
// ---------------------------------------------------------------------------

/** Adds a message in time order, replacing the "sending" copy of it if there is one. */
export function insertMessage(list, message) {
  const real = list.filter((m) => !m.pending);
  const pending = list.filter((m) => m.pending);
  const echo = pending.findIndex((m) => m.user_id === message.user_id && m.body === message.body);
  if (echo >= 0) pending.splice(echo, 1);
  if (real.some((m) => m.id === message.id)) return [...real, ...pending];
  let i = real.length;
  while (i > 0 && isAfter(real[i - 1].created_date, message.created_date)) i -= 1;
  return [...real.slice(0, i), message, ...real.slice(i), ...pending];
}

/** Adds a reaction, replacing any copy of the same player + message + emoji. */
export function addReaction(list, reaction) {
  const same = (r) => r.message_id === reaction.message_id && r.user_id === reaction.user_id && r.emoji === reaction.emoji;
  return [...list.filter((r) => !same(r) && r.id !== reaction.id), reaction];
}

export const upsertThread = (list, thread) =>
  list && (list.some((t) => t.id === thread.id) ? list.map((t) => (t.id === thread.id ? thread : t)) : [thread, ...list]);

/**
 * Updates a room's latest-message summary when a message arrives. A message
 * that counts as unread and mentions the player adds to the room's @ count too.
 */
export function bumpOverview(list, message, countsAsUnread, mentionsMe = false) {
  const room = roomOf(message);
  const latest = {
    last_message_at: message.created_date,
    last_user_id: message.user_id,
    last_author_name: message.author_name,
    last_body: message.body.slice(0, 140),
  };
  const unread = countsAsUnread ? 1 : 0;
  const mentions = countsAsUnread && mentionsMe ? 1 : 0;
  const existing = list.find((o) => o.thread_id === room);
  if (!existing) return [...list, { thread_id: room, last_read_at: null, unread, mentions, ...latest }];
  if (isAfter(existing.last_message_at, message.created_date)) return list;
  return list.map((o) =>
    o === existing ? { ...o, ...latest, unread: o.unread + unread, mentions: (o.mentions || 0) + mentions } : o,
  );
}

const NEW_THREAD_DAYS = 3;

/**
 * Team Chat, then every other open room in one list (the Captains' Lounge for
 * captains, threads and private chats), latest activity first, and closed ones,
 * with each room's summary from chat overview. `unreadInClosed` counts what the
 * closed rooms still add to the Chat tab (what came in before they closed).
 */
export function organizeRooms(threads, overview, now = Date.now()) {
  const summaries = new Map(overview.map((o) => [o.thread_id, o]));
  const recent = now - NEW_THREAD_DAYS * 24 * 60 * 60 * 1000;
  const list = threads.map((thread) => {
    const summary = summaries.get(thread.id);
    const followed = isPrivate(thread) || isLounge(thread) || !!summary?.last_read_at;
    return {
      thread,
      summary,
      unread: summary?.unread || 0,
      mentions: summary?.mentions || 0,
      followed,
      // A thread never opened, with something in it from someone else.
      isNew: !followed && !!summary && summary.unread > 0,
      recent: !!summary && MS(summary.last_message_at) > recent,
      at: summary?.last_message_at || thread.created_date,
    };
  });
  list.sort((a, b) => MS(b.at) - MS(a.at));
  const team = summaries.get(null);
  const others = list.filter((r) => isLounge(r.thread) || !r.thread.archived);
  const closed = list.filter((r) => !isLounge(r.thread) && r.thread.archived);
  return {
    team: { summary: team, unread: team?.unread || 0, mentions: team?.mentions || 0 },
    others,
    closed,
    unreadInClosed: closed.reduce((n, r) => (r.followed ? n + r.unread : n), 0),
  };
}

/**
 * What's waiting outside the room on screen (`active`: a thread's id, or null
 * for Team Chat), for the back button on phones: unread messages the way the
 * Chat tab counts them, unread @mentions (threads never opened included), and
 * whether a thread never opened got messages from others in the last few days.
 */
export function waitingElsewhere(rooms, active) {
  const elsewhere = [...rooms.others, ...rooms.closed].filter((r) => r.thread.id !== active);
  const team = active === null ? { unread: 0, mentions: 0 } : rooms.team;
  return {
    unread: elsewhere.reduce((n, r) => (r.followed ? n + r.unread : n), team.unread),
    mentions: elsewhere.reduce((n, r) => n + r.mentions, team.mentions),
    fresh: elsewhere.some((r) => r.isNew && r.recent && !r.thread.archived),
  };
}
