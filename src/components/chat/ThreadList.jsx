import { useEffect, useRef, useState } from 'react';
import { Archive, ChevronDown, Hash, Lock, MessageSquare, Plus, Users } from 'lucide-react';
import { isLounge, isPrivate, shortWhen, splitLeadingEmoji } from '@/lib/chat';
import { shortName } from '@/lib/format';
import { cn } from '@/lib/utils';

/** The Captains' Lounge: a captain's armband. */
function LoungeIcon({ className, small }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center bg-lime-400 font-display font-black leading-none text-black',
        small ? 'h-4 w-4 rounded-md text-[10px]' : 'h-10 w-10 rounded-2xl text-lg',
        className,
      )}
    >
      C
    </span>
  );
}

/** A thread's icon (its leading emoji, or #); a private chat's has a lock on it; the Lounge has its own. */
export function ThreadIcon({ thread, className }) {
  if (isLounge(thread)) return <LoungeIcon className={className} />;
  const { emoji } = splitLeadingEmoji(thread.title);
  const locked = isPrivate(thread);
  return (
    <span className={cn('relative grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-zinc-100 text-zinc-500', className)}>
      {emoji ? (
        <span className="text-xl leading-none">{emoji}</span>
      ) : locked ? (
        <Users className="h-5 w-5" />
      ) : (
        <Hash className="h-5 w-5" />
      )}
      {locked && (
        <span
          aria-label="Private"
          className="absolute -bottom-1 -right-1 grid h-[18px] w-[18px] place-items-center rounded-full bg-zinc-950 text-lime-400 ring-2 ring-white"
        >
          <Lock className="h-2.5 w-2.5" strokeWidth={3} />
        </span>
      )}
    </span>
  );
}

function RoomItem({ room, icon, title, summary, active, unread, mentions, isNew, me, nameOf, onClick }) {
  const preview = summary
    ? `${summary.last_user_id === me ? 'You' : shortName(nameOf(summary.last_user_id, summary.last_author_name))}: ${summary.last_body}`
    : 'No messages yet';
  const bold = !active && (unread > 0 || isNew);
  return (
    <button
      onClick={onClick}
      data-room={room}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex w-full items-center gap-3 rounded-2xl px-2.5 py-2.5 text-left transition',
        active ? 'bg-lime-100/70 ring-1 ring-lime-300' : 'hover:bg-zinc-50',
      )}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-sm',
              bold ? 'font-extrabold text-zinc-950' : 'font-semibold text-zinc-800',
            )}
          >
            {title}
          </span>
          <span className={cn('shrink-0 text-[10px] font-semibold', bold ? 'text-lime-700' : 'text-zinc-400')}>
            {shortWhen(summary?.last_message_at)}
          </span>
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span className={cn('min-w-0 flex-1 truncate text-xs', bold ? 'font-semibold text-zinc-700' : 'text-zinc-400')}>
            {preview}
          </span>
          {!active && mentions > 0 && <MentionCount n={mentions} />}
          {!active && isNew && (
            <span className="shrink-0 rounded-full bg-lime-400 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.1em] text-black">
              New
            </span>
          )}
          {!active && !isNew && unread > 0 && <UnreadCount n={unread} />}
        </span>
      </span>
    </button>
  );
}

/** Unread messages that @mention you, apart from the unread number so they stand out. */
export function MentionCount({ n, className }) {
  return (
    <span
      aria-label={`${n} ${n === 1 ? 'mention' : 'mentions'}`}
      className={cn(
        'grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-zinc-950 px-1.5 text-[10px] font-black leading-none text-lime-400',
        className,
      )}
    >
      @{n > 99 ? '99+' : n}
    </span>
  );
}

export function UnreadCount({ n, className }) {
  return (
    <span
      aria-label={`${n} unread`}
      className={cn(
        'grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-lime-400 px-1.5 text-[10px] font-black leading-none text-black',
        className,
      )}
    >
      {n > 99 ? '99+' : n}
    </span>
  );
}

function SectionHeader({ label, newLabel, onNew }) {
  return (
    <div className="flex items-center justify-between px-2.5 pb-1 pt-4">
      <span className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">{label}</span>
      <button
        onClick={onNew}
        aria-label={newLabel}
        className="inline-flex items-center gap-1 rounded-full bg-lime-400 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-black transition hover:bg-lime-300"
      >
        <Plus className="h-3 w-3" strokeWidth={3} /> New
      </button>
    </div>
  );
}

/**
 * Team Chat at the top, then the Captains' Lounge (captains only), open threads
 * and private chats by latest activity, then closed ones.
 */
export function ThreadList({ rooms, activeRoom, me, nameOf, onOpen, onNewThread, onNewPrivate }) {
  const [showClosed, setShowClosed] = useState(false);
  const { team, lounge, open, privateChats, closed } = rooms;
  const item = (room, extra = {}) => (
    <RoomItem
      key={room.thread.id}
      room={room.thread.id}
      icon={<ThreadIcon thread={room.thread} />}
      title={splitLeadingEmoji(room.thread.title).text}
      summary={room.summary}
      unread={room.unread}
      mentions={room.mentions}
      isNew={room.isNew}
      active={activeRoom === room.thread.id}
      me={me}
      nameOf={nameOf}
      onClick={() => onOpen(room.thread.id)}
      {...extra}
    />
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        <RoomItem
          room="team"
          icon={
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-zinc-950 text-lime-400">
              <MessageSquare className="h-5 w-5" strokeWidth={2.4} />
            </span>
          }
          title="Team Chat"
          summary={team.summary}
          unread={team.unread}
          mentions={team.mentions}
          active={activeRoom === null}
          me={me}
          nameOf={nameOf}
          onClick={() => onOpen(null)}
        />
        {lounge && item(lounge)}

        <SectionHeader label="Threads" newLabel="New thread" onNew={onNewThread} />
        {open.length === 0 && (
          <p className="px-2.5 py-2 text-xs leading-relaxed text-zinc-400">
            Side conversations live here: carpools, pickup games, the fantasy league. Start one with New.
          </p>
        )}
        {open.map((room) => item(room))}

        <SectionHeader label="Private chats" newLabel="New private chat" onNew={onNewPrivate} />
        {privateChats.length === 0 && (
          <p className="px-2.5 py-2 text-xs leading-relaxed text-zinc-400">
            Just you and the teammates you pick. Nobody else sees them, captains included.
          </p>
        )}
        {privateChats.map((room) => item(room))}

        {closed.length > 0 && (
          <div className="pt-3">
            <button
              onClick={() => setShowClosed((v) => !v)}
              aria-expanded={showClosed}
              className="flex w-full items-center gap-1.5 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400 transition hover:text-zinc-600"
            >
              <Archive className="h-3 w-3" /> Closed ({closed.length})
              {/* What came in before they closed still counts on the Chat tab, so it shows here too. */}
              {!showClosed && rooms.unreadInClosed > 0 && <UnreadCount n={rooms.unreadInClosed} className="ml-1" />}
              <ChevronDown className={cn('ml-auto h-3.5 w-3.5 transition', showClosed && 'rotate-180')} />
            </button>
            {showClosed &&
              closed.map((room) =>
                item(room, {
                  icon: <ThreadIcon thread={room.thread} className="opacity-60" />,
                  unread: room.followed ? room.unread : 0,
                  isNew: false,
                }),
              )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Phones: a row of every open room under the chat header, so threads are one tap away. */
export function ThreadStrip({ rooms, activeRoom, onOpen, onNewThread }) {
  const strip = useRef(null);

  // Bring the room you're in into view.
  useEffect(() => {
    const el = strip.current;
    const chip = el?.querySelector('[aria-current="page"]');
    if (!chip) return;
    const left = chip.offsetLeft - el.offsetLeft;
    if (left < el.scrollLeft || left + chip.offsetWidth > el.scrollLeft + el.clientWidth) {
      el.scrollTo({ left: Math.max(0, left - 12), behavior: 'smooth' });
    }
  }, [activeRoom]);

  const chip = (active) =>
    cn(
      'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-bold transition',
      active ? 'bg-zinc-950 text-lime-400' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200',
    );

  return (
    <nav
      ref={strip}
      aria-label="Rooms"
      className="flex gap-2 overflow-x-auto border-b border-black/5 px-3 py-2 [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden"
    >
      <button
        data-strip-room="team"
        onClick={() => onOpen(null)}
        aria-current={activeRoom === null ? 'page' : undefined}
        className={chip(activeRoom === null)}
      >
        <MessageSquare className="h-3.5 w-3.5" strokeWidth={2.6} />
        Team Chat
        {activeRoom !== null && rooms.team.mentions > 0 && <MentionCount n={rooms.team.mentions} />}
        {activeRoom !== null && rooms.team.unread > 0 && <UnreadCount n={rooms.team.unread} />}
      </button>
      {[rooms.lounge, ...rooms.open, ...rooms.privateChats].filter(Boolean).map((room) => {
        const active = activeRoom === room.thread.id;
        const { emoji, text } = splitLeadingEmoji(room.thread.title);
        return (
          <button
            key={room.thread.id}
            data-strip-room={room.thread.id}
            onClick={() => onOpen(room.thread.id)}
            aria-current={active ? 'page' : undefined}
            className={chip(active)}
          >
            {isLounge(room.thread) ? (
              <LoungeIcon small />
            ) : emoji ? (
              <span className="text-sm leading-none">{emoji}</span>
            ) : (
              !isPrivate(room.thread) && <Hash className="h-3.5 w-3.5" />
            )}
            {isPrivate(room.thread) && <Lock aria-label="Private" className="h-3.5 w-3.5" strokeWidth={2.6} />}
            <span className="max-w-[10rem] truncate">{text}</span>
            {!active && room.mentions > 0 && <MentionCount n={room.mentions} />}
            {!active && room.isNew && <span aria-label="New" className="h-2 w-2 rounded-full bg-lime-500" />}
            {!active && !room.isNew && room.unread > 0 && <UnreadCount n={room.unread} />}
          </button>
        );
      })}
      <button
        onClick={onNewThread}
        aria-label="New thread"
        className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full border border-dashed border-zinc-300 px-3 text-xs font-bold text-zinc-500 transition hover:border-lime-400 hover:text-zinc-800"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={3} />
        {rooms.open.length ? 'New' : 'Start a thread'}
      </button>
    </nav>
  );
}
