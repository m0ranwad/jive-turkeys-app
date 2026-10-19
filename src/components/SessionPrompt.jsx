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
 * Null when there's nothing to ask; otherwise the session, your entry and its first game.
 */
export function sessionQuestion({ profile, roster, games }) {
  if (!profile || !roster?.current) return null;
  const period = roster.current;
  const entry = entryFor(roster.rows, period, profile.user_id);
  if (!entry || entry.answered_at || entry.status === 'off' || !beforeFirstGame(games, period, today())) return null;
  return { period, entry, first: sessionGames(games, period)[0] };
}

/** I'm in / Sub only / Sitting out, saved to your profile (the session's list follows it). */
function SessionAnswers({ profile, question, onAnswered, compact = false }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const { period } = question;

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
    <div className="grid grid-cols-3 gap-2" role="group" aria-label={`Playing session ${period.session}?`}>
      {ANSWERS.map((choice) => (
        <button
          key={choice.status}
          type="button"
          disabled={busy}
          onClick={() => answer(choice)}
          className={cn(
            'rounded-2xl border-2 px-1 py-3 font-display font-extrabold uppercase transition active:scale-[0.98] disabled:opacity-60',
            compact ? 'text-[11px] tracking-[0.02em]' : 'text-[12px] tracking-[0.06em]',
            choice.status === 'active'
              ? 'border-lime-400 bg-lime-400 text-black hover:bg-lime-300'
              : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300',
          )}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Inside the Next game card when that game starts the session: the session
 * question comes first, then the usual IN / MAYBE / OUT for the game.
 */
export function SessionQuestionPanel({ profile, question, gameAnswer, onAnswered }) {
  const { period, entry } = question;
  return (
    <div className="mt-4 rounded-2xl bg-white p-3 text-zinc-900" data-testid="session-prompt">
      <span className="text-[11px] font-black uppercase tracking-[0.14em] text-lime-700">First, playing session {period.session}?</span>
      <p className="mb-2.5 mt-1 text-xs font-medium text-zinc-600">
        You're down as {STATUS_LABEL[entry.status]}. Active players split the dues; sitting out still gets sub call-ups.
      </p>
      <SessionAnswers compact profile={profile} question={question} onAnswered={onAnswered} />
      <p className="mt-2 text-[11px] font-semibold text-zinc-500">
        {gameAnswer ? `You said ${gameAnswer.toUpperCase()} for this game. That stays.` : 'Then answer for this game.'}
      </p>
    </div>
  );
}

/** On its own, for when the next game isn't the session's first (say, last session's game is still to be played). */
export function SessionPrompt({ profile, roster, games, onAnswered }) {
  const question = sessionQuestion({ profile, roster, games });
  if (!question) return null;
  const { period, entry, first } = question;

  return (
    <section className="rounded-3xl border-2 border-lime-400 bg-lime-50 p-4" data-testid="session-prompt">
      <span className="text-[11px] font-black uppercase tracking-[0.16em] text-lime-800">
        Session {period.session} starts {fmtDateShort(first.date)}
      </span>
      <h2 className="mt-1 font-display text-xl font-extrabold uppercase tracking-tight">Playing session {period.session}?</h2>
      <p className="mb-3 mt-1 text-xs font-medium text-lime-900/80">
        You're down as {STATUS_LABEL[entry.status]} for now. Active players split the session's dues. Sitting out
        keeps you on the list for sub call-ups.
      </p>
      <SessionAnswers profile={profile} question={question} onAnswered={onAnswered} />
    </section>
  );
}
