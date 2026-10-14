import { useState } from 'react';
import { api } from '@/api';
import { useToast } from '@/components/ui/toast';
import { STATUS_LABEL } from '@/lib/constants';
import { fmtDateShort, today } from '@/lib/format';
import { beforeFirstGame, entryFor, sessionGames } from '@/lib/roster';
import { cn } from '@/lib/utils';

const ANSWERS = [
  { status: 'active', label: "I'm in", done: (n) => `You're in for session ${n}` },
  { status: 'sub_pool', label: 'Sub only', done: (n) => `You're in the sub pool for session ${n}` },
  { status: 'on_break', label: 'Sitting out', done: (n) => `Sitting out session ${n}. You'll still get sub call-ups.` },
];

/**
 * "Playing session 2?" A new session starts with everyone's status carried
 * over; until its first game, each player who hasn't confirmed theirs is asked.
 */
export function SessionPrompt({ profile, roster, games, onAnswered }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  if (!profile || !roster?.current) return null;
  const period = roster.current;
  const entry = entryFor(roster.rows, period, profile.user_id);
  if (!entry || entry.answered_at || entry.status === 'off' || !beforeFirstGame(games, period, today())) return null;
  const first = sessionGames(games, period)[0];

  const answer = async (choice) => {
    setBusy(true);
    try {
      await api.entities.PlayerProfile.update(profile.id, { status: choice.status });
      toast({ title: choice.done(period.session) });
      await onAnswered();
    } catch (err) {
      toast({ title: "That didn't save", description: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-3xl border-2 border-lime-400 bg-lime-50 p-4" data-testid="session-prompt">
      <span className="text-[10px] font-black uppercase tracking-[0.16em] text-lime-800">
        Session {period.session} starts {fmtDateShort(first.date)}
      </span>
      <h2 className="mt-1 font-display text-xl font-extrabold uppercase tracking-tight">Playing session {period.session}?</h2>
      <p className="mt-1 text-xs font-medium text-lime-900/80">
        You're down as {STATUS_LABEL[entry.status]} for now. Active players split the session's dues. Sitting out
        keeps you on the list for sub call-ups.
      </p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {ANSWERS.map((choice) => (
          <button
            key={choice.status}
            type="button"
            disabled={busy}
            onClick={() => answer(choice)}
            className={cn(
              'rounded-2xl border-2 px-1 py-3 font-display text-[12px] font-extrabold uppercase tracking-[0.06em] transition active:scale-[0.98] disabled:opacity-60',
              choice.status === 'active'
                ? 'border-lime-400 bg-lime-400 text-black hover:bg-lime-300'
                : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300',
            )}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </section>
  );
}
