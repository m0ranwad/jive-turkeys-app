// The real backend's chat calls, checked against a stand-in Supabase client:
// the right queries, function calls and live channels.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = [];
const channels = [];
let result = { data: [], error: null };

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
    auth: {},
    from: (table) => query(table),
    rpc: (name, params) => {
      calls.push(['rpc', name, params]);
      return Promise.resolve(result);
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
