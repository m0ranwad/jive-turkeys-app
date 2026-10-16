import { useCallback, useEffect, useState } from 'react';
import { api } from '@/api';

// Links to chat photos (they're private, so each needs a signed link that lasts a day).
// Shared by every message on the page, and asked for together: a room full of photos
// is one request.
const links = new Map(); // path -> { url, until }
const waiting = new Map(); // path -> callbacks
let timer = null;
// A new link is fetched an hour before the old one runs out.
const LINK_MS = 23 * 60 * 60 * 1000;

const fresh = (path) => {
  const link = path && links.get(path);
  return link && link.until > Date.now() ? link.url : undefined;
};

/** Shows a photo from a link this browser already has (the one just sent) instead of downloading it. */
export function rememberPhotoUrl(path, url) {
  links.set(path, { url, until: Infinity });
}

function flush() {
  timer = null;
  const batch = new Map(waiting);
  waiting.clear();
  const paths = [...batch.keys()];
  const answer = (urls) =>
    paths.forEach((path) => {
      const url = urls[path] ?? null;
      if (url) links.set(path, { url, until: Date.now() + LINK_MS });
      batch.get(path).forEach((done) => done(url));
    });
  api.chat.photoUrls(paths).then(answer, () => answer({}));
}

function request(path, done) {
  if (!waiting.has(path)) waiting.set(path, new Set());
  waiting.get(path).add(done);
  timer ??= setTimeout(flush, 20);
  return () => waiting.get(path)?.delete(done);
}

/**
 * The link to show a chat photo: undefined while it's on its way, null when it can't be
 * shown (deleted, or no signal). `retry` asks again, `broken` drops a link that didn't load.
 */
export function usePhotoUrl(path) {
  const [state, setState] = useState({ path, url: fresh(path), attempt: 0 });
  const current = state.path === path ? state : { path, url: fresh(path), attempt: 0 };

  useEffect(() => {
    if (!path) return undefined;
    const known = fresh(path);
    if (known) {
      setState((s) => (s.path === path && s.url === known ? s : { ...s, path, url: known }));
      return undefined;
    }
    let alive = true;
    const cancel = request(path, (url) => alive && setState((s) => ({ ...s, path, url })));
    return () => {
      alive = false;
      cancel();
    };
  }, [path, current.attempt]);

  const retry = useCallback(() => setState((s) => ({ path, url: undefined, attempt: (s.path === path ? s.attempt : 0) + 1 })), [path]);
  const broken = useCallback(() => {
    links.delete(path);
    setState((s) => ({ ...s, path, url: null }));
  }, [path]);

  return { url: current.url, retry, broken };
}
