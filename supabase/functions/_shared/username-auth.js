// Dependency-injected so the same handler is tested without a live account.
import {
  INTERNAL_EMAIL_DOMAIN, RESET_CODE_USED, RESET_IN_PROGRESS, WRONG_RESET_CODE,
  isResetCode, makeResetCode, normalizeUsername, resetCodeHash, sha256Hex, usernameProblem,
} from './username.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const invalid = () => reply(400, { error: 'Invalid username or password.' });
const tooMany = () => reply(429, { error: 'Too many tries. Please try again in 15 minutes.' });
const wrongTeamCode = () => reply(400, { error: 'That team code is not right. Ask a captain for the code.' });
const wrongResetCode = () => reply(400, { error: WRONG_RESET_CODE });
const resetBusy = () => reply(409, { error: RESET_IN_PROGRESS });
const signInFirst = () => reply(401, { error: 'Sign in to your existing account first.' });
const sessionTokens = (session) => ({ access_token: session.access_token, refresh_token: session.refresh_token });
const passwordProblem = (password) => typeof password !== 'string' || password.length < 6 || password.length > 256
  ? 'Use a password between 6 and 256 characters.'
  : '';
// A Google-only account has no password to confirm, so adding one needs a sign-in this recent instead.
const RECENT_SIGN_IN_SECONDS = 10 * 60;
// How long a captain's reset code works: long enough to reach a player who's at work.
const RESET_CODE_HOURS = 24;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The caller's address. Cloudflare, in front of Supabase, sets cf-connecting-ip
// itself. Otherwise the first X-Forwarded-For entry is the original client
// (later entries are proxies the request passed through), then X-Real-IP.
// A caller can fake those two, so sign-in, resets and signup also have limits
// that don't depend on the address.
export function clientIp(req) {
  const header = (name) => (req.headers.get(name) || '').trim();
  return header('cf-connecting-ip') || header('x-forwarded-for').split(',')[0].trim() || header('x-real-ip') || null;
}

// Supabase Auth turning down an email/password pair, as opposed to being down or busy.
const wrongPassword = (error) => error.status === 400 || error.code === 'invalid_credentials';

// Accounts with a password have an 'email' identity (username accounts too); Google-only ones don't.
const hasPassword = (user) => (user.app_metadata?.providers || []).includes('email')
  || (user.identities || []).some((identity) => identity.provider === 'email');

// Whether the session's latest sign-in was recent. The token was just checked by getUser.
function signedInWithin(token, seconds) {
  try {
    const claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    const latest = Math.max(...(claims.amr || []).map((method) => Number(method.timestamp) || 0));
    return Date.now() / 1000 - latest <= seconds;
  } catch {
    return false;
  }
}

async function caller(req, admin) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const { data, error } = await admin.auth.getUser(token);
  return error || !data?.user ? null : { user: data.user, token };
}

// Checks a password without leaving a new session behind.
async function passwordMatches({ admin, createAuthClient }, email, password) {
  const { data, error } = await createAuthClient().auth.signInWithPassword({ email, password });
  if (error) {
    if (wrongPassword(error)) return false;
    throw error;
  }
  const { error: signOutError } = await admin.auth.admin.signOut(data.session.access_token, 'local');
  if (signOutError) console.error('username-auth: could not end a password-check session', signOutError.message);
  return true;
}

// After a password change, which ends all of the account's sessions (the
// player's own too), signs them back in with the new password. Ending any
// other session again is a safeguard, in case Supabase ever stops doing that
// itself. Never throws: the password has already changed.
async function signInAlone({ admin, createAuthClient }, email, password) {
  try {
    const { data, error } = await createAuthClient().auth.signInWithPassword({ email, password });
    if (error || !data?.session) throw error || new Error('No session');
    const { error: signOutError } = await admin.auth.admin.signOut(data.session.access_token, 'others');
    if (signOutError) console.error('username-auth: could not end other sessions after a password change', signOutError.message);
    return sessionTokens(data.session);
  } catch (error) {
    console.error('username-auth: could not sign in after a password change', error?.message);
    return null;
  }
}

// Undoes a half-made signup. Logged if it fails, since an account without a username would be left over.
async function removeAccount(admin, id) {
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) console.error('username-auth: could not remove a half-made account', id, error.message);
}

// Calls a database function whose failure is only logged: the outcome the
// player sees doesn't depend on it. Returns its result, or null if it failed.
async function tryRpc(admin, name, params, problem) {
  try {
    const { data, error } = await admin.rpc(name, params);
    if (error) throw error;
    return data;
  } catch (error) {
    console.error(`username-auth: ${problem}`, error?.message);
    return null;
  }
}

// What the player sees when something throws. Supabase Auth's password rules are
// passed on; its other refusals can quote the internal address, so they aren't.
function failure(error) {
  if (error?.code === 'weak_password') return reply(400, { error: error.message || 'Choose a stronger password.' });
  if (error?.status === 429) return reply(429, { error: 'Too many tries right now. Please try again in a few minutes.' });
  if (typeof error?.status === 'number' && error.status >= 400 && error.status < 500) {
    return reply(400, { error: "That didn't work, and trying again won't fix it. Use Google or email for now, and let a captain know." });
  }
  return reply(503, { error: 'Account sign-in is unavailable right now. Please try again shortly.' });
}

export async function handleUsernameAuth(req, deps) {
  const { admin, createAuthClient } = deps;
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed.' });
  let action;
  try {
    const raw = await req.text();
    if (raw.length > 8192) return reply(413, { error: 'Request too large.' });
    let body;
    try { body = JSON.parse(raw); } catch { return reply(400, { error: 'Invalid request.' }); }
    if (!body || typeof body !== 'object') return reply(400, { error: 'Invalid request.' });
    action = body.action;
    if (!['signup', 'signin', 'link', 'issue-reset', 'reset'].includes(action)) return reply(400, { error: 'Invalid request.' });
    const username = normalizeUsername(body.username);
    const password = body.password;

    // Counters are keyed by hashes, never raw addresses, usernames or IDs.
    const allow = async (limit, name, ...parts) => {
      const p_key = `${name}:${await sha256Hex(parts.join(':'))}`;
      const { data, error } = await admin.rpc('username_auth_attempt', { p_key, p_limit: limit });
      if (error) throw error;
      return data === true;
    };
    const ip = clientIp(req);
    // Without an address every request shares one counter, so the logs should show it.
    if (!ip) console.warn('username-auth: no client address on the request');
    const from = ip || 'unknown';
    // Generous: a whole team signing up on the same gym Wi-Fi shares one address.
    if (!await allow(300, 'ip', from)) return tooMany();

    if (action === 'signin') {
      // Per address first, so wrong guesses from elsewhere can't lock a player
      // out on their own phone. The per-username ceiling bounds guesses spread
      // over many addresses.
      if (!await allow(10, 'signin', username, from) || !await allow(50, 'signin', username)) return tooMany();
      if (usernameProblem(username) || passwordProblem(password)) return invalid();
      const { data: alias, error: aliasError } = await admin.from('username_accounts').select('user_id').eq('username', username).maybeSingle();
      if (aliasError) throw aliasError;
      // Missing usernames still go through password verification, with the
      // same outward error. Never reveal an account's email to a caller.
      const lookup = alias ? await admin.auth.admin.getUserById(alias.user_id) : null;
      if (lookup?.error) throw lookup.error;
      const email = lookup?.data?.user?.email || `unknown@${INTERNAL_EMAIL_DOMAIN}`;
      const { data, error } = await createAuthClient().auth.signInWithPassword({ email, password });
      if (error && !wrongPassword(error)) throw error;
      if (error || !alias || !data?.session) return invalid();
      return reply(200, { session: sessionTokens(data.session) });
    }

    if (action === 'issue-reset') {
      // A captain makes a one-time code for a teammate who forgot their password.
      const me = await caller(req, admin);
      if (!me) return signInFirst();
      if (!await allow(30, 'issue-reset', me.user.id)) return tooMany();
      const playerId = UUID.test(String(body.userId)) ? body.userId : null;
      const code = makeResetCode();
      const expiresAt = new Date(Date.now() + RESET_CODE_HOURS * 60 * 60 * 1000).toISOString();
      // The database checks the captain and the player's username, and shares
      // its lock with claiming a code, so a reset in progress isn't replaced.
      const { data: issued, error } = await admin.rpc('username_reset_issue', {
        p_user: playerId, p_captain: me.user.id, p_hash: await resetCodeHash(code), p_expires_at: expiresAt,
      });
      if (error) throw error;
      if (issued?.status === 'busy') return resetBusy();
      if (issued?.status === 'forbidden') return reply(403, { error: 'Only captains can reset passwords.' });
      if (issued?.status === 'missing') return reply(404, { error: "This player doesn't sign in with a username." });
      if (issued?.status !== 'issued') throw new Error('Reset code was not issued');
      return reply(200, { code, username: issued.username, expiresAt });
    }

    if (action === 'reset') {
      if (!await allow(10, 'reset', username, from) || !await allow(50, 'reset', username)) return tooMany();
      if (passwordProblem(password)) return reply(400, { error: passwordProblem(password) });
      if (usernameProblem(username) || !isResetCode(body.code)) return wrongResetCode();
      const hash = await resetCodeHash(body.code);
      const claim = crypto.randomUUID();
      const { data: claimed, error: claimError } = await admin.rpc('username_reset_claim', {
        p_username: username, p_hash: hash, p_claim: claim,
      });
      if (claimError) throw claimError;
      // A right code another reset is using works again in a moment.
      if (claimed?.status === 'busy') return resetBusy();
      if (claimed?.status !== 'claimed') return wrongResetCode();
      const userId = claimed.user_id;
      let updated;
      try {
        const { data, error } = await admin.auth.admin.updateUserById(userId, {
          password, app_metadata: { jt_username_reset_claim: claim },
        });
        if (error) throw error;
        if (!data?.user) throw new Error('Password update returned no account');
        updated = data;
        // The Auth transaction consumes the code together with its password
        // change. There is no separate cleanup write that could leave it usable.
      } catch (error) {
        // A refused password keeps its code. If Auth committed but its reply
        // was lost, the code is already used, and releasing cannot restore it.
        // The player hears what became of the code, not "try again", when a
        // retry can't work.
        const outcome = await tryRpc(admin, 'username_reset_release', { p_user: userId, p_claim: claim, p_hash: hash },
          'could not release a failed reset; its claim will expire');
        if (outcome === 'used') return reply(400, { error: RESET_CODE_USED });
        if (outcome === 'replaced') return wrongResetCode();
        if (outcome === 'busy') return resetBusy();
        throw error;
      }
      // Normally a no-op: covers an Auth version that saves the claim marker separately.
      await tryRpc(admin, 'username_reset_finish', { p_user: userId, p_claim: claim }, 'could not finish a reset');
      return reply(200, { session: await signInAlone(deps, updated.user.email, password) });
    }

    if (usernameProblem(username)) return reply(400, { error: usernameProblem(username) });
    if (passwordProblem(password)) return reply(400, { error: passwordProblem(password) });

    if (action === 'link') {
      const me = await caller(req, admin);
      if (!me) return signInFirst();
      if (!await allow(10, 'link', me.user.id)) return tooMany();
      const { data: member, error: memberError } = await admin.from('users').select('joined_team_at, role').eq('id', me.user.id).single();
      if (memberError) throw memberError;
      if (!member.joined_team_at && member.role !== 'admin') return reply(403, { error: 'Join the team first.' });
      // Email/password players sign in with the password they already have, so
      // it only has to be right. Google-only players are choosing one, which
      // needs a fresh sign-in to show it's really them.
      const keepsPassword = hasPassword(me.user);
      if (keepsPassword) {
        if (!await passwordMatches(deps, me.user.email, password)) return reply(400, { error: "That isn't your password." });
      } else if (!signedInWithin(me.token, RECENT_SIGN_IN_SECONDS)) {
        return reply(401, { error: 'For your security, sign out and sign back in with Google, then add your username.' });
      }
      const { error: aliasError } = await admin.from('username_accounts').insert({ user_id: me.user.id, username });
      if (aliasError) {
        if (aliasError.code === '23505') return reply(409, { error: 'That username is taken, or your account already has one.' });
        throw aliasError;
      }
      if (keepsPassword) return reply(200, { username });
      const { error } = await admin.auth.admin.updateUserById(me.user.id, { password });
      if (error) {
        await admin.from('username_accounts').delete().eq('user_id', me.user.id);
        throw error;
      }
      // Setting the password signed the player out, so hand them a new session.
      return reply(200, { username, session: await signInAlone(deps, me.user.email, password) });
    }

    // Signup. The team-wide ceiling holds even if the address is faked, so the
    // team code can't be guessed by trying new usernames from new addresses.
    if (!await allow(5, 'signup', username) || !await allow(40, 'signup-ip', from)
      || !await allow(100, 'signup-team')) return tooMany();
    const teamCode = String(body.teamCode || '');
    const { data: codeMatches, error: codeError } = await admin.rpc('team_code_matches', { p_code: teamCode });
    if (codeError) throw codeError;
    if (!codeMatches) return wrongTeamCode();
    const { data: existing, error: existingError } = await admin.from('username_accounts').select('user_id').eq('username', username).maybeSingle();
    if (existingError) throw existingError;
    if (existing) return reply(409, { error: 'That username is taken. Choose another or log in.' });
    // Supabase manages the password and session. This random, undeliverable
    // internal identifier is never presented as the player's contact email.
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: `${crypto.randomUUID()}@${INTERNAL_EMAIL_DOMAIN}`, password, email_confirm: true,
    });
    if (createError || !created?.user) throw createError || new Error('Account creation failed');
    const user = created.user;
    const { error: aliasError } = await admin.from('username_accounts').insert({ user_id: user.id, username });
    if (aliasError) {
      await removeAccount(admin, user.id);
      if (aliasError.code === '23505') return reply(409, { error: 'That username is taken. Choose another or log in.' });
      throw aliasError;
    }
    // The same joining join_team() does when a player enters the code on the site.
    const { data: joined, error: joinError } = await admin.rpc('join_team_as', { p_user: user.id, p_code: teamCode });
    if (joinError || joined !== 'joined') {
      await removeAccount(admin, user.id);
      if (joinError) throw joinError;
      return wrongTeamCode();
    }
    const { data, error } = await createAuthClient().auth.signInWithPassword({ email: user.email, password });
    if (error) console.error('username-auth: new account could not sign in yet', error.message);
    // The account exists even if signing in failed just now; the player can log in.
    return reply(200, { username, session: !error && data?.session ? sessionTokens(data.session) : null });
  } catch (error) {
    // For the function's logs: what failed, never what the player typed.
    console.error('username-auth failed', action, error?.status ?? '', error?.code ?? '', error?.message ?? error);
    return failure(error);
  }
}
