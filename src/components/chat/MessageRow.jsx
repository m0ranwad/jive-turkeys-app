import { Fragment, useEffect, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Copy, CornerUpLeft, Expand, MoreHorizontal, Pencil, Plus, Trash2, X } from 'lucide-react';
import { EmojiPicker } from './EmojiPicker';
import {
  PHOTO_BODY,
  QUICK_REACTIONS,
  gifOf,
  hasAttachment,
  imageOf,
  isEmojiOnly,
  linkParts,
  timeLabel,
} from '@/lib/chat';
import { usePhotoUrl } from '@/hooks/usePhotoUrl';
import { initials, shortName } from '@/lib/format';
import { TEAM, mentionParts } from '@/lib/mentions';
import { cn } from '@/lib/utils';

/** The message text: links can be tapped, and the people it @mentions stand out (you most of all). */
function Body({ message, mine, me, people }) {
  const mentioned = message.mentions?.length ? people.filter((p) => message.mentions.includes(p.id)) : [];
  const team = !!message.mentions_team;
  return linkParts(message.body).flatMap((part, i) => {
    if (part.href) {
      return (
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
      );
    }
    if (!mentioned.length && !team) return <Fragment key={i}>{part.text}</Fragment>;
    return mentionParts(part.text, mentioned, { team }).map((piece, j) => {
      if (!piece.mention) return <Fragment key={`${i}-${j}`}>{piece.text}</Fragment>;
      const you = !mine && (piece.mention === me || piece.mention === TEAM);
      return (
        <span
          key={`${i}-${j}`}
          data-mention={you ? 'you' : 'other'}
          className={cn(
            'font-bold',
            you ? 'rounded-md bg-lime-300 px-1 text-zinc-950' : mine ? 'text-lime-300' : 'text-lime-700',
          )}
        >
          {piece.text}
        </span>
      );
    });
  });
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
  me,
  people = [],
  selected,
  canDelete,
  canEdit,
  highlighted,
  onSelect,
  onReact,
  onReply,
  onCopy,
  onDelete,
  onEdit,
  onRetry,
  onRemoveUnsent,
  onJumpTo,
  resolvePhotoUrl,
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const gif = gifOf(m);
  const image = imageOf(m);
  const photoUrl = usePhotoUrl(image?.path, resolvePhotoUrl);
  const caption = image && m.body !== PHOTO_BODY ? m.body : null;
  const media = !!(gif || image);
  const big = !media && isEmojiOnly(m.body);

  const bubble = cn(
    'rounded-[20px] px-3.5 py-2 text-[15px] font-medium leading-snug md:text-sm',
    mine ? 'bg-zinc-950 text-white hover:bg-zinc-800' : 'bg-zinc-100 text-zinc-900 hover:bg-zinc-200/80',
    mine ? !first && 'rounded-tr-md' : !first && 'rounded-tl-md',
    mine ? !last && 'rounded-br-md' : !last && 'rounded-bl-md',
  );

  // On a photo, a tap opens it full screen and a long press shows the message's options.
  const pressTimer = useRef(null);
  const longPressed = useRef(false);
  const cancelPress = () => clearTimeout(pressTimer.current);
  const startPress = () => {
    longPressed.current = false;
    cancelPress();
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      if (!m.pending && !selected) onSelect(m.id);
    }, 450);
  };
  useEffect(() => cancelPress, []);
  const openOptions = () => {
    setFullscreen(false);
    if (!selected) onSelect(m.id);
  };

  return (
    <div data-message-id={m.id} className={first ? 'mt-3' : 'mt-0.5'}>
      <div className={cn('flex gap-2', mine ? 'flex-row-reverse' : 'flex-row')}>
        {!mine && (
          <div className="w-8 shrink-0 self-end">
            {last && (
              <span className="grid h-8 w-8 place-items-center rounded-full bg-lime-400 font-display text-[11px] font-extrabold uppercase text-black">
                {initials(author)}
              </span>
            )}
          </div>
        )}
        <div className={cn('flex min-w-0 max-w-[80%] flex-col sm:max-w-[70%]', mine ? 'items-end' : 'items-start')}>
          {first && !mine && (
            <div className="mb-1 ml-3 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-zinc-500">
              {shortName(author)}
              {isCaptainAuthor && (
                <span className="rounded bg-lime-400 px-1 py-px text-[11px] tracking-[0.12em] text-black">Capt</span>
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
            aria-label={
              gif
                ? `GIF${gif.title ? `: ${gif.title}` : ''}`
                : image
                  ? caption
                    ? `Photo: ${caption}`
                    : 'Photo'
                  : undefined
            }
            className={cn(
              'max-w-full cursor-pointer text-left outline-none transition focus-visible:ring-2 focus-visible:ring-lime-400',
              media ? 'overflow-hidden rounded-[20px] bg-zinc-100' : big ? 'px-1 text-4xl leading-tight' : bubble,
              selected && (big ? 'rounded-2xl bg-lime-100' : 'ring-2 ring-lime-400 ring-offset-1'),
              highlighted && 'ring-2 ring-amber-300 ring-offset-1',
              m.pending && !m.failed && 'opacity-60',
              m.failed && 'ring-1 ring-red-300',
            )}
          >
            {gif ? (
              // About 240px wide at most, keeping its shape so the chat doesn't jump as it loads.
              <img
                src={gif.url}
                alt=""
                width={gif.width}
                height={gif.height}
                loading="lazy"
                decoding="async"
                data-gif
                className="block h-auto max-w-full"
                style={{ width: `${Math.min(gif.width, 240)}px`, aspectRatio: `${gif.width} / ${gif.height}` }}
              />
            ) : image ? (
              <>
                {photoUrl ? (
                  <button
                    type="button"
                    aria-label="View photo"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (longPressed.current) {
                        longPressed.current = false;
                        return;
                      }
                      setFullscreen(true);
                    }}
                    onPointerDown={startPress}
                    onPointerUp={cancelPress}
                    onPointerLeave={cancelPress}
                    onPointerCancel={cancelPress}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      cancelPress();
                      if (!m.pending && !selected) onSelect(m.id);
                    }}
                    className="block select-none [-webkit-touch-callout:none]"
                  >
                    <img
                      src={photoUrl}
                      alt=""
                      width={image.width}
                      height={image.height}
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                      data-photo
                      className="block h-auto max-w-full"
                      style={{ width: `${Math.min(image.width, 240)}px`, aspectRatio: `${image.width} / ${image.height}` }}
                    />
                  </button>
                ) : (
                  <div
                    className="bg-zinc-200"
                    style={{ width: `${Math.min(image.width, 240)}px`, aspectRatio: `${image.width} / ${image.height}` }}
                    aria-hidden
                  />
                )}
                {caption && (
                  <div
                    className={cn(
                      'whitespace-pre-wrap break-words px-3.5 py-2 text-[15px] font-medium leading-snug md:text-sm',
                      mine ? 'bg-zinc-950 text-white' : 'bg-zinc-100 text-zinc-900',
                    )}
                  >
                    <Body message={{ ...m, body: caption }} mine={mine} me={me} people={people} />
                  </div>
                )}
              </>
            ) : (
              <span className="whitespace-pre-wrap break-words">
                <Body message={m} mine={mine && !big} me={me} people={people} />
              </span>
            )}
            {m.edited_date && !media && (
              <span className={cn('ml-1.5 align-baseline text-[11px] font-semibold', big ? 'text-zinc-500' : 'opacity-75')}>edited</span>
            )}
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

          {(last || selected || m.pending) && (
            <div className={cn('mt-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500', mine ? 'mr-2' : 'ml-3')}>
              {m.failed ? 'Not sent' : m.pending ? 'Sending…' : timeLabel(m.created_date)}
            </div>
          )}
          {m.failed && (
            <div className="mt-1 max-w-full text-right">
              {m.error && <p className="text-xs text-red-700">{m.error}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => onRetry(m)} className="min-h-11 rounded-full px-3 text-xs font-bold text-lime-700 hover:bg-lime-50">Retry</button>
                <button type="button" onClick={() => onRemoveUnsent(m)} className="min-h-11 rounded-full px-3 text-xs font-bold text-zinc-600 hover:bg-zinc-100">Remove</button>
              </div>
            </div>
          )}
        </div>
        {/* Empty space beside the bubble: same as tapping the message (iMessage-style). */}
        {!m.pending && (
          <div
            aria-hidden="true"
            data-message-gutter
            onClick={() => onSelect(m.id)}
            className="flex-1 cursor-pointer self-stretch"
          />
        )}
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
                    'grid h-9 w-9 place-items-center rounded-full text-xl transition motion-safe:hover:scale-110 active:scale-90',
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
            {image && photoUrl && <ActionButton icon={Expand} label="View" onClick={() => setFullscreen(true)} />}
            {!hasAttachment(m) && <ActionButton icon={Copy} label="Copy" onClick={() => onCopy(m)} />}
            {canEdit && <ActionButton icon={Pencil} label="Edit" onClick={() => onEdit(m)} />}
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

      <DialogPrimitive.Root open={fullscreen && !!photoUrl} onOpenChange={(open) => !open && setFullscreen(false)}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/90" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed inset-0 z-50 flex flex-col items-center justify-center p-4 text-white outline-none"
            onCloseAutoFocus={(e) => e.preventDefault()}
            onClick={(e) => {
              if (e.target === e.currentTarget) setFullscreen(false);
            }}
          >
            <DialogPrimitive.Title className="sr-only">Photo</DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label="Close photo"
              className="absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
            >
              <X className="h-5 w-5" />
            </DialogPrimitive.Close>
            <img
              src={photoUrl}
              alt={caption || 'Photo'}
              className="max-h-[calc(100%-5rem)] max-w-full object-contain"
            />
            {!m.pending && (
              <div className="absolute inset-x-0 bottom-0 flex justify-center gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                <button
                  type="button"
                  onClick={() => {
                    setFullscreen(false);
                    onReply(m);
                  }}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white/15 px-4 text-xs font-bold uppercase tracking-[0.08em] text-white transition hover:bg-white/25"
                >
                  <CornerUpLeft className="h-4 w-4" />
                  Reply
                </button>
                <button
                  type="button"
                  onClick={openOptions}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white/15 px-4 text-xs font-bold uppercase tracking-[0.08em] text-white transition hover:bg-white/25"
                >
                  <MoreHorizontal className="h-4 w-4" />
                  Options
                </button>
              </div>
            )}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
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
