import { useState } from 'react';
import { EMOJI_GROUPS } from '@/lib/chat';
import { cn } from '@/lib/utils';

/** A small built-in emoji grid (phones also have their own emoji keyboard). */
export function EmojiPicker({ onPick, className }) {
  const [group, setGroup] = useState(0);
  return (
    <div className={cn('rounded-2xl border border-black/5 bg-white p-2 shadow-lg', className)}>
      <div className="flex gap-1 border-b border-black/5 pb-1.5">
        {EMOJI_GROUPS.map((g, i) => (
          <button
            key={g.label}
            type="button"
            onClick={() => setGroup(i)}
            aria-label={g.label}
            aria-pressed={group === i}
            className={cn(
              'grid h-8 w-9 place-items-center rounded-xl text-lg transition',
              group === i ? 'bg-lime-100 ring-1 ring-lime-300' : 'opacity-60 hover:bg-zinc-100 hover:opacity-100',
            )}
          >
            {g.icon}
          </button>
        ))}
        <span className="ml-auto self-center pr-1 text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-400">
          {EMOJI_GROUPS[group].label}
        </span>
      </div>
      <div className="grid max-h-44 grid-cols-8 gap-0.5 overflow-y-auto pt-1.5 sm:grid-cols-10">
        {EMOJI_GROUPS[group].emojis.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => onPick(emoji)}
            className="grid aspect-square place-items-center rounded-xl text-[22px] transition hover:bg-zinc-100 active:scale-90"
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
