// The demo backend powers previews and local development. It must behave like
// the real database for chat (the rules themselves are tested in
// supabase/tests/chat.test.sql), and its chats must persist in the browser.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_LOGIN, DEMO_PLAYER_LOGIN, createDemoBackend } from '@/api/demo';

const DB_KEY = 'jt_demo_db_v17';

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
    expect(threads.map((t) => t.title).sort()).toEqual(
      ['⚽ Sunday pickup?', '🍕 Post-game food spot', '🎽 Jersey order', '🏈 Fantasy football league'].sort(),
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

describe('photos', () => {
  const jpeg = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });
  const photo = (path) => ({ type: 'image', path, width: 1600, height: 1200 });

  it('has sample photos in Team Chat: a GIF without a caption and a captioned screenshot', async () => {
    const { api } = await signedIn();
    const team = await api.chat.history(null);
    const withPhotos = team.filter((m) => m.attachments);
    expect(withPhotos.map((m) => m.body)).toEqual(['🎞️ GIF', 'Standings after week 4 👀 2nd place, 3 points back']);
    const urls = await api.chat.photoUrls(withPhotos.map((m) => m.attachments[0].path));
    expect(Object.values(urls)).toEqual(['/chat-samples/goal.gif', '/chat-samples/standings.jpg']);
  });

  it('uploads into your own folder with progress, and shows it after a reload', async () => {
    const { api, me } = await signedIn();
    const progress = [];
    const path = await api.chat.uploadPhoto(jpeg(), { onProgress: (p) => progress.push(p) });
    expect(path).toMatch(new RegExp(`^${me.id}/[0-9a-f-]+\\.jpg$`));
    expect(progress.at(-1)).toBe(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));

    const reloaded = createDemoBackend();
    expect((await reloaded.chat.photoUrls([path, `${me.id}/gone.jpg`]))).toEqual({
      [path]: 'data:image/jpeg;base64,/9j/2Q==',
      [`${me.id}/gone.jpg`]: null,
    });
  });

  it('posts 1 to 4 of your own photos, like the database', async () => {
    const { api, me } = await signedIn();
    const mine = await api.chat.uploadPhoto(jpeg());
    const post = (attachments) => api.entities.Message.create({ user_id: me.id, author_name: 'Casey', body: '📷 Photo', thread_id: null, attachments });
    await expect(post([photo(mine)])).resolves.toMatchObject({ attachments: [photo(mine)] });
    await expect(post([photo('someone-else/x.jpg')])).rejects.toThrow('only show photos its author uploaded');
    await expect(post([])).rejects.toThrow('1 to 4 photos');
    await expect(post(Array(5).fill(photo(mine)))).rejects.toThrow('1 to 4 photos');
  });

  it('removes photos like the storage rules: your own, any as a captain, or any no message shows', async () => {
    const { api } = await signedIn();
    await api.auth.signIn('jordan@demo.test', 'demo1234');
    const jordan = await api.auth.me();
    const shown = await api.chat.uploadPhoto(jpeg());
    const loose = await api.chat.uploadPhoto(jpeg());
    await api.entities.Message.create({ user_id: jordan.id, author_name: 'Jordan', body: '📷 Photo', thread_id: null, attachments: [photo(shown)] });

    await api.auth.signIn('sam@demo.test', 'demo1234');
    await api.chat.removePhotos([shown, loose]);
    expect(await api.chat.photoUrls([shown, loose])).toEqual({ [shown]: expect.stringMatching(/^data:/), [loose]: null });

    await api.auth.signIn(DEMO_LOGIN.email, DEMO_LOGIN.password);
    await api.chat.removePhotos([shown]);
    expect((await api.chat.photoUrls([shown]))[shown]).toBeNull();
  });

  it("doesn't upload without a connection", async () => {
    const { api } = await signedIn();
    localStorage.setItem('jt_demo_offline', '1');
    await expect(api.chat.uploadPhoto(jpeg())).rejects.toThrow('Failed to fetch');
    localStorage.removeItem('jt_demo_offline');
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
    // Five app players, plus Dana Wells, who isn't on the app.
    expect(await api.entities.DuesPayment.filter({ session: 2, paid: true })).toHaveLength(6);
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
    await api.dues.markPaid({ year, session: 2, userIds: [mike.id], paid: true, paidDate: '2026-10-09' });
    await api.dues.setPartner(mike.id, kelly.user_id);

    await api.users.linkGuest(mike.id, chris.user_id);
    const [moved] = await api.entities.DuesPayment.filter({ session: 2, user_id: chris.user_id });
    expect(moved).toMatchObject({ guest_id: null, paid: true, paid_date: '2026-10-09' });
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
    await row(3, { guest_id: mike.id }, { paid: true, paid_date: '2026-10-01' });
    await row(4, { guest_id: mike.id }, { override_amount: 25 });
    await row(3, { user_id: chris.user_id }, { override_amount: 50 });
    await row(4, { user_id: chris.user_id });

    await api.users.linkGuest(mike.id, chris.user_id);
    const [three] = await api.entities.DuesPayment.filter({ season_year: year, session: 3, user_id: chris.user_id });
    const [four] = await api.entities.DuesPayment.filter({ season_year: year, session: 4, user_id: chris.user_id });
    expect(three).toMatchObject({ paid: true, paid_date: '2026-10-01', override_amount: 50 });
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
