import { createClient } from '@supabase/supabase-js';
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
       * Returns an unsubscribe function.
       */
      subscribe(onInsert, { onUpdate, onDelete } = {}) {
        let channel = supabase.channel(`${table}-changes-${++channelCount}`);
        const listen = (event, handler) => {
          channel = channel.on('postgres_changes', { event, schema: 'public', table }, handler);
        };
        if (onInsert) listen('INSERT', (payload) => onInsert(payload.new));
        if (onUpdate) listen('UPDATE', (payload) => onUpdate(payload.new));
        // Deletes only carry the primary key.
        if (onDelete) listen('DELETE', (payload) => onDelete(payload.old));
        channel.subscribe();
        return () => supabase.removeChannel(channel);
      },
    };
  }

  const entities = Object.fromEntries(Object.entries(TABLES).map(([name, table]) => [name, entity(table)]));

  const auth = {
    /** The signed-in user ({ id, email, full_name, role }) or null. */
    async me() {
      const { data } = await supabase.auth.getSession();
      const sessionUser = data.session?.user;
      if (!sessionUser) return null;
      const { data: row } = await supabase.from('users').select('*').eq('id', sessionUser.id).maybeSingle();
      return {
        id: sessionUser.id,
        email: sessionUser.email,
        full_name: row?.full_name || sessionUser.user_metadata?.full_name || sessionUser.user_metadata?.name || '',
        role: row?.role || 'user',
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

    /** "I'm looking at this room", so this player's phone doesn't buzz for it. */
    async viewing(threadId) {
      const { error } = await supabase.rpc('chat_viewing', { p_thread_id: threadId });
      if (error) fail(error);
    },
  };

  const dues = {
    /** Marks players paid (or unpaid again) for a session. Any player can, for anyone. */
    async markPaid({ year, session, userIds, paid, paidDate }) {
      const { error } = await supabase.rpc('mark_dues_paid', {
        p_season_year: Number(year),
        p_session: Number(session),
        p_user_ids: userIds,
        p_paid: paid,
        p_paid_date: paid ? paidDate : null,
      });
      if (error) fail(error);
    },
    /** Links two players who pay together (either can be a guest); a null partner unlinks. */
    async setPartner(userId, partnerId) {
      const { error } = await supabase.rpc('set_dues_partner', { p_user_id: userId, p_partner_id: partnerId });
      if (error) fail(error);
    },
    /** Captains: a teammate who wasn't on the app joined; their payments and history move to their account. */
    async linkGuest(guestId, userId) {
      const { error } = await supabase.rpc('link_dues_guest', { p_guest_id: guestId, p_user_id: userId });
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

  return { mode: 'supabase', auth, entities, users, chat, dues, push };
}
