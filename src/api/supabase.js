import { createClient } from '@supabase/supabase-js';
import { TABLES, parseSort } from './tables';

const PAGE_SIZE = 1000;

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
      filter: (where, sort) => fetchAll(() => ordered(supabase.from(table).select('*').match(where), sort)),
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
      /** Calls onInsert(row) for every new row; returns an unsubscribe function. */
      subscribe(onInsert) {
        const channel = supabase
          .channel(`${table}-inserts`)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table }, (payload) => onInsert(payload.new))
          .subscribe();
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

  return { mode: 'supabase', auth, entities, users };
}
