// GIF search for the chat (the GIF button), through KLIPY. Kept free of
// Supabase specifics so it can be tested in Node (tests/unit/gifs.test.js);
// notify-chat/index.ts wires it up. The KLIPY key stays here on the server
// (the KLIPY_API_KEY function secret), so nobody can copy it off the site.
// What KLIPY shows (PG-13) is set in the KLIPY partner panel. Rules: docs/chat.md section 8.

const API = 'https://api.klipy.com/api/v1';
const PER_PAGE = 24;
const MAX_QUERY = 50;
const MAX_PAGE = 20;
// GIFs are only ever shown from KLIPY's own servers (the database checks the
// same before a GIF message is saved, and public/_headers lets pages load them).
const KLIPY_FILE = /^https:\/\/([a-z0-9-]+\.)*klipy\.com\/[^\s"'<>]+$/i;

const size = (n) => (Number.isInteger(n) && n > 0 && n < 10000 ? n : null);

/** The first usable file of a size ("md", "sm", ...): WebP when there is one (smaller), else GIF. */
function fileOf(file, sizes) {
  for (const s of sizes) {
    for (const kind of ['webp', 'gif']) {
      const f = file?.[s]?.[kind];
      if (f && typeof f.url === 'string' && KLIPY_FILE.test(f.url) && size(f.width) && size(f.height)) {
        return { url: f.url, width: f.width, height: f.height };
      }
    }
  }
  return null;
}

/**
 * KLIPY's answer ({ result, data: { data: [...], has_next } }) as the GIFs the
 * picker shows: `url` (what's posted, about 300px) and `preview` (smaller, for
 * the grid). Ads and anything without a usable file are left out.
 */
export function gifsFrom(json) {
  const items = Array.isArray(json?.data?.data) ? json.data.data : [];
  const gifs = [];
  for (const item of items) {
    if (!item || item.type === 'ad') continue;
    const full = fileOf(item.file, ['md', 'hd', 'sm']);
    if (!full) continue;
    const preview = fileOf(item.file, ['sm', 'xs', 'md']) || full;
    const title = typeof item.title === 'string' ? item.title.trim().slice(0, 120) : '';
    gifs.push({ id: String(item.slug ?? item.id ?? full.url), title, ...full, preview });
  }
  return { gifs, more: !!json?.data?.has_next };
}

/**
 * Handles { action: 'gifs', q, page } from a signed-in teammate. Returns [status, json]:
 * { ready: false } until the KLIPY key is set; else { ready: true, gifs, more }.
 * No search words means what's trending. Nothing about the player goes to KLIPY.
 * deps: { klipyKey, userOf(token), isTeamMember(userId), fetch }
 */
export async function handleGifs(body, token, deps) {
  const user = await deps.userOf(token);
  if (!user) return [401, { error: 'Sign in first.' }];
  if (!(await deps.isTeamMember(user.id))) return [403, { error: 'Join the team first.' }];
  if (!deps.klipyKey) return [200, { ready: false, gifs: [], more: false }];

  const q = typeof body?.q === 'string' ? body.q.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY) : '';
  const page = Math.min(Math.max(Number.parseInt(body?.page, 10) || 1, 1), MAX_PAGE);
  const params = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE), customer_id: 'jive-turkeys', locale: 'en' });
  if (q) params.set('q', q);
  const url = `${API}/${encodeURIComponent(deps.klipyKey)}/gifs/${q ? 'search' : 'trending'}?${params}`;

  let res;
  try {
    res = await deps.fetch(url, { headers: { Accept: 'application/json' } });
  } catch (err) {
    console.error('KLIPY unreachable', err);
    return [502, { error: "Couldn't load GIFs." }];
  }
  if (!res.ok) {
    console.error('KLIPY said', res.status);
    return [502, { error: "Couldn't load GIFs." }];
  }
  return [200, { ready: true, ...gifsFrom(await res.json()) }];
}
