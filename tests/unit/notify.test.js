// The notify-chat function's decisions: what notifications say, and what each
// kind of request does. The encryption itself is in webpush.test.js.
import { createECDH, randomBytes } from 'node:crypto';
import ece from 'http_ece';
import { describe, expect, it, vi } from 'vitest';
import { TEST_NOTIFICATION, chatNotification, handleNotify, potmNotification } from '../../supabase/functions/_shared/notify.js';
import { b64u, generateVapidKeys } from '../../supabase/functions/_shared/webpush.js';

const MESSAGE = '11111111-2222-4333-8444-555555555555';

function phone(id) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return { id, ecdh, endpoint: `https://push.example/${id}`, p256dh: b64u.encode(ecdh.getPublicKey()), auth: b64u.encode(auth) };
}

async function setup({ targets = [], subscriptions = [], unread = async () => [], status = () => 201, user = { id: 'me' } } = {}) {
  const vapid = { ...(await generateVapidKeys()), subject: 'mailto:team@jiveturkeys.app' };
  const delivered = [];
  const fetch = vi.fn(async (url, init) => {
    const p = [...targets, ...subscriptions].find((t) => t.endpoint === url);
    delivered.push({
      to: p.subscription_id ?? p.id,
      message: JSON.parse(
        ece.decrypt(Buffer.from(init.body), { version: 'aes128gcm', privateKey: p.ecdh, authSecret: p.auth }).toString(),
      ),
    });
    return new Response(null, { status: status(url) });
  });
  const db = {
    pushTargets: vi.fn(async () => targets),
    unreadCounts: vi.fn(unread),
    potmTargets: vi.fn(async () => targets),
    subscriptionsOf: vi.fn(async () => subscriptions),
    forget: vi.fn(async () => {}),
  };
  return { deps: { vapid, db, fetch, userOf: vi.fn(async (token) => (token === 'good' ? user : null)) }, db, delivered, vapid };
}

describe('chatNotification', () => {
  it('says who wrote what, and opens the room it was posted in', () => {
    expect(chatNotification({ thread_id: null, author_name: 'Jordan Rivera', body: 'Who has pinnies?' })).toEqual({
      title: 'Team Chat',
      body: 'Jordan R.: Who has pinnies?',
      url: '/banter',
      tag: 'chat-team',
    });
    expect(chatNotification({ thread_id: 't1', thread_title: '⚽ Sunday pickup', author_name: 'Sam', body: 'Field 3' })).toEqual({
      title: '⚽ Sunday pickup',
      body: 'Sam: Field 3',
      url: '/banter?thread=t1',
      tag: 'chat-t1',
    });
  });

  it('keeps long messages short and on one line', () => {
    const { body } = chatNotification({
      thread_id: null,
      author_name: 'Kelly Moss',
      body: `Line one\n\nline two ${'x'.repeat(300)}`,
    });
    expect(body.startsWith('Kelly M.: Line one line two')).toBe(true);
    expect(body).toHaveLength(160);
    expect(body.endsWith('…')).toBe(true);
  });

  it('copes with a missing name', () => {
    expect(chatNotification({ thread_id: null, author_name: null, body: 'hi' }).body).toBe('Player: hi');
  });
});

describe('handleNotify', () => {
  it('hands out the public key the site subscribes with', async () => {
    const { deps, vapid } = await setup();
    expect(await handleNotify({ action: 'config' }, '', deps)).toEqual([200, { publicKey: vapid.publicKey }]);
  });

  it('says so when the keys have not been set up yet', async () => {
    const { deps } = await setup();
    expect((await handleNotify({ action: 'config' }, '', { ...deps, vapid: {} }))[0]).toBe(503);
  });

  it('sends a new message to each phone the database picked', async () => {
    const a = {
      ...phone('a'),
      subscription_id: 'a',
      thread_id: null,
      thread_title: null,
      author_name: 'Jordan Rivera',
      body: 'In',
    };
    const b = {
      ...phone('b'),
      subscription_id: 'b',
      thread_id: null,
      thread_title: null,
      author_name: 'Jordan Rivera',
      body: 'In',
    };
    const { deps, db, delivered } = await setup({ targets: [a, b] });
    const [status, result] = await handleNotify({ message_id: MESSAGE }, '', deps);
    expect(status).toBe(200);
    expect(result).toMatchObject({ sent: 2, forgotten: 0, failed: 0 });
    expect(db.pushTargets).toHaveBeenCalledWith(MESSAGE);
    expect(delivered.map((d) => d.to).sort()).toEqual(['a', 'b']);
    expect(delivered[0].message).toEqual({ title: 'Team Chat', body: 'Jordan R.: In', url: '/banter', tag: 'chat-team' });
  });

  it("puts each player's unread chat count on their app icon", async () => {
    const row = (id) => ({ ...phone(id), subscription_id: id, thread_id: null, author_name: 'Jordan Rivera', body: 'In' });
    const { deps, db, delivered } = await setup({
      targets: [row('a'), row('b'), row('c')],
      unread: async () => [
        { subscription_id: 'a', unread: 4 },
        { subscription_id: 'b', unread: 0 },
      ],
    });
    await handleNotify({ message_id: MESSAGE }, '', deps);
    expect(db.unreadCounts).toHaveBeenCalledTimes(1);
    expect(db.unreadCounts.mock.calls[0][0].sort()).toEqual(['a', 'b', 'c']);
    const badgeOf = (id) => delivered.find((d) => d.to === id).message.badge;
    expect(badgeOf('a')).toBe(4);
    expect(badgeOf('b'), 'all read: 0 clears the icon').toBe(0);
    expect(badgeOf('c'), 'no count, no number: the icon keeps what it had').toBeUndefined();
    expect(delivered.find((d) => d.to === 'a').message).toMatchObject({ title: 'Team Chat', body: 'Jordan R.: In' });
  });

  it("still sends chat notifications when the database can't count unread messages", async () => {
    const row = (id) => ({ ...phone(id), subscription_id: id, thread_id: null, author_name: 'A', body: 'x' });
    const { deps, delivered } = await setup({
      targets: [row('a')],
      unread: async () => {
        throw new Error('function public.chat_push_unread does not exist');
      },
    });
    const [status, result] = await handleNotify({ message_id: MESSAGE }, '', deps);
    expect(status).toBe(200);
    expect(result).toMatchObject({ sent: 1, failed: 0 });
    expect(delivered[0].message).toEqual({ title: 'Team Chat', body: 'A: x', url: '/banter', tag: 'chat-team' });
  });

  it('forgets phones that unsubscribed, and keeps going past failures', async () => {
    const row = (id) => ({ ...phone(id), subscription_id: id, thread_id: null, author_name: 'A', body: 'x' });
    const { deps, db } = await setup({
      targets: [row('ok'), row('gone'), row('busy')],
      status: (url) => (url.endsWith('/gone') ? 410 : url.endsWith('/busy') ? 503 : 201),
    });
    const [, result] = await handleNotify({ message_id: MESSAGE }, '', deps);
    expect(result).toMatchObject({ sent: 1, forgotten: 1, failed: 1 });
    expect(db.forget).toHaveBeenCalledWith('gone');
    expect(db.forget).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when the database says nobody (or the message was already handled)', async () => {
    const { deps, delivered } = await setup({ targets: [] });
    expect((await handleNotify({ message_id: MESSAGE }, '', deps))[1]).toMatchObject({ sent: 0 });
    expect(delivered).toEqual([]);
  });

  it('ignores anything that is not a real message id', async () => {
    const { deps, db } = await setup();
    expect((await handleNotify({ message_id: "x'; select 1" }, '', deps))[0]).toBe(400);
    expect((await handleNotify({}, '', deps))[0]).toBe(400);
    expect(db.pushTargets).not.toHaveBeenCalled();
  });

  it('sends a test only to the signed-in player’s own devices', async () => {
    const mine = phone('mine');
    const { deps, db, delivered } = await setup({ subscriptions: [mine] });
    expect((await handleNotify({ action: 'test' }, 'bad', deps))[0]).toBe(401);
    const [status, result] = await handleNotify({ action: 'test' }, 'good', deps);
    expect(status).toBe(200);
    expect(result.sent).toBe(1);
    expect(db.subscriptionsOf).toHaveBeenCalledWith('me');
    expect(delivered).toEqual([{ to: 'mine', message: TEST_NOTIFICATION }]);
  });

  it('sends Player of the Match notifications the database wrote, to the phones it picked', async () => {
    const GAME = '99999999-2222-4333-8444-555555555555';
    const row = (id) => ({
      ...phone(id),
      subscription_id: id,
      title: '🏆 Voting closes in 3 hours',
      body: "You haven't voted for Player of the Match (5–3 W vs Ball Busters). Voting closes Fri 9:30 AM.",
      url: `/games/${GAME}`,
    });
    const { deps, db, delivered } = await setup({ targets: [row('a'), row('b')] });
    const [status, result] = await handleNotify({ potm_game_id: GAME, kind: 'reminder' }, '', deps);
    expect(status).toBe(200);
    expect(result).toMatchObject({ sent: 2 });
    expect(db.potmTargets).toHaveBeenCalledWith(GAME, 'reminder');
    expect(delivered[0].message).toEqual({
      title: '🏆 Voting closes in 3 hours',
      body: "You haven't voted for Player of the Match (5–3 W vs Ball Busters). Voting closes Fri 9:30 AM.",
      url: `/games/${GAME}`,
      tag: `potm-${GAME}`,
    });
  });

  it('ignores Player of the Match requests that are not a real game and kind', async () => {
    const { deps, db } = await setup();
    expect((await handleNotify({ potm_game_id: 'nope', kind: 'open' }, '', deps))[0]).toBe(400);
    expect((await handleNotify({ potm_game_id: MESSAGE, kind: 'winner' }, '', deps))[0]).toBe(400);
    expect(db.potmTargets).not.toHaveBeenCalled();
  });
});

describe('potmNotification', () => {
  it('keeps one notification per game on screen, and long text short', () => {
    const n = potmNotification({ title: 'T', body: 'x'.repeat(300), url: '/games/g' }, 'g');
    expect(n.tag).toBe('potm-g');
    expect(n.body).toHaveLength(160);
  });
});
