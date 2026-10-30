import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clientIp, handleUsernameAuth } from '../../supabase/functions/_shared/username-auth.js';
import { recoveryHash } from '@/lib/username';

// A session token whose latest sign-in was `secondsAgo` (only its claims are read).
const token = (secondsAgo) => `h.${btoa(JSON.stringify({ amr: [{ method: 'oauth', timestamp: Math.floor(Date.now() / 1000) - secondsAgo }] }))}.s`;
const FRESH_GOOGLE = token(60);
const STALE_GOOGLE = token(60 * 60);

function setup() {
  const users = [
    { id: 'email-player', email: 'player@example.test', password: 'old-password', joined_team_at: '2026-10-01', app_metadata: { providers: ['email'] } },
    { id: 'google-player', email: 'google@example.test', joined_team_at: '2026-10-01', app_metadata: { providers: ['google'] } },
  ];
  const aliases = [];
  const limits = new Map();
  const team = { code: 'TURKEY' };
  const sameCode = (code) => String(code).trim().toLowerCase() === team.code.toLowerCase();
  const admin = {
    rpc: vi.fn(async (name, p) => {
      if (name === 'username_auth_attempt') {
        const count = (limits.get(p.p_key) || 0) + 1;
        limits.set(p.p_key, count);
        return { data: count <= p.p_limit };
      }
      if (name === 'team_code_matches') return { data: sameCode(p.p_code) };
      if (name === 'join_team_as') {
        if (!sameCode(p.p_code)) return { data: 'wrong' };
        users.find((u) => u.id === p.p_user).joined_team_at = '2026-10-30';
        return { data: 'joined' };
      }
      if (name === 'replace_username_recovery') {
        const row = aliases.find((a) => a.user_id === p.p_user && a.recovery_hash === p.p_hash
          && !(a.reset_at > Date.now() - 10 * 60 * 1000));
        if (row) row.recovery_hash = p.p_new_hash;
        return { data: !!row };
      }
      const row = aliases.find((a) => a.username === p.p_username && a.recovery_hash === p.p_hash);
      if (row) Object.assign(row, { recovery_hash: p.p_new_hash, reset_at: Date.now() });
      return { data: row?.user_id || null };
    }),
    from: (table) => {
      let op = 'read';
      let values;
      const filters = [];
      const q = {
        select: () => q,
        eq: (key, value) => { filters.push([key, value]); return q; },
        maybeSingle: () => q,
        single: () => q,
        insert: (v) => { op = 'insert'; values = v; return q; },
        update: (v) => { op = 'update'; values = v; return q; },
        delete: () => { op = 'delete'; return q; },
        then: (resolve, reject) => Promise.resolve().then(() => {
          const rows = table === 'username_accounts' ? aliases : table === 'users' ? users : [{ code: 'TURKEY' }];
          const matches = rows.filter((r) => filters.every(([k, v]) => r[k] === v));
          if (op === 'insert') {
            if (rows.some((a) => a.username === values.username || a.user_id === values.user_id)) return { error: { code: '23505' } };
            rows.push({ ...values });
          }
          if (op === 'update') matches.forEach((r) => Object.assign(r, values));
          if (op === 'delete') matches.forEach((r) => rows.splice(rows.indexOf(r), 1));
          return { data: matches[0] || null };
        }).then(resolve, reject),
      };
      return q;
    },
    auth: {
      getUser: vi.fn(async (t) => ({
        data: { user: t === 'valid' ? users[0] : t === FRESH_GOOGLE || t === STALE_GOOGLE ? users[1] : null },
      })),
      admin: {
        createUser: vi.fn(async (values) => {
          const user = { ...values, id: crypto.randomUUID(), joined_team_at: null, app_metadata: { providers: ['email'] } };
          users.push(user);
          return { data: { user } };
        }),
        getUserById: vi.fn(async (id) => ({ data: { user: users.find((u) => u.id === id) } })),
        updateUserById: vi.fn(async (id, values) => {
          const user = users.find((u) => u.id === id);
          Object.assign(user, values);
          return { data: { user } };
        }),
        deleteUser: vi.fn(async (id) => { users.splice(users.findIndex((u) => u.id === id), 1); return {}; }),
        signOut: vi.fn(async () => ({ data: null, error: null })),
      },
    },
  };
  let sessions = 0;
  const signIn = vi.fn(async ({ email, password }) => users.some((u) => u.email === email && u.password === password)
    ? { data: { session: { access_token: `access-${++sessions}`, refresh_token: 'refresh', user: { email: 'internal' } } } }
    : { error: { message: 'Invalid login credentials', status: 400, code: 'invalid_credentials' } });
  const request = async (body, t = '', headers = { 'x-forwarded-for': '192.0.2.1' }) => {
    const res = await handleUsernameAuth(new Request('https://example.test', {
      method: 'POST', headers: { authorization: `Bearer ${t}`, ...headers }, body: JSON.stringify(body),
    }), { admin, createAuthClient: () => ({ auth: { signInWithPassword: signIn } }) });
    return { status: res.status, body: await res.json(), headers: res.headers };
  };
  const signup = (patch = {}) => request({ action: 'signup', username: 'new_player', password: 'password123', teamCode: 'TURKEY', ...patch });
  const link = (patch = {}, t = 'valid') => request({ action: 'link', username: 'my_alias', password: 'new-password', currentPassword: 'old-password', ...patch }, t);
  return { admin, aliases, users, team, limits, request, signup, link, signIn };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('username account service', () => {
  it('requires the team code before creating an ordinary, email-free account', async () => {
    const s = setup();
    expect((await s.signup({ teamCode: 'wrong' })).status).toBe(400);
    expect(s.admin.auth.admin.createUser).not.toHaveBeenCalled();
    const result = await s.signup({ username: ' NEW_PLAYER ', teamCode: ' turkey ' });
    expect(result.status).toBe(200);
    expect(result.body.username).toBe('new_player');
    expect(result.body.session).toEqual({ access_token: 'access-1', refresh_token: 'refresh' });
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(s.users.at(-1).email).toMatch(/@players\.jiveturkeys\.invalid$/);
    expect(s.users.at(-1).joined_team_at).toBeTruthy();
    expect(s.aliases[0].recovery_hash).toBe(await recoveryHash(result.body.recoveryCode));
    expect(JSON.stringify(result.body)).not.toContain(s.aliases[0].recovery_hash);
    expect(JSON.stringify(result.body)).not.toContain('email');
  });

  it('signs in case-insensitively and gives the same error for a missing username or wrong password', async () => {
    const s = setup();
    await s.signup();
    const correct = await s.request({ action: 'signin', username: 'NEW_PLAYER', password: 'password123' });
    expect(correct.status).toBe(200);
    const wrong = await s.request({ action: 'signin', username: 'new_player', password: 'incorrect' });
    const missing = await s.request({ action: 'signin', username: 'missing', password: 'incorrect' });
    expect(wrong).toMatchObject({ status: 400, body: missing.body });
    expect(s.signIn).toHaveBeenCalledTimes(4);
  });

  it('rejects duplicate and invalid usernames without creating more identities', async () => {
    const s = setup();
    await s.signup();
    expect((await s.signup()).status).toBe(409);
    expect((await s.signup({ username: 'a@b.test' })).status).toBe(400);
    expect(s.admin.auth.admin.createUser).toHaveBeenCalledTimes(1);
  });

  it('requires a valid session and membership to add an alias, and ignores a caller-supplied user ID', async () => {
    const s = setup();
    const body = { action: 'link', username: 'google_alias', password: 'new-password', currentPassword: 'old-password', user_id: 'someone-else' };
    expect((await s.request(body)).status).toBe(401);
    s.users[0].joined_team_at = null;
    expect((await s.request(body, 'valid')).status).toBe(403);
    s.users[0].joined_team_at = '2026-10-01';
    expect((await s.request(body, 'valid')).status).toBe(200);
    expect(s.aliases[0].user_id).toBe('email-player');
    expect(s.users).toHaveLength(2);
    expect(s.users[0]).toMatchObject({ email: 'player@example.test', password: 'new-password' });
    expect(s.admin.auth.admin.createUser).not.toHaveBeenCalled();
    expect((await s.request({ action: 'signin', username: 'google_alias', password: 'new-password' })).status).toBe(200);
  });

  it('will not replace an existing username or change its password on a collision', async () => {
    const s = setup();
    await s.signup();
    expect((await s.link({ username: 'new_player', password: 'changed' })).status).toBe(409);
    expect(s.users[0].password).toBe('old-password');
  });

  it('recovers the same account, rotates the code once, and rejects wrong and reused codes', async () => {
    const s = setup();
    const original = await s.signup();
    const body = { action: 'recover', username: 'new_player', password: 'replacement', recoveryCode: original.body.recoveryCode };
    expect((await s.request({ ...body, recoveryCode: '0000'.repeat(8) })).status).toBe(400);
    expect(s.users.at(-1).password).toBe('password123');
    const reset = await s.request(body);
    expect(reset.status).toBe(200);
    expect(reset.body.recoveryCode).not.toBe(original.body.recoveryCode);
    expect(s.users).toHaveLength(3);
    expect(s.users.at(-1).password).toBe('replacement');
    expect((await s.request(body)).status).toBe(400);
  });

  it('restores the recovery code if the password service fails', async () => {
    const s = setup();
    const original = await s.signup();
    s.admin.auth.admin.updateUserById.mockResolvedValueOnce({ error: { message: 'offline' } });
    const body = { action: 'recover', username: 'new_player', password: 'replacement', recoveryCode: original.body.recoveryCode };
    expect((await s.request(body)).status).toBe(503);
    expect(s.aliases[0].recovery_hash).toBe(await recoveryHash(original.body.recoveryCode));
    expect((await s.request(body)).status).toBe(200);
  });

  it('limits guessing even for a nonexistent account, and fails closed when the counter is unavailable', async () => {
    const s = setup();
    const body = { action: 'signin', username: 'missing', password: 'incorrect' };
    for (let i = 0; i < 10; i++) expect((await s.request(body)).status).toBe(400);
    expect((await s.request(body)).status).toBe(429);
    s.admin.rpc.mockResolvedValueOnce({ error: { message: 'database unavailable' } });
    expect((await s.request({ ...body, username: 'another' })).status).toBe(503);
  });

  it('keeps the recovery code available if initial sign-in fails after account creation', async () => {
    const s = setup();
    s.signIn.mockResolvedValueOnce({ error: { message: 'temporarily unavailable' } });
    const result = await s.signup();
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ session: null, username: 'new_player' });
    expect(result.body.recoveryCode).toBeTruthy();
    expect(s.aliases).toHaveLength(1);
  });

  it('replaces a lost code only for the signed-in owner after password verification', async () => {
    const s = setup();
    const original = await s.link({ username: 'google_alias', password: 'linked-password' });
    const body = { action: 'rotate', username: 'google_alias', password: 'linked-password' };
    expect((await s.request(body)).status).toBe(401);
    expect((await s.request({ ...body, password: 'incorrect' }, 'valid')).status).toBe(400);
    expect(s.aliases[0].recovery_hash).toBe(await recoveryHash(original.body.recoveryCode));
    const rotated = await s.request(body, 'valid');
    expect(rotated.status).toBe(200);
    expect(s.aliases[0].recovery_hash).toBe(await recoveryHash(rotated.body.recoveryCode));
    expect(rotated.body.recoveryCode).not.toBe(original.body.recoveryCode);
  });
  it('asks an email/password player for their current password before setting a new one', async () => {
    const s = setup();
    expect(await s.link({ currentPassword: '' })).toMatchObject({ status: 400, body: { error: 'Enter your current password.' } });
    expect(await s.link({ currentPassword: 'guess-123' })).toMatchObject({ status: 400, body: { error: 'Your current password is not right.' } });
    expect(s.users[0].password).toBe('old-password');
    expect(s.aliases).toHaveLength(0);
    expect((await s.link()).status).toBe(200);
    expect(s.users[0].password).toBe('new-password');
    // The check's own session is ended straight away.
    expect(s.admin.auth.admin.signOut).toHaveBeenCalledWith('access-1', 'local');
  });

  it('lets a Google-only player add a password only soon after signing in', async () => {
    const s = setup();
    const stale = await s.link({ currentPassword: undefined }, STALE_GOOGLE);
    expect(stale.status).toBe(401);
    expect(stale.body.error).toMatch(/sign back in with Google/);
    expect(s.users[1].password).toBeUndefined();
    expect((await s.link({ currentPassword: undefined }, FRESH_GOOGLE)).status).toBe(200);
    expect(s.users[1].password).toBe('new-password');
    expect(s.aliases[0].user_id).toBe('google-player');
  });

  it('signs the player in after a reset and ends every other session', async () => {
    const s = setup();
    const original = await s.signup();
    const reset = await s.request({ action: 'recover', username: 'new_player', password: 'replacement', recoveryCode: original.body.recoveryCode });
    expect(reset.body.session).toEqual({ access_token: 'access-2', refresh_token: 'refresh' });
    expect(s.admin.auth.admin.signOut).toHaveBeenCalledWith('access-2', 'others');
  });

  it('still hands over the new code if signing in after a reset fails', async () => {
    const s = setup();
    const original = await s.signup();
    s.signIn.mockResolvedValueOnce({ error: { message: 'unavailable', status: 503 } });
    const reset = await s.request({ action: 'recover', username: 'new_player', password: 'replacement', recoveryCode: original.body.recoveryCode });
    expect(reset.status).toBe(200);
    expect(reset.body).toMatchObject({ session: null });
    expect(s.aliases[0].recovery_hash).toBe(await recoveryHash(reset.body.recoveryCode));
    expect(console.error).toHaveBeenCalled();
  });

  it('ends the session it opened to check the password when replacing a code', async () => {
    const s = setup();
    await s.link({ username: 'my_alias', password: 'linked-password' });
    s.admin.auth.admin.signOut.mockClear();
    expect((await s.request({ action: 'rotate', username: 'my_alias', password: 'linked-password' }, 'valid')).status).toBe(200);
    expect(s.admin.auth.admin.signOut).toHaveBeenCalledTimes(1);
    expect(s.admin.auth.admin.signOut.mock.calls[0][1]).toBe('local');
  });

  it("doesn't let wrong guesses from elsewhere lock a player out", async () => {
    const s = setup();
    const original = await s.signup();
    const attacker = { 'x-forwarded-for': '198.51.100.7' };
    for (let i = 0; i < 10; i++) await s.request({ action: 'signin', username: 'new_player', password: 'guess-123' }, '', attacker);
    expect((await s.request({ action: 'signin', username: 'new_player', password: 'guess-123' }, '', attacker)).status).toBe(429);
    for (let i = 0; i < 12; i++) {
      await s.request({ action: 'recover', username: 'new_player', password: 'guess-pass', recoveryCode: 'f'.repeat(32) }, '', attacker);
    }
    expect((await s.request({ action: 'signin', username: 'new_player', password: 'password123' })).status).toBe(200);
    const reset = await s.request({ action: 'recover', username: 'new_player', password: 'replacement', recoveryCode: original.body.recoveryCode });
    expect(reset.status).toBe(200);
  });

  it('caps guesses at one username spread over many addresses', async () => {
    const s = setup();
    await s.signup();
    const from = (n) => ({ 'x-forwarded-for': `203.0.113.${n}` });
    for (let i = 0; i < 50; i++) await s.request({ action: 'signin', username: 'new_player', password: 'guess-123' }, '', from(i % 25));
    expect((await s.request({ action: 'signin', username: 'new_player', password: 'password123' }, '', from(99))).status).toBe(429);
  });

  it('finds the caller from the address the platform saw', () => {
    const req = (headers) => new Request('https://example.test', { headers });
    expect(clientIp(req({ 'cf-connecting-ip': '192.0.2.9', 'x-forwarded-for': '10.0.0.1' }))).toBe('192.0.2.9');
    expect(clientIp(req({ 'x-forwarded-for': '192.0.2.1, 10.0.0.1, 172.70.1.1' }))).toBe('192.0.2.1');
    expect(clientIp(req({}))).toBeNull();
  });

  it('shares one counter when there is no address, and says so in the logs', async () => {
    const s = setup();
    expect((await s.request({ action: 'signin', username: 'missing', password: 'guess-123' }, '', {})).status).toBe(400);
    expect(console.warn).toHaveBeenCalledWith('username-auth: no client address on the request');
  });

  it('joins new accounts through the database, and undoes the account if the code changed meanwhile', async () => {
    const s = setup();
    s.admin.rpc.mockImplementationOnce(async () => ({ data: true })); // address limit
    s.admin.rpc.mockImplementationOnce(async () => ({ data: true })); // username signup limit
    s.admin.rpc.mockImplementationOnce(async () => ({ data: true })); // address signup limit
    s.admin.rpc.mockImplementationOnce(async () => ({ data: true })); // the code matched...
    s.team.code = 'NEWCODE'; // ...then a captain changed it
    expect((await s.signup()).body.error).toMatch(/team code is not right/);
    expect(s.admin.auth.admin.createUser).toHaveBeenCalledTimes(1);
    expect(s.users).toHaveLength(2);
    expect(s.admin.rpc).toHaveBeenCalledWith('join_team_as', expect.objectContaining({ p_code: 'TURKEY' }));
  });

  it("passes Supabase's password rules on to the player", async () => {
    const s = setup();
    s.admin.auth.admin.createUser.mockResolvedValueOnce({
      error: { name: 'AuthWeakPasswordError', status: 422, code: 'weak_password', message: 'Password should be at least 8 characters.' },
    });
    expect(await s.signup()).toMatchObject({ status: 400, body: { error: 'Password should be at least 8 characters.' } });
    expect(console.error).toHaveBeenCalledWith('username-auth failed', 'signup', 422, 'weak_password', 'Password should be at least 8 characters.');
  });

  it("says when trying again won't help, without quoting the internal address", async () => {
    const s = setup();
    s.admin.auth.admin.createUser.mockImplementationOnce(async ({ email }) => ({
      error: { name: 'AuthApiError', status: 400, code: 'email_address_invalid', message: `Email address "${email}" is invalid` },
    }));
    const result = await s.signup();
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/trying again won't fix it/);
    expect(result.body.error).not.toMatch(/invalid"|@/);
    expect(console.error).toHaveBeenCalled();
  });

  it('logs unexpected failures and asks the player to try again', async () => {
    const s = setup();
    s.admin.rpc.mockResolvedValueOnce({ error: { message: 'connection refused' } });
    expect((await s.signup()).status).toBe(503);
    expect(console.error).toHaveBeenCalledWith('username-auth failed', 'signup', '', '', 'connection refused');
  });
  it("a code replacement checked before a reset can't undo the reset", async () => {
    const s = setup();
    const linked = await s.link({ password: 'linked-password' });
    let reset;
    s.signIn.mockImplementationOnce(async () => {
      // The reset lands while the replacement is still checking the old password.
      reset = await s.request({ action: 'recover', username: 'my_alias', password: 'reset-password', recoveryCode: linked.body.recoveryCode });
      return { data: { session: { access_token: 'checked-before-the-reset', refresh_token: 'refresh' } } };
    });
    const late = await s.request({ action: 'rotate', username: 'my_alias', password: 'linked-password' }, 'valid');
    expect(reset.status).toBe(200);
    expect(late.status).toBe(409);
    expect(late.body).not.toHaveProperty('recoveryCode');
    expect(s.aliases[0].recovery_hash).toBe(await recoveryHash(reset.body.recoveryCode));
  });

  it('waits 10 minutes after a reset before replacing the code', async () => {
    const s = setup();
    const linked = await s.link({ password: 'linked-password' });
    await s.request({ action: 'recover', username: 'my_alias', password: 'reset-password', recoveryCode: linked.body.recoveryCode });
    const rotate = { action: 'rotate', username: 'my_alias', password: 'reset-password' };
    expect((await s.request(rotate, 'valid')).body.error).toMatch(/try again in 10 minutes/);
    s.aliases[0].reset_at = Date.now() - 11 * 60 * 1000;
    expect((await s.request(rotate, 'valid')).status).toBe(200);
  });

  it('signs the player back in after adding a username, since setting a password signs them out', async () => {
    const s = setup();
    const linked = await s.link();
    expect(linked.body.session).toEqual({ access_token: 'access-2', refresh_token: 'refresh' });
    expect(s.signIn).toHaveBeenLastCalledWith({ email: 'player@example.test', password: 'new-password' });
  });
});
