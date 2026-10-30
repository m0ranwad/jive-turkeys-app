// Dependency-injected so the same handler is tested without a live account.
import { makeRecoveryCode, normalizeRecoveryCode, normalizeUsername, recoveryHash, usernameProblem } from './username.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const invalid = () => reply(400, { error: 'Invalid username or password.' });
const sessionTokens = (session) => ({ access_token: session.access_token, refresh_token: session.refresh_token });

export async function handleUsernameAuth(req, { admin, createAuthClient }) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed.' });
  try {
    const raw = await req.text();
    if (raw.length > 8192) return reply(413, { error: 'Request too large.' });
    let body;
    try { body = JSON.parse(raw); } catch { return reply(400, { error: 'Invalid request.' }); }
    if (!body || typeof body !== 'object') return reply(400, { error: 'Invalid request.' });
    const { action } = body;
    if (!['signup', 'signin', 'recover', 'link', 'rotate'].includes(action)) return reply(400, { error: 'Invalid request.' });
    const username = normalizeUsername(body.username);
    if (usernameProblem(username)) return reply(400, { error: usernameProblem(username) });
    const password = body.password;
    if (typeof password !== 'string' || password.length < 6 || password.length > 256) {
      return reply(400, { error: 'Use a password between 6 and 256 characters.' });
    }

    // The gateway appends the connecting IP. Using the last address avoids a
    // caller-supplied X-Forwarded-For prefix bypassing this additional limit.
    const ip = (req.headers.get('x-forwarded-for') || 'unknown').split(',').at(-1).trim();
    const allow = async (key, limit) => {
      const { data, error } = await admin.rpc('username_auth_attempt', { p_key: key, p_limit: limit });
      if (error) throw error;
      return data === true;
    };
    if (!await allow(`ip:${await recoveryHash(ip)}`, 60) ||
        !await allow(`${action}:${await recoveryHash(username)}`, action === 'signup' ? 5 : 10)) {
      return reply(429, { error: 'Too many tries. Please try again in 15 minutes.' });
    }

    if (action === 'signin') {
      const { data: alias, error: aliasError } = await admin.from('username_accounts').select('user_id').eq('username', username).maybeSingle();
      if (aliasError) throw aliasError;
      // Missing usernames still go through password verification, with the
      // same outward error. Never reveal an account's email to a caller.
      const lookup = alias ? await admin.auth.admin.getUserById(alias.user_id) : null;
      if (lookup?.error) throw lookup.error;
      const email = lookup?.data?.user?.email || 'unknown@players.jiveturkeys.invalid';
      const { data, error } = await createAuthClient().auth.signInWithPassword({ email, password });
      if (error || !alias || !data?.session) return invalid();
      return reply(200, { session: sessionTokens(data.session) });
    }

    const recoveryCode = makeRecoveryCode();
    const hash = await recoveryHash(recoveryCode);
    if (action === 'rotate') {
      const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
      const { data: caller, error: authError } = await admin.auth.getUser(token);
      if (authError || !caller?.user) return reply(401, { error: 'Sign in to your existing account first.' });
      const { data: alias, error: aliasError } = await admin.from('username_accounts').select('user_id').eq('username', username).maybeSingle();
      if (aliasError) throw aliasError;
      if (alias?.user_id !== caller.user.id) return invalid();
      const { error: passwordError } = await createAuthClient().auth.signInWithPassword({ email: caller.user.email, password });
      if (passwordError) return invalid();
      const { error } = await admin.from('username_accounts').update({ recovery_hash: hash }).eq('user_id', caller.user.id);
      if (error) throw error;
      return reply(200, { recoveryCode });
    }
    if (action === 'recover') {
      if (!/^[a-f0-9]{32}$/.test(normalizeRecoveryCode(body.recoveryCode))) {
        return reply(400, { error: 'Invalid username or recovery code.' });
      }
      const oldHash = await recoveryHash(body.recoveryCode);
      const { data: userId, error } = await admin.rpc('claim_username_recovery', {
        p_username: username, p_hash: oldHash, p_new_hash: hash,
      });
      if (error) throw error;
      if (!userId) return reply(400, { error: 'Invalid username or recovery code.' });
      const { error: updateError } = await admin.auth.admin.updateUserById(userId, { password });
      if (updateError) {
        // Restore only our own claim; never overwrite another rotation.
        const { error: restoreError } = await admin.from('username_accounts').update({ recovery_hash: oldHash })
          .eq('user_id', userId).eq('recovery_hash', hash);
        if (restoreError) throw restoreError;
        throw updateError;
      }
      return reply(200, { recoveryCode });
    }

    let user;
    if (action === 'link') {
      const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
      const { data, error } = await admin.auth.getUser(token);
      if (error || !data?.user) return reply(401, { error: 'Sign in to your existing account first.' });
      user = data.user;
      const { data: member, error: memberError } = await admin.from('users').select('joined_team_at, role').eq('id', user.id).single();
      if (memberError) throw memberError;
      if (!member.joined_team_at && member.role !== 'admin') return reply(403, { error: 'Join the team first.' });
    } else {
      if (!await allow(`signup-ip:${await recoveryHash(ip)}`, 10)) {
        return reply(429, { error: 'Too many tries. Please try again in 15 minutes.' });
      }
      const { data: team, error: codeError } = await admin.from('team_join_code').select('code').single();
      if (codeError) throw codeError;
      if (!body.teamCode || String(body.teamCode).trim().toLowerCase() !== team.code.trim().toLowerCase()) {
        return reply(400, { error: 'That team code is not right. Ask a captain for the code.' });
      }
      const { data: existing, error: existingError } = await admin.from('username_accounts').select('user_id').eq('username', username).maybeSingle();
      if (existingError) throw existingError;
      if (existing) return reply(409, { error: 'That username is taken. Choose another or log in.' });
      // Supabase manages the password and session. This random, undeliverable
      // internal identifier is never presented as the player's contact email.
      const { data, error } = await admin.auth.admin.createUser({
        email: `${crypto.randomUUID()}@players.jiveturkeys.invalid`, password, email_confirm: true,
      });
      if (error || !data?.user) throw error || new Error('Account creation failed');
      user = data.user;
    }

    const { error: aliasError } = await admin.from('username_accounts').insert({ user_id: user.id, username, recovery_hash: hash });
    if (aliasError) {
      if (action === 'signup') await admin.auth.admin.deleteUser(user.id);
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
    const { error: joinError } = await admin.from('users').update({ joined_team_at: new Date().toISOString() }).eq('id', user.id);
    if (joinError) { await admin.auth.admin.deleteUser(user.id); throw joinError; }
    const { data, error } = await createAuthClient().auth.signInWithPassword({ email: user.email, password });
    // Account exists even if session creation is temporarily unavailable. Give
    // them their recovery code and let them sign in again without creating a duplicate.
    return reply(200, { recoveryCode, username, session: !error && data?.session ? sessionTokens(data.session) : null });
  } catch {
    return reply(503, { error: 'Account sign-in is unavailable right now. Please try again shortly.' });
  }
}
