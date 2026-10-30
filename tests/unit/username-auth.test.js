import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clientIp, handleUsernameAuth } from '../../supabase/functions/_shared/username-auth.js';
import { RESET_CLAIM_TIMEOUT_MS, RESET_IN_PROGRESS, resetCodeHash } from '@/lib/username';

// A session token whose latest sign-in was `secondsAgo` (only its claims are read).
const token = (secondsAgo) => `h.${btoa(JSON.stringify({ amr: [{ method: 'oauth', timestamp: Math.floor(Date.now() / 1000) - secondsAgo }] }))}.s`;
const FRESH_GOOGLE = token(60);
const STALE_GOOGLE = token(60 * 60);

function setup() {
  // Auth accounts and their public.users rows, kept together.
  const users = [
    { id: 'email-player', email: 'player@example.test', password: 'old-password', role: 'user', joined_team_at: '2026-10-01', app_metadata: { providers: ['email'] } },
    { id: 'google-player', email: 'google@example.test', role: 'user', joined_team_at: '2026-10-01', app_metadata: { providers: ['google'] } },
    { id: 'captain', email: 'captain@example.test', password: 'captain-pass', role: 'admin', joined_team_at: '2026-10-01', app_metadata: { providers: ['email'] } },
  ];
  const tokens = { valid: 'email-player', captain: 'captain', [FRESH_GOOGLE]: 'google-player', [STALE_GOOGLE]: 'google-player' };
  const aliases = [];
  const limits = new Map();
  const team = { code: 'TURKEY' };
  const activeClaim = (a) => a.reset_claim_id && new Date(a.reset_claimed_at).getTime() > Date.now() - RESET_CLAIM_TIMEOUT_MS;
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
      if (name === 'username_reset_claim') {
        const a = aliases.find((row) => row.username === p.p_username && row.reset_hash === p.p_hash
          && new Date(row.reset_expires_at) > new Date() && !activeClaim(row));
        if (!a) return { data: null };
        Object.assign(a, { reset_claim_id: p.p_claim, reset_claimed_at: new Date().toISOString() });
        return { data: a.user_id };
      }
      if (name === 'username_reset_release') {
        const a = aliases.find((row) => row.user_id === p.p_user && row.reset_claim_id === p.p_claim);
        if (a) Object.assign(a, { reset_claim_id: null, reset_claimed_at: null });
        return { data: null };
      }
      if (name === 'username_reset_issue') {
        const captain = users.find((u) => u.id === p.p_captain);
        if (captain?.role !== 'admin' || captain.removed_at) return { data: 'forbidden' };
        const a = aliases.find((row) => row.user_id === p.p_user);
        if (!a) return { data: 'missing' };
        if (activeClaim(a)) return { data: 'busy' };
        Object.assign(a, { reset_hash: p.p_hash, reset_expires_at: p.p_expires_at, reset_by: p.p_captain,
          reset_claim_id: null, reset_claimed_at: null });
        return { data: 'issued' };
      }
      throw new Error(`unexpected rpc ${name}`);
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
          const rows = table === 'username_accounts' ? aliases : table === 'users' ? users : [];
          const matches = rows.filter((r) => filters.every(([k, v]) => r[k] === v));
          if (op === 'insert') {
            if (rows.some((a) => a.username === values.username || a.user_id === values.user_id)) return { error: { code: '23505' } };
            rows.push({ reset_hash: null, reset_expires_at: null, reset_claim_id: null, reset_claimed_at: null, ...values });
          }
          if (op === 'update') matches.forEach((r) => Object.assign(r, values));
          if (op === 'delete') matches.forEach((r) => rows.splice(rows.indexOf(r), 1));
          return { data: matches[0] || null };
        }).then(resolve, reject),
      };
      return q;
    },
    auth: {
      getUser: vi.fn(async (t) => ({ data: { user: users.find((u) => u.id === tokens[t]) || null } })),
      admin: {
        createUser: vi.fn(async (values) => {
          const user = { ...values, id: crypto.randomUUID(), role: 'user', joined_team_at: null, app_metadata: { providers: ['email'] } };
          users.push(user);
          return { data: { user } };
        }),
        getUserById: vi.fn(async (id) => ({ data: { user: users.find((u) => u.id === id) } })),
        updateUserById: vi.fn(async (id, values) => {
          const user = users.find((u) => u.id === id);
          const claim = values.app_metadata?.jt_username_reset_claim;
          if (claim) {
            // Stand-in for the deferred Auth trigger; real transaction behavior
            // and Auth's password-before-metadata order are checked in SQL.
            const a = aliases.find((row) => row.user_id === id && row.reset_claim_id === claim
              && activeClaim(row) && new Date(row.reset_expires_at) > new Date());
            if (!a) return { error: { status: 409, message: 'This reset is no longer current.' } };
            Object.assign(a, { reset_hash: null, reset_expires_at: null, reset_claim_id: null, reset_claimed_at: null });
          }
          const metadata = { ...user.app_metadata, ...values.app_metadata };
          delete metadata.jt_username_reset_claim;
          Object.assign(user, values, { app_metadata: metadata });
          return { data: { user } };
        }),
        deleteUser: vi.fn(async (id) => { users.splice(users.findIndex((u) => u.id === id), 1); return {}; }),
        signOut: vi.fn(async () => ({ data: null, error: null })),
      },
    },
  };
  let sessions = 0;
  const signIn = vi.fn(async ({ email, password }) => users.some((u) => u.email === email && u.password === password)
    ? { data: { session: { access_token: `access-${++sessions}`, refresh_token: 'refresh' } } }
    : { error: { message: 'Invalid login credentials', status: 400, code: 'invalid_credentials' } });
  const request = async (body, t = '', headers = { 'x-forwarded-for': '192.0.2.1' }) => {
    const res = await handleUsernameAuth(new Request('https://example.test', {
      method: 'POST', headers: { authorization: `Bearer ${t}`, ...headers }, body: JSON.stringify(body),
    }), { admin, createAuthClient: () => ({ auth: { signInWithPassword: signIn } }) });
    return { status: res.status, body: await res.json(), headers: res.headers };
  };
  const signup = (patch = {}, headers) => request({ action: 'signup', username: 'new_player', password: 'password123', teamCode: 'TURKEY', ...patch }, '', headers);
  const link = (patch = {}, t = 'valid') => request({ action: 'link', username: 'my_alias', password: 'old-password', ...patch }, t);
  const issue = (userId, t = 'captain') => request({ action: 'issue-reset', userId }, t);
  const reset = (patch = {}, headers) => request({ action: 'reset', username: 'new_player', password: 'fresh-password', ...patch }, '', headers);
  const signin = (username, password, headers) => request({ action: 'signin', username, password }, '', headers);
  const newPlayer = () => users.find((u) => u.id === aliases.find((a) => a.username === 'new_player')?.user_id);
  return { admin, aliases, users, team, request, signup, link, issue, reset, signin, signIn, newPlayer };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('signing up with a username', () => {
  it('requires the team code before creating an ordinary, email-free account, and signs the player in', async () => {
    const s = setup();
    expect((await s.signup({ teamCode: 'wrong' })).status).toBe(400);
    expect(s.admin.auth.admin.createUser).not.toHaveBeenCalled();
    const result = await s.signup({ username: ' NEW_PLAYER ', teamCode: ' turkey ' });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ username: 'new_player', session: { access_token: 'access-1', refresh_token: 'refresh' } });
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(s.newPlayer().email).toMatch(/@players\.jiveturkeys\.invalid$/);
    expect(s.newPlayer().joined_team_at).toBeTruthy();
  });

  it('allows dots and dashes, rejects taken and invalid usernames, and suggests a fix for spaces', async () => {
    const s = setup();
    expect((await s.signup({ username: 'josh.smith' })).status).toBe(200);
    expect((await s.signup({ username: 'josh-s' })).status).toBe(200);
    expect((await s.signup({ username: 'Josh.Smith' })).status).toBe(409);
    expect((await s.signup({ username: 'Josh Smith' })).body.error).toBe("Usernames can't have spaces or symbols. How about josh_smith?");
    expect((await s.signup({ username: 'js' })).body.error).toMatch(/at least 3/);
    expect(s.admin.auth.admin.createUser).toHaveBeenCalledTimes(2);
  });

  it('lets a whole team sign up together on the same Wi-Fi', async () => {
    const s = setup();
    for (let i = 0; i < 25; i++) expect((await s.signup({ username: `player${i}` })).status).toBe(200);
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
    expect(s.users).toHaveLength(3);
    expect(s.admin.rpc).toHaveBeenCalledWith('join_team_as', expect.objectContaining({ p_code: 'TURKEY' }));
  });

  it('still creates the account if signing in right after fails', async () => {
    const s = setup();
    s.signIn.mockResolvedValueOnce({ error: { message: 'temporarily unavailable', status: 503 } });
    const result = await s.signup();
    expect(result).toMatchObject({ status: 200, body: { session: null, username: 'new_player' } });
    expect(s.aliases).toHaveLength(1);
  });
});

describe('signing in with a username', () => {
  it('ignores capitals and spaces, and gives the same error for a missing username, a wrong password or a name', async () => {
    const s = setup();
    await s.signup();
    expect((await s.signin(' NEW_PLAYER ', 'password123')).status).toBe(200);
    const wrong = await s.signin('new_player', 'incorrect');
    expect(wrong).toMatchObject({ status: 400, body: { error: 'Invalid username or password.' } });
    expect((await s.signin('missing', 'incorrect')).body).toEqual(wrong.body);
    expect((await s.signin('New Player', 'password123')).body).toEqual(wrong.body);
  });

  it("doesn't let wrong guesses from elsewhere lock a player out", async () => {
    const s = setup();
    await s.signup();
    const attacker = { 'x-forwarded-for': '198.51.100.7' };
    for (let i = 0; i < 10; i++) await s.signin('new_player', 'guess-123', attacker);
    expect((await s.signin('new_player', 'guess-123', attacker)).status).toBe(429);
    expect((await s.signin('new_player', 'password123')).status).toBe(200);
  });

  it('caps guesses at one username spread over many addresses', async () => {
    const s = setup();
    await s.signup();
    const from = (n) => ({ 'x-forwarded-for': `203.0.113.${n}` });
    for (let i = 0; i < 50; i++) await s.signin('new_player', 'guess-123', from(i % 25));
    expect((await s.signin('new_player', 'password123', from(99))).status).toBe(429);
  });

  it('fails closed when the counter is unavailable', async () => {
    const s = setup();
    s.admin.rpc.mockResolvedValueOnce({ error: { message: 'database unavailable' } });
    expect((await s.signin('anyone', 'password123')).status).toBe(503);
  });
});

describe('adding a username to a Google or email account', () => {
  it('requires a session and membership, and ignores a caller-supplied user ID', async () => {
    const s = setup();
    expect((await s.link({ user_id: 'someone-else' }, '')).status).toBe(401);
    s.users[0].joined_team_at = null;
    expect((await s.link()).status).toBe(403);
    s.users[0].joined_team_at = '2026-10-01';
    expect((await s.link({ user_id: 'someone-else' })).status).toBe(200);
    expect(s.aliases[0].user_id).toBe('email-player');
    expect(s.admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it('keeps an email player on the password they already have', async () => {
    const s = setup();
    expect(await s.link({ password: 'guess-123' })).toMatchObject({ status: 400, body: { error: "That isn't your password." } });
    expect(s.aliases).toHaveLength(0);
    const linked = await s.link();
    expect(linked).toMatchObject({ status: 200, body: { username: 'my_alias' } });
    expect(linked.body.session).toBeUndefined();
    expect(s.admin.auth.admin.updateUserById).not.toHaveBeenCalled();
    // The check's own session is ended straight away.
    expect(s.admin.auth.admin.signOut).toHaveBeenCalledWith('access-1', 'local');
    expect((await s.signin('my_alias', 'old-password')).status).toBe(200);
  });

  it('lets a Google-only player choose a password soon after signing in, and signs them back in', async () => {
    const s = setup();
    const stale = await s.link({ password: 'new-password' }, STALE_GOOGLE);
    expect(stale.status).toBe(401);
    expect(stale.body.error).toMatch(/sign back in with Google/);
    expect(s.users[1].password).toBeUndefined();
    const linked = await s.link({ password: 'new-password' }, FRESH_GOOGLE);
    expect(linked.body.session).toEqual({ access_token: 'access-1', refresh_token: 'refresh' });
    expect(s.users[1].password).toBe('new-password');
    expect(s.aliases[0].user_id).toBe('google-player');
  });

  it('will not take a username that is already used', async () => {
    const s = setup();
    await s.signup();
    expect((await s.link({ username: 'new_player' })).status).toBe(409);
    expect(s.aliases).toHaveLength(1);
  });
});

describe('a captain resetting a password', () => {
  it('only captains can make a reset code, only for players with a username', async () => {
    const s = setup();
    await s.signup();
    const id = s.newPlayer().id;
    expect((await s.issue(id, '')).status).toBe(401);
    expect((await s.issue(id, 'valid')).status).toBe(403);
    expect((await s.issue('google-player')).status).toBe(404);
    const made = await s.issue(id);
    expect(made.status).toBe(200);
    expect(made.body.username).toBe('new_player');
    expect(made.body.code).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    expect(new Date(made.body.expiresAt) - Date.now()).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(s.aliases[0]).toMatchObject({ reset_hash: await resetCodeHash(made.body.code), reset_by: 'captain' });
    expect(JSON.stringify(made.body)).not.toContain(s.aliases[0].reset_hash);
  });

  it('a player sets a new password with the code, is signed in, and the code works only once', async () => {
    const s = setup();
    await s.signup();
    const { code } = (await s.issue(s.newPlayer().id)).body;
    expect((await s.reset({ code: 'ABCD-EFGH' })).body.error).toMatch(/Ask a captain for a new one/);
    expect(s.newPlayer().password).toBe('password123');
    const done = await s.reset({ code: code.toLowerCase().replace('-', ' '), username: 'New_Player' });
    expect(done.status).toBe(200);
    expect(done.body.session).toEqual({ access_token: 'access-2', refresh_token: 'refresh' });
    expect(s.newPlayer().password).toBe('fresh-password');
    expect(s.admin.auth.admin.signOut).toHaveBeenCalledWith('access-2', 'others');
    expect((await s.reset({ code, password: 'another-one' })).status).toBe(400);
    expect(s.newPlayer().password).toBe('fresh-password');
  });

  it("a code runs out after a day, and a new one replaces the old", async () => {
    const s = setup();
    await s.signup();
    const first = (await s.issue(s.newPlayer().id)).body.code;
    const second = (await s.issue(s.newPlayer().id)).body.code;
    expect((await s.reset({ code: first })).status).toBe(400);
    s.aliases[0].reset_expires_at = new Date(Date.now() - 1000).toISOString();
    expect((await s.reset({ code: second })).status).toBe(400);
    expect(s.newPlayer().password).toBe('password123');
  });

  it("keeps the code if Supabase turns down the new password, so the player can pick another", async () => {
    const s = setup();
    await s.signup();
    const { code } = (await s.issue(s.newPlayer().id)).body;
    s.admin.auth.admin.updateUserById.mockResolvedValueOnce({
      error: { name: 'AuthWeakPasswordError', status: 422, code: 'weak_password', message: 'Password should be at least 8 characters.' },
    });
    expect(await s.reset({ code, password: 'short1' })).toMatchObject({ status: 400, body: { error: 'Password should be at least 8 characters.' } });
    expect((await s.reset({ code, password: 'longer-password' })).status).toBe(200);
  });

  it('limits guesses at a code', async () => {
    const s = setup();
    await s.signup();
    await s.issue(s.newPlayer().id);
    for (let i = 0; i < 10; i++) await s.reset({ code: 'ABCD-EFGH' });
    expect((await s.reset({ code: 'ABCD-EFGH' })).status).toBe(429);
  });

  // Hold the Auth call after claiming the code, as a slow network request would.
  const pauseAuth = (s) => {
    let resume, arrived;
    const gate = new Promise((resolve) => { resume = resolve; });
    const entered = new Promise((resolve) => { arrived = resolve; });
    const update = s.admin.auth.admin.updateUserById.getMockImplementation();
    s.admin.auth.admin.updateUserById.mockImplementationOnce(async (...args) => {
      arrived();
      await gate;
      return update(...args);
    });
    return { resume, entered };
  };

  it('allows only one concurrent reset to change the password', async () => {
    const s = setup();
    await s.signup();
    const { code } = (await s.issue(s.newPlayer().id)).body;
    const paused = pauseAuth(s);
    const first = s.reset({ code, password: 'first-password' });
    await paused.entered;
    const second = await s.reset({ code, password: 'second-password' });
    paused.resume();
    expect((await first).status).toBe(200);
    expect(second.status).toBe(400);
    expect(s.admin.auth.admin.updateUserById).toHaveBeenCalledTimes(1);
    expect(s.newPlayer().password).toBe('first-password');
    expect(s.newPlayer().app_metadata.providers).toEqual(['email']);
    expect(s.newPlayer().app_metadata.jt_username_reset_claim).toBeUndefined();
  });

  it('asks the captain to retry while a reset is finishing, then allows a new code', async () => {
    const s = setup();
    await s.signup();
    const id = s.newPlayer().id;
    const { code } = (await s.issue(id)).body;
    const paused = pauseAuth(s);
    const resetting = s.reset({ code });
    await paused.entered;
    const busy = await s.issue(id);
    const stored = s.aliases[0].reset_hash;
    paused.resume();
    expect((await resetting).status).toBe(200);
    expect(busy).toMatchObject({ status: 409, body: { error: RESET_IN_PROGRESS } });
    expect(stored).toBe(await resetCodeHash(code));
    expect((await s.issue(id)).status).toBe(200);
  });

  it('fences an old stalled Auth request after its claim expires and a newer reset finishes', async () => {
    const s = setup();
    await s.signup();
    const { code } = (await s.issue(s.newPlayer().id)).body;
    const paused = pauseAuth(s);
    const old = s.reset({ code, password: 'stale-password' });
    await paused.entered;
    s.aliases[0].reset_claimed_at = new Date(Date.now() - RESET_CLAIM_TIMEOUT_MS - 1000).toISOString();
    const replacement = (await s.issue(s.newPlayer().id)).body.code;
    const fresh = await s.reset({ code: replacement, password: 'newer-password' });
    paused.resume();
    const stale = await old;
    expect(fresh.status).toBe(200);
    expect(stale.status).not.toBe(200);
    expect(s.newPlayer().password).toBe('newer-password');
    expect((await s.reset({ code: replacement })).status).toBe(400);
  });

  it('keeps a completed reset one-time even when the Auth reply is lost', async () => {
    const s = setup();
    await s.signup();
    const { code } = (await s.issue(s.newPlayer().id)).body;
    const update = s.admin.auth.admin.updateUserById.getMockImplementation();
    s.admin.auth.admin.updateUserById.mockImplementationOnce(async (...args) => {
      await update(...args);
      throw new TypeError('Failed to fetch');
    });
    expect((await s.reset({ code })).status).toBe(503);
    expect(s.newPlayer().password).toBe('fresh-password');
    expect((await s.reset({ code, password: 'another-password' })).status).toBe(400);
    expect(s.aliases[0].reset_hash).toBeNull();
  });

  it('does not rely on a later cleanup write to make the code one-time', async () => {
    const s = setup();
    await s.signup();
    const { code } = (await s.issue(s.newPlayer().id)).body;
    const from = s.admin.from;
    s.admin.from = (table) => {
      const q = from(table);
      const update = q.update;
      q.update = (values) => {
        if (table !== 'username_accounts' || values.reset_hash !== null) return update(values);
        const failed = { eq: () => failed, then: (resolve) => Promise.resolve({ error: { message: 'write unavailable' } }).then(resolve) };
        return failed;
      };
      return q;
    };
    expect((await s.reset({ code })).status).toBe(200);
    expect((await s.reset({ code, password: 'another-password' })).status).toBe(400);
    expect(s.newPlayer().password).toBe('fresh-password');
  });

  it('can retry a refused password after a failed claim release times out', async () => {
    const s = setup();
    await s.signup();
    const { code } = (await s.issue(s.newPlayer().id)).body;
    const rpc = s.admin.rpc.getMockImplementation();
    s.admin.rpc.mockImplementation((name, params) => name === 'username_reset_release'
      ? Promise.resolve({ error: { message: 'database unavailable' } }) : rpc(name, params));
    s.admin.auth.admin.updateUserById.mockResolvedValueOnce({ error: { status: 422, code: 'weak_password', message: 'Choose a stronger password.' } });
    expect((await s.reset({ code })).body.error).toBe('Choose a stronger password.');
    expect(s.aliases[0].reset_hash).toBe(await resetCodeHash(code));
    s.aliases[0].reset_claimed_at = new Date(Date.now() - RESET_CLAIM_TIMEOUT_MS - 1000).toISOString();
    s.admin.rpc.mockImplementation(rpc);
    expect((await s.reset({ code, password: 'stronger-password' })).status).toBe(200);
  });

  it('does not update a password if claiming the code is unavailable', async () => {
    const s = setup();
    await s.signup();
    const { code } = (await s.issue(s.newPlayer().id)).body;
    const rpc = s.admin.rpc.getMockImplementation();
    s.admin.rpc.mockImplementation((name, params) => name === 'username_reset_claim'
      ? Promise.resolve({ error: { message: 'database unavailable' } }) : rpc(name, params));
    expect((await s.reset({ code })).status).toBe(503);
    expect(s.admin.auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(s.newPlayer().password).toBe('password123');
  });
});

describe('the account service', () => {
  it('finds the caller from the address the platform saw', () => {
    const req = (headers) => new Request('https://example.test', { headers });
    expect(clientIp(req({ 'cf-connecting-ip': '192.0.2.9', 'x-forwarded-for': '10.0.0.1' }))).toBe('192.0.2.9');
    expect(clientIp(req({ 'x-forwarded-for': '192.0.2.1, 10.0.0.1, 172.70.1.1' }))).toBe('192.0.2.1');
    expect(clientIp(req({ 'x-real-ip': '10.0.0.9', 'x-forwarded-for': '192.0.2.1, 10.0.0.1' }))).toBe('192.0.2.1');
    expect(clientIp(req({ 'cf-connecting-ip': ' ', 'x-forwarded-for': ' 192.0.2.1 , 10.0.0.1' }))).toBe('192.0.2.1');
    expect(clientIp(req({ 'x-real-ip': '10.0.0.9' }))).toBeNull();
    expect(clientIp(req({}))).toBeNull();
  });

  it('shares one counter when there is no address, and says so in the logs', async () => {
    const s = setup();
    expect((await s.signin('missing', 'guess-123', {})).status).toBe(400);
    expect(console.warn).toHaveBeenCalledWith('username-auth: no client address on the request');
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
  });

  it('logs unexpected failures and asks the player to try again', async () => {
    const s = setup();
    s.admin.rpc.mockResolvedValueOnce({ error: { message: 'connection refused' } });
    expect((await s.signup()).status).toBe(503);
    expect(console.error).toHaveBeenCalledWith('username-auth failed', 'signup', '', '', 'connection refused');
  });

  it('turns away actions it no longer has', async () => {
    const s = setup();
    expect((await s.request({ action: 'recover', username: 'new_player', password: 'password123' })).status).toBe(400);
    expect((await s.request({ action: 'rotate', username: 'new_player', password: 'password123' }, 'valid')).status).toBe(400);
  });
});
