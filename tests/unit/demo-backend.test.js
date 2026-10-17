// The demo backend powers previews and local development. It must behave like
// the real database for chat (the rules themselves are tested in
// supabase/tests/chat.test.sql), and its chats must persist in the browser.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_LOGIN, DEMO_PLAYER_LOGIN, createDemoBackend } from '@/api/demo';

const DB_KEY = 'jt_demo_db_v19';

async function signedIn() {
  const api = createDemoBackend();
  await api.auth.signIn(DEMO_LOGIN.email, DEMO_LOGIN.password);
  const me = await api.auth.me();
  return { api, me };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => localStorage.clear());

describe('signing in automatically', () => {
  it('starts a new visitor as the captain, without announcing a sign-in', async () => {
    const api = createDemoBackend({ autoSignIn: true });
    const events = [];
    api.auth.onChange((event) => events.push(event));
    expect(await api.auth.me()).toMatchObject({ email: DEMO_LOGIN.email, role: 'admin' });
    await flush();
    expect(events).toEqual([]);
  });

  it('keeps whoever is already signed in', async () => {
    await createDemoBackend().auth.signIn(DEMO_PLAYER_LOGIN.email, DEMO_PLAYER_LOGIN.password);
    const api = createDemoBackend({ autoSignIn: true });
    expect(await api.auth.me()).toMatchObject({ email: DEMO_PLAYER_LOGIN.email, role: 'user' });
  });

  it('stays signed out after signing out, until someone signs in again', async () => {
    await createDemoBackend({ autoSignIn: true }).auth.signOut();
    const api = createDemoBackend({ autoSignIn: true });
    expect(await api.auth.me()).toBeNull();

    await api.auth.signIn(DEMO_PLAYER_LOGIN.email, DEMO_PLAYER_LOGIN.password);
    await api.auth.signOut();
    expect(await createDemoBackend({ autoSignIn: true }).auth.me()).toBeNull();

    await createDemoBackend().auth.signUp('newbie@demo.test', 'demo1234');
    expect(await createDemoBackend({ autoSignIn: true }).auth.me()).toMatchObject({ email: 'newbie@demo.test' });
  });

  it('is off unless asked for', async () => {
    expect(await createDemoBackend().auth.me()).toBeNull();
  });
});

describe('sample chat data', () => {
  it('has a Team Chat, open threads with unread, a never-opened thread and a closed one', async () => {
    const { api } = await signedIn();
    const threads = await api.entities.ChatThread.list('-created_date');
    // Plus the Captains' Lounge and the captain's private chat with Jordan.
    expect(threads.map((t) => t.title).sort()).toEqual(
      [
        '⚽ Sunday pickup?',
        '🍕 Post-game food spot',
        '🎽 Jersey order',
        '🏈 Fantasy football league',
        "Captains' Lounge",
        'Casey C. & Jordan R.',
      ].sort(),
    );
    expect(threads.find((t) => t.title === '🎽 Jersey order').archived).toBe(true);

    const overview = await api.chat.overview();
    const room = (title) => overview.find((o) => o.thread_id === threads.find((t) => t.title === title).id);
    expect(overview.find((o) => o.thread_id === null).unread).toBe(3);
    expect(room('⚽ Sunday pickup?')).toMatchObject({ unread: 3 });
    expect(room('🏈 Fantasy football league')).toMatchObject({ last_read_at: null, unread: 3 });
    expect(room('🍕 Post-game food spot').unread).toBe(0);
  });

  it('has replies and reactions to show off', async () => {
    const { api } = await signedIn();
    const team = await api.chat.history(null);
    expect(team.some((m) => m.reply_to_id)).toBe(true);
    const reactions = await api.entities.MessageReaction.filter({ message_id: team.map((m) => m.id) });
    expect(reactions.length).toBeGreaterThan(5);
  });

  it('has @mentions of the captain: one unread in Team Chat, one in a thread they have never opened', async () => {
    const { api } = await signedIn();
    const threads = await api.entities.ChatThread.list();
    const fantasy = threads.find((t) => t.title === '🏈 Fantasy football league');
    const overview = await api.chat.overview();
    expect(overview.find((o) => o.thread_id === null).mentions).toBe(1);
    expect(overview.find((o) => o.thread_id === fantasy.id).mentions).toBe(1);
    expect(overview.reduce((n, o) => n + o.mentions, 0)).toBe(2);
    const food = threads.find((t) => t.title === '🍕 Post-game food spot');
    expect((await api.chat.history(food.id)).some((m) => m.mentions_team)).toBe(true);
  });
});

describe('private chats and the Captains\' Lounge', () => {
  const titles = async (api) => (await api.entities.ChatThread.list()).map((t) => t.title).sort();
  const asJordan = async (api) => {
    await api.auth.signIn(DEMO_PLAYER_LOGIN.email, DEMO_PLAYER_LOGIN.password);
    return api.auth.me();
  };
  const idOf = async (api, title) => (await api.entities.ChatThread.filter({ title }))[0]?.id;
  const userId = async (api, name) => (await api.entities.PlayerProfile.list()).find((p) => p.display_name === name).user_id;

  it('shows captains the Lounge and their own private chats, never anyone else\'s', async () => {
    const { api } = await signedIn();
    const mine = await titles(api);
    expect(mine).toContain("Captains' Lounge");
    expect(mine).toContain('Casey C. & Jordan R.');
    expect(mine).not.toContain("🚗 Ride to Thursday's game");
    expect((await api.chat.search('ride Thursday')).length).toBe(0);
    const dm = await idOf(api, 'Casey C. & Jordan R.');
    expect((await api.chat.overview()).filter((o) => o.visibility === 'private').map((o) => o.thread_id)).toEqual([dm]);
  });

  it('shows players their private chats, but not the Lounge', async () => {
    const { api } = await signedIn();
    const lounge = await idOf(api, "Captains' Lounge");
    await asJordan(api);
    const theirs = await titles(api);
    expect(theirs).not.toContain("Captains' Lounge");
    expect(theirs).toContain("🚗 Ride to Thursday's game");
    expect(await api.chat.history(lounge)).toEqual([]);
    expect((await api.entities.Message.filter({ thread_id: lounge })).length).toBe(0);
    expect((await api.chat.search('Lineup idea')).length).toBe(0);
    // Their private chats count like Team Chat, from when they were added.
    const rideId = await idOf(api, "🚗 Ride to Thursday's game");
    const ride = (await api.chat.overview()).find((o) => o.thread_id === rideId);
    expect(ride).toMatchObject({ visibility: 'private', unread: 2, last_read_at: null });
    await expect(
      api.entities.Message.create({ user_id: (await api.auth.me()).id, author_name: 'Jordan', body: 'hi', thread_id: lounge }),
    ).rejects.toThrow('permission');
  });

  it('starts a private chat with teammates on the site, the starter included', async () => {
    const { api, me } = await signedIn();
    const sam = await userId(api, 'Sam Okafor');
    const nia = JSON.parse(localStorage.getItem(DB_KEY)).users.find((u) => u.email === 'nia@demo.test').id;
    await expect(api.chat.startPrivate('Just me', [me.id, nia])).rejects.toThrow('Pick at least one teammate');
    const chat = await api.chat.startPrivate('Lineup chat', [sam, nia, sam]);
    expect(chat).toMatchObject({ title: 'Lineup chat', visibility: 'private', created_by: me.id });
    const members = await api.entities.ChatThreadMember.filter({ thread_id: chat.id });
    expect(members.map((m) => m.user_id).sort()).toEqual([me.id, sam].sort());
    await expect(api.entities.ChatThread.update(chat.id, { visibility: 'team' })).rejects.toThrow('permission');
    await expect(api.entities.ChatThread.create({ title: 'Sneaky', created_by: me.id, visibility: 'private' })).rejects.toThrow('permission');
  });

  it('adds people (who see the whole chat, unread only from then), and lets anyone leave', async () => {
    const { api, me } = await signedIn();
    const sam = await userId(api, 'Sam Okafor');
    const jordan = await userId(api, 'Jordan Rivera');
    const chat = await api.chat.startPrivate('Subs', [sam]);
    await api.entities.Message.create({ user_id: me.id, author_name: 'Casey', body: 'Before Jordan', thread_id: chat.id });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await api.chat.addMembers(chat.id, [jordan]);
    await asJordan(api);
    expect((await api.chat.history(chat.id)).map((m) => m.body)).toEqual(['Before Jordan']);
    expect((await api.chat.overview()).find((o) => o.thread_id === chat.id).unread).toBe(0);
    // Only the starter takes people out; anyone leaves.
    const rows = await api.entities.ChatThreadMember.filter({ thread_id: chat.id });
    await expect(api.entities.ChatThreadMember.delete(rows.find((r) => r.user_id === sam).id)).rejects.toThrow('permission');
    await api.entities.ChatThreadMember.delete(rows.find((r) => r.user_id === jordan).id);
    expect(await titles(api)).not.toContain('Subs');
  });

  it('mentions only people in the chat, never @team, and captains delete only their own messages there', async () => {
    const { api, me } = await signedIn();
    const jordan = await userId(api, 'Jordan Rivera');
    const sam = await userId(api, 'Sam Okafor');
    const dm = await idOf(api, 'Casey C. & Jordan R.');
    const sent = await api.entities.Message.create({
      user_id: me.id, author_name: 'Casey', body: '@team @Jordan R. @Sam O.', thread_id: dm, mentions: [jordan, sam], mentions_team: true,
    });
    expect(sent).toMatchObject({ mentions: [jordan], mentions_team: false });
    const theirs = (await api.chat.history(dm)).find((m) => m.user_id === jordan);
    await expect(api.entities.Message.delete(theirs.id)).rejects.toThrow('permission');
    await api.entities.Message.delete(sent.id);
  });

  it('takes a removed player out of their private chats, and adding them back does not bring them back', async () => {
    const { api } = await signedIn();
    const jordan = await userId(api, 'Jordan Rivera');
    await api.users.setRemoved(jordan, true);
    expect((await api.entities.ChatThreadMember.list()).some((m) => m.user_id === jordan)).toBe(false);
    await api.users.setRemoved(jordan, false);
    await asJordan(api);
    expect(await titles(api)).not.toContain("🚗 Ride to Thursday's game");
    expect(await titles(api)).not.toContain('Casey C. & Jordan R.');
  });

  it('counts unread from when you were added back, even if you had read further back before leaving', async () => {
    const { api, me } = await signedIn();
    const sam = await userId(api, 'Sam Okafor');
    const chat = await api.chat.startPrivate('Carpool', [sam]);
    const wait = () => new Promise((resolve) => setTimeout(resolve, 5));
    await api.auth.signIn('sam@demo.test', 'demo1234');
    await api.chat.markRead(chat.id, new Date().toISOString());
    await api.chat.leave(chat.id);
    await api.auth.signIn(DEMO_LOGIN.email, DEMO_LOGIN.password);
    await wait();
    await api.entities.Message.create({ user_id: me.id, author_name: 'Casey', body: 'While Sam was out', thread_id: chat.id });
    await wait();
    await api.chat.addMembers(chat.id, [sam]);
    await wait();
    await api.entities.Message.create({ user_id: me.id, author_name: 'Casey', body: 'Welcome back', thread_id: chat.id });
    await api.auth.signIn('sam@demo.test', 'demo1234');
    expect((await api.chat.history(chat.id)).map((m) => m.body)).toEqual(['While Sam was out', 'Welcome back']);
    expect((await api.chat.overview()).find((o) => o.thread_id === chat.id).unread).toBe(1);
  });

  it('only says someone left or was taken out when it happened', async () => {
    const { api } = await signedIn();
    const sam = await userId(api, 'Sam Okafor');
    const dm = await idOf(api, 'Casey C. & Jordan R.');
    // Jordan started it, so Casey (a captain) can't take Jordan out.
    await expect(api.chat.removeMember(dm, await userId(api, 'Jordan Rivera'))).rejects.toThrow('permission');
    // Sam isn't in it, so there's nobody to take out.
    await expect(api.chat.removeMember(dm, sam)).rejects.toThrow('permission');
    await api.chat.leave(dm);
    await expect(api.chat.leave(dm)).rejects.toThrow('permission');
    expect(await titles(api)).not.toContain('Casey C. & Jordan R.');
  });

  it('a chat nobody named gets a name when renamed, and nobody unnames it', async () => {
    const { api, me } = await signedIn();
    const sam = await userId(api, 'Sam Okafor');
    const chat = await api.chat.startPrivate('Casey C. & Sam O.', [sam], { named: false });
    expect(chat.named).toBe(false);
    expect((await api.entities.ChatThread.update(chat.id, { title: '🥅 Goalies' })).named).toBe(true);
    await expect(api.entities.ChatThread.update(chat.id, { named: false })).rejects.toThrow('permission');
    expect((await api.entities.ChatThread.filter({ id: chat.id }))[0]).toMatchObject({ created_by: me.id, named: true });
  });

  it('shows nothing of the chat to an account that has not entered the team code', async () => {
    const api = createDemoBackend();
    await api.auth.signIn('nia@demo.test', 'demo1234');
    expect(await api.entities.ChatThread.list()).toEqual([]);
    expect(await api.chat.history(null)).toEqual([]);
    expect(await api.chat.search('pinnies')).toEqual([]);
  });
});

describe('@mentions', () => {
  it('keeps only teammates on the site, never the author, and @team only from captains (like the database)', async () => {
    const { api, me } = await signedIn();
    const people = await api.entities.PlayerProfile.list();
    const jordan = people.find((p) => p.display_name === 'Jordan Rivera').user_id;
    // Signed up, but hasn't entered the team code.
    const nia = JSON.parse(localStorage.getItem(DB_KEY)).users.find((u) => u.email === 'nia@demo.test').id;
    const sent = await api.entities.Message.create({
      user_id: me.id, author_name: 'Casey', body: '@team @Jordan R.', thread_id: null,
      mentions: [jordan, jordan, me.id, nia, 'nobody'], mentions_team: true,
    });
    expect(sent).toMatchObject({ mentions: [jordan], mentions_team: true });

    await api.auth.signIn('jordan@demo.test', 'demo1234');
    const theirs = await api.entities.Message.create({
      user_id: jordan, author_name: 'Jordan', body: '@team', thread_id: null, mentions: [], mentions_team: true,
    });
    expect(theirs).toMatchObject({ mentions: null, mentions_team: false });
    const edited = await api.entities.Message.update(theirs.id, { body: '@Casey C.', mentions: [me.id], mentions_team: true });
    expect(edited).toMatchObject({ mentions: [me.id], mentions_team: false });
  });

  it('counts unread messages that mention you, until you read the room', async () => {
    const { api } = await signedIn();
    await api.auth.signIn('jordan@demo.test', 'demo1234');
    const jordan = await api.auth.me();
    const [food] = await api.entities.ChatThread.filter({ title: '🍕 Post-game food spot' });
    // The captain's @team mentions everyone.
    expect((await api.chat.overview()).find((o) => o.thread_id === food.id).mentions).toBe(1);
    await api.chat.markRead(food.id, (await api.chat.history(food.id)).at(-1).created_date);
    expect((await api.chat.overview()).find((o) => o.thread_id === food.id).mentions).toBe(0);
    expect((await api.chat.overview()).find((o) => o.thread_id === null).mentions).toBe(0);
    await api.auth.signIn(DEMO_LOGIN.email, DEMO_LOGIN.password);
    await api.entities.Message.create({ user_id: (await api.auth.me()).id, author_name: 'Casey', body: '@Jordan R. hi', thread_id: null, mentions: [jordan.id] });
    await api.auth.signIn('jordan@demo.test', 'demo1234');
    expect((await api.chat.overview()).find((o) => o.thread_id === null).mentions).toBe(1);
  });
});

describe('history', () => {
  it('returns a room oldest-first and keeps Team Chat and threads apart', async () => {
    const { api } = await signedIn();
    const [pickup] = await api.entities.ChatThread.filter({ title: '⚽ Sunday pickup?' });
    const team = await api.chat.history(null);
    const thread = await api.chat.history(pickup.id);
    expect(team.every((m) => (m.thread_id ?? null) === null)).toBe(true);
    expect(thread.every((m) => m.thread_id === pickup.id)).toBe(true);
    const times = team.map((m) => m.created_date);
    expect(times).toEqual([...times].sort());
  });

  it('pages back through older messages', async () => {
    const { api, me } = await signedIn();
    for (let i = 0; i < 5; i += 1)
      await api.entities.Message.create({ user_id: me.id, author_name: 'Me', body: `n${i}`, thread_id: null });
    const all = await api.chat.history(null);
    const latest = await api.chat.history(null, { limit: 4 });
    expect(latest).toEqual(all.slice(-4));
    const earlier = await api.chat.history(null, { before: latest[0].created_date, limit: 100 });
    expect([...earlier, ...latest]).toEqual(all);
  });
});

describe('filter', () => {
  it('matches empty columns with null and any of several values with an array', async () => {
    const { api } = await signedIn();
    const team = await api.entities.Message.filter({ thread_id: null });
    expect(team.length).toBe((await api.chat.history(null, { limit: 1000 })).length);
    const ids = team.slice(0, 2).map((m) => m.id);
    expect((await api.entities.Message.filter({ id: ids })).map((m) => m.id).sort()).toEqual([...ids].sort());
    expect(await api.entities.Message.filter({ id: ids }, 'created_date', 1)).toHaveLength(1);
  });
});

describe('read markers', () => {
  it('clears unread when a room is read, ignores your own messages, and never moves back', async () => {
    const { api, me } = await signedIn();
    const team = await api.chat.history(null);
    const last = team.at(-1).created_date;
    await api.chat.markRead(null, last);
    expect((await api.chat.overview()).find((o) => o.thread_id === null)).toMatchObject({ unread: 0, last_read_at: last });

    await api.entities.Message.create({ user_id: me.id, author_name: 'Me', body: 'mine', thread_id: null });
    expect((await api.chat.overview()).find((o) => o.thread_id === null).unread).toBe(0);

    await api.chat.markRead(null, team[0].created_date);
    expect((await api.chat.overview()).find((o) => o.thread_id === null).last_read_at).toBe(last);
  });
});

describe('deleting', () => {
  it("removes a message's reactions and unlinks replies to it", async () => {
    const { api } = await signedIn();
    const team = await api.chat.history(null);
    const target = team.find((m) => team.some((r) => r.reply_to_id === m.id));
    await api.entities.MessageReaction.create({ message_id: target.id, user_id: 'x', emoji: '👍' });
    await api.entities.Message.delete(target.id);

    const after = await api.chat.history(null);
    expect(after.some((m) => m.id === target.id)).toBe(false);
    expect(after.some((m) => m.reply_to_id === target.id)).toBe(false);
    expect(after).toHaveLength(team.length - 1);
    expect(await api.entities.MessageReaction.filter({ message_id: target.id })).toEqual([]);
  });

  it("removes a thread's messages, reactions and read markers, and nothing else", async () => {
    const { api } = await signedIn();
    const [pickup] = await api.entities.ChatThread.filter({ title: '⚽ Sunday pickup?' });
    const inThread = await api.chat.history(pickup.id);
    await api.entities.MessageReaction.create({ message_id: inThread[0].id, user_id: 'x', emoji: '🔥' });
    const teamBefore = await api.chat.history(null);
    const threadsBefore = await api.entities.ChatThread.list();

    await api.entities.ChatThread.delete(pickup.id);

    expect(await api.chat.history(pickup.id)).toEqual([]);
    expect(await api.entities.MessageReaction.filter({ message_id: inThread.map((m) => m.id) })).toEqual([]);
    expect(await api.entities.ChatRead.filter({ thread_id: pickup.id })).toEqual([]);
    expect(await api.chat.history(null)).toEqual(teamBefore);
    expect(await api.entities.ChatThread.list()).toHaveLength(threadsBefore.length - 1);
  });
});

describe('live updates', () => {
  it('tells subscribers about new, changed and deleted rows until they unsubscribe', async () => {
    const { api, me } = await signedIn();
    const onInsert = vi.fn();
    const onUpdate = vi.fn();
    const onDelete = vi.fn();
    const stop = api.entities.ChatThread.subscribe(onInsert, { onUpdate, onDelete });
    const second = vi.fn();
    const stopSecond = api.entities.ChatThread.subscribe(second);

    const thread = await api.entities.ChatThread.create({ title: 'Live', created_by: me.id });
    await api.entities.ChatThread.update(thread.id, { archived: true });
    await api.entities.ChatThread.delete(thread.id);
    await flush();
    expect(onInsert).toHaveBeenCalledWith(expect.objectContaining({ id: thread.id, title: 'Live' }));
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: thread.id, archived: true }));
    expect(onDelete).toHaveBeenCalledWith({ id: thread.id });
    expect(second).toHaveBeenCalledTimes(1);

    stop();
    stopSecond();
    await api.entities.ChatThread.create({ title: 'Unheard', created_by: me.id });
    await flush();
    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('persistence', () => {
  it('keeps chats, threads and reactions after a reload', async () => {
    const { api, me } = await signedIn();
    const thread = await api.entities.ChatThread.create({ title: 'Keep me', created_by: me.id, author_name: 'Me' });
    const message = await api.entities.Message.create({
      user_id: me.id,
      author_name: 'Me',
      body: 'Still here?',
      thread_id: thread.id,
    });
    await api.entities.MessageReaction.create({ message_id: message.id, user_id: me.id, emoji: '🦃' });

    const reloaded = createDemoBackend();
    expect((await reloaded.chat.history(thread.id)).map((m) => m.body)).toEqual(['Still here?']);
    expect(await reloaded.entities.MessageReaction.filter({ message_id: message.id })).toHaveLength(1);
    expect((await reloaded.entities.ChatThread.list()).some((t) => t.title === 'Keep me')).toBe(true);
  });

  it('keeps saved chats when a later version adds a new kind of data', async () => {
    const { api, me } = await signedIn();
    await api.entities.Message.create({ user_id: me.id, author_name: 'Me', body: 'Before the upgrade', thread_id: null });
    const saved = JSON.parse(localStorage.getItem(DB_KEY));
    delete saved.chat_reads; // as if chat_reads were added after this browser saved its data
    localStorage.setItem(DB_KEY, JSON.stringify(saved));

    const upgraded = createDemoBackend();
    expect((await upgraded.chat.history(null)).at(-1).body).toBe('Before the upgrade');
    await upgraded.chat.markRead(null, new Date().toISOString());
    expect(await upgraded.entities.ChatRead.list()).toHaveLength(1);
  });
});

describe('dues', () => {
  it('has sample dues: $595 + 7 × $18 for two sessions, half paid this session, and a couple who pay together', async () => {
    const { api } = await signedIn();
    const dues = await api.entities.SessionDues.list();
    expect(dues.map((d) => [d.session, d.league_fee, d.ref_fee, d.game_count, d.total_fee]).sort()).toEqual([
      [1, 595, 18, 7, 721],
      [2, 595, 18, 7, 721],
    ]);
    // Five app players, plus Dana Wells, who isn't on the app, and Jamie, who paid before deciding to sit it out.
    const paid = await api.entities.DuesPayment.filter({ session: 2, paid: true });
    expect(paid).toHaveLength(7);
    const amountFor = async (name) => {
      const [p] = await api.entities.PlayerProfile.filter({ display_name: name });
      return paid.find((row) => row.user_id === p.user_id).paid_amount;
    };
    // Everyone paid the $61 share, except Sam, who paid $50 before the ref fees were added.
    expect(await amountFor('Jordan Rivera')).toBe(61);
    expect(await amountFor('Sam Okafor')).toBe(50);
    expect(await amountFor('Jamie Fox')).toBe(61);
    const guests = await api.entities.TeamGuest.list('display_name');
    expect(guests.map((g) => [g.display_name, g.gender, g.status, g.removed])).toEqual([
      ['Dana Wells', 'F', 'active', false],
      ['Mike Russo', 'M', 'active', false],
    ]);
    const [alex] = await api.entities.PlayerProfile.filter({ display_name: 'Alex Chen' });
    const [riley] = await api.entities.PlayerProfile.filter({ display_name: 'Riley Novak' });
    expect([alex.pays_with, riley.pays_with]).toEqual([riley.user_id, alex.user_id]);
    const [settings] = await api.entities.TeamSettings.list();
    expect(settings.pay_venmo).toBeTruthy();
  });

  it('lets any player mark players paid, recording who did it, without touching custom amounts', async () => {
    const api = createDemoBackend();
    await api.auth.signIn('jordan@demo.test', 'demo1234');
    const jordan = await api.auth.me();
    const [alex] = await api.entities.PlayerProfile.filter({ display_name: 'Alex Chen' });
    const [kelly] = await api.entities.PlayerProfile.filter({ display_name: 'Kelly Moss' });
    const year = (await api.entities.SessionDues.list())[0].season_year;
    await api.entities.DuesPayment.create({ season_year: year, session: 2, user_id: kelly.user_id, override_amount: 40, paid: false });

    await api.dues.markPaid({ year, session: 2, userIds: [alex.user_id, kelly.user_id], paid: true, paidDate: '2026-10-09' });
    const rows = await api.entities.DuesPayment.filter({ session: 2, user_id: [alex.user_id, kelly.user_id] });
    expect(rows.map((r) => [r.paid, r.paid_date, r.paid_by])).toEqual([
      [true, '2026-10-09', jordan.id],
      [true, '2026-10-09', jordan.id],
    ]);
    expect(rows.find((r) => r.user_id === kelly.user_id).override_amount).toBe(40);

    await api.dues.markPaid({ year, session: 2, userIds: [alex.user_id], paid: false, paidDate: '2026-10-09' });
    const [again] = await api.entities.DuesPayment.filter({ session: 2, user_id: alex.user_id });
    expect([again.paid, again.paid_date, again.paid_by]).toEqual([false, null, null]);

    // The history keeps both changes, newest first, like the database's dues_history.
    const history = await api.entities.DuesHistory.filter({ session: 2, user_id: alex.user_id }, '-created_date');
    expect(history.map((h) => [h.paid, h.paid_date, h.changed_by])).toEqual([
      [false, null, jordan.id],
      [true, '2026-10-09', jordan.id],
    ]);
  });

  it('records what each player paid, keeps it in the history, and clears it when marked not paid', async () => {
    const api = createDemoBackend();
    await api.auth.signIn('jordan@demo.test', 'demo1234');
    const [alex] = await api.entities.PlayerProfile.filter({ display_name: 'Alex Chen' });
    const [riley] = await api.entities.PlayerProfile.filter({ display_name: 'Riley Novak' });
    const year = (await api.entities.SessionDues.list())[0].season_year;
    const ids = [alex.user_id, riley.user_id];
    const amounts = async () => (await api.entities.DuesPayment.filter({ session: 2, user_id: ids })).map((r) => r.paid_amount);

    await api.dues.markPaid({ year, session: 2, userIds: ids, paid: true, paidDate: '2026-10-09', amounts: [61, 40.5] });
    expect(await amounts()).toEqual([61, 40.5]);
    await api.dues.markPaid({ year, session: 2, userIds: [alex.user_id], paid: false, paidDate: '2026-10-09', amounts: [61] });
    expect(await amounts()).toEqual([null, 40.5]);
    const history = await api.entities.DuesHistory.filter({ session: 2, user_id: alex.user_id }, '-created_date');
    expect(history.map((h) => [h.paid, h.paid_amount])).toEqual([
      [false, null],
      [true, 61],
    ]);
    await expect(api.dues.markPaid({ year, session: 2, userIds: ids, paid: true, amounts: [61] })).rejects.toThrow('Each player needs an amount');
    await expect(api.dues.markPaid({ year, session: 2, userIds: [alex.user_id], paid: true, amounts: [-1] })).rejects.toThrow("can't be less than $0");
  });

  it('pays the difference when a share went up after someone paid, and only then', async () => {
    const { api, me } = await signedIn();
    const id = async (name) => (await api.entities.PlayerProfile.filter({ display_name: name }))[0].user_id;
    const [sam, jordan] = [await id('Sam Okafor'), await id('Jordan Rivera')];
    const year = (await api.entities.SessionDues.list())[0].season_year;
    const payment = async (userId) => (await api.entities.DuesPayment.filter({ session: 2, user_id: userId }))[0];
    const historyCount = async () => (await api.entities.DuesHistory.list()).length;
    const before = await historyCount();

    // Sam paid $50; the share is now $61.
    await api.dues.markPaid({ year, session: 2, userIds: [sam], paid: true, paidDate: '2026-10-12', amounts: [61] });
    expect(await payment(sam)).toMatchObject({ paid: true, paid_amount: 61, paid_date: '2026-10-12', paid_by: me.id });
    const [latest] = await api.entities.DuesHistory.filter({ session: 2, user_id: sam }, '-created_date');
    expect(latest).toMatchObject({ paid: true, paid_amount: 61, changed_by: me.id });
    expect(await historyCount()).toBe(before + 1);

    // Jordan paid $61 and the share went down to $56: nothing changes.
    const jordanBefore = await payment(jordan);
    await api.dues.markPaid({ year, session: 2, userIds: [jordan], paid: true, paidDate: '2026-10-12', amounts: [56] });
    expect(await payment(jordan)).toMatchObject({ paid_amount: 61, paid_date: jordanBefore.paid_date });
    expect(await historyCount()).toBe(before + 1);
  });

  it('leaves a player who is already paid alone: same date, nothing added to the history', async () => {
    const { api } = await signedIn();
    const [jordan] = await api.entities.PlayerProfile.filter({ display_name: 'Jordan Rivera' });
    const [before] = await api.entities.DuesPayment.filter({ session: 2, user_id: jordan.user_id });
    const historyBefore = await api.entities.DuesHistory.list();
    await api.dues.markPaid({ year: before.season_year, session: 2, userIds: [jordan.user_id], paid: true, paidDate: '2030-01-01' });
    const [after] = await api.entities.DuesPayment.filter({ session: 2, user_id: jordan.user_id });
    expect(after.paid_date).toBe(before.paid_date);
    expect(await api.entities.DuesHistory.list()).toHaveLength(historyBefore.length);
  });

  it('has sample history for every payment, including a mistake that was put back', async () => {
    const { api } = await signedIn();
    const payments = await api.entities.DuesPayment.filter({ paid: true });
    const history = await api.entities.DuesHistory.list();
    expect(history.filter((h) => h.paid).length).toBeGreaterThanOrEqual(payments.length);
    expect(history.filter((h) => !h.paid)).toHaveLength(1);
  });

  it('links a couple both ways, moves a relinked player, and unlinks both', async () => {
    const { api } = await signedIn();
    const id = async (name) => (await api.entities.PlayerProfile.filter({ display_name: name }))[0].user_id;
    const partner = async (name) => (await api.entities.PlayerProfile.filter({ display_name: name }))[0].pays_with ?? null;
    const [alex, riley, sam] = [await id('Alex Chen'), await id('Riley Novak'), await id('Sam Okafor')];

    await api.dues.setPartner(sam, riley);
    expect([await partner('Sam Okafor'), await partner('Riley Novak'), await partner('Alex Chen')]).toEqual([riley, sam, null]);
    await api.dues.setPartner(riley, null);
    expect([await partner('Sam Okafor'), await partner('Riley Novak')]).toEqual([null, null]);
    expect(alex).toBeTruthy();
  });

  it('marks teammates who are not on the app paid, with their own payment and history rows', async () => {
    const { api, me } = await signedIn();
    const [mike] = await api.entities.TeamGuest.filter({ display_name: 'Mike Russo' });
    const year = (await api.entities.SessionDues.list())[0].season_year;
    await api.dues.markPaid({ year, session: 2, userIds: [mike.id], paid: true, paidDate: '2026-10-09' });
    const [row] = await api.entities.DuesPayment.filter({ session: 2, guest_id: mike.id });
    expect(row).toMatchObject({ user_id: null, paid: true, paid_date: '2026-10-09', paid_by: me.id });
    expect(await api.entities.DuesHistory.filter({ session: 2, guest_id: mike.id, paid: true })).toHaveLength(1);
  });

  it('pairs a guest with an app player, both ways', async () => {
    const { api } = await signedIn();
    const [mike] = await api.entities.TeamGuest.filter({ display_name: 'Mike Russo' });
    const [kelly] = await api.entities.PlayerProfile.filter({ display_name: 'Kelly Moss' });
    await api.dues.setPartner(kelly.user_id, mike.id);
    expect((await api.entities.PlayerProfile.filter({ display_name: 'Kelly Moss' }))[0]).toMatchObject({ pays_with: null, pays_with_guest: mike.id });
    expect((await api.entities.TeamGuest.filter({ id: mike.id }))[0]).toMatchObject({ pays_with_user: kelly.user_id, pays_with_guest: null });
    await api.dues.setPartner(mike.id, null);
    expect((await api.entities.PlayerProfile.filter({ display_name: 'Kelly Moss' }))[0].pays_with_guest).toBeNull();
  });

  it("moves a guest's payments, history and partner to their account when a captain links them", async () => {
    const { api } = await signedIn();
    const [mike] = await api.entities.TeamGuest.filter({ display_name: 'Mike Russo' });
    const [chris] = await api.entities.PlayerProfile.filter({ display_name: 'Chris Dunn' });
    const [kelly] = await api.entities.PlayerProfile.filter({ display_name: 'Kelly Moss' });
    const year = (await api.entities.SessionDues.list())[0].season_year;
    await api.dues.markPaid({ year, session: 2, userIds: [mike.id], paid: true, paidDate: '2026-10-09', amounts: [61] });
    await api.dues.setPartner(mike.id, kelly.user_id);

    await api.users.linkGuest(mike.id, chris.user_id);
    const [moved] = await api.entities.DuesPayment.filter({ session: 2, user_id: chris.user_id });
    expect(moved).toMatchObject({ guest_id: null, paid: true, paid_date: '2026-10-09', paid_amount: 61 });
    expect(await api.entities.DuesHistory.filter({ guest_id: mike.id })).toHaveLength(0);
    expect((await api.entities.TeamGuest.filter({ id: mike.id }))[0]).toMatchObject({ linked_user_id: chris.user_id });
    expect((await api.entities.PlayerProfile.filter({ display_name: 'Kelly Moss' }))[0].pays_with).toBe(chris.user_id);
    await expect(api.users.linkGuest(mike.id, chris.user_id)).rejects.toThrow('already been picked');
  });

  it('keeps what both had when a captain links someone who was also marked under their account', async () => {
    const { api } = await signedIn();
    const [mike] = await api.entities.TeamGuest.filter({ display_name: 'Mike Russo' });
    const [chris] = await api.entities.PlayerProfile.filter({ display_name: 'Chris Dunn' });
    const year = (await api.entities.SessionDues.list())[0].season_year;
    const row = (session, who, extra) => api.entities.DuesPayment.create({ season_year: year, session, user_id: null, guest_id: null, paid: false, override_amount: null, ...who, ...extra });
    // Session 1: Mike paid under his roster name (sample data) and Chris under his account.
    await row(1, { user_id: chris.user_id }, { paid: true, paid_date: '2026-09-01' });
    // Session 3: paid under the roster name only. Session 4: a custom amount under the roster name only.
    await row(3, { guest_id: mike.id }, { paid: true, paid_date: '2026-10-01', paid_amount: 45 });
    await row(4, { guest_id: mike.id }, { override_amount: 25 });
    await row(3, { user_id: chris.user_id }, { override_amount: 50 });
    await row(4, { user_id: chris.user_id });

    await api.users.linkGuest(mike.id, chris.user_id);
    const [three] = await api.entities.DuesPayment.filter({ season_year: year, session: 3, user_id: chris.user_id });
    const [four] = await api.entities.DuesPayment.filter({ season_year: year, session: 4, user_id: chris.user_id });
    expect(three).toMatchObject({ paid: true, paid_date: '2026-10-01', paid_amount: 45, override_amount: 50 });
    expect(four).toMatchObject({ paid: false, override_amount: 25 });
    // Both had paid session 1, and nothing is deleted: Mike's own rows stay under his roster name.
    expect(await api.entities.DuesPayment.filter({ guest_id: mike.id })).toHaveLength(3);
    expect(await api.entities.DuesPayment.filter({ session: 1, user_id: chris.user_id })).toHaveLength(1);
  });

  it('only lets captains link a guest to an account', async () => {
    const api = createDemoBackend();
    await api.auth.signIn('jordan@demo.test', 'demo1234');
    const [mike] = await api.entities.TeamGuest.filter({ display_name: 'Mike Russo' });
    await expect(api.users.linkGuest(mike.id, (await api.auth.me()).id)).rejects.toThrow('Only captains');
  });

  it('lets a new player pick their name: status, details, payments and history become theirs, once', async () => {
    const api = createDemoBackend();
    await api.auth.signUp('mike@demo.test', 'demo1234');
    const me = await api.auth.me();
    await api.entities.PlayerProfile.create({ user_id: me.id, display_name: 'Mike Russo', status: 'active' });
    const [mike] = await api.entities.TeamGuest.filter({ display_name: 'Mike Russo' });
    const [dana] = await api.entities.TeamGuest.filter({ display_name: 'Dana Wells' });
    await api.entities.TeamGuest.update(mike.id, { status: 'sub_pool' });

    await api.users.claimGuest(mike.id);
    const [profile] = await api.entities.PlayerProfile.filter({ user_id: me.id });
    expect(profile).toMatchObject({ status: 'sub_pool', gender: 'M', position: 'Defense' });
    expect(await api.entities.DuesPayment.filter({ session: 1, user_id: me.id, paid: true })).toHaveLength(1);
    expect((await api.entities.TeamGuest.filter({ id: mike.id }))[0].linked_user_id).toBe(me.id);
    await expect(api.users.claimGuest(dana.id)).rejects.toThrow('already has a name');
  });
});
