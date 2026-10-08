import { Check } from 'lucide-react';
import { CARD } from '@/lib/constants';
import { cn } from '@/lib/utils';

const CHOICES = [
  { value: 'in', label: 'IN', active: 'border-lime-400 bg-lime-400 text-black' },
  { value: 'maybe', label: 'MAYBE', active: 'border-amber-300 bg-amber-300 text-black' },
  { value: 'out', label: 'OUT', active: 'border-zinc-900 bg-zinc-900 text-white' },
];

export function RsvpCard({ rsvp, onSet, onToggleGk, suspended, busy }) {
  const status = rsvp?.status;
  return (
    <div className={CARD}>
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm font-extrabold uppercase tracking-[0.12em]">Your RSVP</h3>
        {suspended && (
          <span className="rounded-full bg-red-600 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-white">
            Suspended – next game
          </span>
        )}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {CHOICES.map((choice) => (
          <button
            key={choice.value}
            disabled={busy}
            onClick={() => onSet(choice.value)}
            className={cn(
              'rounded-2xl border-2 py-3.5 font-display text-[13px] font-extrabold uppercase tracking-[0.1em] transition active:scale-[0.98] disabled:opacity-60',
              status === choice.value ? choice.active : 'border-zinc-200 bg-white text-zinc-400 hover:border-zinc-300',
            )}
          >
            {choice.label}
          </button>
        ))}
      </div>
      {status === 'in' && (
        <button
          onClick={() => onToggleGk(!rsvp?.playing_gk)}
          disabled={busy}
          className={cn(
            'mt-3 flex w-full items-center justify-between rounded-2xl border-2 px-4 py-3 text-left transition',
            rsvp?.playing_gk ? 'border-black bg-zinc-950 text-white' : 'border-zinc-200 bg-white hover:border-zinc-300',
          )}
        >
          <span>
            <span className="block text-sm font-bold">Playing GK</span>
            <span className="mt-0.5 block text-[11px] font-medium text-zinc-400">
              A woman in goal doesn't count toward the 3-women minimum
            </span>
          </span>
          <span className={cn('relative h-6 w-11 shrink-0 rounded-full transition', rsvp?.playing_gk ? 'bg-lime-400' : 'bg-zinc-200')}>
            <span
              className={cn(
                'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all',
                rsvp?.playing_gk ? 'left-[22px]' : 'left-0.5',
              )}
            />
          </span>
        </button>
      )}
      {status === 'in' && rsvp?.playing_gk && (
        <div className="mt-3">
          <span className="inline-flex items-center gap-1 rounded-full bg-zinc-900 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.1em] text-lime-400">
            <Check className="h-2.5 w-2.5" /> GK
          </span>
        </div>
      )}
    </div>
  );
}
