import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import {
  ChevronLeft,
  Lock,
  LockOpen,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { api } from '@/api';
import { PageSpinner } from '@/components/PageSpinner';
import { ConfirmDialog, NewRoomDialog, PeopleDialog, PrivateChatDialog, ThreadDialog } from '@/components/chat/ChatDialogs';
import { ChatSearch } from '@/components/chat/ChatSearch';
import { ClosedNotice, Composer } from '@/components/chat/Composer';
import { NotificationsButton, NotificationsDialog, NotificationsPrompt, usePush } from '@/components/chat/Notifications';
import { Conversation } from '@/components/chat/Conversation';
import { MentionCount, ThreadIcon, ThreadList, UnreadCount } from '@/components/chat/ThreadList';
import { useToast } from '@/components/ui/toast';
import { useTeam } from '@/hooks/useTeam';
import { copyText } from '@/lib/clipboard';
import {
  CHAT_READ_EVENT,
  addReaction,
  bumpOverview,
  canDeleteAny,
  canManageRoom,
  catchUpMessages,
  directChat,
  insertMessage,
  isAfter,
  isLounge,
  isPrivate,
  organizeRooms,
  privateChatTitle,
  readUpTo,
  roomOf,
  roomTitle,
  rememberChatRoom,
  splitLeadingEmoji,
  upsertMember,
  upsertThread,
  waitingElsewhere,
} from '@/lib/chat';
import { friendlyError, saveFailedToast } from '@/lib/errors';
import { chatOutbox, keepOutbox, sendChatMessage } from '@/lib/chat-local';
import { shortName } from '@/lib/format';
import { findMentions, mentionPeople, mentionsMe } from '@/lib/mentions';
import { cn } from '@/lib/utils';

const PAGE = 60;
const TIP_KEY = 'jt_chat_tip_seen';

function tipSeen() {
  try {
    return !!localStorage.getItem(TIP_KEY);
  } catch {
    return true;
  }
}

/** One-time pointer for players coming from Messenger, at the top of the room list. */
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
    <div className="flex items-start gap-2 rounded-2xl bg-lime-50 py-2.5 pl-3 pr-2 text-xs font-medium leading-relaxed text-lime-900 ring-1 ring-lime-200">
      <span className="flex-1">
        <b>Tip:</b> in a chat, tap any message to react, reply or copy it. Tap <b>New</b> to start a thread or a
        private chat.
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

// Who's in each private chat (only the ones this player is in).
const loadMembers = () => api.entities.ChatThreadMember.list();

const WIDE = '(min-width: 768px)';

/** Computers (and tablets) show the room list beside the chat; phones show one or the other. */
function useWide() {
  const [wide, setWide] = useState(() => !!window.matchMedia?.(WIDE).matches);
  useEffect(() => {
    const query = window.matchMedia?.(WIDE);
    if (!query) return undefined;
    const update = () => setWide(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return wide;
}

// How much the visible area must shrink while typing to count as an on-screen keyboard.
const KEYBOARD_PX = 120;

/**
 * Sizes the chat to fill the screen between the header and the bottom tab bar.
 *
 * While typing on a phone, the on-screen keyboard covers the bottom of the page
 * without making it shorter (iPhones do this; the browser then slides the page
 * around), which hid the message box. So while the keyboard is up, the chat
 * pins itself to exactly the part of the screen above the keyboard.
 */
function useChatViewport(ref, ready) {
  const [box, setBox] = useState(null);
  useLayoutEffect(() => {
    if (!ready) return undefined;
    const vv = window.visualViewport;
    let flowTop = null;
    let fullHeight = vv ? vv.height : window.innerHeight;
    const fit = () => {
      const el = ref.current;
      if (!el) return;
      const active = document.activeElement;
      const typing = !!active && el.contains(active) && active.matches('textarea, input');
      if (vv && !typing && vv.scale < 1.05) fullHeight = Math.max(fullHeight, vv.height);
      if (vv && typing && vv.scale < 1.05 && fullHeight - vv.height > KEYBOARD_PX) {
        setBox({ keyboard: true, top: Math.round(vv.offsetTop), height: Math.round(vv.height) });
        return;
      }
      // Where the chat starts on the page, measured while it's in its normal place.
      if (getComputedStyle(el).position !== 'fixed') flowTop = el.getBoundingClientRect().top + window.scrollY;
      if (flowTop == null) return;
      const tabBar = document.querySelector('[data-bottom-nav]');
      const tabBarHeight = tabBar ? tabBar.getBoundingClientRect().height : 0;
      setBox({ keyboard: false, height: Math.max(260, Math.round(window.innerHeight - flowTop - tabBarHeight - 12)) });
    };
    // Focus changes settle a moment later (and the keyboard animates in), so check again after them.
    const soon = () => setTimeout(fit, 0);
    fit();
    window.addEventListener('resize', fit);
    vv?.addEventListener('resize', fit);
    vv?.addEventListener('scroll', fit);
    document.addEventListener('focusin', soon);
    document.addEventListener('focusout', soon);
    return () => {
      window.removeEventListener('resize', fit);
      vv?.removeEventListener('resize', fit);
      vv?.removeEventListener('scroll', fit);
      document.removeEventListener('focusin', soon);
      document.removeEventListener('focusout', soon);
    };
  }, [ref, ready]);

  if (!box) return { keyboard: false, style: { height: 'calc(100vh - 12rem)' } };
  if (!box.keyboard) return { keyboard: false, style: { height: box.height } };
  // Above the site header and tab bar (z-40), below dialogs (z-50).
  return {
    keyboard: true,
    style: {
      position: 'fixed',
      left: 0,
      right: 0,
      top: box.top,
      height: box.height,
      zIndex: 45,
      padding: 6,
      background: '#FAFAF7',
    },
  };
}

export function ChatPage() {
  const { user, profile, profiles, isCaptain, loading } = useTeam();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const wide = useWide();
  // The room on screen: a thread's id, or null for Team Chat (?thread=… or ?room=team). Phones open on
  // the room list (undefined: no room); computers show Team Chat beside the list until another is picked.
  const threadParam = params.get('thread') || null;
  const room = (threadParam || params.get('room') === 'team' || wide) ? threadParam : undefined;
  const listOnly = room === undefined;
  // A teammate's Message button on the Team page: open your private chat with them, or start one.
  const dmWith = params.get('dm');
  const me = user?.id;

  const [threads, setThreads] = useState(null);
  // Who's in your private chats: undefined while loading, null if that failed (say, no signal).
  const [members, setMembers] = useState(undefined);
  const [overview, setOverview] = useState([]);
  const [loaded, setLoaded] = useState(null);
  const [historyRetry, setHistoryRetry] = useState(0);
  const [roomsError, setRoomsError] = useState(null);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [offline, setOffline] = useState(() => !navigator.onLine);
  const [outbox, setOutbox] = useState(() => chatOutbox(me));
  const outboxRef = useRef(outbox);
  const sending = useRef(new Set());
  const roomsRequest = useRef(0);
  const updateOutbox = useCallback((update) => {
    const next = update(outboxRef.current);
    outboxRef.current = next;
    keepOutbox(me, next);
    setOutbox(next);
  }, [me]);
  useEffect(() => {
    outboxRef.current = chatOutbox(me);
    setOutbox(outboxRef.current);
  }, [me]);
  const [reactions, setReactions] = useState([]);
  const [extras, setExtras] = useState({});
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  // Search: the dialog, and a found message to jump to once its room has loaded far enough back.
  const [searchOpen, setSearchOpen] = useState(false);
  const [findTarget, setFindTarget] = useState(null);
  const [focusId, setFocusId] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  // One of your messages being edited in the message box.
  const [editing, setEditing] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [visible, setVisible] = useState(() => !document.hidden);

  const shell = useRef(null);
  const composer = useRef(null);
  const { style: shellStyle } = useChatViewport(shell, !loading);
  const pushStatus = usePush();
  const [notifyOpen, setNotifyOpen] = useState(false);

  // Live handlers read these instead of re-subscribing on every change.
  const live = useRef({});
  live.current = { me, viewing: room, historyFailed: !!loaded?.error };
  // Messages that arrive live while a room's history is still loading.
  const arriving = useRef({ room: undefined, messages: [] });
  const overviewRef = useRef(overview);
  overviewRef.current = overview;
  const membersRef = useRef(members);
  membersRef.current = members;
  const threadsRef = useRef(threads);
  threadsRef.current = threads;

  const refreshOverview = useCallback(() => {
    api.chat
      .overview()
      .then(setOverview)
      .catch(() => {});
  }, []);

  const refreshRooms = useCallback(async () => {
    const run = ++roomsRequest.current;
    setRoomsLoading(true);
    try {
      const [threadRows, summary] = await Promise.all([api.entities.ChatThread.list('-created_date'), api.chat.overview()]);
      if (run !== roomsRequest.current) return;
      setThreads(threadRows);
      setOverview(summary);
      setRoomsError(null);
    } catch (err) {
      if (run === roomsRequest.current) setRoomsError(friendlyError(err));
    } finally {
      if (run === roomsRequest.current) setRoomsLoading(false);
    }
  }, []);

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

  // Each catch-up started; only the latest one's answer lets the room be marked read again.
  const catchUps = useRef(0);

  /**
   * Live updates miss whatever is posted while the page is out of view (a phone asleep, the app in
   * the background) or the connection is down, so then fetch the room summaries and the open room's
   * latest messages, together like opening a room. Until they're in, the room isn't marked read.
   * If this fails, the next return or reconnect tries again.
   */
  const catchUp = useCallback(() => {
    const target = live.current.viewing;
    if (target === undefined) {
      refreshRooms();
      return;
    }
    if (live.current.historyFailed) {
      setHistoryRetry((n) => n + 1);
      return;
    }
    const run = ++catchUps.current;
    setLoaded((current) => (current?.room === target ? { ...current, behind: true, syncing: true, syncError: null } : current));
    Promise.all([api.chat.history(target, { limit: PAGE }), api.chat.overview()])
      .then(([rows, summary]) => {
        if (run !== catchUps.current) return;
        setOverview(summary);
        setLoaded((current) => {
          if (current?.room !== target) return current;
          const { messages, restarted } = catchUpMessages(current.messages, rows, PAGE);
          return { ...current, messages, hasMore: current.hasMore || restarted, behind: false, syncing: false, syncError: null };
        });
        loadReactions(rows);
      })
      .catch((err) => {
        if (run === catchUps.current) setLoaded((current) => current?.room === target ? { ...current, syncing: false, syncError: friendlyError(err) } : current);
      });
  }, [refreshRooms, loadReactions]);

  // Rooms, who's in the private ones, room summaries, and live updates for the whole page.
  useEffect(() => {
    let alive = true;
    refreshRooms();
    // Tried again when the page comes back into view, if it failed.
    const fetchMembers = () =>
      loadMembers()
        .then((rows) => alive && setMembers(rows))
        .catch(() => alive && setMembers((current) => (Array.isArray(current) ? current : null)));
    fetchMembers();

    let refreshTimer;
    let roomsTimer;
    const offThreads = api.entities.ChatThread.subscribe((t) => setThreads((list) => upsertThread(list, t)), {
      onUpdate: (t) => setThreads((list) => upsertThread(list, t)),
      onDelete: ({ id }) => setThreads((list) => list && list.filter((t) => t.id !== id)),
    });
    // You were added to a private chat: fetch the rooms, since it's new to you.
    const reloadRooms = () => {
      clearTimeout(roomsTimer);
      roomsTimer = setTimeout(() => {
        Promise.all([api.entities.ChatThread.list('-created_date'), loadMembers().catch(() => undefined)])
          .then(([threadRows, memberRows]) => {
            if (!alive) return;
            setThreads(threadRows);
            if (memberRows) setMembers(memberRows);
            refreshOverview();
          })
          .catch(() => {});
      }, 300);
    };
    const offMembers = api.entities.ChatThreadMember.subscribe(
      (row) => {
        if (membersRef.current?.some((m) => m.id === row.id)) return;
        // Someone new in a chat you're in: add them to the list.
        if (row.user_id !== live.current.me && threadsRef.current?.some((t) => t.id === row.thread_id)) {
          setMembers((list) => (Array.isArray(list) ? upsertMember(list, row) : list));
        } else reloadRooms();
      },
      {
        // Deletes carry only the id and reach every open page, so only ones in your chats count.
        onDelete: ({ id }) => {
          const gone = membersRef.current?.find((m) => m.id === id);
          if (!gone) return;
          if (gone.user_id === live.current.me) {
            setThreads((list) => list && list.filter((t) => t.id !== gone.thread_id));
            setMembers((list) => list.filter((m) => m.thread_id !== gone.thread_id));
            refreshOverview();
          } else setMembers((list) => list.filter((m) => m.id !== id));
        },
      },
    );
    const offMessages = api.entities.Message.subscribe(
      (m) => {
        const { me: myId, viewing } = live.current;
        const messageRoom = roomOf(m);
        if (arriving.current.room === messageRoom) arriving.current.messages.push(m);
        setOverview((list) => bumpOverview(list, m, m.user_id !== myId && messageRoom !== viewing, mentionsMe(m, myId)));
        setLoaded((current) =>
          current && current.room === messageRoom ? { ...current, messages: insertMessage(current.messages, m) } : current,
        );
      },
      {
        // An edit (yours on another device, or someone else's): the new text, in place.
        onUpdate: (m) => {
          setLoaded((current) =>
            current && { ...current, messages: current.messages.map((x) => (x.id === m.id ? { ...x, ...m } : x)) },
          );
          setOverview((list) => bumpOverview(list, m, false));
          clearTimeout(refreshTimer);
          refreshTimer = setTimeout(refreshOverview, 300);
        },
        onDelete: ({ id }) => {
          setLoaded((current) => current && { ...current, messages: current.messages.filter((m) => m.id !== id) });
          setReactions((list) => list.filter((r) => r.message_id !== id));
          clearTimeout(refreshTimer);
          refreshTimer = setTimeout(refreshOverview, 500);
        },
        // The connection dropped and came back: what was posted in between never arrived.
        onReconnect: catchUp,
      },
    );
    const offReactions = api.entities.MessageReaction.subscribe((r) => setReactions((list) => addReaction(list, r)), {
      onDelete: ({ id }) => setReactions((list) => list.filter((r) => r.id !== id)),
    });
    const onVisibility = () => {
      setVisible(!document.hidden);
      if (document.hidden) return;
      catchUp();
      if (threadsRef.current === null) refreshRooms();
      if (membersRef.current === null) fetchMembers();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const onOnline = () => { setOffline(false); catchUp(); refreshRooms(); };
    const onOffline = () => setOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      alive = false;
      roomsRequest.current += 1;
      clearTimeout(refreshTimer);
      clearTimeout(roomsTimer);
      offThreads();
      offMembers();
      offMessages();
      offReactions();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [toast, refreshOverview, refreshRooms, catchUp]);

  // Open a room: its latest messages, and where the player left off.
  useEffect(() => {
    setReplyTo(null);
    setEditing(null);
    setMenuOpen(false);
    setLoaded(null);
    setReactions([]);
    catchUps.current += 1;
    arriving.current = { room, messages: [] };
    if (room === undefined) return undefined;
    let alive = true;
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
        setLoaded({ room, messages: [], hasMore: false, unreadAfter: null, error: friendlyError(err) });
      });
    return () => {
      alive = false;
    };
  }, [room, historyRetry, loadReactions]);

  // A live echo or reload can confirm a message even when its send response never arrived.
  useEffect(() => {
    const saved = new Set(loaded?.messages.map((m) => m.id));
    if (outbox.some((m) => saved.has(m.id))) updateOutbox((list) => list.filter((m) => !saved.has(m.id)));
  }, [loaded, outbox, updateOutbox]);
  const visibleMessages = useMemo(() => [
    ...(loaded?.messages || []),
    ...outbox.filter((m) => roomOf(m) === room && !loaded?.messages.some((saved) => saved.id === m.id)),
  ], [loaded, outbox, room]);

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

  // While a room is on screen, check in every 15 seconds so this player's phone
  // doesn't buzz for the conversation they're already reading.
  useEffect(() => {
    if (!loaded || !visible) return undefined;
    const checkIn = () => api.chat.viewing(loaded.room).catch(() => {});
    checkIn();
    const timer = setInterval(checkIn, 15000);
    return () => clearInterval(timer);
  }, [loaded?.room, visible]);

  // Mark the open room read while it's on screen: right away when it opens or has
  // caught up on what it missed (so a quick look counts), then shortly after new
  // messages settle. Never while it's catching up.
  const markedRoom = useRef(undefined);
  useEffect(() => {
    if (!loaded || loaded.behind) markedRoom.current = undefined;
    if (!loaded || !visible || loaded.behind) return undefined;
    const last = readUpTo(loaded.messages, me);
    if (!last) return undefined;
    const mark = () => {
      const summary = overviewRef.current.find((o) => o.thread_id === loaded.room);
      if (summary && !summary.unread && !isAfter(last.created_date, summary.last_read_at)) return;
      setOverview((list) =>
        list.map((o) =>
          o.thread_id === loaded.room
            ? {
                ...o,
                unread: 0,
                mentions: 0,
                last_read_at: isAfter(last.created_date, o.last_read_at) ? last.created_date : o.last_read_at,
              }
            : o,
        ),
      );
      api.chat
        .markRead(loaded.room, last.created_date)
        .then(() => window.dispatchEvent(new Event(CHAT_READ_EVENT)))
        .catch(() => {});
    };
    if (markedRoom.current !== loaded.room) {
      markedRoom.current = loaded.room;
      mark();
      return undefined;
    }
    const timer = setTimeout(mark, 600);
    return () => clearTimeout(timer);
  }, [loaded, visible, me]);

  const profilesById = useMemo(() => new Map(profiles.map((p) => [p.user_id, p])), [profiles]);
  const nameOf = useCallback(
    (userId, fallback) => profilesById.get(userId)?.display_name || fallback || 'Player',
    [profilesById],
  );
  const isCaptainUser = useCallback((userId) => !!profilesById.get(userId)?.is_captain, [profilesById]);
  const people = useMemo(() => mentionPeople(profiles), [profiles]);
  // Teammates as the people windows show them, and the ones to start a private chat with or add to one.
  const personOf = useCallback(
    (userId) => {
      const p = profilesById.get(userId);
      return { id: userId, name: p?.display_name || 'Player', gender: p?.gender ?? null, captain: !!p?.is_captain };
    },
    [profilesById],
  );
  const teammates = useMemo(
    () =>
      profiles
        .filter((p) => p.user_id && p.user_id !== me && !p.removed)
        .map((p) => personOf(p.user_id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [profiles, me, personOf],
  );

  const memberList = useMemo(() => (Array.isArray(members) ? members : []), [members]);
  // Rooms as this player sees them: a private chat nobody named shows the other people in it now.
  const shownThreads = useMemo(
    () =>
      threads &&
      threads.map((t) =>
        isPrivate(t) && t.named === false && Array.isArray(members)
          ? { ...t, title: roomTitle(t, { members, me, nameOf }) }
          : t,
      ),
    [threads, members, me, nameOf],
  );

  const thread = room ? shownThreads?.find((t) => t.id === room) : null;
  const threadMissing = !!room && !!threads && !thread;

  // For the Chat tab: the room on screen, or nothing (the list, or a room that's gone).
  useEffect(() => {
    rememberChatRoom(room === undefined || threadMissing ? '' : room ? `?thread=${room}` : '?room=team');
  }, [room, threadMissing]);
  const privateRoom = isPrivate(thread);
  const lounge = isLounge(thread);
  const canManage = canManageRoom(thread, me, isCaptain);
  const roomMembers = useMemo(
    () => (privateRoom ? memberList.filter((m) => m.thread_id === thread.id) : []),
    [memberList, thread, privateRoom],
  );
  // Who can be @mentioned in this room: only the people who can read it. @team only in Team Chat and threads.
  const roomPeople = useMemo(() => {
    if (privateRoom) {
      const ids = new Set(roomMembers.map((m) => m.user_id));
      return people.filter((p) => ids.has(p.id));
    }
    return lounge ? people.filter((p) => isCaptainUser(p.id)) : people;
  }, [people, privateRoom, lounge, roomMembers, isCaptainUser]);
  const canMentionTeam = isCaptain && !privateRoom && !lounge;
  // Who a message mentions (only what's set is sent, so a message without mentions saves the
  // same way it always has).
  const mentionFields = (body, { who = roomPeople, team = canMentionTeam } = {}) => {
    const { mentions, team: everyone } = findMentions(body, who, { me, canMentionTeam: team });
    return { ...(mentions.length && { mentions }), ...(everyone && { mentions_team: true }) };
  };

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

  const rooms = useMemo(() => organizeRooms(shownThreads || [], overview), [shownThreads, overview]);
  const myName = profile?.display_name || user?.full_name || 'Player';

  // A room opened from the list (or its search and New) remembers it, so on phones ‹ goes back like the
  // phone's own back button.
  const openRoom = (id, { replace = false, fromList = false } = {}) =>
    setParams(id ? { thread: id } : { room: 'team' }, { replace, state: fromList ? { fromList: true } : null });
  // Phones: back to the room list. Computers: Team Chat (the list is already there).
  const showList = () => (location.state?.fromList && !wide ? navigate(-1) : setParams({}, { replace: true }));

  // From a teammate's Message button: your open private chat with just them, or a new one.
  useEffect(() => {
    if (!dmWith || !threads || !me || loading || members === undefined) return;
    const existing = members && directChat(threads, members, me, dmWith);
    if (existing) {
      openRoom(existing.id, { replace: true });
      return;
    }
    setParams({}, { replace: true });
    if (members === null) {
      // Without the list we can't tell if you have one already, and a second would be a duplicate.
      toast({ title: "Couldn't open your private chats", description: 'Check your signal and try again.' });
    } else if (teammates.some((p) => p.id === dmWith)) {
      setDialog({ kind: 'private', preselected: dmWith });
    } else if (dmWith !== me) {
      toast({ title: "They're not on the team anymore" });
    }
    // Runs once the rooms and who's in them are in; openRoom, setParams and toast change every render.
  }, [dmWith, threads, members, me, loading, teammates]);

  const deliver = async (pending) => {
    if (sending.current.has(pending.id)) return false;
    sending.current.add(pending.id);
    const target = roomOf(pending);
    updateOutbox((list) => list.map((m) => m.id === pending.id ? { ...m, failed: false, error: null } : m));
    try {
      const created = await sendChatMessage(api, pending);
      setLoaded((current) =>
        current && current.room === target
          ? { ...current, messages: insertMessage(current.messages, created) }
          : current,
      );
      updateOutbox((list) => list.filter((m) => m.id !== pending.id));
      setOverview((list) => bumpOverview(list, created, false));
      return true;
    } catch (err) {
      updateOutbox((list) => list.map((m) => m.id === pending.id ? { ...m, failed: true, error: friendlyError(err) } : m));
      toast({ title: "That didn't send", description: friendlyError(err) });
      return false;
    } finally {
      sending.current.delete(pending.id);
    }
  };

  const enqueue = (target, body, replyId, mentioned) => {
    const pending = {
      id: crypto.randomUUID(), pending: true, user_id: me, author_name: myName, body,
      thread_id: target, reply_to_id: replyId ?? null, ...mentioned, created_date: new Date().toISOString(),
    };
    updateOutbox((list) => [...list, pending]);
    return deliver(pending);
  };

  const send = (body) => {
    if (!me) return false;
    const replyId = replyTo?.id;
    setReplyTo(null);
    return enqueue(room, body, replyId, mentionFields(body));
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
      // A search jump waiting on this stops here instead of asking again and again.
      setFindTarget(null);
      toast({ title: "Couldn't load more", description: err.message });
    } finally {
      setLoadingEarlier(false);
    }
  };

  // A search result: once its room is open, load further back until the message is there, then jump to it.
  useEffect(() => {
    if (!findTarget || !loaded || loaded.room !== findTarget.room || loadingEarlier) return;
    if (loaded.messages.some((m) => m.id === findTarget.id)) {
      setFocusId(findTarget.id);
      setFindTarget(null);
    } else if (loaded.hasMore) {
      loadEarlier();
    } else {
      setFindTarget(null);
      toast({ title: "Couldn't find that message", description: 'It may have been deleted.' });
    }
    // loadEarlier and toast change every render; this runs on what's loaded.
  }, [findTarget, loaded, loadingEarlier]);

  // Leaving that room before the message turns up drops the jump.
  useEffect(() => {
    setFindTarget((target) => (target && target.room !== room ? null : target));
  }, [room]);

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
    setEditing(null);
    setReplyTo(message);
    composer.current?.focus();
  };

  const startEdit = (message) => {
    setReplyTo(null);
    setEditing(message);
  };

  const saveEdit = async (message, body) => {
    const found = mentionFields(body);
    // Who it mentions follows the new text (cleared if the mentions were taken out).
    const mentions =
      found.mentions || found.mentions_team || message.mentions?.length || message.mentions_team
        ? { mentions: found.mentions ?? null, mentions_team: !!found.mentions_team }
        : {};
    try {
      const updated = await api.entities.Message.update(message.id, { body, ...mentions });
      setLoaded((current) =>
        current && { ...current, messages: current.messages.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)) },
      );
      setEditing(null);
      setOverview((list) => bumpOverview(list, updated, false));
      refreshOverview();
      return true;
    } catch (err) {
      toast({ title: "That edit didn't save", description: err.message });
      return false;
    }
  };

  const copy = async (message) => {
    const ok = await copyText(message.body);
    toast({ title: ok ? 'Copied' : "Couldn't copy that" });
  };

  /**
   * A new room's first message. The room already exists, so a failed send doesn't
   * undo it (trying again would start a second one): the message waits in that room's outbox.
   */
  const sendFirst = async (room, body, mentioned) => {
    await enqueue(room, body, null, mentioned);
  };

  const saveThread = async ({ title, first }) => {
    let created;
    try {
      if (dialog.kind === 'rename') {
        const updated = await api.entities.ChatThread.update(thread.id, { title });
        setThreads((list) => upsertThread(list, updated));
        return;
      }
      created = await api.entities.ChatThread.create({ title, created_by: me, author_name: myName });
    } catch (err) {
      toast(saveFailedToast(err));
      throw err;
    }
    setThreads((list) => upsertThread(list, created));
    // The starter has "read" it, so replies count toward their unread badge.
    api.chat.markRead(created.id, created.created_date).catch(() => {});
    if (first) await sendFirst(created.id, first, mentionFields(first, { who: people, team: isCaptain }));
    openRoom(created.id, { fromList: true });
  };

  const savePrivate = async ({ title, userIds, first }) => {
    let created;
    try {
      const others = [...userIds].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
      created = await api.chat.startPrivate(
        title || privateChatTitle([me, ...others].map((id) => shortName(nameOf(id)))),
        userIds,
        { named: !!title },
      );
    } catch (err) {
      toast(saveFailedToast(err));
      throw err;
    }
    setThreads((list) => upsertThread(list, created));
    try {
      setMembers(await loadMembers());
    } catch {
      // The live update brings them.
    }
    api.chat.markRead(created.id, created.created_date).catch(() => {});
    if (first) {
      const inIt = new Set([me, ...userIds]);
      await sendFirst(created.id, first, mentionFields(first, { who: people.filter((p) => inIt.has(p.id)), team: false }));
    }
    openRoom(created.id, { fromList: true });
  };

  const addPeople = async (userIds) => {
    try {
      await api.chat.addMembers(thread.id, userIds);
    } catch (err) {
      toast(saveFailedToast(err));
      throw err;
    }
    try {
      setMembers(await loadMembers());
    } catch {
      // The live update brings them.
    }
    toast({ title: userIds.length === 1 ? `${nameOf(userIds[0])} is in the chat` : `${userIds.length} people added` });
  };

  const removePerson = async (member) => {
    try {
      await api.chat.removeMember(member.thread_id, member.user_id);
      setMembers((list) => list.filter((m) => !(m.thread_id === member.thread_id && m.user_id === member.user_id)));
      toast({ title: `${nameOf(member.user_id)} is out of the chat` });
    } catch (err) {
      toast(saveFailedToast(err));
    }
  };

  const setClosed = async (archived) => {
    setMenuOpen(false);
    try {
      const updated = await api.entities.ChatThread.update(thread.id, { archived });
      setThreads((list) => upsertThread(list, updated));
      const kind = privateRoom ? 'Chat' : 'Thread';
      toast({
        title: archived ? `${kind} closed` : `${kind} reopened`,
        description: archived ? `It moved to Closed ${privateRoom ? 'chats' : 'threads'}.` : undefined,
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
        showList();
        toast({ title: isPrivate(dialog.thread) ? 'Chat deleted' : 'Thread deleted' });
      } else if (dialog.kind === 'leave') {
        await api.chat.leave(dialog.thread.id);
        setThreads((list) => list.filter((t) => t.id !== dialog.thread.id));
        setMembers((list) => (Array.isArray(list) ? list.filter((m) => m.thread_id !== dialog.thread.id) : list));
        showList();
        toast({ title: 'You left the chat' });
      } else {
        await api.entities.Message.delete(dialog.message.id);
        setLoaded((current) => current && { ...current, messages: current.messages.filter((m) => m.id !== dialog.message.id) });
        refreshOverview();
      }
    } catch (err) {
      toast(dialog.kind === 'leave' ? saveFailedToast(err) : { title: "That didn't delete", description: err.message });
      throw err;
    }
  };

  if (loading) return <PageSpinner />;

  const teamSize = profiles.filter((p) => p.status !== 'on_break').length;
  const title = thread ? splitLeadingEmoji(thread.title).text : 'Team Chat';
  const roomKind = privateRoom ? 'chat' : 'thread';
  const subtitle = thread
    ? `${thread.archived ? 'Closed · ' : ''}${
        lounge
          ? `Captains only · ${profiles.filter((p) => p.is_captain && !p.removed).length} captains`
          : privateRoom && !Array.isArray(members)
            ? 'Private'
            : privateRoom
            ? `Private · ${privateChatTitle([
                'You',
                ...roomMembers
                  .filter((m) => m.user_id !== me)
                  .map((m) => shortName(nameOf(m.user_id)))
                  .sort((a, b) => a.localeCompare(b)),
              ])}`
            : `Started by ${thread.created_by === me ? 'you' : shortName(nameOf(thread.created_by, thread.author_name))}`
      }`
    : room
      ? ''
      : `Everyone · ${teamSize} players`;

  const waiting = room === undefined ? null : waitingElsewhere(rooms, room);
  const backLabel = waiting
    ? [
        'All chats',
        waiting.mentions > 0 && `${waiting.mentions} ${waiting.mentions === 1 ? 'mention' : 'mentions'}`,
        waiting.unread > 0 && `${waiting.unread} unread`,
        !waiting.mentions && !waiting.unread && waiting.fresh && 'new threads',
      ]
        .filter(Boolean)
        .join(', ')
    : '';
  const hasOptions = canManage || privateRoom;
  const closeMenuAnd = (next) => () => {
    setMenuOpen(false);
    next();
  };

  return (
    <div ref={shell} data-chat-shell className="flex gap-3" style={shellStyle}>
      <aside
        className={cn(
          'w-full flex-col overflow-hidden rounded-3xl border border-black/5 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] md:flex md:w-64 md:shrink-0',
          listOnly ? 'flex' : 'hidden',
        )}
      >
        {/* Search and notifications cover every room, so they sit above the list. */}
        <div className="flex items-center gap-1 border-b border-black/5 py-2.5 pl-4 pr-2.5">
          <h1 className="min-w-0 flex-1 truncate font-display text-lg font-extrabold uppercase tracking-tight">Chats</h1>
          <button
            onClick={() => setSearchOpen(true)}
            aria-label="Search the chat"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700"
          >
            <Search className="h-5 w-5" />
          </button>
          <NotificationsButton state={pushStatus} onClick={() => setNotifyOpen(true)} />
          <button
            onClick={() => setDialog({ kind: 'pick' })}
            className="ml-1 inline-flex h-9 shrink-0 items-center gap-1 rounded-full bg-lime-400 px-3 text-[11px] font-bold uppercase tracking-[0.1em] text-black transition hover:bg-lime-300"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={3} />
            New
          </button>
        </div>
        {roomsError && <ChatNotice title="Chats didn't load" message={roomsError} busy={roomsLoading} onRetry={refreshRooms} />}
        {threads ? (
          <ThreadList
            rooms={rooms}
            activeRoom={room}
            me={me}
            nameOf={nameOf}
            onOpen={(id) => openRoom(id, { fromList: true })}
            notes={
              <>
                <ChatTip />
                {tipSeen() && <NotificationsPrompt state={pushStatus} />}
              </>
            }
          />
        ) : !roomsError ? (
          <PageSpinner />
        ) : null}
      </aside>

      {!listOnly && (
        <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-3xl border border-black/5 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <header className="flex items-center gap-2.5 border-b border-black/5 px-3 py-2.5">
            {/* Phones: back to the list, with what's waiting in the other rooms, counted like the list rows. */}
            <button
              onClick={showList}
              className="-ml-1 inline-flex h-9 min-w-9 shrink-0 items-center justify-center gap-0.5 rounded-full pr-0.5 text-zinc-500 transition hover:bg-zinc-100 md:hidden"
            >
              {/* Screen readers hear the counts in words; an aria-label would leave out the numbers on screen. */}
              <span className="sr-only">{backLabel}</span>
              <span aria-hidden="true" className="inline-flex items-center gap-0.5">
                <ChevronLeft className="h-5 w-5 shrink-0" />
                {waiting.mentions > 0 && <MentionCount n={waiting.mentions} />}
                {waiting.unread > 0 && <UnreadCount n={waiting.unread} />}
                {!waiting.mentions && !waiting.unread && waiting.fresh && (
                  <span className="mr-1 h-2 w-2 rounded-full bg-lime-500" aria-label="New threads" />
                )}
              </span>
            </button>
            {/* The room's icon on computers; phones keep the space for its name. */}
            {thread ? (
              <ThreadIcon thread={thread} className={cn('hidden h-9 w-9 rounded-xl md:grid', thread.archived && 'opacity-60')} />
            ) : (
              <span className="hidden h-9 w-9 shrink-0 place-items-center rounded-xl bg-zinc-950 text-lime-400 md:grid">
                <MessageSquare className="h-[18px] w-[18px]" strokeWidth={2.4} />
              </span>
            )}
            <div className="min-w-0 flex-1 leading-tight">
              {/* Not in capitals like other headings: a room's name is often long, and wide capitals cut it short. */}
              <h1 className="truncate font-display text-base font-extrabold tracking-tight">
                {threadMissing ? 'Thread' : title}
              </h1>
              <p className="truncate text-[11px] font-semibold text-zinc-500">{subtitle}</p>
            </div>

            {/* One menu for every room, with only what you can do there (Team Chat and the Lounge have none). */}
            {hasOptions && (
              <div className="relative">
                <button
                  onClick={() => setMenuOpen((open) => !open)}
                  aria-label="Chat options"
                  aria-expanded={menuOpen}
                  className="grid h-9 w-9 place-items-center rounded-full text-zinc-500 transition hover:bg-zinc-100"
                >
                  <MoreHorizontal className="h-5 w-5" />
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                    <div className="absolute right-0 top-full z-40 mt-1 w-48 overflow-hidden rounded-2xl border border-black/5 bg-white py-1 shadow-xl">
                      {privateRoom && <MenuItem icon={Users} label="People" onClick={closeMenuAnd(() => setDialog({ kind: 'people' }))} />}
                      {canManage && (
                        <>
                          <MenuItem icon={Pencil} label="Rename" onClick={closeMenuAnd(() => setDialog({ kind: 'rename' }))} />
                          {thread.archived ? (
                            <MenuItem icon={LockOpen} label={`Reopen ${roomKind}`} onClick={() => setClosed(false)} />
                          ) : (
                            <MenuItem icon={Lock} label={`Close ${roomKind}`} onClick={() => setClosed(true)} />
                          )}
                        </>
                      )}
                      {privateRoom && (
                        <MenuItem icon={LogOut} label="Leave chat" onClick={closeMenuAnd(() => setDialog({ kind: 'leave', thread }))} />
                      )}
                      {canManage && (
                        <MenuItem
                          icon={Trash2}
                          label={`Delete ${roomKind}`}
                          danger
                          onClick={closeMenuAnd(() => setDialog({ kind: 'deleteThread', thread }))}
                        />
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </header>

          {offline && !loaded?.error && <ChatNotice title="No connection" message="Your unsent messages stay here." />}
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
          ) : loaded?.error && loaded.room === room ? (
            <div className="grid flex-1 place-items-center p-5"><ChatNotice title="Messages didn't load" message={loaded.error} onRetry={() => setHistoryRetry((n) => n + 1)} /></div>
          ) : loaded && loaded.room === room ? (
            <>
              {(loaded.syncing || loaded.syncError) && <ChatNotice title={loaded.syncing ? 'Updating messages…' : "Couldn't update messages"} message={loaded.syncError} busy={loaded.syncing} onRetry={loaded.syncError ? catchUp : undefined} />}
              <Conversation
                key={`messages-${room ?? 'team'}`}
                messages={visibleMessages}
                unreadAfter={loaded.unreadAfter}
                me={me}
                // Can delete anyone's message: captains, except in private chats.
                isCaptain={canDeleteAny(thread, isCaptain)}
                reactionsByMessage={reactionsByMessage}
                lookup={lookup}
                nameOf={nameOf}
                isCaptainUser={isCaptainUser}
                people={people}
                hasMore={loaded.hasMore}
                loadingEarlier={loadingEarlier}
                onLoadEarlier={loadEarlier}
                onReact={toggleReaction}
                onReply={reply}
                onCopy={copy}
                onDelete={(message) => setDialog({ kind: 'deleteMessage', message })}
                onEdit={startEdit}
                onRetry={deliver}
                onRemoveUnsent={(message) => updateOutbox((list) => list.filter((m) => m.id !== message.id))}
                focusId={focusId}
                onFocused={() => setFocusId(null)}
                emptyText={
                  lounge
                    ? "Only captains can see this room. Plan lineups, subs and anything else that's just for captains."
                    : privateRoom
                      ? 'Only the people in this chat can see it. Say hi.'
                      : thread
                        ? 'Nothing here yet. Say something to get it going.'
                        : 'No messages yet. Break the ice.'
                }
              />
              {thread?.archived ? (
                <ClosedNotice canReopen={canManage} onReopen={() => setClosed(false)} label={`This ${roomKind} is closed.`} />
              ) : (
                <Composer
                  key={`composer-${room ?? 'team'}`}
                  ref={composer}
                  room={room ?? 'team'}
                  placeholder={
                    lounge ? 'Message the captains' : privateRoom ? 'Message this chat' : thread ? 'Message this thread' : 'Message the team'
                  }
                  replyTo={replyTo}
                  replyName={
                    replyTo ? (replyTo.user_id === me ? 'yourself' : shortName(nameOf(replyTo.user_id, replyTo.author_name))) : ''
                  }
                  onCancelReply={() => setReplyTo(null)}
                  onSend={send}
                  editing={editing}
                  onCancelEdit={() => setEditing(null)}
                  onSaveEdit={saveEdit}
                  people={roomPeople}
                  me={me}
                  canMentionTeam={canMentionTeam}
                />
              )}
            </>
          ) : (
            <div className="flex-1">
              <PageSpinner />
            </div>
          )}
        </section>
      )}

      <NotificationsDialog open={notifyOpen} onOpenChange={setNotifyOpen} state={pushStatus} />
      <ChatSearch
        open={searchOpen}
        onOpenChange={setSearchOpen}
        nameOf={nameOf}
        roomName={(id, saved) => shownThreads?.find((t) => t.id === id)?.title ?? saved}
        onPick={(found) => {
          setSearchOpen(false);
          setFindTarget({ room: found.thread_id ?? null, id: found.id });
          openRoom(found.thread_id ?? null, { fromList: true });
        }}
      />
      <NewRoomDialog
        open={dialog?.kind === 'pick'}
        onOpenChange={(open) => !open && setDialog(null)}
        onPick={(kind) => setDialog({ kind })}
      />
      <ThreadDialog
        open={dialog?.kind === 'new' || dialog?.kind === 'rename'}
        onOpenChange={(open) => !open && setDialog(null)}
        thread={dialog?.kind === 'rename' ? thread : null}
        onSave={saveThread}
      />
      <PrivateChatDialog
        open={dialog?.kind === 'private'}
        onOpenChange={(open) => !open && setDialog(null)}
        people={teammates}
        preselected={dialog?.kind === 'private' ? dialog.preselected : null}
        onSave={savePrivate}
      />
      <PeopleDialog
        open={dialog?.kind === 'people' && privateRoom}
        onOpenChange={(open) => !open && setDialog(null)}
        thread={privateRoom ? thread : null}
        members={Array.isArray(members) ? roomMembers : null}
        me={me}
        personOf={personOf}
        people={teammates}
        onAdd={addPeople}
        onRemove={removePerson}
        onLeave={() => setDialog({ kind: 'leave', thread })}
      />
      <ConfirmDialog
        open={dialog?.kind === 'leave'}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Leave this chat?"
        body="You won't see it anymore unless someone in it adds you back. Your messages stay."
        confirmLabel="Leave"
        busyLabel="Leaving…"
        onConfirm={confirmDelete}
      />
      <ConfirmDialog
        open={dialog?.kind === 'deleteThread' || dialog?.kind === 'deleteMessage'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={dialog?.kind === 'deleteThread' ? (isPrivate(dialog.thread) ? 'Delete chat?' : 'Delete thread?') : 'Delete message?'}
        body={
          dialog?.kind === 'deleteThread'
            ? isPrivate(dialog.thread)
              ? `“${dialog.thread.title}” and all its messages will be removed for everyone in it. To keep them, close the chat instead.`
              : `“${dialog.thread.title}” and all its messages will be removed for everyone. To keep them, close the thread instead.`
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

function ChatNotice({ title, message, busy = false, onRetry }) {
  return (
    <div className="m-2 rounded-2xl bg-amber-50 px-3.5 py-3 text-sm text-amber-950 ring-1 ring-amber-200">
      <p className="font-bold">{title}</p>
      {message && <p className="mt-1 text-xs leading-relaxed">{message}</p>}
      {onRetry && <button type="button" disabled={busy} onClick={onRetry} className="mt-2 min-h-11 rounded-full bg-zinc-950 px-4 text-xs font-bold text-white disabled:opacity-50">{busy ? 'Trying…' : 'Try again'}</button>}
    </div>
  );
}
