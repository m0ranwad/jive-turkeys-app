import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  ChevronLeft,
  Lock,
  LockOpen,
  LogOut,
  MessageSquare,
  MessagesSquare,
  MoreHorizontal,
  Pencil,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { api } from '@/api';
import { PageSpinner } from '@/components/PageSpinner';
import { ConfirmDialog, PeopleDialog, PrivateChatDialog, ThreadDialog } from '@/components/chat/ChatDialogs';
import { ChatSearch } from '@/components/chat/ChatSearch';
import { ClosedNotice, Composer } from '@/components/chat/Composer';
import { NotificationsButton, NotificationsDialog, NotificationsPrompt, usePush } from '@/components/chat/Notifications';
import { Conversation } from '@/components/chat/Conversation';
import { MentionCount, ThreadIcon, ThreadList, ThreadStrip, UnreadCount } from '@/components/chat/ThreadList';
import { useToast } from '@/components/ui/toast';
import { useTeam } from '@/hooks/useTeam';
import { copyText } from '@/lib/clipboard';
import {
  CHAT_READ_EVENT,
  addReaction,
  bumpOverview,
  canDeleteAny,
  canManageRoom,
  directChat,
  insertMessage,
  isAfter,
  isLounge,
  isPrivate,
  organizeRooms,
  privateChatTitle,
  roomOf,
  splitLeadingEmoji,
  upsertThread,
} from '@/lib/chat';
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

// Who's in each private chat (only the ones this player is in). Before the
// database has private chats there's nobody, and the chat works as it did.
const loadMembers = () => api.entities.ChatThreadMember.list().catch(() => []);

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
  const room = params.get('thread') || null;
  const listOpen = params.get('view') === 'threads';
  // A teammate's Message button on the Team page: open your private chat with them, or start one.
  const dmWith = params.get('dm');
  const me = user?.id;

  const [threads, setThreads] = useState(null);
  const [members, setMembers] = useState([]);
  const [overview, setOverview] = useState([]);
  const [loaded, setLoaded] = useState(null);
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
  const { style: shellStyle, keyboard } = useChatViewport(shell, !loading);
  const pushStatus = usePush();
  const [notifyOpen, setNotifyOpen] = useState(false);

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

  // Rooms, who's in the private ones, room summaries, and live updates for the whole page.
  useEffect(() => {
    let alive = true;
    Promise.all([api.entities.ChatThread.list('-created_date'), loadMembers(), api.chat.overview()])
      .then(([threadRows, memberRows, summary]) => {
        if (!alive) return;
        setThreads(threadRows);
        setMembers(memberRows);
        setOverview(summary);
      })
      .catch((err) => {
        if (!alive) return;
        setThreads([]);
        toast({ title: "Chat didn't load", description: err.message });
      });

    let refreshTimer;
    let roomsTimer;
    const offThreads = api.entities.ChatThread.subscribe((t) => setThreads((list) => upsertThread(list, t)), {
      onUpdate: (t) => setThreads((list) => upsertThread(list, t)),
      onDelete: ({ id }) => setThreads((list) => list && list.filter((t) => t.id !== id)),
    });
    // Someone added you to a private chat, or took you (or someone else) out: fetch the rooms again.
    const reloadRooms = () => {
      clearTimeout(roomsTimer);
      roomsTimer = setTimeout(() => {
        Promise.all([api.entities.ChatThread.list('-created_date'), loadMembers()])
          .then(([threadRows, memberRows]) => {
            if (!alive) return;
            setThreads(threadRows);
            setMembers(memberRows);
            refreshOverview();
          })
          .catch(() => {});
      }, 300);
    };
    const offMembers = api.entities.ChatThreadMember.subscribe(reloadRooms, { onDelete: reloadRooms });
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
        onUpdate: (m) =>
          setLoaded((current) =>
            current && { ...current, messages: current.messages.map((x) => (x.id === m.id ? { ...x, ...m } : x)) },
          ),
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
      clearTimeout(roomsTimer);
      offThreads();
      offMembers();
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
    setEditing(null);
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

  // While a room is on screen, check in every 15 seconds so this player's phone
  // doesn't buzz for the conversation they're already reading.
  useEffect(() => {
    if (!loaded || listOpen || !visible) return undefined;
    const checkIn = () => api.chat.viewing(loaded.room).catch(() => {});
    checkIn();
    const timer = setInterval(checkIn, 15000);
    return () => clearInterval(timer);
  }, [loaded?.room, listOpen, visible]);

  // Mark the open room read while it's on screen: right away when it opens (so
  // a quick look counts), then shortly after new messages settle.
  const markedRoom = useRef(undefined);
  useEffect(() => {
    if (!loaded || listOpen || !visible) return undefined;
    const last = [...loaded.messages].reverse().find((m) => !m.pending);
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
  }, [loaded, listOpen, visible]);

  const profilesById = useMemo(() => new Map(profiles.map((p) => [p.user_id, p])), [profiles]);
  const nameOf = useCallback(
    (userId, fallback) => profilesById.get(userId)?.display_name || fallback || 'Player',
    [profilesById],
  );
  const isCaptainUser = useCallback((userId) => !!profilesById.get(userId)?.is_captain, [profilesById]);
  const people = useMemo(() => mentionPeople(profiles), [profiles]);
  // Teammates to start a private chat with or add to one.
  const teammates = useMemo(
    () => people.filter((p) => p.id !== me && !p.removed).sort((a, b) => a.name.localeCompare(b.name)),
    [people, me],
  );

  const thread = room ? threads?.find((t) => t.id === room) : null;
  const threadMissing = !!room && !!threads && !thread;
  const privateRoom = isPrivate(thread);
  const lounge = isLounge(thread);
  const canManage = canManageRoom(thread, me, isCaptain);
  const roomMembers = useMemo(
    () => (privateRoom ? members.filter((m) => m.thread_id === thread.id) : []),
    [members, thread, privateRoom],
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

  const rooms = useMemo(() => organizeRooms(threads || [], overview), [threads, overview]);
  const myName = profile?.display_name || user?.full_name || 'Player';

  const openRoom = (id, options) => setParams(id ? { thread: id } : {}, options);
  // Keeps the open room loaded underneath the list on phones.
  const showThreads = () => setParams(room ? { thread: room, view: 'threads' } : { view: 'threads' });

  // From a teammate's Message button: your open private chat with just them, or a new one.
  useEffect(() => {
    if (!dmWith || !threads || !me) return;
    const existing = directChat(threads, members, me, dmWith);
    if (existing) openRoom(existing.id, { replace: true });
    else {
      openRoom(null, { replace: true });
      if (dmWith !== me) setDialog({ kind: 'private', preselected: dmWith });
    }
    // Runs once the rooms are in; openRoom changes every render.
  }, [dmWith, threads, members, me]);

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
      ...mentionFields(body),
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
        ...mentionFields(body),
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
          ...mentionFields(first, { who: people, team: isCaptain }),
        });
      }
      openRoom(created.id);
    } catch (err) {
      toast({ title: "That didn't save", description: err.message });
      throw err;
    }
  };

  const savePrivate = async ({ title, userIds, first }) => {
    try {
      const others = [...userIds].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
      const created = await api.chat.startPrivate(
        title || privateChatTitle([me, ...others].map((id) => shortName(nameOf(id)))),
        userIds,
      );
      setThreads((list) => upsertThread(list, created));
      setMembers(await loadMembers());
      api.chat.markRead(created.id, created.created_date).catch(() => {});
      if (first) {
        const inIt = new Set([me, ...userIds]);
        await api.entities.Message.create({
          user_id: me,
          author_name: myName,
          body: first,
          thread_id: created.id,
          reply_to_id: null,
          ...mentionFields(first, { who: people.filter((p) => inIt.has(p.id)), team: false }),
        });
      }
      openRoom(created.id);
    } catch (err) {
      toast({ title: "That didn't save", description: err.message });
      throw err;
    }
  };

  const addPeople = async (userIds) => {
    try {
      await api.chat.addMembers(thread.id, userIds);
      setMembers(await loadMembers());
      toast({ title: userIds.length === 1 ? `${nameOf(userIds[0])} is in the chat` : `${userIds.length} people added` });
    } catch (err) {
      toast({ title: "That didn't save", description: err.message });
      throw err;
    }
  };

  const removePerson = async (member) => {
    try {
      await api.entities.ChatThreadMember.delete(member.id);
      setMembers((list) => list.filter((m) => m.id !== member.id));
      toast({ title: `${nameOf(member.user_id)} is out of the chat` });
    } catch (err) {
      toast({ title: "That didn't save", description: err.message });
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
        openRoom(null);
        toast({ title: isPrivate(dialog.thread) ? 'Chat deleted' : 'Thread deleted' });
      } else if (dialog.kind === 'leave') {
        const mine = members.find((m) => m.thread_id === dialog.thread.id && m.user_id === me);
        if (mine) await api.entities.ChatThreadMember.delete(mine.id);
        setThreads((list) => list.filter((t) => t.id !== dialog.thread.id));
        setMembers((list) => list.filter((m) => m.thread_id !== dialog.thread.id));
        openRoom(null);
        toast({ title: 'You left the chat' });
      } else {
        await api.entities.Message.delete(dialog.message.id);
        setLoaded((current) => current && { ...current, messages: current.messages.filter((m) => m.id !== dialog.message.id) });
        refreshOverview();
      }
    } catch (err) {
      toast({ title: dialog.kind === 'leave' ? "That didn't work" : "That didn't delete", description: err.message });
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

  return (
    <div ref={shell} data-chat-shell className="flex gap-3" style={shellStyle}>
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
            onNewPrivate={() => setDialog({ kind: 'private' })}
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
            <ThreadIcon thread={thread} className={cn('h-9 w-9 rounded-xl', thread.archived && 'opacity-60')} />
          ) : (
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-zinc-950 text-lime-400">
              <MessageSquare className="h-[18px] w-[18px]" strokeWidth={2.4} />
            </span>
          )}
          <div className="min-w-0 flex-1 leading-tight">
            <h1 className="truncate font-display text-base font-extrabold uppercase tracking-tight">
              {threadMissing ? 'Thread' : title}
            </h1>
            <p className="truncate text-[11px] font-semibold text-zinc-400">{subtitle}</p>
          </div>

          <button
            onClick={() => setSearchOpen(true)}
            aria-label="Search the chat"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
          >
            <Search className="h-5 w-5" />
          </button>
          <NotificationsButton state={pushStatus} onClick={() => setNotifyOpen(true)} />

          {!room && (
            <button
              onClick={showThreads}
              className="relative inline-flex shrink-0 items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.1em] text-zinc-700 transition hover:bg-zinc-200 md:hidden"
            >
              <MessagesSquare className="h-4 w-4" />
              Threads
              {/* Mentions first: one count leaves space for the room's name. */}
              {rooms.mentionsInThreads > 0 ? (
                <MentionCount n={rooms.mentionsInThreads} className="-mr-1" />
              ) : rooms.unreadInThreads > 0 ? (
                <UnreadCount n={rooms.unreadInThreads} className="-mr-1" />
              ) : (
                rooms.freshThreads && <span className="h-2 w-2 rounded-full bg-lime-500" aria-label="New threads" />
              )}
            </button>
          )}

          {(canManage || privateRoom) && (
            <div className="relative">
              <button
                onClick={() => setMenuOpen((open) => !open)}
                aria-label={privateRoom ? 'Chat options' : 'Thread options'}
                aria-expanded={menuOpen}
                className="grid h-9 w-9 place-items-center rounded-full text-zinc-500 transition hover:bg-zinc-100"
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 top-full z-40 mt-1 w-48 overflow-hidden rounded-2xl border border-black/5 bg-white py-1 shadow-xl">
                    {privateRoom && (
                      <MenuItem
                        icon={Users}
                        label="People"
                        onClick={() => {
                          setMenuOpen(false);
                          setDialog({ kind: 'people' });
                        }}
                      />
                    )}
                    {canManage && (
                      <>
                        <MenuItem
                          icon={Pencil}
                          label="Rename"
                          onClick={() => {
                            setMenuOpen(false);
                            setDialog({ kind: 'rename' });
                          }}
                        />
                        {thread.archived ? (
                          <MenuItem icon={LockOpen} label={`Reopen ${roomKind}`} onClick={() => setClosed(false)} />
                        ) : (
                          <MenuItem icon={Lock} label={`Close ${roomKind}`} onClick={() => setClosed(true)} />
                        )}
                      </>
                    )}
                    {privateRoom && (
                      <MenuItem
                        icon={LogOut}
                        label="Leave chat"
                        onClick={() => {
                          setMenuOpen(false);
                          setDialog({ kind: 'leave', thread });
                        }}
                      />
                    )}
                    {canManage && (
                      <MenuItem
                        icon={Trash2}
                        label={`Delete ${roomKind}`}
                        danger
                        onClick={() => {
                          setMenuOpen(false);
                          setDialog({ kind: 'deleteThread', thread });
                        }}
                      />
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </header>

        {/* Phones: every room one tap away (hidden while typing, to keep room above the keyboard). */}
        {threads && !keyboard && (
          <ThreadStrip rooms={rooms} activeRoom={room} onOpen={openRoom} onNewThread={() => setDialog({ kind: 'new' })} />
        )}

        <ChatTip />
        {!keyboard && tipSeen() && <NotificationsPrompt state={pushStatus} />}

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

      <NotificationsDialog open={notifyOpen} onOpenChange={setNotifyOpen} state={pushStatus} />
      <ChatSearch
        open={searchOpen}
        onOpenChange={setSearchOpen}
        nameOf={nameOf}
        onPick={(found) => {
          setSearchOpen(false);
          setFindTarget({ room: found.thread_id ?? null, id: found.id });
          openRoom(found.thread_id ?? null);
        }}
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
        members={roomMembers}
        me={me}
        nameOf={nameOf}
        people={teammates}
        onAdd={addPeople}
        onRemove={removePerson}
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
