import { createClient } from '@supabase/supabase-js';
import { JOIN_ERRORS } from '@/lib/team-code';
import { TABLES, parseSort } from './tables';

const PAGE_SIZE = 1000;

// Each live subscription gets its own channel: supabase-js hands back the
// existing channel for a repeated name, and that one is already subscribed.
let channelCount = 0;

/** filter() values: null matches empty columns, an array matches any of its values. */
function applyWhere(query, where) {
  return Object.entries(where).reduce((q, [column, value]) => {
    if (value === null) return q.is(column, null);
    if (Array.isArray(value)) return q.in(column, value);
    return q.eq(column, value);
  }, query);
}

function fail(error) {
  if (error.code === 'PGRST116') throw new Error("You don't have permission to do that.");
  throw new Error(error.message || 'Something went wrong');
}

export function createSupabaseBackend(url, key) {
  const supabase = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // Implicit flow lets reset-password and invite links work on a
      // different device from the one that requested them.
      flowType: 'implicit',
    },
  });

  const origin = () => window.location.origin;

  /** Reads every row, a page at a time (Supabase caps a response at 1000). */
  async function fetchAll(build, limit) {
    const rows = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const to = limit ? Math.min(from + PAGE_SIZE, limit) - 1 : from + PAGE_SIZE - 1;
      const { data, error } = await build().range(from, to);
      if (error) fail(error);
      rows.push(...data);
      if (data.length < to - from + 1 || (limit && rows.length >= limit)) return rows;
    }
  }

  function entity(table) {
    const ordered = (query, sort) => {
      const { column, ascending } = parseSort(sort);
      return query.order(column, { ascending }).order('id');
    };
    return {
      list: (sort, limit) => fetchAll(() => ordered(supabase.from(table).select('*'), sort), limit),
      filter: (where, sort, limit) => fetchAll(() => ordered(applyWhere(supabase.from(table).select('*'), where), sort), limit),
      async create(row) {
        const { data, error } = await supabase.from(table).insert(row).select().single();
        if (error) fail(error);
        return data;
      },
      async bulkCreate(rows) {
        if (!rows.length) return [];
        const { data, error } = await supabase.from(table).insert(rows).select();
        if (error) fail(error);
        return data;
      },
      async update(id, patch) {
        const { data, error } = await supabase.from(table).update(patch).eq('id', id).select().single();
        if (error) fail(error);
        return data;
      },
      bulkUpdate(rows) {
        return Promise.all(rows.map(({ id, ...patch }) => this.update(id, patch)));
      },
      async delete(id) {
        const { error } = await supabase.from(table).delete().eq('id', id);
        if (error) fail(error);
      },
      /**
       * Calls onInsert(row) for every new row, and onUpdate(row) / onDelete({ id }) when given.
       * onReconnect() when live updates come back after the connection dropped (a phone asleep,
       * lost signal): changes made in between never arrive, so it's the cue to fetch them.
       * Returns an unsubscribe function.
       */
      subscribe(onInsert, { onUpdate, onDelete, onReconnect } = {}) {
        let channel = supabase.channel(`${table}-changes-${++channelCount}`);
        const listen = (event, handler) => {
          channel = channel.on('postgres_changes', { event, schema: 'public', table }, handler);
        };
        if (onInsert) listen('INSERT', (payload) => onInsert(payload.new));
        if (onUpdate) listen('UPDATE', (payload) => onUpdate(payload.new));
        // Deletes only carry the primary key.
        if (onDelete) listen('DELETE', (payload) => onDelete(payload.old));
        // The channel joins again by itself after a drop, reporting SUBSCRIBED each time.
        let joined = false;
        channel.subscribe((status) => {
          if (status !== 'SUBSCRIBED') return;
          if (joined) onReconnect?.();
          joined = true;
        });
        return () => supabase.removeChannel(channel);
      },
    };
  }

  const entities = Object.fromEntries(Object.entries(TABLES).map(([name, table]) => [name, entity(table)]));

  async function usernameAccount(action, values) {
    const { data, error } = await supabase.functions.invoke('username-auth', { body: { action, ...values } });
    if (error) {
      let message;
      try { message = (await error.context.json()).error; } catch { /* Network or service unavailable. */ }
      throw new Error(message || 'Account sign-in is unavailable right now. Please try again shortly.');
    }
    if (data?.error) throw new Error(data.error);
    if (data?.session) {
      const { error: sessionError } = await supabase.auth.setSession(data.session);
      if (sessionError) {
        if (action === 'signup') return { ...data, session: null };
        throw new Error('Please try logging in again.');
      }
    }
    return data;
  }

  const auth = {
    /**
     * The signed-in user ({ id, email, full_name, role, joined }) or null. `joined`: on the
     * team (entered the team code, or a captain). Before the database has team codes, everyone is.
     */
    async me() {
      const { data } = await supabase.auth.getSession();
      const sessionUser = data.session?.user;
      if (!sessionUser) return null;
      const { data: row } = await supabase.from('users').select('*').eq('id', sessionUser.id).maybeSingle();
      const { data: alias } = await supabase.from('username_accounts').select('username').eq('user_id', sessionUser.id).maybeSingle();
      return {
        id: sessionUser.id,
        email: sessionUser.email?.endsWith('@players.jiveturkeys.invalid') ? null : sessionUser.email,
        username: alias?.username || null,
        full_name: row?.full_name || sessionUser.user_metadata?.full_name || sessionUser.user_metadata?.name || '',
        role: row?.role || 'user',
        joined: row ? row.joined_team_at !== null || row.role === 'admin' : true,
      };
    },

    onChange(callback) {
      const { data } = supabase.auth.onAuthStateChange((event) => {
        // Defer so callers can query Supabase from the callback.
        setTimeout(() => callback(event), 0);
      });
      return () => data.subscription.unsubscribe();
    },

    async hasSession() {
      const { data } = await supabase.auth.getSession();
      return !!data.session;
    },

    async signIn(email, password) {
      if (!email.includes('@')) return usernameAccount('signin', { username: email, password });
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Invalid email or password' : error.message);
    },

    /** Returns { needsVerification } — false when email confirmation is off. */
    async signUp(email, password) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: origin() },
      });
      if (error) throw new Error(error.message);
      if (data.user && data.user.identities?.length === 0) {
        throw new Error('An account with this email already exists. Try logging in.');
      }
      return { needsVerification: !data.session };
    },

    signUpUsername: (username, password, teamCode) => usernameAccount('signup', { username, password, teamCode }),
    linkUsername: (username, password) => usernameAccount('link', { username, password }),
    recoverUsername: (username, recoveryCode, password) => usernameAccount('recover', { username, recoveryCode, password }),
    rotateRecoveryCode: (username, password) => usernameAccount('rotate', { username, password }),

    async verifySignup(email, code) {
      let { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
      if (error) ({ error } = await supabase.auth.verifyOtp({ email, token: code, type: 'signup' }));
      if (error) throw new Error('Invalid or expired verification code');
    },

    async resendSignup(email) {
      const { error } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: origin() } });
      if (error) throw new Error(error.message);
    },

    async signInWithGoogle(returnTo = '/') {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: origin() + returnTo },
      });
      if (error) throw new Error(error.message);
    },

    async requestPasswordReset(email) {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin()}/reset-password` });
      if (error) throw new Error(error.message);
    },

    async updatePassword(password) {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw new Error(error.message);
    },

    async signOut() {
      await supabase.auth.signOut();
    },
  };

  const users = {
    /** Joins the team with the team code. Throws a message for the player if it's wrong or they tried too often. */
    async joinTeam(code) {
      const { data, error } = await supabase.rpc('join_team', { p_code: code });
      if (error) fail(error);
      if (data !== 'joined') throw new Error(JOIN_ERRORS[data] || JOIN_ERRORS.wrong);
    },
    /** A new player picks their name on the roster: its status, dues payments and history become theirs. */
    async claimGuest(guestId) {
      const { error } = await supabase.rpc('claim_team_guest', { p_guest_id: guestId });
      if (error) fail(error);
    },
    /** Captains: link a roster name to the account its player joined with. */
    async linkGuest(guestId, userId) {
      const { error } = await supabase.rpc('link_team_guest', { p_guest_id: guestId, p_user_id: userId });
      if (error) fail(error);
    },
    /** Captains: undo a pick or link. The name is a grey card again with everything that came with it. */
    async unlinkGuest(guestId) {
      const { error } = await supabase.rpc('unlink_team_guest', { p_guest_id: guestId });
      if (error) fail(error);
    },

    /** Captains: take a signed-up player off the team (they lose access), or add them back. */
    async setRemoved(userId, removed) {
      const { error } = await supabase.rpc('set_team_member_removed', { p_user_id: userId, p_removed: removed });
      if (error) fail(error);
    },

    async setRole(userId, role) {
      const { error } = await supabase.from('users').update({ role }).eq('id', userId).select().single();
      if (error) fail(error);
    },

    async invite(email, role) {
      const { data, error } = await supabase.functions.invoke('invite-user', {
        body: { email, role, redirectTo: `${origin()}/reset-password?invite=1` },
      });
      if (error || data?.error) throw new Error(data?.error || error.message);
    },
  };

  // A refused delete removes nothing without an error, so check that a row went.
  async function removeMember(threadId, userId) {
    const { data, error } = await supabase
      .from('chat_thread_members')
      .delete()
      .eq('thread_id', threadId)
      .eq('user_id', userId)
      .select('id');
    if (error) fail(error);
    if (!data?.length) throw new Error("You don't have permission to do that.");
  }

  const chat = {
    /** Up to `limit` messages in a room (null = Team Chat) before `before`, oldest first. */
    async history(threadId, { before, limit = 60 } = {}) {
      let query = supabase.from('messages').select('*');
      query = threadId ? query.eq('thread_id', threadId) : query.is('thread_id', null);
      if (before) query = query.lt('created_date', before);
      const { data, error } = await query
        .order('created_date', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit);
      if (error) fail(error);
      return data.reverse();
    },

    /** One row per room with its latest message, the signed-in player's read marker and unread count. */
    async overview() {
      const { data, error } = await supabase.rpc('chat_overview');
      if (error) fail(error);
      return data.map((row) => ({ ...row, unread: Number(row.unread) }));
    },

    /** Marks a room read up to `readAt` (a message's created_date). Never moves the marker back. */
    async markRead(threadId, readAt) {
      const { error } = await supabase.rpc('chat_mark_read', { p_thread_id: threadId, p_read_at: readAt });
      if (error) fail(error);
    },

    /** Up to 50 messages matching `q` (2+ characters), best first, each with its thread's title. */
    async search(q) {
      const { data, error } = await supabase.rpc('chat_search', { q });
      if (error) fail(error);
      return data;
    },

    /**
     * Starts a private chat with the teammates picked (the starter is in it too). Resolves to the
     * new chat. `named: false` when nobody gave it a name (the title is then everyone's names).
     */
    async startPrivate(title, userIds, { named = true } = {}) {
      const { data, error } = await supabase.rpc('chat_start_private', { p_title: title, p_user_ids: userIds, p_named: named });
      if (error) fail(error);
      return data;
    },

    /** Leaves a private chat. Throws unless you're really out of it. */
    async leave(threadId) {
      const { data } = await supabase.auth.getSession();
      await removeMember(threadId, data.session?.user?.id);
    },

    /** The starter takes someone out of a private chat. Throws unless they're really out. */
    removeMember: (threadId, userId) => removeMember(threadId, userId),

    /** Adds teammates to a private chat you're in. They see the whole chat. */
    async addMembers(threadId, userIds) {
      const { error } = await supabase.rpc('chat_add_members', { p_thread_id: threadId, p_user_ids: userIds });
      if (error) fail(error);
    },

    /** "I'm looking at this room", so this player's phone doesn't buzz for it. */
    async viewing(threadId) {
      const { error } = await supabase.rpc('chat_viewing', { p_thread_id: threadId });
      if (error) fail(error);
    },
  };

  const dues = {
    /**
     * Marks players paid (or unpaid again) for a session. Any player can, for anyone. `amounts` is what
     * each one pays, in the same order as `userIds`: their share right now.
     */
    async markPaid({ year, session, userIds, paid, paidDate, amounts }) {
      const params = {
        p_season_year: Number(year),
        p_session: Number(session),
        p_user_ids: userIds,
        p_paid: paid,
        p_paid_date: paid ? paidDate : null,
      };
      let { error } = await supabase.rpc('mark_dues_paid', { ...params, p_amounts: paid ? amounts ?? null : null });
      // The site can go live a few minutes before the database update that records amounts.
      if (error?.code === 'PGRST202') ({ error } = await supabase.rpc('mark_dues_paid', params));
      if (error) fail(error);
    },
    /** Links two players who pay together (either can be a guest); a null partner unlinks. */
    async setPartner(userId, partnerId) {
      const { error } = await supabase.rpc('set_dues_partner', { p_user_id: userId, p_partner_id: partnerId });
      if (error) fail(error);
    },
    /** Captains: who paid together in a session that's over, that session only; a null partner unlinks. */
    async setSessionPartner({ year, session }, userId, partnerId) {
      const { error } = await supabase.rpc('set_session_partner', {
        p_year: Number(year),
        p_session: Number(session),
        p_id: userId,
        p_partner_id: partnerId,
      });
      if (error) fail(error);
    },
  };

  const games = {
    /** Captains: a game's score, stat lines and fill-ins, all saved together or not at all. */
    async saveResult(gameId, { scoreUs, scoreThem, lines, fillIns }) {
      const { error } = await supabase.rpc('save_game_result', {
        p_game_id: gameId,
        p_score_us: scoreUs,
        p_score_them: scoreThem,
        p_lines: lines,
        p_fill_ins: fillIns,
      });
      if (error) fail(error);
    },
  };

  const roster = {
    /**
     * Starts the current session's list if it hasn't been yet. Resolves to { season_year, session, over }:
     * `over` once its games have all been played and nothing else is on the schedule (status changes
     * don't count for it).
     */
    async start() {
      const { data, error } = await supabase.rpc('roster_start_current');
      if (error) fail(error);
      return data;
    },
    /** Captains: ask "Playing session N?" before it starts, with its first game's date (null stops asking). */
    async ask({ year, session, startsOn }) {
      const { error } = await supabase.rpc('roster_ask', { p_year: Number(year), p_session: Number(session), p_starts_on: startsOn || null });
      if (error) fail(error);
    },
    /** Your answer to "Playing session N?": for the current session it's your status; for one asked ahead, that session only. */
    async answer({ year, session, status }) {
      const { error } = await supabase.rpc('roster_answer', { p_year: Number(year), p_session: Number(session), p_status: status });
      if (error) fail(error);
    },
  };

  const notifyChat = async (action) => {
    const { data, error } = await supabase.functions.invoke('notify-chat', { body: { action } });
    if (error) throw new Error("Notifications aren't ready yet. Try again in a few minutes.");
    return data;
  };

  const push = {
    /** The key this site's notifications are signed with (needed to sign a device up). */
    async publicKey() {
      return (await notifyChat('config')).publicKey;
    },
    /** Saves this device's push subscription for the signed-in player. */
    async save(subscription) {
      const { endpoint, keys } = subscription.toJSON();
      const { error } = await supabase.rpc('push_subscribe', {
        p_endpoint: endpoint,
        p_p256dh: keys.p256dh,
        p_auth: keys.auth,
        p_user_agent: navigator.userAgent,
      });
      if (error) fail(error);
    },
    async remove(endpoint) {
      const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
      if (error) fail(error);
    },
    /** Sends a test notification to the signed-in player's devices. Resolves to { sent, failed }. */
    test: () => notifyChat('test'),
  };

  return { mode: 'supabase', auth, entities, users, chat, dues, games, roster, push };
}
