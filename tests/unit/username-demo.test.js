import { beforeEach, describe, expect, it } from 'vitest';
import { createDemoBackend, DEMO_LOGIN, DEMO_PLAYER_LOGIN, DEMO_USERNAME_LOGIN } from '@/api/demo';

beforeEach(() => localStorage.clear());

describe('email-free accounts in previews', () => {
  it('requires the code, persists a new username account, and accepts mixed-case login', async () => {
    const api = createDemoBackend();
    await expect(api.auth.signUpUsername('new_player', 'password123', 'wrong')).rejects.toThrow('team code');
    const { recoveryCode } = await api.auth.signUpUsername(' NEW_PLAYER ', 'password123', 'turkey');
    const me = await api.auth.me();
    expect(me).toMatchObject({ username: 'new_player', email: null, role: 'user', joined: true });
    await api.auth.signOut();
    const reopened = createDemoBackend();
    await reopened.auth.signIn('NEW_PLAYER', 'password123');
    expect((await reopened.auth.me()).id).toBe(me.id);
    await expect(reopened.auth.signUpUsername('new_player', 'password123', 'TURKEY')).rejects.toThrow('taken');
    expect(recoveryCode).toMatch(/^[a-f0-9]{4}(-[a-f0-9]{4}){7}$/);
  });

  it('adds a username to the same existing account and preserves email login', async () => {
    const api = createDemoBackend();
    await api.auth.signIn(DEMO_LOGIN.email, DEMO_LOGIN.password);
    const before = await api.auth.me();
    expect(before.hasPassword).toBe(true);
    await expect(api.auth.linkUsername('casey_cap', 'new-password', 'guess-123')).rejects.toThrow('current password');
    expect((await api.auth.me()).username).toBeNull();
    await api.auth.linkUsername('casey_cap', 'new-password', DEMO_LOGIN.password);
    await api.auth.signOut();
    await api.auth.signIn('casey_cap', 'new-password');
    expect(await api.auth.me()).toMatchObject({ id: before.id, role: 'admin', email: DEMO_LOGIN.email });
    await api.auth.signOut();
    await api.auth.signIn(DEMO_LOGIN.email, 'new-password');
    expect((await api.auth.me()).id).toBe(before.id);
  });

  it('uses recovery once, preserves identity, and keeps the old password after a wrong code', async () => {
    const api = createDemoBackend();
    const { recoveryCode } = await api.auth.signUpUsername('new_player', 'password123', 'TURKEY');
    const id = (await api.auth.me()).id;
    await api.auth.signOut();
    await expect(api.auth.recoverUsername('new_player', 'wrong', 'replacement')).rejects.toThrow('Invalid');
    const replacement = await api.auth.recoverUsername('NEW_PLAYER', recoveryCode, 'replacement');
    // Signed in with the new password, like the account service.
    expect(replacement.session).toBe(true);
    expect((await api.auth.me()).id).toBe(id);
    await api.auth.signOut();
    await expect(api.auth.recoverUsername('new_player', recoveryCode, 'another-password')).rejects.toThrow('Invalid');
    await expect(api.auth.signIn('new_player', 'password123')).rejects.toThrow('Invalid');
    await api.auth.signIn('new_player', 'replacement');
    expect((await api.auth.me()).id).toBe(id);
    expect(replacement.recoveryCode).not.toBe(recoveryCode);
  });

  it("has a sample player with a username: Jordan, who also keeps their email", async () => {
    const api = createDemoBackend();
    await api.auth.signIn(DEMO_USERNAME_LOGIN.username, DEMO_PLAYER_LOGIN.password);
    expect(await api.auth.me()).toMatchObject({ username: 'jordan', email: DEMO_PLAYER_LOGIN.email, role: 'user' });
    await api.auth.signOut();
    const { recoveryCode } = await api.auth.recoverUsername('jordan', DEMO_USERNAME_LOGIN.recoveryCode, 'replacement');
    expect(recoveryCode).not.toBe(DEMO_USERNAME_LOGIN.recoveryCode);
    expect((await api.auth.me()).email).toBe(DEMO_PLAYER_LOGIN.email);
  });
});
