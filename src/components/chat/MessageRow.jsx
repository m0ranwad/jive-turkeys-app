import { Fragment, useState } from 'react';
import { Copy, CornerUpLeft, Plus, Trash2 } from 'lucide-react';
import { EmojiPicker } from './EmojiPicker';
import { QUICK_REACTIONS, isEmojiOnly, linkParts, timeLabel } from '@/lib/chat';
import { initials, shortName } from '@/lib/format';
import { cn } from '@/lib/utils';

function Body({ text, mine }) {
  return linkParts(text).map((part, i) =>
    part.href ? (
      <a
        key={i}
        href={part.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={cn('break-all underline underline-offset-2', mine ? 'text-lime-300' : 'text-lime-700')}
      >
        {part.text}
      </a>
    ) : (
      <Fragment key={i}>{part.text}</Fragment>
    ),
  );
}

/** One chat message: name, reply quote, bubble, reactions, and its actions when tapped. */
export function MessageRow({
  message: m,
  first,
  last,
  mine,
  author,
  isCaptainAuthor,
  replyTarget,
  replyAuthor,
  reactions,
  nameOf,
  selected,
  canDelete,
  highlighted,
  onSelect,
  onReact,
  onReply,
  onCopy,
  onDelete,
  onJumpTo,
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const big = isEmojiOnly(m.body);

  const bubble = cn(
    'rounded-[20px] px-3.5 py-2 text-[15px] font-medium leading-snug md:text-sm',
    mine ? 'bg-zinc-950 text-white hover:bg-zinc-800' : 'bg-zinc-100 text-zinc-900 hover:bg-zinc-200/80',
    mine ? !first && 'rounded-tr-md' : !first && 'rounded-tl-md',
    mine ? !last && 'rounded-br-md' : !last && 'rounded-bl-md',
  );

  return (
    <div data-message-id={m.id} className={first ? 'mt-3' : 'mt-0.5'}>
      <div className={cn('flex gap-2', mine ? 'flex-row-reverse' : 'flex-row')}>
        {!mine && (
          <div className="w-8 shrink-0 self-end">
            {last && (
              <span className="grid h-8 w-8 place-items-center rounded-full bg-lime-400 font-display text-[10px] font-extrabold uppercase text-black">
                {initials(author)}
              </span>
            )}
          </div>
        )}
        <div className={cn('flex min-w-0 max-w-[80%] flex-col sm:max-w-[70%]', mine ? 'items-end' : 'items-start')}>
          {first && !mine && (
            <div className="mb-1 ml-3 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.1em] text-zinc-500">
              {shortName(author)}
              {isCaptainAuthor && (
                <span className="rounded bg-lime-400 px-1 py-px text-[8px] tracking-[0.12em] text-black">Capt</span>
              )}
            </div>
          )}

          {m.reply_to_id && (
            <button
              type="button"
              onClick={() => replyTarget && onJumpTo(replyTarget.id)}
              className={cn(
                'mb-0.5 flex max-w-full items-start gap-1.5 rounded-2xl border border-black/5 bg-white px-3 py-1.5 text-left text-xs text-zinc-500',
                mine ? 'mr-1' : 'ml-1',
              )}
            >
              <CornerUpLeft className="mt-px h-3 w-3 shrink-0 text-lime-600" />
              {replyTarget ? (
                <span className="min-w-0">
                  <span className="font-bold text-zinc-700">{shortName(replyAuthor)}</span>{' '}
                  <span className="line-clamp-2 break-words">{replyTarget.body}</span>
                </span>
              ) : (
                <span className="italic">Original message was deleted</span>
              )}
            </button>
          )}

          {/* A div, not a button, because the message can contain links. */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => !m.pending && onSelect(m.id)}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && !m.pending) {
                e.preventDefault();
                onSelect(m.id);
              }
            }}
            aria-expanded={selected}
            className={cn(
              'max-w-full cursor-pointer text-left outline-none transition focus-visible:ring-2 focus-visible:ring-lime-400',
              big ? 'px-1 text-4xl leading-tight' : bubble,
              selected && (big ? 'rounded-2xl bg-lime-100' : 'ring-2 ring-lime-400 ring-offset-1'),
              highlighted && 'ring-2 ring-amber-300 ring-offset-1',
              m.pending && 'opacity-60',
            )}
          >
            <span className="whitespace-pre-wrap break-words">
              <Body text={m.body} mine={mine && !big} />
            </span>
          </div>

          {reactions.length > 0 && (
            <div className={cn('-mt-1 flex flex-wrap gap-1', mine ? 'mr-2 justify-end' : 'ml-2')}>
              {reactions.map((r) => (
                <button
                  key={r.emoji}
                  type="button"
                  onClick={() => onReact(m, r.emoji)}
                  title={r.userIds.map((id) => shortName(nameOf(id))).join(', ')}
                  aria-label={`${r.emoji} ${r.count}${r.mine ? ', including you' : ''}`}
                  aria-pressed={r.mine}
                  className={cn(
                    'flex h-6 items-center gap-1 rounded-full border px-1.5 text-xs font-bold shadow-sm transition active:scale-95',
                    r.mine
                      ? 'border-lime-400 bg-lime-100 text-lime-900'
                      : 'border-black/5 bg-white text-zinc-600 hover:bg-zinc-50',
                  )}
                >
                  <span className="text-sm leading-none">{r.emoji}</span>
                  {r.count > 1 && r.count}
                </button>
              ))}
            </div>
          )}

          {(last || selected) && (
            <div className={cn('mt-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400', mine ? 'mr-2' : 'ml-3')}>
              {m.pending ? 'Sending…' : timeLabel(m.created_date)}
            </div>
          )}
        </div>
      </div>

      {selected && (
        <div
          className={cn('mt-1.5 space-y-2', mine ? 'ml-auto flex w-72 max-w-full flex-col items-end' : 'w-80 max-w-full pl-10')}
        >
          <div className="flex items-center gap-0.5 rounded-full border border-black/5 bg-white p-1 shadow-lg">
            {QUICK_REACTIONS.map((emoji) => {
              const on = reactions.some((r) => r.emoji === emoji && r.mine);
              return (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onReact(m, emoji, true)}
                  aria-label={`React ${emoji}`}
                  aria-pressed={on}
                  className={cn(
                    'grid h-9 w-9 place-items-center rounded-full text-xl transition hover:scale-110 active:scale-90',
                    on && 'bg-lime-100',
                  )}
                >
                  {emoji}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setPickerOpen((open) => !open)}
              aria-label="More reactions"
              aria-pressed={pickerOpen}
              className="grid h-9 w-9 place-items-center rounded-full bg-zinc-100 text-zinc-500 transition hover:bg-zinc-200"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          {pickerOpen && (
            <EmojiPicker
              className="w-full"
              onPick={(emoji) => {
                setPickerOpen(false);
                onReact(m, emoji, true);
              }}
            />
          )}
          <div className="flex gap-1.5">
            <ActionButton icon={CornerUpLeft} label="Reply" onClick={() => onReply(m)} />
            <ActionButton icon={Copy} label="Copy" onClick={() => onCopy(m)} />
            {canDelete && <ActionButton icon={Trash2} label="Delete" danger onClick={() => onDelete(m)} />}
          </div>
          {reactions.length > 0 && (
            <div className="w-full rounded-2xl bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
              {reactions.map((r) => (
                <div key={r.emoji} className="flex gap-2 py-0.5">
                  <span>{r.emoji}</span>
                  <span className="min-w-0">{r.userIds.map((id) => shortName(nameOf(id))).join(', ')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ActionButton({ icon: Icon, label, danger, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-black/5 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em] shadow-sm transition',
        danger ? 'text-red-600 hover:bg-red-50' : 'text-zinc-700 hover:bg-zinc-50',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
