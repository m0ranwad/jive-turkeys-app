// Dependency-injected so the same handler is tested without a live account.
import {
  INTERNAL_EMAIL_DOMAIN, makeRecoveryCode, normalizeRecoveryCode, normalizeUsername, recoveryHash, usernameProblem,
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
const sessionTokens = (session) => ({ access_token: session.access_token, refresh_token: session.refresh_token });
// A Google-only account has no password to confirm, so adding one needs a sign-in this recent instead.
const RECENT_SIGN_IN_SECONDS = 10 * 60;

// The caller's address. Cloudflare, in front of Supabase, sets cf-connecting-ip
// itself. Otherwise the first X-Forwarded-For entry is the original client;
// later entries are proxies the request passed through.
export function clientIp(req) {
  const forwarded = (req.headers.get('x-forwarded-for') || '').split(',')[0];
  return (req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || forwarded).trim() || null;
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

// Signs the player in with their new password and ends every other session, so
// whoever had the old password is signed out too. Never throws: the password
// and code have already changed, and the player still needs the new code.
async function signInAlone({ admin, createAuthClient }, email, password) {
  try {
    const { data, error } = await createAuthClient().auth.signInWithPassword({ email, password });
    if (error || !data?.session) throw error || new Error('No session');
    const { error: signOutError } = await admin.auth.admin.signOut(data.session.access_token, 'others');
    if (signOutError) console.error('username-auth: could not end other sessions after a reset', signOutError.message);
    return sessionTokens(data.session);
  } catch (error) {
    console.error('username-auth: could not sign in after a reset; other sessions are still open', error?.message);
    return null;
  }
}

// Undoes a half-made signup. Logged if it fails, since an account without a username would be left over.
async function removeAccount(admin, id) {
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) console.error('username-auth: could not remove a half-made account', id, error.message);
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
    if (!['signup', 'signin', 'recover', 'link', 'rotate'].includes(action)) return reply(400, { error: 'Invalid request.' });
    const username = normalizeUsername(body.username);
    if (usernameProblem(username)) return reply(400, { error: usernameProblem(username) });
    const password = body.password;
    if (typeof password !== 'string' || password.length < 6 || password.length > 256) {
      return reply(400, { error: 'Use a password between 6 and 256 characters.' });
    }

    // Counters are keyed by hashes, never raw addresses, usernames or IDs.
    const allow = async (limit, name, ...parts) => {
      const p_key = `${name}:${await recoveryHash(parts.join(':'))}`;
      const { data, error } = await admin.rpc('username_auth_attempt', { p_key, p_limit: limit });
      if (error) throw error;
      return data === true;
    };
    const ip = clientIp(req);
    // Without an address every request shares one counter, so the logs should show it.
    if (!ip) console.warn('username-auth: no client address on the request');
    const from = ip || 'unknown';
    if (!await allow(60, 'ip', from)) return tooMany();

    if (action === 'signin') {
      // Per address first, so wrong guesses from elsewhere can't lock a player
      // out on their own phone. The per-username ceiling bounds guesses spread
      // over many addresses; recovery has no such limit, so a player can always get back in.
      if (!await allow(10, 'signin', username, from) || !await allow(50, 'signin', username)) return tooMany();
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

    const recoveryCode = makeRecoveryCode();
    const hash = await recoveryHash(recoveryCode);
    if (action === 'rotate') {
      const me = await caller(req, admin);
      if (!me) return reply(401, { error: 'Sign in to your existing account first.' });
      if (!await allow(10, 'rotate', me.user.id)) return tooMany();
      const { data: alias, error: aliasError } = await admin.from('username_accounts').select('user_id').eq('username', username).maybeSingle();
      if (aliasError) throw aliasError;
      if (alias?.user_id !== me.user.id) return invalid();
      if (!await passwordMatches(deps, me.user.email, password)) return invalid();
      const { error } = await admin.from('username_accounts').update({ recovery_hash: hash }).eq('user_id', me.user.id);
      if (error) throw error;
      return reply(200, { recoveryCode });
    }
    if (action === 'recover') {
      // Only the per-address limit: nobody can guess a 128-bit code, and a
      // per-username one would let anyone lock a player out of recovery.
      if (!/^[a-f0-9]{32}$/.test(normalizeRecoveryCode(body.recoveryCode))) {
        return reply(400, { error: 'Invalid username or recovery code.' });
      }
      const oldHash = await recoveryHash(body.recoveryCode);
      const { data: userId, error } = await admin.rpc('claim_username_recovery', {
        p_username: username, p_hash: oldHash, p_new_hash: hash,
      });
      if (error) throw error;
      if (!userId) return reply(400, { error: 'Invalid username or recovery code.' });
      const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(userId, { password });
      if (updateError) {
        // Restore only our own claim; never overwrite another rotation.
        const { error: restoreError } = await admin.from('username_accounts').update({ recovery_hash: oldHash })
          .eq('user_id', userId).eq('recovery_hash', hash);
        if (restoreError) throw restoreError;
        throw updateError;
      }
      return reply(200, { recoveryCode, session: await signInAlone(deps, updated.user.email, password) });
    }

    let user;
    if (action === 'link') {
      const me = await caller(req, admin);
      if (!me) return reply(401, { error: 'Sign in to your existing account first.' });
      if (!await allow(10, 'link', me.user.id)) return tooMany();
      const { data: member, error: memberError } = await admin.from('users').select('joined_team_at, role').eq('id', me.user.id).single();
      if (memberError) throw memberError;
      if (!member.joined_team_at && member.role !== 'admin') return reply(403, { error: 'Join the team first.' });
      // This sets the account's password, so the owner proves it's them: with
      // the current password, or for a Google-only account, a fresh sign-in.
      if (hasPassword(me.user)) {
        if (typeof body.currentPassword !== 'string' || !body.currentPassword) {
          return reply(400, { error: 'Enter your current password.' });
        }
        if (!await passwordMatches(deps, me.user.email, body.currentPassword)) {
          return reply(400, { error: 'Your current password is not right.' });
        }
      } else if (!signedInWithin(me.token, RECENT_SIGN_IN_SECONDS)) {
        return reply(401, { error: 'For your security, sign out and sign back in with Google, then add your username.' });
      }
      user = me.user;
    } else {
      if (!await allow(5, 'signup', username) || !await allow(10, 'signup-ip', from)) return tooMany();
      const teamCode = String(body.teamCode || '');
      const { data: codeMatches, error: codeError } = await admin.rpc('team_code_matches', { p_code: teamCode });
      if (codeError) throw codeError;
      if (!codeMatches) return wrongTeamCode();
      const { data: existing, error: existingError } = await admin.from('username_accounts').select('user_id').eq('username', username).maybeSingle();
      if (existingError) throw existingError;
      if (existing) return reply(409, { error: 'That username is taken. Choose another or log in.' });
      // Supabase manages the password and session. This random, undeliverable
      // internal identifier is never presented as the player's contact email.
      const { data, error } = await admin.auth.admin.createUser({
        email: `${crypto.randomUUID()}@${INTERNAL_EMAIL_DOMAIN}`, password, email_confirm: true,
      });
      if (error || !data?.user) throw error || new Error('Account creation failed');
      user = data.user;
    }

    const { error: aliasError } = await admin.from('username_accounts').insert({ user_id: user.id, username, recovery_hash: hash });
    if (aliasError) {
      if (action === 'signup') await removeAccount(admin, user.id);
      if (aliasError.code === '23505') return reply(409, { error: 'That username is taken, or your account already has a username.' });
      throw aliasError;
    }
    if (action === 'link') {
      const { error } = await admin.auth.admin.updateUserById(user.id, { password });
      if (error) {
        await admin.from('username_accounts').delete().eq('user_id', user.id);
        throw error;
      }
      return reply(200, { recoveryCode, username });
    }
    // The same joining join_team() does when a player enters the code on the site.
    const { data: joined, error: joinError } = await admin.rpc('join_team_as', { p_user: user.id, p_code: String(body.teamCode || '') });
    if (joinError || joined !== 'joined') {
      await removeAccount(admin, user.id);
      if (joinError) throw joinError;
      return wrongTeamCode();
    }
    const { data, error } = await createAuthClient().auth.signInWithPassword({ email: user.email, password });
    if (error) console.error('username-auth: new account could not sign in yet', error.message);
    // Account exists even if session creation is temporarily unavailable. Give
    // them their recovery code and let them sign in again without creating a duplicate.
    return reply(200, { recoveryCode, username, session: !error && data?.session ? sessionTokens(data.session) : null });
  } catch (error) {
    // For the function's logs: what failed, never what the player typed.
    console.error('username-auth failed', action, error?.status ?? '', error?.code ?? '', error?.message ?? error);
    return failure(error);
  }
}
