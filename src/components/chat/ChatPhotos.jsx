import { useEffect, useRef } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ChevronLeft, ChevronRight, CornerUpLeft, ImageOff, Trash2, X } from 'lucide-react';
import { usePhotoUrl } from '@/hooks/usePhotoUrl';
import { QUICK_REACTIONS, timeLabel } from '@/lib/chat';
import { shortName } from '@/lib/format';
import { isGif } from '@/lib/photos';
import { cn } from '@/lib/utils';

/** Where a photo is shown from: the local copy while it's still sending, else its link. */
function usePhotoSource(photo) {
  const link = usePhotoUrl(photo.preview ? null : photo.path);
  return photo.preview ? { url: photo.preview, retry: () => {}, broken: () => {} } : link;
}

/** One photo, filling its box: grey while it loads, a retry button if it can't be shown. */
function PhotoTile({ photo, label, className, style, disabled, onOpen }) {
  const { url, retry, broken } = usePhotoSource(photo);
  if (url === null) {
    return (
      <button
        type="button"
        onClick={retry}
        aria-label="Photo didn't load. Try again"
        className={cn('grid place-items-center gap-1 bg-zinc-100 p-3 text-center text-[11px] font-semibold text-zinc-500', className)}
        style={style}
      >
        <span className="grid place-items-center gap-1">
          <ImageOff className="h-5 w-5" />
          Photo didn't load. Tap to try again.
        </span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled || !url}
      aria-label={label}
      className={cn('relative block overflow-hidden bg-zinc-200', !url && 'animate-pulse', className)}
      style={style}
    >
      {url && <img src={url} alt="" onError={broken} draggable={false} className="h-full w-full object-cover" />}
      {isGif(photo) && (
        <span className="absolute bottom-2 left-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-black tracking-wider text-white">
          GIF
        </span>
      )}
    </button>
  );
}

/**
 * A message's photos: one at its own shape (very tall ones are cropped until opened),
 * or a grid of 2 to 4. Tapping one opens it full screen. While sending, a progress bar.
 */
export function MessagePhotos({ message, photos, onOpen, className }) {
  const many = photos.length > 1;
  const one = photos[0];
  const label = (i) => (many ? `Open photo ${i + 1} of ${photos.length}` : 'Open photo');
  return (
    <div
      data-photos
      className={cn(
        'relative w-56 max-w-full overflow-hidden rounded-[20px] border border-black/5 sm:w-72',
        many && 'grid grid-cols-2 gap-0.5 bg-white',
        message.pending && 'opacity-80',
        className,
      )}
    >
      {many ? (
        photos.map((photo, i) => (
          <PhotoTile
            key={photo.path || i}
            photo={photo}
            label={label(i)}
            disabled={message.pending}
            onOpen={() => onOpen(i)}
            className={cn('w-full', photos.length === 3 && i === 0 ? 'col-span-2 aspect-[2/1]' : 'aspect-square')}
          />
        ))
      ) : (
        <PhotoTile
          photo={one}
          label={label(0)}
          disabled={message.pending}
          onOpen={() => onOpen(0)}
          className="max-h-80 min-h-24 w-full"
          style={{ aspectRatio: `${one.width} / ${one.height}` }}
        />
      )}
      {message.pending && (
        <div
          role="progressbar"
          aria-label="Uploading"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round((message.progress || 0) * 100)}
          className="absolute inset-x-3 bottom-3 h-1.5 overflow-hidden rounded-full bg-black/30"
        >
          <div className="h-full rounded-full bg-lime-400 transition-[width]" style={{ width: `${(message.progress || 0) * 100}%` }} />
        </div>
      )}
    </div>
  );
}

/**
 * A message's photos full screen: swipe or the arrows between them, and the message's
 * options (reactions, Reply, Delete) along the bottom, since a photo has no bubble to tap.
 */
export function PhotoViewer({
  message,
  photos,
  index,
  onIndex,
  onClose,
  author,
  caption,
  reactions,
  canDelete,
  onReact,
  onReply,
  onDelete,
}) {
  const open = index != null;
  const at = Math.min(index ?? 0, photos.length - 1);
  const photo = photos[at];
  const many = photos.length > 1;
  const { url, retry, broken } = usePhotoSource(photo || {});
  // Reply and Delete run once the viewer has closed, so the message box (or the confirm) gets the focus.
  const after = useRef(null);
  const touch = useRef(null);

  const go = (step) => many && onIndex((at + step + photos.length) % photos.length);

  useEffect(() => {
    if (!open || !many) return undefined;
    const onKey = (e) => {
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, many, at, photos.length]);

  const closeThen = (fn) => {
    after.current = fn;
    onClose();
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(e) => {
            const fn = after.current;
            after.current = null;
            if (fn) {
              e.preventDefault();
              fn();
            }
          }}
          className="fixed inset-0 z-50 flex flex-col text-white outline-none"
        >
          <div className="flex items-center gap-3 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <div className="min-w-0 flex-1 leading-tight">
              <DialogPrimitive.Title className="truncate text-sm font-bold">{shortName(author)}</DialogPrimitive.Title>
              <p className="text-[11px] font-semibold text-white/60">
                {timeLabel(message.created_date)}
                {many && ` · ${at + 1} of ${photos.length}`}
              </p>
            </div>
            <DialogPrimitive.Close
              aria-label="Close photo"
              className="grid h-10 w-10 place-items-center rounded-full bg-white/10 transition hover:bg-white/20"
            >
              <X className="h-5 w-5" />
            </DialogPrimitive.Close>
          </div>

          <div
            className="relative flex min-h-0 flex-1 items-center justify-center px-2"
            onTouchStart={(e) => {
              touch.current = e.touches[0].clientX;
            }}
            onTouchEnd={(e) => {
              const dx = e.changedTouches[0].clientX - (touch.current ?? e.changedTouches[0].clientX);
              if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
              touch.current = null;
            }}
          >
            {url ? (
              <img
                key={photo?.path || at}
                src={url}
                alt={caption || 'Photo'}
                onError={broken}
                className="max-h-full max-w-full rounded-lg object-contain"
              />
            ) : url === null ? (
              <button type="button" onClick={retry} className="grid place-items-center gap-2 text-sm font-semibold text-white/70">
                <ImageOff className="h-7 w-7" />
                Photo didn't load. Tap to try again.
              </button>
            ) : (
              <div className="h-48 w-48 animate-pulse rounded-lg bg-white/10" />
            )}
            {many && (
              <>
                <button
                  type="button"
                  onClick={() => go(-1)}
                  aria-label="Previous photo"
                  className="absolute left-2 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/50 transition hover:bg-black/70"
                >
                  <ChevronLeft className="h-6 w-6" />
                </button>
                <button
                  type="button"
                  onClick={() => go(1)}
                  aria-label="Next photo"
                  className="absolute right-2 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/50 transition hover:bg-black/70"
                >
                  <ChevronRight className="h-6 w-6" />
                </button>
              </>
            )}
          </div>

          <div className="space-y-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
            {caption && <p className="line-clamp-3 whitespace-pre-wrap break-words text-center text-sm font-medium">{caption}</p>}
            <div className="flex flex-wrap items-center justify-center gap-2">
              <div className="flex items-center gap-0.5 rounded-full bg-white/10 p-1">
                {QUICK_REACTIONS.map((emoji) => {
                  const on = reactions.some((r) => r.emoji === emoji && r.mine);
                  return (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => onReact(message, emoji)}
                      aria-label={`React ${emoji}`}
                      aria-pressed={on}
                      className={cn(
                        'grid h-9 w-9 place-items-center rounded-full text-xl transition hover:scale-110 active:scale-90',
                        on && 'bg-lime-400/30',
                      )}
                    >
                      {emoji}
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-1.5">
                <ViewerButton icon={CornerUpLeft} label="Reply" onClick={() => closeThen(() => onReply(message))} />
                {canDelete && <ViewerButton icon={Trash2} label="Delete" danger onClick={() => closeThen(() => onDelete(message))} />}
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function ViewerButton({ icon: Icon, label, danger, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-10 items-center gap-1.5 rounded-full bg-white/10 px-3.5 text-[11px] font-bold uppercase tracking-[0.08em] transition hover:bg-white/20',
        danger ? 'text-red-300' : 'text-white',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
