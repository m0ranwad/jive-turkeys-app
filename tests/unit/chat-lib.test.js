// Chat logic behind the screens: grouping, unread lines, links, emoji, and
// keeping message / reaction / room lists right as things arrive live.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EMOJI_GROUPS,
  QUICK_REACTIONS,
  addReaction,
  buildTimeline,
  bumpOverview,
  canDeleteAny,
  canManageRoom,
  dayLabel,
  directChat,
  insertMessage,
  isAfter,
  isEmojiOnly,
  linkParts,
  mentionTotal,
  organizeRooms,
  privateChatTitle,
  roomOf,
  roomTitle,
  shortWhen,
  splitLeadingEmoji,
  summarizeReactions,
  unreadTotal,
  upsertMember,
  upsertThread,
  waitingElsewhere,
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

  it('counts private chats and the Captains\' Lounge like Team Chat, opened or not', () => {
    expect(
      unreadTotal([
        summary(null, { unread: 2 }),
        summary('never-opened', { unread: 4, last_read_at: null, visibility: 'team' }),
        summary('dm', { unread: 1, last_read_at: null, visibility: 'private' }),
        summary('lounge', { unread: 3, last_read_at: null, visibility: 'captains' }),
      ]),
    ).toBe(6);
  });

  it('counts unread @mentions of you in every room, threads you have never opened too', () => {
    expect(
      mentionTotal([
        summary(null, { unread: 2, mentions: 1 }),
        summary('opened', { unread: 3, mentions: 0 }),
        summary('never-opened', { unread: 4, mentions: 2, last_read_at: null }),
        summary('older-site', { unread: 1 }),
      ]),
    ).toBe(3);
  });

  it('adds a live message that mentions you to the room\'s @ count, if it counts as unread', () => {
    const list = [summary(null, { unread: 1, mentions: 0 })];
    expect(bumpOverview(list, msg('n', 'ann', 0), true, true)[0]).toMatchObject({ unread: 2, mentions: 1 });
    expect(bumpOverview(list, msg('n', 'ann', 0), true, false)[0]).toMatchObject({ unread: 2, mentions: 0 });
    expect(bumpOverview(list, msg('n', 'ann', 0), false, true)[0]).toMatchObject({ unread: 1, mentions: 0 });
    expect(bumpOverview([], msg('n', 'ann', 0, { thread_id: 't1' }), true, true)[0]).toMatchObject({ unread: 1, mentions: 1 });
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

  it('sorts rooms by latest activity, splits off closed ones, and flags new ones', () => {
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
    expect(rooms.others.map((r) => r.thread.id)).toEqual(['busy', 'fresh', 'quiet', 'old-new']);
    expect(rooms.closed.map((r) => r.thread.id)).toEqual(['closed']);
    expect(rooms.others.find((r) => r.thread.id === 'fresh').isNew).toBe(true);
    expect(rooms.others.find((r) => r.thread.id === 'busy').isNew).toBe(false);
    expect(rooms.team.mentions).toBe(0);
  });

  it("counts what's waiting outside the room on screen, for the back button on phones", () => {
    const threads = [
      { id: 'busy', title: 'Busy', archived: false, created_date: at(6000) },
      { id: 'fresh', title: 'Fresh', archived: false, created_date: at(100) },
      { id: 'old-new', title: 'Old new', archived: false, created_date: at(9000) },
    ];
    const rooms = organizeRooms(
      threads,
      [
        summary(null, { unread: 2 }),
        summary('busy', { last_message_at: at(1), unread: 3 }),
        summary('fresh', { last_message_at: at(20), last_read_at: null, unread: 1 }),
      ],
      NOW.getTime(),
    );
    // From Team Chat: the thread you follow counts; the one never opened doesn't, but lights the dot.
    expect(waitingElsewhere(rooms, null)).toEqual({ unread: 3, mentions: 0, fresh: true });
    // From a thread: Team Chat counts, the room you're in doesn't.
    expect(waitingElsewhere(rooms, 'busy')).toEqual({ unread: 2, mentions: 0, fresh: true });
    expect(waitingElsewhere(rooms, 'fresh')).toEqual({ unread: 5, mentions: 0, fresh: false });
    // Mentions count in threads you've never opened, unlike unread messages.
    const mentioned = organizeRooms(threads, [
      summary(null, { unread: 2, mentions: 1 }),
      summary('busy', { unread: 3, mentions: 1 }),
      summary('fresh', { last_read_at: null, unread: 1, mentions: 1 }),
    ]);
    expect(mentioned.team.mentions).toBe(1);
    expect(mentioned.others.find((r) => r.thread.id === 'fresh').mentions).toBe(1);
    expect(waitingElsewhere(mentioned, null)).toMatchObject({ unread: 3, mentions: 2 });
    expect(waitingElsewhere(mentioned, 'busy')).toMatchObject({ unread: 2, mentions: 2 });
    // A never-opened thread whose last message is a week old doesn't keep the dot lit.
    const stale = organizeRooms(
      [threads[2]],
      [summary('old-new', { last_message_at: at(8000), last_read_at: null, unread: 2 })],
      NOW.getTime(),
    );
    expect(waitingElsewhere(stale, null).fresh).toBe(false);
  });

  it('lists the Lounge, threads and private chats together by latest activity, counting the Lounge and private chats like Team Chat', () => {
    const threads = [
      { id: 'thread', title: 'Pickup', archived: false, visibility: 'team', created_date: at(500) },
      { id: 'lounge', title: "Captains' Lounge", archived: false, visibility: 'captains', created_date: at(9000) },
      { id: 'dm', title: 'Casey C. & Jordan R.', archived: false, visibility: 'private', created_date: at(300) },
      { id: 'ride', title: 'Ride', archived: false, visibility: 'private', created_date: at(100) },
      { id: 'old-chat', title: 'Old', archived: true, visibility: 'private', created_date: at(50) },
    ];
    const rooms = organizeRooms(
      threads,
      [
        summary('thread', { last_message_at: at(5), last_read_at: null, unread: 2 }),
        summary('lounge', { last_message_at: at(1), last_read_at: null, unread: 1 }),
        summary('dm', { last_message_at: at(30), last_read_at: null, unread: 4 }),
      ],
      NOW.getTime(),
    );
    // Latest activity first, whatever the kind; the ride chat has no messages yet, so it goes by when it started.
    expect(rooms.others.map((r) => r.thread.id)).toEqual(['lounge', 'thread', 'dm', 'ride']);
    expect(rooms.closed.map((r) => r.thread.id)).toEqual(['old-chat']);
    // A thread never opened is New; a private chat or the Lounge never is, it just counts.
    const room = (id) => rooms.others.find((r) => r.thread.id === id);
    expect(room('thread').isNew).toBe(true);
    expect(room('dm').isNew).toBe(false);
    expect(room('lounge').isNew).toBe(false);
    expect(waitingElsewhere(rooms, null).unread).toBe(5);
  });

  it('names a private chat after its people: four at most, then "& N more" (like the database)', () => {
    expect(privateChatTitle(['Jordan R.'])).toBe('Jordan R.');
    expect(privateChatTitle(['Casey C.', 'Jordan R.'])).toBe('Casey C. & Jordan R.');
    expect(privateChatTitle(['Casey C.', 'Jordan R.', 'Sam O.', 'Riley N.'])).toBe('Casey C., Jordan R., Sam O. & Riley N.');
    expect(privateChatTitle(['A B.', 'C D.', 'E F.', 'G H.', 'I J.', 'K L.'])).toBe('A B., C D., E F. & 3 more');
    expect(privateChatTitle([])).toBe('Private chat');
    expect(privateChatTitle(['X'.repeat(50), 'Y'.repeat(50)]).length).toBeLessThanOrEqual(80);
  });

  it("shows a private chat nobody named as the other people in it now, and anything else by its title", () => {
    const names = { me: 'Casey Captain', jo: 'Jordan Rivera', sam: 'Sam Okafor' };
    const nameOf = (id) => names[id];
    const members = (ids) => ids.map((user_id, i) => ({ id: `m${i}`, thread_id: 'dm', user_id }));
    const dm = { id: 'dm', title: 'Casey C. & Jordan R.', visibility: 'private', named: false };
    expect(roomTitle(dm, { members: members(['me', 'jo']), me: 'me', nameOf })).toBe('Jordan R.');
    expect(roomTitle(dm, { members: members(['me', 'jo']), me: 'jo', nameOf })).toBe('Casey C.');
    expect(roomTitle(dm, { members: members(['me', 'sam', 'jo']), me: 'me', nameOf })).toBe('Jordan R. & Sam O.');
    expect(roomTitle(dm, { members: members(['me']), me: 'me', nameOf })).toBe('Just you');
    expect(roomTitle({ ...dm, named: true, title: '🚗 Ride' }, { members: members(['me', 'jo']), me: 'me', nameOf })).toBe('🚗 Ride');
    expect(roomTitle({ id: 't', title: 'Pickup', visibility: 'team' }, { me: 'me', nameOf })).toBe('Pickup');
  });

  it('keeps one copy of each place in a private chat', () => {
    const list = [{ id: 'local', thread_id: 't', user_id: 'jo' }];
    expect(upsertMember(list, { id: 'real', thread_id: 't', user_id: 'jo' })).toEqual([{ id: 'real', thread_id: 't', user_id: 'jo' }]);
    expect(upsertMember(list, { id: 'm2', thread_id: 't', user_id: 'sam' })).toHaveLength(2);
    expect(upsertMember(undefined, { id: 'm2', thread_id: 't', user_id: 'sam' })).toHaveLength(1);
  });

  it("counts closed rooms' leftover unread where the Chat tab does, and shows it on Closed", () => {
    const rooms = organizeRooms(
      [
        { id: 'chat', title: 'Old chat', archived: true, visibility: 'private', created_date: at(500) },
        { id: 'thread', title: 'Old thread', archived: true, visibility: 'team', created_date: at(600) },
      ],
      [
        summary('chat', { last_read_at: null, unread: 2 }),
        summary('thread', { last_read_at: null, unread: 5 }),
      ],
      NOW.getTime(),
    );
    // The private chat counts (opened or not); the never-opened thread doesn't, as on the Chat tab.
    expect(rooms.unreadInClosed).toBe(2);
    expect(waitingElsewhere(rooms, null).unread).toBe(2);
    expect(
      unreadTotal([
        summary('chat', { last_read_at: null, unread: 2, visibility: 'private' }),
        summary('thread', { last_read_at: null, unread: 5, visibility: 'team' }),
      ]),
    ).toBe(2);
  });

  it('finds the open private chat with just two players', () => {
    const threads = [
      { id: 'team', visibility: 'team' },
      { id: 'group', visibility: 'private' },
      { id: 'closed', visibility: 'private', archived: true },
      { id: 'dm', visibility: 'private' },
    ];
    const members = [
      ['group', 'me'], ['group', 'jo'], ['group', 'sam'],
      ['closed', 'me'], ['closed', 'jo'],
      ['dm', 'jo'], ['dm', 'me'],
    ].map(([thread_id, user_id]) => ({ thread_id, user_id }));
    expect(directChat(threads, members, 'me', 'jo').id).toBe('dm');
    expect(directChat(threads, members, 'me', 'sam')).toBeNull();
  });

  it('lets captains manage threads but not private chats or the Lounge', () => {
    const thread = { visibility: 'team', created_by: 'ann' };
    const chat = { visibility: 'private', created_by: 'ann' };
    const lounge = { visibility: 'captains', created_by: null };
    expect(canManageRoom(thread, 'cap', true)).toBe(true);
    expect(canManageRoom(thread, 'ann', false)).toBe(true);
    expect(canManageRoom(thread, 'bob', false)).toBe(false);
    expect(canManageRoom(chat, 'ann', false)).toBe(true);
    expect(canManageRoom(chat, 'cap', true)).toBe(false);
    expect(canManageRoom(lounge, 'cap', true)).toBe(false);
    expect(canDeleteAny(thread, true)).toBe(true);
    expect(canDeleteAny(null, true)).toBe(true);
    expect(canDeleteAny(chat, true)).toBe(false);
    expect(canDeleteAny(lounge, true)).toBe(true);
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
