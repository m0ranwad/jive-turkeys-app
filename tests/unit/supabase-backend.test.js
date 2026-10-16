// The real backend's chat calls, checked against a stand-in Supabase client:
// the right queries, function calls and live channels.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = [];
const channels = [];
let result = { data: [], error: null };
// The signed-in session the stand-in client reports (auth.getSession).
let session = null;
// What the stand-in storage calls resolve to.
let storageResult = { data: [], error: null };

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
    storage: {
      from: (bucket) => ({
        createSignedUrls: async (paths, seconds) => {
          calls.push(['storage', bucket, 'createSignedUrls', paths, seconds]);
          return storageResult;
        },
        remove: async (paths) => {
          calls.push(['storage', bucket, 'remove', paths]);
          return storageResult;
        },
      }),
    },
  }),
}));

const { createSupabaseBackend } = await import('@/api/supabase');
const api = createSupabaseBackend('https://example.supabase.co', 'sb_publishable_test');

beforeEach(() => {
  calls.length = 0;
  channels.length = 0;
  result = { data: [], error: null };
  session = null;
  storageResult = { data: [], error: null };
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

describe('dues', () => {
  it('marks players paid through the database function, with the date only when paid', async () => {
    await api.dues.markPaid({ year: '2026', session: 2, userIds: ['a', 'b'], paid: true, paidDate: '2026-10-09' });
    await api.dues.markPaid({ year: 2026, session: 2, userIds: ['a'], paid: false, paidDate: '2026-10-09' });
    expect(calls).toEqual([
      ['rpc', 'mark_dues_paid', { p_season_year: 2026, p_session: 2, p_user_ids: ['a', 'b'], p_paid: true, p_paid_date: '2026-10-09' }],
      ['rpc', 'mark_dues_paid', { p_season_year: 2026, p_session: 2, p_user_ids: ['a'], p_paid: false, p_paid_date: null }],
    ]);
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
  it('picks a name and links one through the database functions', async () => {
    await api.users.claimGuest('g1');
    await api.users.linkGuest('g2', 'u1');
    expect(calls).toEqual([
      ['rpc', 'claim_team_guest', { p_guest_id: 'g1' }],
      ['rpc', 'link_team_guest', { p_guest_id: 'g2', p_user_id: 'u1' }],
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

describe('chat photos', () => {
  // A stand-in for the upload request: records it, then answers the way the test says.
  let requests = [];
  let answer = (xhr) => xhr.finish(200, '{}');
  class FakeXHR {
    headers = {};
    upload = {};
    open(method, url) {
      Object.assign(this, { method, url });
    }
    setRequestHeader(name, value) {
      this.headers[name] = value;
    }
    send(body) {
      this.body = body;
      requests.push(this);
      answer(this);
    }
    finish(status, responseText) {
      Object.assign(this, { status, responseText });
      this.onload();
    }
  }

  beforeEach(() => {
    requests = [];
    answer = (xhr) => {
      xhr.upload.onprogress({ lengthComputable: true, loaded: 2, total: 4 });
      xhr.finish(200, '{}');
    };
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
  });

  const jpeg = new Blob(['x'], { type: 'image/jpeg' });

  it("uploads into the player's own folder, reporting progress", async () => {
    session = { access_token: 'token-1', user: { id: 'u1' } };
    const progress = [];
    const path = await api.chat.uploadPhoto(jpeg, { onProgress: (p) => progress.push(p) });
    expect(path).toMatch(/^u1\/[0-9a-f-]{36}\.jpg$/);
    const [request] = requests;
    expect(request.method).toBe('POST');
    expect(request.url).toBe(`https://example.supabase.co/storage/v1/object/chat-media/${path}`);
    expect(request.headers).toMatchObject({
      authorization: 'Bearer token-1',
      apikey: 'sb_publishable_test',
      'content-type': 'image/jpeg',
      'x-upsert': 'false',
    });
    expect(request.body).toBe(jpeg);
    expect(progress).toEqual([0.5, 1]);
  });

  it('says why an upload failed, in plain words', async () => {
    session = { access_token: 'token-1', user: { id: 'u1' } };
    answer = (xhr) => xhr.finish(413, JSON.stringify({ message: 'The object exceeded the maximum allowed size' }));
    await expect(api.chat.uploadPhoto(jpeg)).rejects.toThrow('That photo is too big.');
    answer = (xhr) => xhr.finish(400, JSON.stringify({ message: 'new row violates row-level security policy' }));
    await expect(api.chat.uploadPhoto(jpeg)).rejects.toThrow("You don't have permission to do that.");
    answer = (xhr) => xhr.onerror();
    await expect(api.chat.uploadPhoto(jpeg)).rejects.toThrow('Failed to fetch');
    session = null;
    await expect(api.chat.uploadPhoto(jpeg)).rejects.toThrow('Not signed in');
  });

  it('asks for links that last a day, all at once, and marks missing photos', async () => {
    storageResult = {
      data: [
        { path: 'u1/a.jpg', signedUrl: 'https://example.supabase.co/storage/v1/object/sign/chat-media/u1/a.jpg?token=t', error: null },
        { path: 'u1/b.jpg', signedUrl: null, error: 'Either the object does not exist or you do not have access to it' },
      ],
      error: null,
    };
    expect(await api.chat.photoUrls(['u1/a.jpg', 'u1/b.jpg'])).toEqual({
      'u1/a.jpg': 'https://example.supabase.co/storage/v1/object/sign/chat-media/u1/a.jpg?token=t',
      'u1/b.jpg': null,
    });
    expect(calls).toEqual([['storage', 'chat-media', 'createSignedUrls', ['u1/a.jpg', 'u1/b.jpg'], 86400]]);
    expect(await api.chat.photoUrls([])).toEqual({});
    expect(calls).toHaveLength(1);
  });

  it('removes photo files from the chat bucket', async () => {
    await api.chat.removePhotos(['u1/a.jpg']);
    expect(calls).toEqual([['storage', 'chat-media', 'remove', ['u1/a.jpg']]]);
    storageResult = { data: null, error: { message: 'boom' } };
    await expect(api.chat.removePhotos(['u1/a.jpg'])).rejects.toThrow('boom');
  });
});
