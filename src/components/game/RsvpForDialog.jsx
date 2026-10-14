import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

const CHOICES = [
  { value: 'in', label: 'IN', active: 'border-lime-400 bg-lime-400 text-black' },
  { value: 'maybe', label: 'MAYBE', active: 'border-amber-300 bg-amber-300 text-black' },
  { value: 'out', label: 'OUT', active: 'border-zinc-900 bg-zinc-900 text-white' },
];

/**
 * Captains: set someone's RSVP for a game, for a teammate who texted instead
 * or who hasn't joined the site.
 */
export function RsvpForDialog({ player, rsvp, busy, onSet, onToggleGk, onClose }) {
  const status = rsvp?.status ?? null;
  return (
    <Dialog open={!!player} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader className="text-left">
          <DialogTitle className="font-display text-lg font-extrabold uppercase tracking-tight">
            {player?.display_name}
          </DialogTitle>
        </DialogHeader>
        <p className="-mt-2 text-sm text-zinc-500">
          {player?.guest ? "Hasn't joined the site, so you RSVP for them." : 'Set their RSVP if they told you another way.'}
        </p>
        <div className="grid grid-cols-3 gap-2">
          {CHOICES.map((choice) => (
            <button
              key={choice.value}
              type="button"
              disabled={busy}
              aria-pressed={status === choice.value}
              onClick={() => onSet(choice.value)}
              className={cn(
                'rounded-2xl border-2 py-3.5 font-display text-[13px] font-extrabold uppercase tracking-[0.1em] transition disabled:opacity-60',
                status === choice.value ? choice.active : 'border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300',
              )}
            >
              {choice.label}
            </button>
          ))}
        </div>
        {status === 'in' && (
          <button
            type="button"
            disabled={busy}
            aria-pressed={!!rsvp?.playing_gk}
            onClick={onToggleGk}
            className={cn(
              'flex w-full items-center justify-between rounded-2xl border-2 px-4 py-3 text-left text-sm font-bold transition disabled:opacity-60',
              rsvp?.playing_gk ? 'border-black bg-zinc-950 text-white' : 'border-zinc-200 bg-white hover:border-zinc-300',
            )}
          >
            Playing GK
            <span className="text-[11px] font-semibold opacity-70">{rsvp?.playing_gk ? 'Yes' : 'No'}</span>
          </button>
        )}
        <div className="flex items-center justify-between gap-3">
          {status ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onSet(null)}
              className="text-xs font-bold uppercase tracking-[0.1em] text-zinc-400 transition hover:text-zinc-900"
            >
              Clear (no reply)
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-zinc-950 px-5 py-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-white transition hover:bg-zinc-800"
          >
            Done
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
