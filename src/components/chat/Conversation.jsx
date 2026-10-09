import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, LoaderCircle } from 'lucide-react';
import { MessageRow } from './MessageRow';
import { buildTimeline, summarizeReactions } from '@/lib/chat';
import { plural } from '@/lib/format';

const NEAR_BOTTOM_PX = 96;

/**
 * The scrolling message list for one room. Opens at the "new messages" line
 * (or the bottom), follows new messages while you're at the bottom, and
 * otherwise offers a "new messages" button.
 */
export function Conversation({
  messages,
  unreadAfter,
  me,
  isCaptain,
  reactionsByMessage,
  lookup,
  nameOf,
  isCaptainUser,
  hasMore,
  loadingEarlier,
  onLoadEarlier,
  onReact,
  onReply,
  onCopy,
  onDelete,
  emptyText,
}) {
  const scroller = useRef(null);
  const stick = useRef(true);
  const lastSeen = useRef(undefined);
  // The top message and how far it sat from the top of the view, so older
  // messages added above it don't move what you're looking at.
  const topAnchor = useRef(null);
  const [newBelow, setNewBelow] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [highlightId, setHighlightId] = useState(null);

  const timeline = useMemo(() => buildTimeline(messages, { unreadAfter, me }), [messages, unreadAfter, me]);

  const toBottom = (smooth) => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };

  const rowOf = (id) => scroller.current?.querySelector(`[data-message-id="${id}"]`);
  const rememberTop = () => {
    const el = scroller.current;
    const first = messages.find((m) => !m.pending);
    const row = first && rowOf(first.id);
    topAnchor.current = row ? { id: first.id, offset: row.offsetTop - el.scrollTop } : null;
  };

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const last = messages[messages.length - 1];
    const anchorRow = topAnchor.current && topAnchor.current.id !== messages[0]?.id && rowOf(topAnchor.current.id);
    if (lastSeen.current === undefined) {
      // First paint: start at the "new messages" line, else at the bottom.
      const divider = el.querySelector('[data-unread-divider]');
      el.scrollTop = divider ? Math.max(0, divider.offsetTop - 12) : el.scrollHeight;
      stick.current = !divider || el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    } else if (anchorRow) {
      // Older messages were added above: keep the same messages in view.
      el.scrollTop = anchorRow.offsetTop - topAnchor.current.offset;
    } else if (last && last.id !== lastSeen.current) {
      if (stick.current || last.user_id === me) toBottom(true);
      else if (!last.pending) setNewBelow((n) => n + 1);
    } else if (stick.current) {
      el.scrollTop = el.scrollHeight;
    }
    lastSeen.current = last?.id ?? null;
    rememberTop();
  }, [messages, reactionsByMessage, me]);

  // When the list gets shorter (the phone keyboard opening), keep the newest messages in view
  // if you were at them. Judged from where the list is right now, since the last scroll event
  // can lag behind a jump made just before the resize.
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    let height = el.clientHeight;
    const observer = new ResizeObserver(() => {
      const wasAtBottom = el.scrollHeight - el.scrollTop - height < NEAR_BOTTOM_PX;
      height = el.clientHeight;
      if (wasAtBottom) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Keep the tapped message's options in view.
  useEffect(() => {
    if (!selectedId) return;
    const row = scroller.current?.querySelector(`[data-message-id="${selectedId}"]`);
    row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e) => e.key === 'Escape' && setSelectedId(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId]);

  const onScroll = () => {
    const el = scroller.current;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    if (stick.current && newBelow) setNewBelow(0);
    rememberTop();
  };

  const jumpTo = (id) => {
    const row = scroller.current?.querySelector(`[data-message-id="${id}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setHighlightId(id);
    setTimeout(() => setHighlightId((current) => (current === id ? null : current)), 1600);
  };

  const close =
    (fn) =>
    (...args) => {
      setSelectedId(null);
      fn(...args);
    };

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scroller}
        onScroll={onScroll}
        onClick={(e) => e.target === e.currentTarget && setSelectedId(null)}
        role="log"
        aria-label="Messages"
        className="relative h-full overflow-y-auto overscroll-contain px-3 pb-4 pt-2"
      >
        {hasMore && (
          <div className="flex justify-center py-2">
            <button
              onClick={onLoadEarlier}
              disabled={loadingEarlier}
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-zinc-500 transition hover:bg-zinc-200"
            >
              {loadingEarlier && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
              Load earlier messages
            </button>
          </div>
        )}

        {messages.length === 0 && (
          <div className="grid h-full place-items-center px-6 text-center">
            <p className="text-sm font-semibold text-zinc-400">{emptyText}</p>
          </div>
        )}

        {timeline.map((item) => {
          if (item.type === 'day') {
            return (
              <div key={item.key} className="flex justify-center pb-1 pt-4">
                <span className="rounded-full bg-zinc-100 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-zinc-400">
                  {item.label}
                </span>
              </div>
            );
          }
          if (item.type === 'unread') {
            return (
              <div key={item.key} data-unread-divider className="mt-4 flex items-center gap-3">
                <span className="h-px flex-1 bg-lime-400" />
                <span className="text-[10px] font-black uppercase tracking-[0.16em] text-lime-700">New messages</span>
                <span className="h-px flex-1 bg-lime-400" />
              </div>
            );
          }
          const m = item.message;
          const mine = m.user_id === me;
          const target = m.reply_to_id ? lookup(m.reply_to_id) : null;
          return (
            <MessageRow
              key={item.key}
              message={m}
              first={item.first}
              last={item.last}
              mine={mine}
              author={nameOf(m.user_id, m.author_name)}
              isCaptainAuthor={isCaptainUser(m.user_id)}
              replyTarget={target}
              replyAuthor={target ? nameOf(target.user_id, target.author_name) : ''}
              reactions={summarizeReactions(reactionsByMessage.get(m.id) || [], me)}
              nameOf={nameOf}
              selected={selectedId === m.id}
              highlighted={highlightId === m.id}
              canDelete={mine || isCaptain}
              onSelect={(id) => setSelectedId((current) => (current === id ? null : id))}
              onReact={(message, emoji, fromMenu) => {
                if (fromMenu) setSelectedId(null);
                onReact(message, emoji);
              }}
              onReply={close(onReply)}
              onCopy={close(onCopy)}
              onDelete={close(onDelete)}
              onJumpTo={jumpTo}
            />
          );
        })}
      </div>

      {newBelow > 0 && (
        <button
          onClick={() => {
            toBottom(true);
            setNewBelow(0);
          }}
          className="absolute bottom-3 left-1/2 z-20 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-zinc-950 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.1em] text-lime-400 shadow-lg transition hover:bg-zinc-800"
        >
          <ArrowDown className="h-3.5 w-3.5" />
          {newBelow} new {plural(newBelow, 'message')}
        </button>
      )}
    </div>
  );
}
