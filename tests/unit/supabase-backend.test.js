// The real backend's chat calls, checked against a stand-in Supabase client:
// the right queries, function calls and live channels.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = [];
const channels = [];
let result = { data: [], error: null };
// The signed-in session the stand-in client reports (auth.getSession).
let session = null;

// A chainable stand-in for supabase.from(...): records each call, resolves to `result`.
function query(table) {
  const q = {
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  for (const method of [
    'select',
    'eq',
    'is',
    'in',
    'lt',
    'order',
    'limit',
    'range',
    'match',
    'insert',
    'update',
    'delete',
    'single',
    'maybeSingle',
  ]) {
    q[method] = (...args) => {
      calls.push([table, method, ...args]);
      return q;
    };
  }
  return q;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session } }),
    },
    from: (table) => query(table),
    rpc: (name, params) => {
      calls.push(['rpc', name, params]);
      return Promise.resolve(typeof result === 'function' ? result(name, params) : result);
    },
    channel: (name) => {
      const channel = { name, bindings: [], subscribed: false };
      channel.on = (type, filter, handler) => {
        channel.bindings.push({ type, filter, handler });
        return channel;
      };
      channel.subscribe = () => {
        channel.subscribed = true;
        return channel;
      };
      channels.push(channel);
      return channel;
    },
    removeChannel: (channel) => calls.push(['removeChannel', channel.name]),
  }),
}));

const { createSupabaseBackend } = await import('@/api/supabase');
const api = createSupabaseBackend('https://example.supabase.co', 'sb_publishable_test');

beforeEach(() => {
  calls.length = 0;
  channels.length = 0;
  result = { data: [], error: null };
  session = null;
});

describe('chat.history', () => {
  it('asks for Team Chat as "no thread", newest first, then returns oldest first', async () => {
    result = { data: [{ id: 'b' }, { id: 'a' }], error: null };
    const rows = await api.chat.history(null, { before: '2026-10-08T20:00:00Z', limit: 2 });
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(calls).toEqual([
      ['messages', 'select', '*'],
      ['messages', 'is', 'thread_id', null],
      ['messages', 'lt', 'created_date', '2026-10-08T20:00:00Z'],
      ['messages', 'order', 'created_date', { ascending: false }],
      ['messages', 'order', 'id', { ascending: false }],
      ['messages', 'limit', 2],
    ]);
  });

  it('asks for one thread by id', async () => {
    await api.chat.history('t1');
    expect(calls).toContainEqual(['messages', 'eq', 'thread_id', 't1']);
    expect(calls).toContainEqual(['messages', 'limit', 60]);
  });

  it('reports database errors', async () => {
    result = { data: null, error: { message: 'boom' } };
    await expect(api.chat.history(null)).rejects.toThrow('boom');
  });
});

describe('chat.overview and markRead', () => {
  it('calls the summary function and turns counts into numbers', async () => {
    result = { data: [{ thread_id: null, unread: '4' }], error: null };
    expect(await api.chat.overview()).toEqual([{ thread_id: null, unread: 4 }]);
    expect(calls).toEqual([['rpc', 'chat_overview', undefined]]);
  });

  it('marks a room read up to a given message time', async () => {
    await api.chat.markRead(null, '2026-10-08T19:00:00.123456+00:00');
    expect(calls).toEqual([['rpc', 'chat_mark_read', { p_thread_id: null, p_read_at: '2026-10-08T19:00:00.123456+00:00' }]]);
  });
});

describe('private chats', () => {
  it('starts one and adds people through the database functions', async () => {
    result = { data: { id: 't1', title: 'Ride', visibility: 'private' }, error: null };
    expect(await api.chat.startPrivate('Ride', ['a', 'b'])).toEqual({ id: 't1', title: 'Ride', visibility: 'private' });
    await api.chat.startPrivate('Ann L. & Bo C.', ['b'], { named: false });
    await api.chat.addMembers('t1', ['c']);
    expect(calls).toEqual([
      ['rpc', 'chat_start_private', { p_title: 'Ride', p_user_ids: ['a', 'b'], p_named: true }],
      ['rpc', 'chat_start_private', { p_title: 'Ann L. & Bo C.', p_user_ids: ['b'], p_named: false }],
      ['rpc', 'chat_add_members', { p_thread_id: 't1', p_user_ids: ['c'] }],
    ]);
  });

  it('leaves or takes someone out, and only says it worked when a row really went', async () => {
    session = { user: { id: 'me' } };
    result = { data: [{ id: 'm1' }], error: null };
    await api.chat.leave('t1');
    await api.chat.removeMember('t1', 'sam');
    expect(calls).toEqual([
      ['chat_thread_members', 'delete'],
      ['chat_thread_members', 'eq', 'thread_id', 't1'],
      ['chat_thread_members', 'eq', 'user_id', 'me'],
      ['chat_thread_members', 'select', 'id'],
      ['chat_thread_members', 'delete'],
      ['chat_thread_members', 'eq', 'thread_id', 't1'],
      ['chat_thread_members', 'eq', 'user_id', 'sam'],
      ['chat_thread_members', 'select', 'id'],
    ]);
    // Refused (or nothing there): the database removes nothing and says nothing.
    result = { data: [], error: null };
    await expect(api.chat.leave('t1')).rejects.toThrow("You don't have permission to do that.");
  });

  it('reports why it could not', async () => {
    result = { data: null, error: { message: 'Pick at least one teammate' } };
    await expect(api.chat.startPrivate('Just me', [])).rejects.toThrow('Pick at least one teammate');
  });
});

describe('filter', () => {
  it('uses "is null" for null and "in" for lists', async () => {
    await api.entities.Message.filter({ thread_id: null, id: ['a', 'b'], user_id: 'u' });
    expect(calls).toEqual(
      expect.arrayContaining([
        ['messages', 'is', 'thread_id', null],
        ['messages', 'in', 'id', ['a', 'b']],
        ['messages', 'eq', 'user_id', 'u'],
      ]),
    );
  });
});

describe('subscribe', () => {
  it('gives every subscriber its own channel, even on the same table', () => {
    // supabase-js hands back an existing channel for a repeated name, and adding
    // listeners to an already-subscribed channel fails, so names must differ.
    const stopA = api.entities.Message.subscribe(() => {});
    const stopB = api.entities.Message.subscribe(() => {});
    expect(channels).toHaveLength(2);
    expect(channels[0].name).not.toBe(channels[1].name);
    expect(channels.every((c) => c.subscribed)).toBe(true);
    stopA();
    stopB();
    expect(calls.filter((c) => c[0] === 'removeChannel')).toHaveLength(2);
  });

  it('listens for inserts, updates and deletes, passing the row (or the deleted id)', () => {
    const onInsert = vi.fn();
    const onUpdate = vi.fn();
    const onDelete = vi.fn();
    api.entities.ChatThread.subscribe(onInsert, { onUpdate, onDelete });
    const [channel] = channels;
    expect(channel.bindings.map((b) => [b.type, b.filter])).toEqual([
      ['postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_threads' }],
      ['postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_threads' }],
      ['postgres_changes', { event: 'DELETE', schema: 'public', table: 'chat_threads' }],
    ]);
    channel.bindings[0].handler({ new: { id: 't1' } });
    channel.bindings[1].handler({ new: { id: 't1', archived: true } });
    channel.bindings[2].handler({ old: { id: 't1' } });
    expect(onInsert).toHaveBeenCalledWith({ id: 't1' });
    expect(onUpdate).toHaveBeenCalledWith({ id: 't1', archived: true });
    expect(onDelete).toHaveBeenCalledWith({ id: 't1' });
  });

  it('only listens for inserts when that is all it was given', () => {
    api.entities.Message.subscribe(() => {});
    expect(channels[0].bindings.map((b) => b.filter.event)).toEqual(['INSERT']);
  });
});

describe('dues', () => {
  it('marks players paid through the database function, with the date and amounts only when paid', async () => {
    await api.dues.markPaid({ year: '2026', session: 2, userIds: ['a', 'b'], paid: true, paidDate: '2026-10-09', amounts: [61, 40.5] });
    await api.dues.markPaid({ year: 2026, session: 2, userIds: ['a'], paid: false, paidDate: '2026-10-09', amounts: [61] });
    const sent = { p_season_year: 2026, p_session: 2 };
    expect(calls).toEqual([
      ['rpc', 'mark_dues_paid', { ...sent, p_user_ids: ['a', 'b'], p_paid: true, p_paid_date: '2026-10-09', p_amounts: [61, 40.5] }],
      ['rpc', 'mark_dues_paid', { ...sent, p_user_ids: ['a'], p_paid: false, p_paid_date: null, p_amounts: null }],
    ]);
  });

  it('falls back to marking paid without amounts while the database update is on its way', async () => {
    result = (name, params) =>
      params.p_amounts !== undefined ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } } : { data: null, error: null };
    await api.dues.markPaid({ year: 2026, session: 2, userIds: ['a'], paid: true, paidDate: '2026-10-09', amounts: [61] });
    expect(calls.map(([, , params]) => params.p_amounts)).toEqual([[61], undefined]);
  });

  it('links and unlinks couples through the database function', async () => {
    await api.dues.setPartner('a', 'b');
    await api.dues.setPartner('a', null);
    expect(calls).toEqual([
      ['rpc', 'set_dues_partner', { p_user_id: 'a', p_partner_id: 'b' }],
      ['rpc', 'set_dues_partner', { p_user_id: 'a', p_partner_id: null }],
    ]);
  });

  it('reports database errors', async () => {
    result = { data: null, error: { message: 'nope' } };
    await expect(api.dues.markPaid({ year: 2026, session: 2, userIds: ['a'], paid: true })).rejects.toThrow('nope');
  });
});

describe('roster names', () => {
  it('picks a name, links one and undoes it through the database functions', async () => {
    await api.users.claimGuest('g1');
    await api.users.linkGuest('g2', 'u1');
    await api.users.unlinkGuest('g2');
    expect(calls).toEqual([
      ['rpc', 'claim_team_guest', { p_guest_id: 'g1' }],
      ['rpc', 'link_team_guest', { p_guest_id: 'g2', p_user_id: 'u1' }],
      ['rpc', 'unlink_team_guest', { p_guest_id: 'g2' }],
    ]);
  });

  it('reports a name someone already picked', async () => {
    result = { data: null, error: { message: 'That name has already been picked' } };
    await expect(api.users.claimGuest('g1')).rejects.toThrow('already been picked');
    await expect(api.users.linkGuest('g1', 'u1')).rejects.toThrow('already been picked');
  });
});

describe('session lists', () => {
  it("starts the current session's list through the database function", async () => {
    result = { data: { season_year: 2026, session: 2 }, error: null };
    expect(await api.roster.start()).toEqual({ season_year: 2026, session: 2 });
    expect(calls).toEqual([['rpc', 'roster_start_current', undefined]]);
  });

  it('reports database errors (the site then uses today\'s statuses)', async () => {
    result = { data: null, error: { message: 'function roster_start_current() does not exist' } };
    await expect(api.roster.start()).rejects.toThrow('does not exist');
  });
});

describe('the team code', () => {
  const signedIn = (row) => {
    session = { user: { id: 'u1', email: 'zed@example.com', user_metadata: {} } };
    result = { data: row, error: null };
  };

  it("says a new account hasn't joined the team until it enters the code", async () => {
    signedIn({ id: 'u1', role: 'user', full_name: 'Zed', joined_team_at: null });
    expect(await api.auth.me()).toMatchObject({ id: 'u1', role: 'user', joined: false });
    signedIn({ id: 'u1', role: 'user', full_name: 'Zed', joined_team_at: '2026-10-14T12:00:00Z' });
    expect(await api.auth.me()).toMatchObject({ joined: true });
  });

  it('counts captains as joined, and everyone before the database has team codes', async () => {
    signedIn({ id: 'u1', role: 'admin', full_name: 'Cap', joined_team_at: null });
    expect(await api.auth.me()).toMatchObject({ joined: true });
    signedIn({ id: 'u1', role: 'user', full_name: 'Old' });
    expect(await api.auth.me()).toMatchObject({ joined: true });
  });

  it('joins through the database function and explains a wrong code or too many tries', async () => {
    result = { data: 'joined', error: null };
    await api.users.joinTeam('TURKEY');
    expect(calls).toEqual([['rpc', 'join_team', { p_code: 'TURKEY' }]]);
    result = { data: 'wrong', error: null };
    await expect(api.users.joinTeam('NOPE')).rejects.toThrow("That code isn't right");
    result = { data: 'blocked', error: null };
    await expect(api.users.joinTeam('NOPE')).rejects.toThrow('Too many tries. Try again in an hour.');
  });
});
