import { useEffect, useState } from 'react';
import { api } from '@/api';
import { CHAT_READ_EVENT, unreadTotal } from '@/lib/chat';

/** Live unread count for the Chat tab badge. */
export function useChatUnread(enabled) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    let timer;
    // New messages often come in bursts; refresh once they settle.
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        api.chat
          .overview()
          .then((rows) => alive && setCount(unreadTotal(rows)))
          .catch(() => {});
      }, 500);
    };
    const onVisible = () => !document.hidden && refresh();

    refresh();
    const unsubscribe = api.entities.Message.subscribe(refresh, { onDelete: refresh });
    window.addEventListener(CHAT_READ_EVENT, refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearTimeout(timer);
      unsubscribe();
      window.removeEventListener(CHAT_READ_EVENT, refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);

  return count;
}
