import { beforeEach, describe, expect, it } from 'vitest';
import { createDemoBackend, DEMO_LOGIN, DEMO_PLAYER_LOGIN, DEMO_USERNAME_LOGIN } from '@/api/demo';
import { RESET_CLAIM_TIMEOUT_MS, RESET_IN_PROGRESS } from '@/lib/username';

beforeEach(() => localStorage.clear());

describe('email-free accounts in previews', () => {
  it('requires the code, signs the player in, and accepts mixed-case login', async () => {
    const api = createDemoBackend();
    await expect(api.auth.signUpUsername('new_player', 'password123', 'wrong')).rejects.toThrow('team code');
    expect(await api.auth.signUpUsername(' NEW.PLAYER ', 'password123', 'turkey')).toEqual({ username: 'new.player', session: true });
    const me = await api.auth.me();
    expect(me).toMatchObject({ username: 'new.player', email: null, role: 'user', joined: true });
    await api.auth.signOut();
    const reopened = createDemoBackend();
    await reopened.auth.signIn('NEW.PLAYER ', 'password123');
    expect((await reopened.auth.me()).id).toBe(me.id);
    await expect(reopened.auth.signUpUsername('new.player', 'password123', 'TURKEY')).rejects.toThrow('taken');
  });

  it('adds a username to an email account, keeping the password it has', async () => {
    const api = createDemoBackend();
    await api.auth.signIn(DEMO_LOGIN.email, DEMO_LOGIN.password);
    const before = await api.auth.me();
    expect(before.hasPassword).toBe(true);
    await expect(api.auth.linkUsername('casey_cap', 'guess-123')).rejects.toThrow("That isn't your password.");
    expect((await api.auth.me()).username).toBeNull();
    await api.auth.linkUsername('casey_cap', DEMO_LOGIN.password);
    await api.auth.signOut();
    await api.auth.signIn('casey_cap', DEMO_LOGIN.password);
    expect(await api.auth.me()).toMatchObject({ id: before.id, role: 'admin', email: DEMO_LOGIN.email });
  });

  it('captains see usernames and reset a teammate’s password with a one-time code', async () => {
    const api = createDemoBackend();
    await api.auth.signIn(DEMO_PLAYER_LOGIN.email, DEMO_PLAYER_LOGIN.password);
    const jordan = (await api.auth.me()).id;
    expect(Object.values(await api.users.usernames())).toEqual(['jordan']);
    await expect(api.users.issueResetCode(jordan)).rejects.toThrow('Only captains');
    await api.auth.signOut();

    await api.auth.signIn(DEMO_LOGIN.email, DEMO_LOGIN.password);
    expect((await api.users.usernames())[jordan]).toBe('jordan');
    const casey = (await api.auth.me()).id;
    await expect(api.users.issueResetCode(casey)).rejects.toThrow("doesn't sign in with a username");
    const { code, username } = await api.users.issueResetCode(jordan);
    expect(username).toBe('jordan');
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    await api.auth.signOut();

    await expect(api.auth.resetWithCode('jordan', 'ABCD-EFGH', 'fresh-pass')).rejects.toThrow('Ask a captain for a new one');
    expect(await api.auth.resetWithCode(DEMO_USERNAME_LOGIN.username, code.toLowerCase(), 'fresh-pass')).toEqual({ session: true });
    expect((await api.auth.me()).id).toBe(jordan);
    await api.auth.signOut();
    await expect(api.auth.resetWithCode('jordan', code, 'another-pass')).rejects.toThrow('Ask a captain');
    await expect(api.auth.signIn('jordan', DEMO_PLAYER_LOGIN.password)).rejects.toThrow('Invalid');
    await api.auth.signIn('jordan', 'fresh-pass');
    expect((await api.auth.me()).email).toBe(DEMO_PLAYER_LOGIN.email);
  });

  it('does not make a reset code without signal, and can retry after reconnecting', async () => {
    const api = createDemoBackend({ autoSignIn: true });
    const [jordan] = Object.keys(await api.users.usernames());
    const before = localStorage.getItem('jt_demo_db_v33');
    localStorage.setItem('jt_demo_offline', '1');
    await expect(api.users.issueResetCode(jordan)).rejects.toThrow('Failed to fetch');
    expect(localStorage.getItem('jt_demo_db_v33')).toBe(before);
    localStorage.removeItem('jt_demo_offline');
    expect((await api.users.issueResetCode(jordan)).username).toBe('jordan');
  });

  it('rejects a replaced code in an older tab and never restores an old password', async () => {
    const captain = createDemoBackend({ autoSignIn: true });
    const [jordan] = Object.keys(await captain.users.usernames());
    const first = await captain.users.issueResetCode(jordan);
    const player = createDemoBackend();
    const stale = createDemoBackend();
    const second = await captain.users.issueResetCode(jordan);
    await expect(player.auth.resetWithCode('jordan', first.code, 'first-password')).rejects.toThrow('Ask a captain');
    await player.auth.resetWithCode('jordan', second.code, 'fresh-password');

    // A different change saved by the older tab must not bring the used code or password back.
    const [profile] = await stale.entities.PlayerProfile.filter({ user_id: jordan });
    await stale.entities.PlayerProfile.update(profile.id, { phone: '5551234567' });
    await expect(stale.auth.signIn('jordan', DEMO_PLAYER_LOGIN.password)).rejects.toThrow('Invalid');
    await stale.auth.signIn('jordan', 'fresh-password');
    await expect(stale.auth.resetWithCode('jordan', second.code, 'another-password')).rejects.toThrow('Ask a captain');
  });

  it('asks the captain to retry during a reset and can replace an abandoned claim', async () => {
    const api = createDemoBackend({ autoSignIn: true });
    const [jordan] = Object.keys(await api.users.usernames());
    const first = await api.users.issueResetCode(jordan);
    const saved = JSON.parse(localStorage.getItem('jt_demo_db_v33'));
    const user = saved.users.find((u) => u.id === jordan);
    Object.assign(user, { reset_claim_id: crypto.randomUUID(), reset_claimed_at: new Date().toISOString() });
    localStorage.setItem('jt_demo_db_v33', JSON.stringify(saved));
    await expect(api.users.issueResetCode(jordan)).rejects.toThrow(RESET_IN_PROGRESS);
    user.reset_claimed_at = new Date(Date.now() - RESET_CLAIM_TIMEOUT_MS - 1000).toISOString();
    localStorage.setItem('jt_demo_db_v33', JSON.stringify(saved));
    const second = await api.users.issueResetCode(jordan);
    await expect(api.auth.resetWithCode('jordan', first.code, 'old-code-password')).rejects.toThrow('Ask a captain');
    await api.auth.resetWithCode('jordan', second.code, 'replacement-password');
  });

  it('only one concurrent preview reset can use the code', async () => {
    const api = createDemoBackend({ autoSignIn: true });
    const [jordan] = Object.keys(await api.users.usernames());
    const { code } = await api.users.issueResetCode(jordan);
    const olderTab = createDemoBackend();
    const results = await Promise.allSettled([
      api.auth.resetWithCode('jordan', code, 'first-password'),
      olderTab.auth.resetWithCode('jordan', code, 'second-password'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    await expect(api.auth.resetWithCode('jordan', code, 'third-password')).rejects.toThrow('Ask a captain');
  });
});
