import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ChevronLeft, Lock, LockOpen, MessageSquare, MessagesSquare, MoreHorizontal, Pencil, Trash2, X } from 'lucide-react';
import { api } from '@/api';
import { PageSpinner } from '@/components/PageSpinner';
import { ConfirmDialog, ThreadDialog } from '@/components/chat/ChatDialogs';
import { ClosedNotice, Composer } from '@/components/chat/Composer';
import { Conversation } from '@/components/chat/Conversation';
import { ThreadIcon, ThreadList, UnreadCount } from '@/components/chat/ThreadList';
import { useToast } from '@/components/ui/toast';
import { useTeam } from '@/hooks/useTeam';
import { copyText } from '@/lib/clipboard';
import { CHAT_READ_EVENT, isAfter, roomOf, splitLeadingEmoji } from '@/lib/chat';
import { shortName } from '@/lib/format';
import { cn } from '@/lib/utils';

const PAGE = 60;
const NEW_THREAD_DAYS = 3;
const TIP_KEY = 'jt_chat_tip_seen';

function tipSeen() {
  try {
    return !!localStorage.getItem(TIP_KEY);
  } catch {
    return true;
  }
}

/** One-time pointer for players coming from Messenger. */
function ChatTip() {
  const [open, setOpen] = useState(() => !tipSeen());
  if (!open) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(TIP_KEY, '1');
    } catch {
      // Private mode: it shows again next time.
    }
    setOpen(false);
  };
  return (
    <div className="flex items-start gap-2 border-b border-lime-200 bg-lime-50 px-4 py-2.5 text-xs font-medium leading-relaxed text-lime-900">
      <span className="flex-1">
        <b>Tip:</b> tap any message to react, reply or copy it. Side conversations go in <b>Threads</b>.
      </span>
      <button
        onClick={dismiss}
        aria-label="Got it"
        className="-mr-1 grid h-6 w-6 shrink-0 place-items-center rounded-full hover:bg-lime-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

let pendingCount = 0;
const pendingId = () => `pending-${++pendingCount}`;

/** Adds a message in time order, replacing the "sending" copy of it if there is one. */
function insertMessage(list, message) {
  const real = list.filter((m) => !m.pending);
  const pending = list.filter((m) => m.pending);
  const echo = pending.findIndex((m) => m.user_id === message.user_id && m.body === message.body);
  if (echo >= 0) pending.splice(echo, 1);
  if (real.some((m) => m.id === message.id)) return [...real, ...pending];
  let i = real.length;
  while (i > 0 && isAfter(real[i - 1].created_date, message.created_date)) i -= 1;
  return [...real.slice(0, i), message, ...real.slice(i), ...pending];
}

/** Adds a reaction, replacing any copy of the same player + message + emoji. */
function addReaction(list, reaction) {
  const same = (r) => r.message_id === reaction.message_id && r.user_id === reaction.user_id && r.emoji === reaction.emoji;
  return [...list.filter((r) => !same(r) && r.id !== reaction.id), reaction];
}

const upsertThread = (list, thread) =>
  list && (list.some((t) => t.id === thread.id) ? list.map((t) => (t.id === thread.id ? thread : t)) : [thread, ...list]);

/** Updates a room's latest-message summary when a message arrives. */
function bumpOverview(list, message, countsAsUnread) {
  const room = roomOf(message);
  const latest = {
    last_message_at: message.created_date,
    last_user_id: message.user_id,
    last_author_name: message.author_name,
    last_body: message.body.slice(0, 140),
  };
  const existing = list.find((o) => o.thread_id === room);
  if (!existing) return [...list, { thread_id: room, last_read_at: null, unread: countsAsUnread ? 1 : 0, ...latest }];
  if (isAfter(existing.last_message_at, message.created_date)) return list;
  return list.map((o) => (o === existing ? { ...o, ...latest, unread: o.unread + (countsAsUnread ? 1 : 0) } : o));
}

/** Sizes the chat to fill the screen between the header and the bottom tab bar. */
function useFillViewport(ref, ready) {
  const [height, setHeight] = useState(null);
  useLayoutEffect(() => {
    if (!ready) return undefined;
    const fit = () => {
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const tabBar = document.querySelector('[data-bottom-nav]');
      const tabBarHeight = tabBar ? tabBar.getBoundingClientRect().height : 0;
      setHeight(Math.max(380, Math.round(window.innerHeight - top - tabBarHeight - 12)));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [ref, ready]);
  return height;
}

export function ChatPage() {
  const { user, profile, profiles, isCaptain, loading } = useTeam();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const room = params.get('thread') || null;
  const listOpen = params.get('view') === 'threads';
  const me = user?.id;

  const [threads, setThreads] = useState(null);
  const [overview, setOverview] = useState([]);
  const [loaded, setLoaded] = useState(null);
  const [reactions, setReactions] = useState([]);
  const [extras, setExtras] = useState({});
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [visible, setVisible] = useState(() => !document.hidden);

  const shell = useRef(null);
  const composer = useRef(null);
  const height = useFillViewport(shell, !loading);

  // Live handlers read these instead of re-subscribing on every change.
  const live = useRef({});
  live.current = { me, viewing: listOpen ? undefined : room };
  // Messages that arrive live while a room's history is still loading.
  const arriving = useRef({ room: undefined, messages: [] });
  const overviewRef = useRef(overview);
  overviewRef.current = overview;

  const refreshOverview = useCallback(() => {
    api.chat
      .overview()
      .then(setOverview)
      .catch(() => {});
  }, []);

  // Threads, room summaries, and live updates for the whole page.
  useEffect(() => {
    let alive = true;
    Promise.all([api.entities.ChatThread.list('-created_date'), api.chat.overview()])
      .then(([threadRows, summary]) => {
        if (!alive) return;
        setThreads(threadRows);
        setOverview(summary);
      })
      .catch((err) => {
        if (!alive) return;
        setThreads([]);
        toast({ title: "Chat didn't load", description: err.message });
      });

    let refreshTimer;
    const offThreads = api.entities.ChatThread.subscribe((t) => setThreads((list) => upsertThread(list, t)), {
      onUpdate: (t) => setThreads((list) => upsertThread(list, t)),
      onDelete: ({ id }) => setThreads((list) => list && list.filter((t) => t.id !== id)),
    });
    const offMessages = api.entities.Message.subscribe(
      (m) => {
        const { me: myId, viewing } = live.current;
        const messageRoom = roomOf(m);
        if (arriving.current.room === messageRoom) arriving.current.messages.push(m);
        setOverview((list) => bumpOverview(list, m, m.user_id !== myId && messageRoom !== viewing));
        setLoaded((current) =>
          current && current.room === messageRoom ? { ...current, messages: insertMessage(current.messages, m) } : current,
        );
      },
      {
        onDelete: ({ id }) => {
          setLoaded((current) => current && { ...current, messages: current.messages.filter((m) => m.id !== id) });
          setReactions((list) => list.filter((r) => r.message_id !== id));
          clearTimeout(refreshTimer);
          refreshTimer = setTimeout(refreshOverview, 500);
        },
      },
    );
    const offReactions = api.entities.MessageReaction.subscribe((r) => setReactions((list) => addReaction(list, r)), {
      onDelete: ({ id }) => setReactions((list) => list.filter((r) => r.id !== id)),
    });
    const onVisibility = () => {
      setVisible(!document.hidden);
      if (!document.hidden) refreshOverview();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      alive = false;
      clearTimeout(refreshTimer);
      offThreads();
      offMessages();
      offReactions();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [toast, refreshOverview]);

  const loadReactions = useCallback(async (messages) => {
    const ids = messages.filter((m) => !m.pending).map((m) => m.id);
    if (!ids.length) return;
    try {
      const rows = await api.entities.MessageReaction.filter({ message_id: ids });
      setReactions((list) => rows.reduce(addReaction, list));
    } catch {
      // Reactions are extras; the messages still show.
    }
  }, []);

  // Open a room: its latest messages, and where the player left off.
  useEffect(() => {
    let alive = true;
    setReplyTo(null);
    setMenuOpen(false);
    setLoaded(null);
    setReactions([]);
    arriving.current = { room, messages: [] };
    Promise.all([api.chat.history(room, { limit: PAGE }), api.chat.overview()])
      .then(([rows, summary]) => {
        if (!alive) return;
        const messages = arriving.current.messages.reduce(insertMessage, rows);
        arriving.current = { room: undefined, messages: [] };
        setOverview(summary);
        setLoaded({
          room,
          messages,
          hasMore: rows.length === PAGE,
          unreadAfter: summary.find((o) => o.thread_id === room)?.last_read_at ?? null,
        });
        loadReactions(messages);
      })
      .catch((err) => {
        if (!alive) return;
        arriving.current = { room: undefined, messages: [] };
        setLoaded({ room, messages: [], hasMore: false, unreadAfter: null });
        toast({ title: "Messages didn't load", description: err.message });
      });
    return () => {
      alive = false;
    };
  }, [room, loadReactions, toast]);

  // Fetch replied-to messages that are older than what's loaded.
  useEffect(() => {
    if (!loaded) return;
    const have = new Set(loaded.messages.map((m) => m.id));
    const missing = [
      ...new Set(loaded.messages.map((m) => m.reply_to_id).filter((id) => id && !have.has(id) && !(id in extras))),
    ];
    if (!missing.length) return;
    setExtras((current) => ({ ...current, ...Object.fromEntries(missing.map((id) => [id, null])) }));
    api.entities.Message.filter({ id: missing })
      .then((rows) => setExtras((current) => ({ ...current, ...Object.fromEntries(rows.map((m) => [m.id, m])) })))
      .catch(() => {});
  }, [loaded, extras]);

  // Mark the open room read while it's on screen.
  useEffect(() => {
    if (!loaded || listOpen || !visible) return undefined;
    const last = [...loaded.messages].reverse().find((m) => !m.pending);
    if (!last) return undefined;
    const timer = setTimeout(() => {
      const summary = overviewRef.current.find((o) => o.thread_id === loaded.room);
      if (summary && !summary.unread && !isAfter(last.created_date, summary.last_read_at)) return;
      setOverview((list) =>
        list.map((o) =>
          o.thread_id === loaded.room
            ? { ...o, unread: 0, last_read_at: isAfter(last.created_date, o.last_read_at) ? last.created_date : o.last_read_at }
            : o,
        ),
      );
      api.chat
        .markRead(loaded.room, last.created_date)
        .then(() => window.dispatchEvent(new Event(CHAT_READ_EVENT)))
        .catch(() => {});
    }, 600);
    return () => clearTimeout(timer);
  }, [loaded, listOpen, visible]);

  const profilesById = useMemo(() => new Map(profiles.map((p) => [p.user_id, p])), [profiles]);
  const nameOf = useCallback(
    (userId, fallback) => profilesById.get(userId)?.display_name || fallback || 'Player',
    [profilesById],
  );
  const isCaptainUser = useCallback((userId) => !!profilesById.get(userId)?.is_captain, [profilesById]);

  const reactionsByMessage = useMemo(() => {
    const map = new Map();
    for (const r of reactions) {
      if (!map.has(r.message_id)) map.set(r.message_id, []);
      map.get(r.message_id).push(r);
    }
    return map;
  }, [reactions]);

  const messagesById = useMemo(() => new Map((loaded?.messages || []).map((m) => [m.id, m])), [loaded]);
  const lookup = useCallback((id) => messagesById.get(id) || extras[id] || null, [messagesById, extras]);

  const rooms = useMemo(() => {
    const summaries = new Map(overview.map((o) => [o.thread_id, o]));
    const recent = Date.now() - NEW_THREAD_DAYS * 24 * 60 * 60 * 1000;
    const list = (threads || []).map((thread) => {
      const summary = summaries.get(thread.id);
      return {
        thread,
        summary,
        unread: summary?.unread || 0,
        // Never opened, and there's something in it from someone else.
        isNew: !!summary && !summary.last_read_at && summary.unread > 0,
        recent: !!summary && new Date(summary.last_message_at).getTime() > recent,
        at: summary?.last_message_at || thread.created_date,
      };
    });
    list.sort((a, b) => new Date(b.at) - new Date(a.at));
    const team = summaries.get(null);
    return {
      team: { summary: team, unread: team?.unread || 0 },
      open: list.filter((r) => !r.thread.archived),
      closed: list.filter((r) => r.thread.archived),
    };
  }, [threads, overview]);

  const threadUnread = rooms.open.reduce((n, r) => (r.summary?.last_read_at ? n + r.unread : n), 0);
  const threadFresh = rooms.open.some((r) => r.isNew && r.recent);

  const thread = room ? threads?.find((t) => t.id === room) : null;
  const threadMissing = !!room && !!threads && !thread;
  const canManage = !!thread && (thread.created_by === me || isCaptain);
  const myName = profile?.display_name || user?.full_name || 'Player';

  const openRoom = (id) => setParams(id ? { thread: id } : {});
  // Keeps the open room loaded underneath the list on phones.
  const showThreads = () => setParams(room ? { thread: room, view: 'threads' } : { view: 'threads' });

  const send = async (body) => {
    if (!me) return false;
    const target = room;
    const reply = replyTo;
    const pending = {
      id: pendingId(),
      pending: true,
      user_id: me,
      author_name: myName,
      body,
      thread_id: target,
      reply_to_id: reply?.id ?? null,
      created_date: new Date().toISOString(),
    };
    setReplyTo(null);
    setLoaded((current) =>
      current && current.room === target ? { ...current, messages: [...current.messages, pending] } : current,
    );
    try {
      const created = await api.entities.Message.create({
        user_id: me,
        author_name: myName,
        body,
        thread_id: target,
        reply_to_id: pending.reply_to_id,
      });
      setLoaded((current) =>
        current && current.room === target
          ? {
              ...current,
              messages: insertMessage(
                current.messages.filter((m) => m.id !== pending.id),
                created,
              ),
            }
          : current,
      );
      setOverview((list) => bumpOverview(list, created, false));
      return true;
    } catch (err) {
      setLoaded((current) => current && { ...current, messages: current.messages.filter((m) => m.id !== pending.id) });
      setReplyTo(reply);
      toast({ title: "That didn't send", description: err.message });
      return false;
    }
  };

  const loadEarlier = async () => {
    if (!loaded?.messages.length) return;
    const target = loaded.room;
    setLoadingEarlier(true);
    try {
      const rows = await api.chat.history(target, { before: loaded.messages.find((m) => !m.pending)?.created_date, limit: PAGE });
      setLoaded((current) =>
        current && current.room === target
          ? { ...current, messages: rows.reduce(insertMessage, current.messages), hasMore: rows.length === PAGE }
          : current,
      );
      loadReactions(rows);
    } catch (err) {
      toast({ title: "Couldn't load more", description: err.message });
    } finally {
      setLoadingEarlier(false);
    }
  };

  const toggleReaction = async (message, emoji) => {
    const existing = reactions.find((r) => r.message_id === message.id && r.user_id === me && r.emoji === emoji);
    if (existing?.pending) return;
    if (existing) {
      setReactions((list) => list.filter((r) => r.id !== existing.id));
      try {
        await api.entities.MessageReaction.delete(existing.id);
      } catch (err) {
        setReactions((list) => addReaction(list, existing));
        toast({ title: "Couldn't remove that reaction", description: err.message });
      }
      return;
    }
    const pending = { id: pendingId(), pending: true, message_id: message.id, user_id: me, emoji };
    setReactions((list) => addReaction(list, pending));
    try {
      const created = await api.entities.MessageReaction.create({ message_id: message.id, user_id: me, emoji });
      setReactions((list) => addReaction(list, created));
    } catch {
      // Usually a double tap that already counted.
      setReactions((list) => list.filter((r) => r.id !== pending.id));
    }
  };

  const reply = (message) => {
    setReplyTo(message);
    composer.current?.focus();
  };

  const copy = async (message) => {
    const ok = await copyText(message.body);
    toast({ title: ok ? 'Copied' : "Couldn't copy that" });
  };

  const saveThread = async ({ title, first }) => {
    try {
      if (dialog.kind === 'rename') {
        const updated = await api.entities.ChatThread.update(thread.id, { title });
        setThreads((list) => upsertThread(list, updated));
        return;
      }
      const created = await api.entities.ChatThread.create({ title, created_by: me, author_name: myName });
      setThreads((list) => upsertThread(list, created));
      // The starter has "read" it, so replies count toward their unread badge.
      api.chat.markRead(created.id, created.created_date).catch(() => {});
      if (first) {
        await api.entities.Message.create({
          user_id: me,
          author_name: myName,
          body: first,
          thread_id: created.id,
          reply_to_id: null,
        });
      }
      openRoom(created.id);
    } catch (err) {
      toast({ title: "That didn't save", description: err.message });
      throw err;
    }
  };

  const setClosed = async (archived) => {
    setMenuOpen(false);
    try {
      const updated = await api.entities.ChatThread.update(thread.id, { archived });
      setThreads((list) => upsertThread(list, updated));
      toast({
        title: archived ? 'Thread closed' : 'Thread reopened',
        description: archived ? 'It moved to Closed threads.' : undefined,
      });
    } catch (err) {
      toast({ title: "That didn't save", description: err.message });
    }
  };

  const confirmDelete = async () => {
    try {
      if (dialog.kind === 'deleteThread') {
        await api.entities.ChatThread.delete(dialog.thread.id);
        setThreads((list) => list.filter((t) => t.id !== dialog.thread.id));
        openRoom(null);
        toast({ title: 'Thread deleted' });
      } else {
        await api.entities.Message.delete(dialog.message.id);
        setLoaded((current) => current && { ...current, messages: current.messages.filter((m) => m.id !== dialog.message.id) });
        refreshOverview();
      }
    } catch (err) {
      toast({ title: "That didn't delete", description: err.message });
      throw err;
    }
  };

  if (loading) return <PageSpinner />;

  const teamSize = profiles.filter((p) => p.status !== 'on_break').length;
  const title = thread ? splitLeadingEmoji(thread.title).text : 'Team Chat';

  return (
    <div ref={shell} className="flex gap-3" style={{ height: height ?? 'calc(100vh - 12rem)' }}>
      <aside
        className={cn(
          'w-full flex-col overflow-hidden rounded-3xl border border-black/5 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] md:flex md:w-64 md:shrink-0',
          listOpen ? 'flex' : 'hidden',
        )}
      >
        <div className="flex items-center gap-2 border-b border-black/5 px-4 py-3">
          <button
            onClick={() => openRoom(null)}
            aria-label="Back to Team Chat"
            className="-ml-1 grid h-9 w-9 place-items-center rounded-full text-zinc-500 transition hover:bg-zinc-100 md:hidden"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h1 className="font-display text-lg font-extrabold uppercase tracking-tight">Chats</h1>
        </div>
        {threads ? (
          <ThreadList
            rooms={rooms}
            activeRoom={listOpen ? undefined : room}
            me={me}
            nameOf={nameOf}
            onOpen={openRoom}
            onNewThread={() => setDialog({ kind: 'new' })}
          />
        ) : (
          <PageSpinner />
        )}
      </aside>

      <section
        className={cn(
          'min-w-0 flex-1 flex-col overflow-hidden rounded-3xl border border-black/5 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]',
          listOpen ? 'hidden md:flex' : 'flex',
        )}
      >
        <header className="flex items-center gap-2.5 border-b border-black/5 px-3 py-2.5">
          {room ? (
            <button
              onClick={showThreads}
              aria-label="All chats"
              className="-ml-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-zinc-500 transition hover:bg-zinc-100 md:hidden"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          ) : null}
          {thread ? (
            <ThreadIcon title={thread.title} className={cn('h-9 w-9 rounded-xl', thread.archived && 'opacity-60')} />
          ) : (
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-zinc-950 text-lime-400">
              <MessageSquare className="h-[18px] w-[18px]" strokeWidth={2.4} />
            </span>
          )}
          <div className="min-w-0 flex-1 leading-tight">
            <h1 className="truncate font-display text-base font-extrabold uppercase tracking-tight">
              {threadMissing ? 'Thread' : title}
            </h1>
            <p className="truncate text-[11px] font-semibold text-zinc-400">
              {thread
                ? `${thread.archived ? 'Closed · ' : ''}Started by ${thread.created_by === me ? 'you' : shortName(nameOf(thread.created_by, thread.author_name))}`
                : room
                  ? ''
                  : `Everyone · ${teamSize} players`}
            </p>
          </div>

          {!room && (
            <button
              onClick={showThreads}
              className="relative inline-flex shrink-0 items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.1em] text-zinc-700 transition hover:bg-zinc-200 md:hidden"
            >
              <MessagesSquare className="h-4 w-4" />
              Threads
              {threadUnread > 0 ? (
                <UnreadCount n={threadUnread} className="-mr-1" />
              ) : (
                threadFresh && <span className="h-2 w-2 rounded-full bg-lime-500" aria-label="New threads" />
              )}
            </button>
          )}

          {canManage && (
            <div className="relative">
              <button
                onClick={() => setMenuOpen((open) => !open)}
                aria-label="Thread options"
                aria-expanded={menuOpen}
                className="grid h-9 w-9 place-items-center rounded-full text-zinc-500 transition hover:bg-zinc-100"
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 top-full z-40 mt-1 w-48 overflow-hidden rounded-2xl border border-black/5 bg-white py-1 shadow-xl">
                    <MenuItem
                      icon={Pencil}
                      label="Rename"
                      onClick={() => {
                        setMenuOpen(false);
                        setDialog({ kind: 'rename' });
                      }}
                    />
                    {thread.archived ? (
                      <MenuItem icon={LockOpen} label="Reopen thread" onClick={() => setClosed(false)} />
                    ) : (
                      <MenuItem icon={Lock} label="Close thread" onClick={() => setClosed(true)} />
                    )}
                    <MenuItem
                      icon={Trash2}
                      label="Delete thread"
                      danger
                      onClick={() => {
                        setMenuOpen(false);
                        setDialog({ kind: 'deleteThread', thread });
                      }}
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </header>

        <ChatTip />

        {threadMissing ? (
          <div className="grid flex-1 place-items-center p-8 text-center">
            <div>
              <p className="text-sm font-semibold text-zinc-500">This thread isn't here anymore.</p>
              <button
                onClick={() => openRoom(null)}
                className="mt-4 rounded-full bg-zinc-950 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.1em] text-lime-400"
              >
                Go to Team Chat
              </button>
            </div>
          </div>
        ) : loaded && loaded.room === room ? (
          <>
            <Conversation
              key={`messages-${room ?? 'team'}`}
              messages={loaded.messages}
              unreadAfter={loaded.unreadAfter}
              me={me}
              isCaptain={isCaptain}
              reactionsByMessage={reactionsByMessage}
              lookup={lookup}
              nameOf={nameOf}
              isCaptainUser={isCaptainUser}
              hasMore={loaded.hasMore}
              loadingEarlier={loadingEarlier}
              onLoadEarlier={loadEarlier}
              onReact={toggleReaction}
              onReply={reply}
              onCopy={copy}
              onDelete={(message) => setDialog({ kind: 'deleteMessage', message })}
              emptyText={thread ? 'Nothing here yet. Say something to get it going.' : 'No messages yet. Break the ice.'}
            />
            {thread?.archived ? (
              <ClosedNotice canReopen={canManage} onReopen={() => setClosed(false)} />
            ) : (
              <Composer
                key={`composer-${room ?? 'team'}`}
                ref={composer}
                room={room ?? 'team'}
                placeholder={thread ? 'Message this thread' : 'Message the team'}
                replyTo={replyTo}
                replyName={
                  replyTo ? (replyTo.user_id === me ? 'yourself' : shortName(nameOf(replyTo.user_id, replyTo.author_name))) : ''
                }
                onCancelReply={() => setReplyTo(null)}
                onSend={send}
              />
            )}
          </>
        ) : (
          <div className="flex-1">
            <PageSpinner />
          </div>
        )}
      </section>

      <ThreadDialog
        open={dialog?.kind === 'new' || dialog?.kind === 'rename'}
        onOpenChange={(open) => !open && setDialog(null)}
        thread={dialog?.kind === 'rename' ? thread : null}
        onSave={saveThread}
      />
      <ConfirmDialog
        open={dialog?.kind === 'deleteThread' || dialog?.kind === 'deleteMessage'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={dialog?.kind === 'deleteThread' ? 'Delete thread?' : 'Delete message?'}
        body={
          dialog?.kind === 'deleteThread'
            ? `“${dialog.thread.title}” and all its messages will be removed for everyone. To keep them, close the thread instead.`
            : 'It will be removed for everyone.'
        }
        confirmLabel="Delete"
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function MenuItem({ icon: Icon, label, danger, onClick }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-semibold transition hover:bg-zinc-50',
        danger ? 'text-red-600' : 'text-zinc-700',
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}
