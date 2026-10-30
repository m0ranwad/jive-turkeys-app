import { AnswerButtons, SuspendedBadge } from '@/components/game/AnswerButtons';
import { cn } from '@/lib/utils';

/**
 * Your own answer, inside the game card: IN / MAYBE / OUT, then "I'll play GK" once you're in.
 * Any number can say they'll play GK; two often share goal.
 */
export function RsvpCard({ rsvp, onSet, onToggleGk, suspended, busy }) {
  const status = rsvp?.status;
  const keeper = !!rsvp?.playing_gk;
  return (
    <div className="mt-4 rounded-[20px] bg-white p-3.5 text-zinc-900">
      <h2 className="sr-only">Your answer</h2>
      {suspended && (
        <div className="mb-2.5">
          <SuspendedBadge />
        </div>
      )}
      <AnswerButtons label="Your answer" status={status} onSet={onSet} busy={busy} />
      {status === 'in' && (
        <button
          type="button"
          aria-pressed={keeper}
          onClick={() => onToggleGk(!keeper)}
          disabled={busy}
          className={cn(
            'mt-2.5 flex min-h-12 w-full items-center justify-between rounded-2xl border-2 px-3.5 text-left text-sm font-bold transition',
            keeper ? 'border-zinc-950 bg-zinc-950 text-white' : 'border-zinc-200 bg-white hover:border-zinc-300',
          )}
        >
          I'll play GK
          <span aria-hidden="true" className={cn('relative h-6 w-11 shrink-0 rounded-full transition', keeper ? 'bg-lime-400' : 'bg-zinc-200')}>
            <span
              className={cn(
                'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all motion-reduce:transition-none',
                keeper ? 'left-[22px]' : 'left-0.5',
              )}
            />
          </span>
        </button>
      )}
    </div>
  );
}
