import { fmtDateShort } from '@/lib/format';
import { cn } from '@/lib/utils';

const ANSWERS = [
  { value: 'in', label: 'IN', active: 'border-lime-400 bg-lime-400 text-black' },
  { value: 'maybe', label: 'MAYBE', active: 'border-amber-300 bg-amber-300 text-black' },
  { value: 'out', label: 'OUT', active: 'border-zinc-900 bg-zinc-900 text-white' },
];

/** The buttons' name for your own answer to a game. The date tells two games against the same team apart. */
export const answerLabel = (game) => `Your answer for vs ${game.opponent}, ${fmtDateShort(game.date)}`;

/**
 * IN / MAYBE / OUT: your own answer (Next game card, the Schedule list, the
 * game page) or a captain answering for someone. `compact` fits inside a later
 * game's card on Schedule, with the same minimum tap height.
 */
export function AnswerButtons({ label, status, onSet, busy, compact = false }) {
  return (
    <div className={cn('grid grid-cols-3', compact ? 'gap-1.5' : 'gap-2')} role="group" aria-label={label}>
      {ANSWERS.map((answer) => (
        <button
          key={answer.value}
          type="button"
          disabled={busy}
          aria-pressed={status === answer.value}
          onClick={() => onSet(answer.value)}
          className={cn(
            'rounded-2xl border-2 font-display font-extrabold uppercase tracking-[0.1em] transition active:scale-[0.98] disabled:opacity-60',
            compact ? 'min-h-11 py-1.5 text-[11px]' : 'py-3.5 text-[13px]',
            status === answer.value ? answer.active : 'border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300',
          )}
        >
          {answer.label}
        </button>
      ))}
    </div>
  );
}

/** A red card in the last game with a result sits the player out this one (suspendedIds()). */
export function SuspendedBadge() {
  return (
    <span className="rounded-full bg-red-600 px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.1em] text-white">
      Suspended – red card
    </span>
  );
}
