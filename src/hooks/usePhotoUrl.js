import { useEffect, useState } from 'react';

// Signed links for chat photos. Shared across every message on the page so
// reopening a room reuses the same URL (browser cache hit) until near expiry.
const links = new Map(); // path -> { url, until }
// Refresh an hour before a day-long signed URL runs out.
const LINK_MS = 23 * 60 * 60 * 1000;

const fresh = (path) => {
  const link = path && links.get(path);
  return link && link.until > Date.now() ? link.url : undefined;
};

/** Shows a photo from a link this browser already has (the one just sent) instead of downloading it. */
export function rememberPhotoUrl(path, url) {
  if (!path || !url) return;
  links.set(path, { url, until: Infinity });
}

/**
 * The link to show a chat photo: undefined while it's on its way, null when it
 * can't be shown. `resolvePhotoUrl` is api.chat.photoUrl (or a test stand-in).
 */
export function usePhotoUrl(path, resolvePhotoUrl) {
  const [url, setUrl] = useState(() => fresh(path) ?? null);

  useEffect(() => {
    if (!path || !resolvePhotoUrl) {
      setUrl(null);
      return undefined;
    }
    const known = fresh(path);
    if (known) {
      setUrl(known);
      return undefined;
    }
    let alive = true;
    resolvePhotoUrl(path)
      .then((next) => {
        if (!alive) return;
        if (next) links.set(path, { url: next, until: Date.now() + LINK_MS });
        setUrl(next ?? null);
      })
      .catch(() => {
        if (alive) setUrl(null);
      });
    return () => {
      alive = false;
    };
  }, [path, resolvePhotoUrl]);

  return url;
}
