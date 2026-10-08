// Chat logic behind the screens: grouping, unread lines, links, emoji, and
// keeping message / reaction / room lists right as things arrive live.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EMOJI_GROUPS,
  QUICK_REACTIONS,
  addReaction,
  buildTimeline,
  bumpOverview,
  dayLabel,
  insertMessage,
  isAfter,
  isEmojiOnly,
  linkParts,
  organizeRooms,
  roomOf,
  shortWhen,
  splitLeadingEmoji,
  summarizeReactions,
  unreadTotal,
  upsertThread,
} from '@/lib/chat';

const NOW = new Date('2026-10-08T20:00:00Z');
const at = (minutesAgo) => new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();
const msg = (id, user, minutesAgo, extra = {}) => ({
  id,
  user_id: user,
  author_name: user,
  body: `message ${id}`,
  thread_id: null,
  created_date: at(minutesAgo),
  ...extra,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('timestamps', () => {
  it('compares instants, whatever format the database sent', () => {
    expect(isAfter('2026-10-08T20:00:00.123456+00:00', '2026-10-08T19:59:59Z')).toBe(true);
    expect(isAfter('2026-10-08T16:00:00-04:00', '2026-10-08T20:00:00Z')).toBe(false); // same instant
    expect(isAfter('2026-10-08T20:00:00Z', null)).toBe(true);
    expect(isAfter(null, '2026-10-08T20:00:00Z')).toBe(false);
  });

  it('labels days the way people say them', () => {
    expect(dayLabel(at(10))).toBe('Today');
    expect(dayLabel(at(24 * 60))).toBe('Yesterday');
    expect(dayLabel('2026-10-03T18:00:00Z')).toMatch(/^Saturday, Oct 3$/);
    expect(dayLabel('2025-12-24T18:00:00Z')).toBe('Dec 24, 2025');
  });

  it('keeps room-list times short', () => {
    expect(shortWhen(at(5))).toMatch(/^\d{1,2}:\d{2} [AP]M$/);
    expect(shortWhen('2026-10-06T12:00:00Z')).toMatch(/^[A-Z][a-z]{2}$/);
    expect(shortWhen('2026-08-01T12:00:00Z')).toBe('Aug 1');
    expect(shortWhen(null)).toBe('');
  });
});

describe('message text', () => {
  it('shows short emoji-only messages big', () => {
    expect(isEmojiOnly('🔥🔥🔥')).toBe(true);
    expect(isEmojiOnly(' 👍🏽 ')).toBe(true);
    expect(isEmojiOnly('❤️')).toBe(true);
    expect(isEmojiOnly('🙋‍♀️')).toBe(true);
    expect(isEmojiOnly('🔥🔥🔥🔥')).toBe(false);
    expect(isEmojiOnly('nice 🔥')).toBe(false);
    expect(isEmojiOnly('1')).toBe(false);
    expect(isEmojiOnly('')).toBe(false);
  });

  it('turns web links into tappable, shortened links', () => {
    const parts = linkParts('Parking: https://www.google.com/maps/search/?api=1&query=North+Coast+Premier, see you');
    expect(parts).toHaveLength(3);
    expect(parts[1].href).toBe('https://www.google.com/maps/search/?api=1&query=North+Coast+Premier');
    expect(parts[1].text).toBe('google.com/maps/search/?api=1&query…');
    expect(parts[2].text).toBe(', see you');
  });

  it('leaves trailing punctuation out of links', () => {
    expect(linkParts('See http://example.com.')[1].href).toBe('http://example.com');
    expect(linkParts('(https://example.com/a)')[1].href).toBe('https://example.com/a');
  });

  it('never makes links out of anything but http and https', () => {
    for (const text of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://x.test', 'www.example.com']) {
      expect(linkParts(text).filter((p) => p.href)).toEqual([]);
    }
  });

  it('uses a leading emoji in a thread topic as its icon', () => {
    expect(splitLeadingEmoji('⚽ Sunday pickup?')).toEqual({ emoji: '⚽', text: 'Sunday pickup?' });
    expect(splitLeadingEmoji('🙋‍♀️ Who is in')).toEqual({ emoji: '🙋‍♀️', text: 'Who is in' });
    expect(splitLeadingEmoji('Carpool')).toEqual({ emoji: null, text: 'Carpool' });
    expect(splitLeadingEmoji('🍕')).toEqual({ emoji: '🍕', text: '🍕' });
  });

  it('offers the quick reactions, including the team turkey', () => {
    expect(QUICK_REACTIONS).toContain('🦃');
    for (const group of EMOJI_GROUPS) expect(new Set(group.emojis).size).toBe(group.emojis.length);
  });
});

describe('timeline', () => {
  const types = (items) =>
    items.map((i) => (i.type === 'message' ? `${i.message.id}${i.first ? '^' : ''}${i.last ? '$' : ''}` : i.type));

  it('adds a day label whenever the day changes', () => {
    const items = buildTimeline([msg('a', 'ann', 26 * 60), msg('b', 'ann', 10)], { me: 'me' });
    expect(types(items)).toEqual(['day', 'a^$', 'day', 'b^$']);
    expect(items[0].label).toBe('Yesterday');
    expect(items[2].label).toBe('Today');
  });

  it('groups messages from the same person within five minutes', () => {
    const items = buildTimeline(
      [
        msg('a', 'ann', 30),
        msg('b', 'ann', 28),
        msg('c', 'ann', 26),
        msg('d', 'bob', 25),
        msg('e', 'ann', 24),
        msg('f', 'ann', 10),
      ],
      { me: 'me' },
    );
    expect(types(items)).toEqual(['day', 'a^', 'b', 'c$', 'd^$', 'e^$', 'f^$']);
  });

  it('puts the New messages line before the first unread message from someone else', () => {
    const items = buildTimeline([msg('a', 'ann', 30), msg('b', 'me', 20), msg('c', 'ann', 19), msg('d', 'ann', 18)], {
      me: 'me',
      unreadAfter: at(25),
    });
    // "b" is newer than the read marker but it's mine, so the line goes before "c".
    expect(types(items)).toEqual(['day', 'a^$', 'b^$', 'unread', 'c^', 'd$']);
  });

  it('splits a run of messages at the New messages line', () => {
    const items = buildTimeline([msg('a', 'ann', 12), msg('b', 'ann', 11), msg('c', 'ann', 10)], {
      me: 'me',
      unreadAfter: at(11),
    });
    expect(types(items)).toEqual(['day', 'a^', 'b$', 'unread', 'c^$']);
  });

  it('shows no New messages line when everything is read, or the room was never opened', () => {
    const list = [msg('a', 'ann', 12), msg('b', 'ann', 11)];
    expect(types(buildTimeline(list, { me: 'me', unreadAfter: at(1) }))).not.toContain('unread');
    expect(types(buildTimeline(list, { me: 'me', unreadAfter: null }))).not.toContain('unread');
  });

  it('never starts the New messages line at a message still sending', () => {
    const items = buildTimeline([msg('a', 'ann', 30), msg('p', 'bob', 0, { pending: true })], { me: 'me', unreadAfter: at(31) });
    expect(types(items).indexOf('unread')).toBe(1);
  });
});

describe('reactions', () => {
  it('counts each emoji, marks yours, and keeps first-used order', () => {
    const rows = [
      { user_id: 'ann', emoji: '😂' },
      { user_id: 'me', emoji: '👍' },
      { user_id: 'bob', emoji: '😂' },
    ];
    expect(summarizeReactions(rows, 'me')).toEqual([
      { emoji: '😂', count: 2, mine: false, userIds: ['ann', 'bob'] },
      { emoji: '👍', count: 1, mine: true, userIds: ['me'] },
    ]);
  });

  it('replaces a "sending" reaction with the saved one instead of doubling it', () => {
    const pending = { id: 'pending-1', pending: true, message_id: 'm', user_id: 'me', emoji: '🔥' };
    const saved = { id: 'r1', message_id: 'm', user_id: 'me', emoji: '🔥' };
    expect(addReaction([pending], saved)).toEqual([saved]);
    expect(addReaction([saved], saved)).toEqual([saved]);
    expect(addReaction([saved], { ...saved, id: 'r2', emoji: '❤️' })).toHaveLength(2);
  });
});

describe('message list', () => {
  it('keeps messages in time order when they arrive out of order', () => {
    const list = [msg('a', 'ann', 30), msg('c', 'ann', 10)];
    expect(insertMessage(list, msg('b', 'bob', 20)).map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('ignores a message it already has (live echo of your own send)', () => {
    const list = [msg('a', 'ann', 30)];
    expect(insertMessage(list, msg('a', 'ann', 30)).map((m) => m.id)).toEqual(['a']);
  });

  it('swaps the "sending" copy for the real message and keeps other sends pending at the end', () => {
    const list = [
      msg('a', 'ann', 30),
      { ...msg('p1', 'me', 0), pending: true, body: 'lol' },
      { ...msg('p2', 'me', 0), pending: true, body: 'lol' },
    ];
    const result = insertMessage(list, { ...msg('real', 'me', 1), body: 'lol' });
    expect(result.map((m) => m.id)).toEqual(['a', 'real', 'p2']);
  });

  it('knows which room a message belongs to', () => {
    expect(roomOf({ thread_id: null })).toBeNull();
    expect(roomOf({})).toBeNull();
    expect(roomOf({ thread_id: 't1' })).toBe('t1');
  });
});

describe('rooms and unread', () => {
  const summary = (thread_id, extra) => ({ thread_id, last_message_at: at(10), last_read_at: at(60), unread: 0, ...extra });

  it('counts Team Chat plus threads you have opened toward the Chat tab', () => {
    expect(
      unreadTotal([
        summary(null, { unread: 2 }),
        summary('opened', { unread: 3 }),
        summary('never-opened', { unread: 4, last_read_at: null }),
      ]),
    ).toBe(5);
    expect(unreadTotal([])).toBe(0);
  });

  it('updates a room summary when a message arrives', () => {
    const list = [summary(null, { unread: 1 })];
    const after = bumpOverview(list, msg('n', 'ann', 0, { body: 'x'.repeat(200) }), true);
    expect(after[0]).toMatchObject({ unread: 2, last_user_id: 'ann', last_message_at: at(0) });
    expect(after[0].last_body).toHaveLength(140);
    expect(bumpOverview(list, msg('n', 'me', 0), false)[0].unread).toBe(1);
  });

  it('adds a summary for a room that had no messages yet', () => {
    const after = bumpOverview([], msg('n', 'ann', 0, { thread_id: 't1' }), true);
    expect(after).toEqual([expect.objectContaining({ thread_id: 't1', unread: 1, last_read_at: null })]);
  });

  it('ignores an older message for the summary preview', () => {
    const list = [summary(null, { unread: 1, last_message_at: at(1) })];
    expect(bumpOverview(list, msg('old', 'ann', 30), true)).toBe(list);
  });

  it('sorts threads by latest activity, splits off closed ones, and flags new ones', () => {
    const threads = [
      { id: 'quiet', title: 'Quiet', archived: false, created_date: at(5000) },
      { id: 'busy', title: 'Busy', archived: false, created_date: at(6000) },
      { id: 'fresh', title: 'Fresh', archived: false, created_date: at(100) },
      { id: 'old-new', title: 'Old new', archived: false, created_date: at(9000) },
      { id: 'closed', title: 'Closed', archived: true, created_date: at(50) },
    ];
    const rooms = organizeRooms(
      threads,
      [
        summary(null, { unread: 2 }),
        summary('busy', { last_message_at: at(1), unread: 3 }),
        summary('fresh', { last_message_at: at(20), last_read_at: null, unread: 1 }),
        summary('old-new', { last_message_at: at(8000), last_read_at: null, unread: 2 }),
      ],
      NOW.getTime(),
    );
    expect(rooms.team.unread).toBe(2);
    expect(rooms.open.map((r) => r.thread.id)).toEqual(['busy', 'fresh', 'quiet', 'old-new']);
    expect(rooms.closed.map((r) => r.thread.id)).toEqual(['closed']);
    expect(rooms.open.find((r) => r.thread.id === 'fresh').isNew).toBe(true);
    expect(rooms.open.find((r) => r.thread.id === 'busy').isNew).toBe(false);
    expect(rooms.unreadInThreads).toBe(3);
    expect(rooms.freshThreads).toBe(true);
    // A never-opened thread whose last message is a week old doesn't keep the dot lit.
    expect(
      organizeRooms([threads[3]], [summary('old-new', { last_message_at: at(8000), last_read_at: null, unread: 2 })])
        .freshThreads,
    ).toBe(false);
  });

  it('updates a thread in place, or adds a new one at the top', () => {
    const list = [
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
    ];
    expect(upsertThread(list, { id: 'b', title: 'B2' })).toEqual([
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B2' },
    ]);
    expect(upsertThread(list, { id: 'c', title: 'C' })[0].id).toBe('c');
    expect(upsertThread(null, { id: 'c' })).toBeNull();
  });
});
