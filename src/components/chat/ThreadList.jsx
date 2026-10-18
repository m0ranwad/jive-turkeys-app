import { useState } from 'react';
import { Archive, ChevronDown, Hash, Lock, MessageSquare, Users } from 'lucide-react';
import { isLounge, isPrivate, shortWhen, splitLeadingEmoji } from '@/lib/chat';
import { shortName } from '@/lib/format';
import { cn } from '@/lib/utils';

/** The Captains' Lounge: a captain's armband. */
function LoungeIcon({ className }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-lime-400 font-display text-lg font-black leading-none text-black',
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
          <span className={cn('shrink-0 text-[11px] font-semibold', bold ? 'text-lime-700' : 'text-zinc-500')}>
            {shortWhen(summary?.last_message_at)}
          </span>
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span className={cn('min-w-0 flex-1 truncate text-xs', bold ? 'font-semibold text-zinc-700' : 'text-zinc-500')}>
            {preview}
          </span>
          {!active && mentions > 0 && <MentionCount n={mentions} />}
          {!active && isNew && (
            <span className="shrink-0 rounded-full bg-lime-400 px-1.5 py-0.5 text-[11px] font-black uppercase tracking-[0.1em] text-black">
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
        'grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-zinc-950 px-1.5 text-[11px] font-black leading-none text-lime-400',
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
        'grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-lime-400 px-1.5 text-[11px] font-black leading-none text-black',
        className,
      )}
    >
      {n > 99 ? '99+' : n}
    </span>
  );
}

/**
 * Team Chat pinned at the top, then every other open room (the Captains' Lounge
 * for captains, threads and private chats) by latest activity, then closed ones.
 * `notes`: one-time tips shown above the list.
 */
export function ThreadList({ rooms, activeRoom, me, nameOf, onOpen, notes }) {
  const [showClosed, setShowClosed] = useState(false);
  const { team, others, closed } = rooms;
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
    <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain p-2">
      <div className="space-y-2 pb-1 empty:hidden">{notes}</div>
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
      {others.map((room) => item(room))}
      {/* No threads or private chats yet (the Lounge doesn't count): how to start one. */}
      {others.every((room) => isLounge(room.thread)) && (
        <p className="px-2.5 py-3 text-xs leading-relaxed text-zinc-500">
          Tap <b className="text-zinc-600">New</b> for a thread the whole team can join (carpools, pickup games, the
          fantasy league), or a private chat with teammates you pick.
        </p>
      )}

      {closed.length > 0 && (
        <div className="pt-3">
          <button
            onClick={() => setShowClosed((v) => !v)}
            aria-expanded={showClosed}
            className="flex w-full items-center gap-1.5 px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500 transition hover:text-zinc-600"
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
  );
}
