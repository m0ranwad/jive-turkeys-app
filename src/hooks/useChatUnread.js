import { useEffect, useState } from 'react';
import { api } from '@/api';
import { CHAT_READ_EVENT, mentionTotal, unreadTotal } from '@/lib/chat';

const NONE = { unread: 0, mentions: 0 };

/** Live counts for the Chat tab: unread messages, and unread ones that @mention the player. */
export function useChatUnread(enabled) {
  const [counts, setCounts] = useState(NONE);

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
          .then((rows) => alive && setCounts({ unread: unreadTotal(rows), mentions: mentionTotal(rows) }))
          .catch(() => {});
      }, 500);
    };
    const onVisible = () => !document.hidden && refresh();

    refresh();
    const unsubscribe = api.entities.Message.subscribe(refresh, { onDelete: refresh, onReconnect: refresh });
    // Added to a private chat, or taken out of one (deletes reach everyone, but they're rare).
    const unsubscribeMembers = api.entities.ChatThreadMember.subscribe(refresh, { onDelete: refresh });
    window.addEventListener(CHAT_READ_EVENT, refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearTimeout(timer);
      unsubscribe();
      unsubscribeMembers();
      window.removeEventListener(CHAT_READ_EVENT, refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);

  return counts;
}
