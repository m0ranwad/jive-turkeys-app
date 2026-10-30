// Announcements: which posts are new to you, and captains fixing or deleting a
// post. The demo backend mirrors the database (supabase/tests/announcements.test.sql).
import { beforeEach, describe, expect, it } from 'vitest';
import { createDemoBackend, DEMO_LOGIN, DEMO_PLAYER_LOGIN, DEMO_TEAM_CODE } from '@/api/demo';
import { newestPostAt, newPostsLabel } from '@/lib/announcements';

async function as(email) {
  const api = createDemoBackend();
  await api.auth.signIn(email, 'demo1234');
  return api;
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 5));

beforeEach(() => localStorage.clear());

describe('newestPostAt', () => {
  it('is when the newest post went up, whatever order they come in', () => {
    const posts = [
      { created_date: '2026-10-08T10:00:00.000Z' },
      { created_date: '2026-10-09T09:00:00.000Z' },
      { created_date: '2026-10-07T23:00:00.000Z' },
    ];
    expect(newestPostAt(posts)).toBe('2026-10-09T09:00:00.000Z');
  });

  it('is nothing with no posts', () => {
    expect(newestPostAt([])).toBeNull();
    expect(newestPostAt(null)).toBeNull();
  });
});

describe('newPostsLabel', () => {
  it('says how many, in words', () => {
    expect(newPostsLabel(1)).toBe('1 new announcement');
    expect(newPostsLabel(3)).toBe('3 new announcements');
  });
});

describe('new posts (demo backend)', () => {
  it('counts the sample post nobody has opened, until you read up to it', async () => {
    const api = await as(DEMO_PLAYER_LOGIN.email);
    expect(await api.announcements.unread()).toBe(1);
    const posts = await api.entities.Announcement.list('-created_date');
    await api.announcements.markRead(newestPostAt(posts));
    expect(await api.announcements.unread()).toBe(0);
    // Each player has their own.
    expect(await (await as(DEMO_LOGIN.email)).announcements.unread()).toBe(1);
  });

  it('never moves the marker back, or past now', async () => {
    const api = await as(DEMO_PLAYER_LOGIN.email);
    const posts = await api.entities.Announcement.list('-created_date');
    await api.announcements.markRead(newestPostAt(posts));
    await api.announcements.markRead(posts.at(-1).created_date);
    expect(await api.announcements.unread()).toBe(0);

    await api.announcements.markRead('2099-01-01T00:00:00.000Z');
    await pause();
    const captain = await as(DEMO_LOGIN.email);
    await captain.entities.Announcement.create({ title: 'Later', body: 'Still counts.' });
    expect(await (await as(DEMO_PLAYER_LOGIN.email)).announcements.unread()).toBe(1);
  });

  it("counts only posts from after you joined, and none before you're on the team", async () => {
    const nia = await as('nia@demo.test');
    expect(await nia.announcements.unread()).toBe(0);
    await expect(nia.announcements.markRead(new Date().toISOString())).rejects.toThrow("You don't have permission");

    await nia.users.joinTeam(DEMO_TEAM_CODE);
    expect(await nia.announcements.unread()).toBe(0);

    await pause();
    const captain = await as(DEMO_LOGIN.email);
    await captain.entities.Announcement.create({ title: 'Welcome, Nia', body: 'See you Thursday.' });
    expect(await (await as('nia@demo.test')).announcements.unread()).toBe(1);
  });

  it('reads back only your own marker', async () => {
    const api = await as(DEMO_PLAYER_LOGIN.email);
    const me = await api.auth.me();
    const rows = await api.entities.AnnouncementRead.list();
    expect(rows.map((r) => r.user_id)).toEqual([me.id]);
  });
});

describe('captains fix and delete posts (demo backend)', () => {
  it('marks a changed post edited, without making it new again', async () => {
    const player = await as(DEMO_PLAYER_LOGIN.email);
    const posts = await player.entities.Announcement.list('-created_date');
    await player.announcements.markRead(newestPostAt(posts));

    const captain = await as(DEMO_LOGIN.email);
    const [photo, welcome] = posts;
    await captain.entities.Announcement.update(welcome.id, { title: welcome.title, body: welcome.body });
    const fixed = await captain.entities.Announcement.update(photo.id, { body: 'Get there 20 minutes early.' });
    expect(fixed.edited_date).toBeTruthy();
    expect(fixed.created_date).toBe(photo.created_date);
    expect((await captain.entities.Announcement.filter({ id: welcome.id }))[0].edited_date).toBeFalsy();

    expect(await (await as(DEMO_PLAYER_LOGIN.email)).announcements.unread()).toBe(0);
  });

  it('lets only captains post, edit and delete', async () => {
    const player = await as(DEMO_PLAYER_LOGIN.email);
    const [post] = await player.entities.Announcement.list('-created_date');
    await expect(player.entities.Announcement.create({ title: 'Hi', body: 'Hi' })).rejects.toThrow("You don't have permission");
    await expect(player.entities.Announcement.update(post.id, { body: 'Hi' })).rejects.toThrow("You don't have permission");
    await expect(player.entities.Announcement.delete(post.id)).rejects.toThrow("You don't have permission");

    const captain = await as(DEMO_LOGIN.email);
    await captain.entities.Announcement.delete(post.id);
    expect(await captain.entities.Announcement.list()).toHaveLength(1);
    // A deleted post no longer counts as new.
    expect(await captain.announcements.unread()).toBe(0);
  });
});
