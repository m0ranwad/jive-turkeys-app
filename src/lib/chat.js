import dayjs from 'dayjs';

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

/** Unread count for the Chat tab: Team Chat plus threads the player has opened. */
export const unreadTotal = (overview) =>
  overview.reduce((n, room) => (room.thread_id === null || room.last_read_at ? n + room.unread : n), 0);

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

/** Updates a room's latest-message summary when a message arrives. */
export function bumpOverview(list, message, countsAsUnread) {
  const room = roomOf(message);
  const latest = {
    last_message_at: message.created_date,
    last_user_id: message.user_id,
    last_author_name: message.author_name,
    last_body: message.body.slice(0, 140),
  };
  const existing = list.find((o) => o.thread_id === room);
  if (!existing) return [...list, { thread_id: room, last_read_at: null, unread: countsAsUnread ? 1 : 0, ...latest }];
  if (isAfter(existing.last_message_at, message.created_date)) return list;
  return list.map((o) => (o === existing ? { ...o, ...latest, unread: o.unread + (countsAsUnread ? 1 : 0) } : o));
}

const NEW_THREAD_DAYS = 3;

/**
 * Team Chat plus open threads (latest activity first) and closed threads, with
 * each room's summary from chat overview. `unreadInThreads` counts threads the
 * player has opened; `freshThreads` is true when a thread they've never opened
 * got messages in the last few days.
 */
export function organizeRooms(threads, overview, now = Date.now()) {
  const summaries = new Map(overview.map((o) => [o.thread_id, o]));
  const recent = now - NEW_THREAD_DAYS * 24 * 60 * 60 * 1000;
  const list = threads.map((thread) => {
    const summary = summaries.get(thread.id);
    return {
      thread,
      summary,
      unread: summary?.unread || 0,
      // Never opened, and there's something in it from someone else.
      isNew: !!summary && !summary.last_read_at && summary.unread > 0,
      recent: !!summary && MS(summary.last_message_at) > recent,
      at: summary?.last_message_at || thread.created_date,
    };
  });
  list.sort((a, b) => MS(b.at) - MS(a.at));
  const team = summaries.get(null);
  const open = list.filter((r) => !r.thread.archived);
  return {
    team: { summary: team, unread: team?.unread || 0 },
    open,
    closed: list.filter((r) => r.thread.archived),
    unreadInThreads: open.reduce((n, r) => (r.summary?.last_read_at ? n + r.unread : n), 0),
    freshThreads: open.some((r) => r.isNew && r.recent),
  };
}
