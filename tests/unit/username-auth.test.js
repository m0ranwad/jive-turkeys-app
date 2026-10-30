import { describe, expect, it, vi } from 'vitest';
import { handleUsernameAuth } from '../../supabase/functions/_shared/username-auth.js';
import { recoveryHash } from '@/lib/username';

function setup() {
  const users = [{ id: 'google-player', email: 'player@example.test', password: 'old-password', joined_team_at: '2026-10-01' }];
  const aliases = [];
  const limits = new Map();
  const admin = {
    rpc: vi.fn(async (name, p) => {
      if (name === 'username_auth_attempt') {
        const count = (limits.get(p.p_key) || 0) + 1;
        limits.set(p.p_key, count);
        return { data: count <= p.p_limit };
      }
      const row = aliases.find((a) => a.username === p.p_username && a.recovery_hash === p.p_hash);
      if (row) row.recovery_hash = p.p_new_hash;
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
      getUser: vi.fn(async (token) => ({ data: { user: token === 'valid' ? users[0] : null } })),
      admin: {
        createUser: vi.fn(async (values) => {
          const user = { ...values, id: crypto.randomUUID() };
          users.push(user);
          return { data: { user } };
        }),
        getUserById: vi.fn(async (id) => ({ data: { user: users.find((u) => u.id === id) } })),
        updateUserById: vi.fn(async (id, values) => { Object.assign(users.find((u) => u.id === id), values); return {}; }),
        deleteUser: vi.fn(async (id) => { users.splice(users.findIndex((u) => u.id === id), 1); return {}; }),
      },
    },
  };
  const signIn = vi.fn(async ({ email, password }) => users.some((u) => u.email === email && u.password === password)
    ? { data: { session: { access_token: 'access', refresh_token: 'refresh', user: { email: 'internal' } } } }
    : { error: { message: 'Invalid login credentials' } });
  const request = async (body, token = '') => {
    const res = await handleUsernameAuth(new Request('https://example.test', {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': '192.0.2.1' }, body: JSON.stringify(body),
    }), { admin, createAuthClient: () => ({ auth: { signInWithPassword: signIn } }) });
    return { status: res.status, body: await res.json(), headers: res.headers };
  };
  const signup = (patch = {}) => request({ action: 'signup', username: 'new_player', password: 'password123', teamCode: 'TURKEY', ...patch });
  return { admin, aliases, users, request, signup, signIn };
}

describe('username account service', () => {
  it('requires the team code before creating an ordinary, email-free account', async () => {
    const s = setup();
    expect((await s.signup({ teamCode: 'wrong' })).status).toBe(400);
    expect(s.admin.auth.admin.createUser).not.toHaveBeenCalled();
    const result = await s.signup({ username: ' NEW_PLAYER ', teamCode: ' turkey ' });
    expect(result.status).toBe(200);
    expect(result.body.username).toBe('new_player');
    expect(result.body.session).toEqual({ access_token: 'access', refresh_token: 'refresh' });
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
    const body = { action: 'link', username: 'google_alias', password: 'new-password', user_id: 'someone-else' };
    expect((await s.request(body)).status).toBe(401);
    s.users[0].joined_team_at = null;
    expect((await s.request(body, 'valid')).status).toBe(403);
    s.users[0].joined_team_at = '2026-10-01';
    expect((await s.request(body, 'valid')).status).toBe(200);
    expect(s.aliases[0].user_id).toBe('google-player');
    expect(s.users).toHaveLength(1);
    expect(s.users[0]).toMatchObject({ email: 'player@example.test', password: 'new-password' });
    expect(s.admin.auth.admin.createUser).not.toHaveBeenCalled();
    expect((await s.request({ action: 'signin', username: 'google_alias', password: 'new-password' })).status).toBe(200);
  });

  it('will not replace an existing username or change its password on a collision', async () => {
    const s = setup();
    await s.signup();
    expect((await s.request({ action: 'link', username: 'new_player', password: 'changed' }, 'valid')).status).toBe(409);
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
    expect(s.users).toHaveLength(2);
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
    const original = await s.request({ action: 'link', username: 'google_alias', password: 'linked-password' }, 'valid');
    const body = { action: 'rotate', username: 'google_alias', password: 'linked-password' };
    expect((await s.request(body)).status).toBe(401);
    expect((await s.request({ ...body, password: 'incorrect' }, 'valid')).status).toBe(400);
    expect(s.aliases[0].recovery_hash).toBe(await recoveryHash(original.body.recoveryCode));
    const rotated = await s.request(body, 'valid');
    expect(rotated.status).toBe(200);
    expect(s.aliases[0].recovery_hash).toBe(await recoveryHash(rotated.body.recoveryCode));
    expect(rotated.body.recoveryCode).not.toBe(original.body.recoveryCode);
  });
});
