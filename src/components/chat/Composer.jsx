import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { CornerUpLeft, Lock, Send, Smile, X } from 'lucide-react';
import { EmojiPicker } from './EmojiPicker';
import { cn } from '@/lib/utils';

const MAX_LENGTH = 2000;
// Unsent text per room, kept while moving between rooms.
const drafts = new Map();

/** Message box: grows with the text, Enter sends on a computer, emoji picker, reply preview. */
export const Composer = forwardRef(function Composer({ room, placeholder, replyTo, replyName, onCancelReply, onSend }, ref) {
  const [draft, setDraft] = useState(() => drafts.get(room) || '');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const box = useRef(null);

  useImperativeHandle(ref, () => ({ focus: () => box.current?.focus() }), []);

  useEffect(() => {
    drafts.set(room, draft);
  }, [room, draft]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [draft]);

  const submit = async () => {
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    setEmojiOpen(false);
    const sent = await onSend(body);
    if (!sent) setDraft((current) => current || body);
  };

  const onKeyDown = (e) => {
    // On a computer Enter sends and Shift+Enter adds a line; on phones Enter adds a line.
    const fineKeyboard = window.matchMedia?.('(pointer: fine)').matches;
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && fineKeyboard) {
      e.preventDefault();
      submit();
    }
    if (e.key === 'Escape' && replyTo) onCancelReply();
  };

  const insertEmoji = (emoji) => {
    const el = box.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? draft.length;
    const next = (draft.slice(0, start) + emoji + draft.slice(end)).slice(0, MAX_LENGTH);
    setDraft(next);
    requestAnimationFrame(() => {
      if (!el) return;
      const caret = start + emoji.length;
      el.setSelectionRange(caret, caret);
    });
  };

  return (
    <div className="relative border-t border-black/5 bg-white p-2.5">
      {emojiOpen && (
        <EmojiPicker onPick={insertEmoji} className="absolute bottom-full left-2.5 right-2.5 mb-2 sm:right-auto sm:w-96" />
      )}
      {replyTo && (
        <div className="mb-2 flex items-center gap-2 rounded-2xl bg-lime-50 px-3 py-2 ring-1 ring-lime-200">
          <CornerUpLeft className="h-4 w-4 shrink-0 text-lime-700" />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="text-[10px] font-black uppercase tracking-[0.1em] text-lime-800">Replying to {replyName}</div>
            <div className="truncate text-xs text-zinc-600">{replyTo.body}</div>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label="Cancel reply"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-zinc-500 transition hover:bg-lime-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex items-end gap-2"
      >
        <button
          type="button"
          onClick={() => setEmojiOpen((open) => !open)}
          aria-label="Emoji"
          aria-pressed={emojiOpen}
          className={cn(
            'grid h-11 w-11 shrink-0 place-items-center rounded-full transition',
            emojiOpen ? 'bg-lime-100 text-lime-700' : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700',
          )}
        >
          <Smile className="h-6 w-6" />
        </button>
        <textarea
          ref={box}
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          maxLength={MAX_LENGTH}
          aria-label="Message"
          className="block max-h-36 min-h-11 flex-1 resize-none rounded-[22px] border border-black/10 bg-zinc-50 px-4 py-[10px] text-base font-medium leading-snug outline-none transition placeholder:text-zinc-400 focus:border-lime-400 focus:bg-white focus:ring-2 focus:ring-lime-200 md:text-sm md:leading-[22px]"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          aria-label="Send"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-zinc-950 text-lime-400 transition hover:bg-zinc-800 active:scale-95 disabled:opacity-30"
        >
          <Send className="h-5 w-5" />
        </button>
      </form>
    </div>
  );
});

export function ClosedNotice({ canReopen, onReopen }) {
  return (
    <div className="flex items-center justify-center gap-3 border-t border-black/5 bg-zinc-50 px-4 py-3.5 text-sm font-semibold text-zinc-500">
      <Lock className="h-4 w-4" />
      This thread is closed.
      {canReopen && (
        <button
          onClick={onReopen}
          className="rounded-full bg-zinc-950 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-lime-400 transition hover:bg-zinc-800"
        >
          Reopen
        </button>
      )}
    </div>
  );
}
