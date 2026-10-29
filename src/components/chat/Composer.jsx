import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { Check, CornerUpLeft, Lock, Pencil, Send, Smile, Users, X } from 'lucide-react';
import { EmojiPicker } from './EmojiPicker';
import { initials } from '@/lib/format';
import { TEAM, mentionChoices, mentionQuery } from '@/lib/mentions';
import { cn } from '@/lib/utils';
import { chatDraft, keepDraft } from '@/lib/chat-local';

const MAX_LENGTH = 2000;
// Tapping Send or an emoji keeps the cursor in the message box, so a phone's keyboard stays open.
const keepTyping = (e) => e.preventDefault();
/**
 * Message box: grows with the text, Enter sends on a computer, emoji picker,
 * reply preview, and a list of teammates to @mention while typing a name after
 * @ (`people`, from mentionPeople(); @team too with `canMentionTeam`). With
 * `editing` (one of your messages), it holds that message's text and saves the
 * change instead of sending.
 */
export const Composer = forwardRef(function Composer(
  {
    room,
    placeholder,
    replyTo,
    replyName,
    onCancelReply,
    onSend,
    editing,
    onCancelEdit,
    onSaveEdit,
    people = [],
    me,
    canMentionTeam = false,
  },
  ref,
) {
  const [draft, setDraft] = useState(() => chatDraft(me, room));
  const [emojiOpen, setEmojiOpen] = useState(false);
  const box = useRef(null);

  // The @mention list: shown while the cursor is in a name typed after @.
  const [caret, setCaret] = useState(null);
  const [pickIndex, setPickIndex] = useState(0);
  const [dismissedAt, setDismissedAt] = useState(null);
  const query = caret == null ? null : mentionQuery(draft, caret);
  const choices = query && query.start !== dismissedAt ? mentionChoices(people, query.query, { me, canMentionTeam }) : [];
  const picking = choices.length > 0;
  const picked = choices[Math.min(pickIndex, choices.length - 1)];
  useEffect(() => {
    setPickIndex(0);
    if (!query) setDismissedAt(null);
  }, [query?.start, query?.query]);
  const trackCaret = (e) => setCaret(document.activeElement === e.target ? e.target.selectionStart : null);

  const pick = (choice) => {
    if (!query) return;
    const insert = `@${choice.label} `;
    const next = (draft.slice(0, query.start) + insert + draft.slice(caret)).slice(0, MAX_LENGTH);
    const at = Math.min(query.start + insert.length, next.length);
    setDraft(next);
    setCaret(at);
    requestAnimationFrame(() => {
      const el = box.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(at, at);
    });
  };

  useImperativeHandle(ref, () => ({ focus: () => box.current?.focus() }), []);

  // The draft you were writing comes back after an edit.
  const draftBeforeEdit = useRef('');
  useEffect(() => {
    if (!editing) return;
    draftBeforeEdit.current = chatDraft(me, room);
    setDraft(editing.body);
    requestAnimationFrame(() => {
      const el = box.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
    // Only when a different message starts being edited.
  }, [editing?.id]);

  useEffect(() => {
    if (!editing) keepDraft(me, room, draft);
  }, [me, room, draft, editing]);

  const stopEditing = () => {
    setDraft(draftBeforeEdit.current);
    onCancelEdit();
  };

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [draft]);

  const submit = async () => {
    const body = draft.trim();
    if (!body) return;
    if (editing) {
      if (body === editing.body) return stopEditing();
      const saved = await onSaveEdit(editing, body);
      if (saved) setDraft(draftBeforeEdit.current);
      return undefined;
    }
    setDraft('');
    keepDraft(me, room, '');
    setEmojiOpen(false);
    await onSend(body);
  };

  const onKeyDown = (e) => {
    if (picking) {
      const move = { ArrowDown: 1, ArrowUp: -1 }[e.key];
      if (move) {
        e.preventDefault();
        setPickIndex((i) => (Math.min(i, choices.length - 1) + move + choices.length) % choices.length);
        return;
      }
      if (((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') && !e.nativeEvent.isComposing) {
        e.preventDefault();
        pick(picked);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissedAt(query.start);
        return;
      }
    }
    // On a computer Enter sends and Shift+Enter adds a line; on phones Enter adds a line.
    const fineKeyboard = window.matchMedia?.('(pointer: fine)').matches;
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && fineKeyboard) {
      e.preventDefault();
      submit();
    }
    if (e.key === 'Escape' && editing) stopEditing();
    else if (e.key === 'Escape' && replyTo) onCancelReply();
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
      {picking && (
        <div
          id={`mentions-${room}`}
          role="listbox"
          aria-label="Mention a teammate"
          className="absolute bottom-full left-2.5 right-2.5 z-10 mb-2 max-h-52 overflow-y-auto overscroll-contain rounded-3xl border border-black/5 bg-white p-1.5 shadow-xl sm:right-auto sm:w-80"
        >
          {choices.map((choice, i) => (
            <div
              key={choice.id}
              id={`mention-${room}-${choice.id}`}
              role="option"
              aria-selected={choice === picked}
              onMouseDown={keepTyping}
              onMouseEnter={() => setPickIndex(i)}
              onClick={() => pick(choice)}
              className={cn(
                'flex cursor-pointer items-center gap-2.5 rounded-2xl px-2.5 py-2 transition',
                choice === picked ? 'bg-lime-100' : 'hover:bg-zinc-50',
              )}
            >
              <span
                className={cn(
                  'grid h-8 w-8 shrink-0 place-items-center rounded-full font-display text-[11px] font-extrabold uppercase',
                  choice.id === TEAM ? 'bg-zinc-950 text-lime-400' : 'bg-lime-400 text-black',
                )}
              >
                {choice.id === TEAM ? <Users className="h-4 w-4" /> : initials(choice.name)}
              </span>
              <span className="min-w-0 leading-tight">
                <span className="block truncate text-sm font-bold text-zinc-900">@{choice.label}</span>
                {choice.name !== choice.label && <span className="block truncate text-[11px] text-zinc-500">{choice.name}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
      {emojiOpen && !picking && (
        <EmojiPicker
          onPick={insertEmoji}
          keepFocus
          className="absolute bottom-full left-2.5 right-2.5 mb-2 sm:right-auto sm:w-96"
        />
      )}
      {editing && (
        <div className="mb-2 flex items-center gap-2 rounded-2xl bg-amber-50 px-3 py-2 ring-1 ring-amber-200">
          <Pencil className="h-4 w-4 shrink-0 text-amber-700" />
          <div className="min-w-0 flex-1 text-[11px] font-black uppercase tracking-[0.1em] text-amber-800">Editing message</div>
          <button
            type="button"
            onClick={stopEditing}
            aria-label="Cancel edit"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-zinc-500 transition hover:bg-amber-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {replyTo && !editing && (
        <div className="mb-2 flex items-center gap-2 rounded-2xl bg-lime-50 px-3 py-2 ring-1 ring-lime-200">
          <CornerUpLeft className="h-4 w-4 shrink-0 text-lime-700" />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="text-[11px] font-black uppercase tracking-[0.1em] text-lime-800">Replying to {replyName}</div>
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
          onMouseDown={keepTyping}
          aria-label="Emoji"
          aria-pressed={emojiOpen}
          className={cn(
            'grid h-11 w-11 shrink-0 place-items-center rounded-full transition',
            emojiOpen ? 'bg-lime-100 text-lime-700' : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700',
          )}
        >
          <Smile className="h-6 w-6" />
        </button>
        <textarea
          ref={box}
          rows={1}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            trackCaret(e);
          }}
          onSelect={trackCaret}
          onBlur={() => setCaret(null)}
          onKeyDown={onKeyDown}
          aria-autocomplete="list"
          aria-controls={picking ? `mentions-${room}` : undefined}
          aria-activedescendant={picking ? `mention-${room}-${picked.id}` : undefined}
          placeholder={placeholder}
          maxLength={MAX_LENGTH}
          aria-label="Message"
          className="block max-h-36 min-h-11 flex-1 resize-none overscroll-contain rounded-[22px] border border-black/10 bg-zinc-50 px-4 py-[10px] text-base font-medium leading-snug outline-none transition placeholder:text-zinc-500 focus:border-lime-400 focus:bg-white focus:ring-2 focus:ring-lime-200 md:text-sm md:leading-[22px]"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          onMouseDown={keepTyping}
          aria-label={editing ? 'Save edit' : 'Send'}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-zinc-950 text-lime-400 transition hover:bg-zinc-800 active:scale-95 disabled:opacity-30"
        >
          {editing ? <Check className="h-5 w-5" /> : <Send className="h-5 w-5" />}
        </button>
      </form>
    </div>
  );
});

export function ClosedNotice({ canReopen, onReopen, label = 'This thread is closed.' }) {
  return (
    <div className="flex items-center justify-center gap-3 border-t border-black/5 bg-zinc-50 px-4 py-3.5 text-sm font-semibold text-zinc-500">
      <Lock className="h-4 w-4" />
      {label}
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
