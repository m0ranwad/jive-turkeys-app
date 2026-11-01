// The chat's GIF search on the server (the notify-chat function's { action: 'gifs' }):
// who may search, what goes to KLIPY, and what comes back. docs/chat.md section 8.
import { describe, expect, it, vi } from 'vitest';
import { gifsFrom, handleGifs } from '../../supabase/functions/_shared/gifs.js';

const file = (name, w, h) => ({
  gif: { url: `https://static.klipy.com/ii/abc/${name}.gif`, width: w, height: h, size: 900000 },
  webp: { url: `https://static.klipy.com/ii/abc/${name}.webp`, width: w, height: h, size: 200000 },
});
const klipy = {
  result: true,
  data: {
    data: [
      { slug: 'goal-celebration', title: 'Goal Celebration ', type: 'gif', file: { md: file('md', 300, 200), sm: file('sm', 150, 100), xs: file('xs', 90, 60) } },
      { type: 'ad', width: 300, height: 250, content: '<iframe></iframe>' },
      { slug: 'elsewhere', title: 'Not from KLIPY', type: 'gif', file: { md: { gif: { url: 'https://evil.example/x.gif', width: 300, height: 200 } } } },
      { slug: 'gif-only', title: 'Old one', type: 'gif', file: { md: { gif: { url: 'https://static.klipy.com/ii/def/md.gif', width: 280, height: 280 } } } },
    ],
    has_next: true,
  },
};

function setup({ key = 'KEY123', user = { id: 'u1' }, member = true, response = () => new Response(JSON.stringify(klipy)) } = {}) {
  const fetch = vi.fn(async () => response());
  const deps = {
    klipyKey: key,
    fetch,
    userOf: vi.fn(async (token) => (token === 'good' ? user : null)),
    isTeamMember: vi.fn(async () => member),
  };
  return { deps, fetch };
}

describe('what the picker gets back', () => {
  it("keeps KLIPY's GIFs (WebP when there is one), with a smaller preview for the grid, and skips ads and other sites", () => {
    expect(gifsFrom(klipy)).toEqual({
      gifs: [
        {
          id: 'goal-celebration',
          title: 'Goal Celebration',
          url: 'https://static.klipy.com/ii/abc/md.webp',
          width: 300,
          height: 200,
          preview: { url: 'https://static.klipy.com/ii/abc/sm.webp', width: 150, height: 100 },
        },
        {
          id: 'gif-only',
          title: 'Old one',
          url: 'https://static.klipy.com/ii/def/md.gif',
          width: 280,
          height: 280,
          preview: { url: 'https://static.klipy.com/ii/def/md.gif', width: 280, height: 280 },
        },
      ],
      more: true,
    });
  });

  it('copes with an empty or odd answer', () => {
    expect(gifsFrom({})).toEqual({ gifs: [], more: false });
    expect(gifsFrom(null)).toEqual({ gifs: [], more: false });
    expect(gifsFrom({ data: { data: [null, { file: null }] } })).toEqual({ gifs: [], more: false });
  });
});

describe('searching', () => {
  it('only for signed-in teammates', async () => {
    const { deps, fetch } = setup();
    expect((await handleGifs({ action: 'gifs', q: 'goal' }, 'bad', deps))[0]).toBe(401);
    const { deps: outsider, fetch: outsiderFetch } = setup({ member: false });
    expect((await handleGifs({ action: 'gifs', q: 'goal' }, 'good', outsider))[0]).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
    expect(outsiderFetch).not.toHaveBeenCalled();
  });

  it("says it isn't set up until the KLIPY key is there", async () => {
    const { deps, fetch } = setup({ key: '' });
    expect(await handleGifs({ action: 'gifs', q: 'goal' }, 'good', deps)).toEqual([200, { ready: false, gifs: [], more: false }]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("searches KLIPY with the words (tidied and capped), and sends nothing about the player", async () => {
    const { deps, fetch } = setup();
    const [status, json] = await handleGifs({ action: 'gifs', q: '  lets   go ', page: 2 }, 'good', deps);
    expect(status).toBe(200);
    expect(json).toMatchObject({ ready: true, more: true });
    expect(json.gifs).toHaveLength(2);
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe('https://api.klipy.com/api/v1/KEY123/gifs/search');
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: 'lets go', page: '2', per_page: '24', customer_id: 'jive-turkeys', locale: 'en' });

    await handleGifs({ action: 'gifs', q: 'x'.repeat(200), page: 999 }, 'good', deps);
    const capped = new URL(fetch.mock.calls[1][0]);
    expect(capped.searchParams.get('q')).toHaveLength(50);
    expect(capped.searchParams.get('page')).toBe('20');
  });

  it("shows what's trending with no words", async () => {
    const { deps, fetch } = setup();
    await handleGifs({ action: 'gifs', q: '   ' }, 'good', deps);
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.pathname).toBe('/api/v1/KEY123/gifs/trending');
    expect(url.searchParams.has('q')).toBe(false);
    expect(url.searchParams.get('page')).toBe('1');
  });

  it("says it couldn't load GIFs when KLIPY can't be reached or says no", async () => {
    const down = setup({ response: () => new Response('nope', { status: 500 }) });
    expect(await handleGifs({ action: 'gifs', q: 'goal' }, 'good', down.deps)).toEqual([502, { error: "Couldn't load GIFs." }]);
    const offline = setup();
    offline.deps.fetch = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await handleGifs({ action: 'gifs', q: 'goal' }, 'good', offline.deps)).toEqual([502, { error: "Couldn't load GIFs." }]);
  });
});
