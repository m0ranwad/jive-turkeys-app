import { useEffect, useState } from 'react';
import { api } from '@/api';
import { ANNOUNCEMENTS_READ_EVENT } from '@/lib/announcements';

/**
 * How many announcements the player hasn't seen, for the menu's badge. Checked when the site opens,
 * on every move to another screen (`pathname`), on coming back to the app, and after they're read.
 */
export function useAnnouncementsUnread(enabled, pathname) {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const refresh = () =>
      api.announcements
        .unread()
        .then((n) => alive && setUnread(n))
        .catch(() => {});
    const onVisible = () => !document.hidden && refresh();

    refresh();
    window.addEventListener(ANNOUNCEMENTS_READ_EVENT, refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      window.removeEventListener(ANNOUNCEMENTS_READ_EVENT, refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, pathname]);

  return unread;
}
