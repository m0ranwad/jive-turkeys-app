// The demo backend powers previews and local development. It must behave like
// the real database for chat (the rules themselves are tested in
// supabase/tests/chat.test.sql), and its chats must persist in the browser.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_LOGIN, createDemoBackend } from '@/api/demo';

const DB_KEY = 'jt_demo_db_v3';

async function signedIn() {
  const api = createDemoBackend();
  await api.auth.signIn(DEMO_LOGIN.email, DEMO_LOGIN.password);
  const me = await api.auth.me();
  return { api, me };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => localStorage.clear());

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
