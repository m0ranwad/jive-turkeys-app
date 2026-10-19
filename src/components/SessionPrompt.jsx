import { useState } from 'react';
import { CalendarCheck } from 'lucide-react';
import { api } from '@/api';
import { useToast } from '@/components/ui/toast';
import { STATUS_LABEL } from '@/lib/constants';
import { fmtDateShort, today } from '@/lib/format';
import { entryFor, isEarlier, sessionGames, sessionRows, stillAsking } from '@/lib/roster';
import { cn } from '@/lib/utils';

const ANSWERS = [
  { status: 'active', label: "I'm in", done: (n) => `You're in for session ${n}` },
  { status: 'sub_pool', label: 'Sub only', done: (n) => `You're in the sub pool for session ${n}` },
  { status: 'on_break', label: 'Sitting out', done: (n) => `Sitting out session ${n}. You'll still get sub call-ups.` },
];

/**
 * "Playing session 2?" A new session starts with everyone's status carried
 * over. It's asked of the current session until its first game (its first game
 * is next, or captains asked ahead and its schedule isn't out), or of a later
 * session captains asked about while this one still has games left.
 * Null when it isn't being asked of you; otherwise the session, your entry,
 * its first game (if the schedule is up), its start date, whether you answered,
 * and whether it's the current session.
 */
export function sessionAsk({ profile, roster, games, sessions = [] }) {
  if (!profile || !roster?.current) return null;
  const startsOn = (period) => sessions.find((s) => s.season_year === Number(period.year) && s.session === Number(period.session))?.starts_on;
  const ahead = sessions
    .filter((s) => s.starts_on && isEarlier(roster.current, { year: s.season_year, session: s.session }))
    .sort((a, b) => a.starts_on.localeCompare(b.starts_on))
    .map((s) => ({ year: s.season_year, session: s.session }))[0];
  const asks = [roster.current, ahead]
    .filter((period) => period && stillAsking(games, period, today(), startsOn(period)))
    .map((period) => {
      const entry = entryFor(roster.rows, period, profile.user_id);
      if (!entry || entry.status === 'off') return null;
      const first = sessionGames(games, period)[0] || null;
      return {
        period,
        entry,
        first,
        startsOn: first?.date || startsOn(period) || null,
        answered: !!entry.answered_at,
        isCurrent: period === roster.current,
      };
    })
    .filter(Boolean);
  // One question at a time: the first you haven't answered, else the latest one asked.
  return asks.find((a) => !a.answered) || asks.at(-1) || null;
}

/** The same, only while you haven't answered. */
export function sessionQuestion(args) {
  const ask = sessionAsk(args);
  return ask && !ask.answered ? ask : null;
}

/**
 * I'm in / Sub only / Sitting out. For the current session it's your status (the
 * session's list follows it); for a session asked about ahead it goes in that
 * session's list only, so the session still being played doesn't change.
 */
function SessionAnswers({ profile, question, onAnswered, compact = false, selected }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const { period } = question;

  const answer = async (choice) => {
    setBusy(true);
    try {
      if (question.isCurrent) await api.entities.PlayerProfile.update(profile.id, { status: choice.status });
      else await api.roster.answer({ year: period.year, session: period.session, status: choice.status });
      toast({ title: choice.done(period.session) });
      await onAnswered();
    } catch (err) {
      toast({ title: "That didn't save", description: err.message });
    } finally {
      setBusy(false);
    }
  };

  // Before you answer, I'm in is the suggested one; after, your answer is the picked one.
  const lit = (status) => (selected ? status === selected : status === 'active');
  return (
    <div className="grid grid-cols-3 gap-2" role="group" aria-label={`Playing session ${period.session}?`}>
      {ANSWERS.map((choice) => (
        <button
          key={choice.status}
          type="button"
          disabled={busy}
          aria-pressed={selected ? choice.status === selected : undefined}
          onClick={() => answer(choice)}
          className={cn(
            'rounded-2xl border-2 px-1 py-3 font-display font-extrabold uppercase transition active:scale-[0.98] disabled:opacity-60',
            compact ? 'text-[11px] tracking-[0.02em]' : 'text-[12px] tracking-[0.06em]',
            lit(choice.status)
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

/** Who has answered for a session so far: in (and how many women), subs, sitting out, and still to answer. */
function sessionTally(rows, period, players) {
  const list = sessionRows(rows, period).filter((r) => r.status !== 'off');
  const answered = list.filter((r) => r.answered_at);
  const gender = new Map(players.map((p) => [p.user_id, p.gender]));
  const inRows = answered.filter((r) => r.status === 'active');
  return {
    in: inRows.length,
    women: inRows.filter((r) => gender.get(r.user_id ?? r.guest_id) === 'F').length,
    subs: answered.filter((r) => r.status === 'sub_pool').length,
    out: answered.filter((r) => r.status === 'on_break').length,
    waiting: list.length - answered.length,
  };
}

/**
 * Between sessions, before the schedule is out: the top of Schedule asks
 * "Playing session N?" and shows how the answers are coming in. You can
 * change your answer until the first game.
 */
export function NextSessionCard({ ask, profile, rows, players, onAnswered }) {
  const { period, entry, startsOn, answered } = ask;
  const tally = sessionTally(rows, period, players);
  const chip = 'rounded-full px-2.5 py-1';
  return (
    <section className="rounded-3xl bg-zinc-950 p-4 text-white" aria-label="Next session" data-testid="session-prompt">
      <span className="text-[11px] font-black uppercase tracking-[0.18em] text-lime-400">Next up</span>
      <h2 className="mt-1 font-display text-2xl font-extrabold uppercase tracking-tight">Session {period.session}</h2>
      <p className="mt-1 text-xs font-semibold text-white/70">
        {startsOn ? `Starts ${fmtDateShort(startsOn)}` : 'Start date to come'} · Games show here when the schedule is out
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.08em]">
        <span className={cn(chip, 'bg-lime-400 text-black')}>{tally.in} in</span>
        <span className={cn(chip, 'bg-white/10 text-white/80')}>{tally.women} women</span>
        <span className={cn(chip, 'bg-white/10 text-white/80')}>{tally.subs} {tally.subs === 1 ? 'sub' : 'subs'}</span>
        <span className={cn(chip, 'bg-white/10 text-white/80')}>{tally.out} sitting out</span>
        <span className={cn(chip, 'bg-white/10 text-white/80')}>{tally.waiting} to answer</span>
      </div>
      <div className="mt-4 rounded-2xl bg-white p-3 text-zinc-900">
        <span className={cn('text-[11px] font-black uppercase tracking-[0.14em]', answered ? 'text-zinc-500' : 'text-lime-700')}>
          {answered ? 'Your answer' : `Playing session ${period.session}?`}
        </span>
        <p className="mb-2.5 mt-1 text-xs font-medium text-zinc-600">
          {answered
            ? 'You can change it until the first game.'
            : `You're down as ${STATUS_LABEL[entry.status]}. Active players split the dues; sitting out still gets sub call-ups.`}
        </p>
        <SessionAnswers
          compact
          profile={profile}
          question={ask}
          onAnswered={onAnswered}
          selected={answered ? entry.status : undefined}
        />
      </div>
    </section>
  );
}

const ANSWER_LABEL = Object.fromEntries(ANSWERS.map((a) => [a.status, a.label]));

/**
 * Asked ahead, while the current session still has games: under the Next game
 * card. Once you've answered it shrinks to one line you can open to change.
 */
export function SessionAheadCard({ ask, profile, rows, players, onAnswered }) {
  const [open, setOpen] = useState(false);
  const { period, entry, startsOn, answered } = ask;
  const tally = sessionTally(rows, period, players);
  const when = startsOn ? `Starts ${fmtDateShort(startsOn)}` : 'Start date to come';

  if (answered && !open) {
    return (
      <section
        aria-label={`Session ${period.session}`}
        data-testid="session-prompt"
        className="flex items-center gap-3 rounded-2xl border border-black/5 bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-lime-400 text-black">
          <CalendarCheck className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-sm font-extrabold uppercase tracking-tight">
            Session {period.session}: {ANSWER_LABEL[entry.status]}
          </span>
          <span className="block truncate text-[11px] font-semibold text-zinc-500">
            {when} · {tally.in} in so far
          </span>
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="shrink-0 rounded-full bg-zinc-100 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-zinc-700 transition hover:bg-zinc-200"
        >
          Change
        </button>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border-2 border-lime-400 bg-white p-4" aria-label={`Session ${period.session}`} data-testid="session-prompt">
      <span className="text-[11px] font-black uppercase tracking-[0.16em] text-lime-700">Asking ahead</span>
      <h2 className="mt-1 font-display text-xl font-extrabold uppercase tracking-tight">Playing session {period.session}?</h2>
      <p className="mt-0.5 text-xs font-bold text-zinc-700">
        {when} · {tally.in} in so far
      </p>
      <p className="mb-3 mt-1 text-xs font-medium text-zinc-600">
        Your answer only counts for session {period.session}. Active players split the dues; sitting out still gets sub
        call-ups.
      </p>
      <SessionAnswers
        profile={profile}
        question={ask}
        selected={answered ? entry.status : undefined}
        onAnswered={async () => {
          setOpen(false);
          await onAnswered();
        }}
      />
    </section>
  );
}

/** On its own, for when the next game isn't the session's first (say, last session's game is still to be played). */
export function SessionPrompt({ profile, roster, games, sessions, onAnswered }) {
  const question = sessionQuestion({ profile, roster, games, sessions });
  if (!question) return null;
  const { period, entry, startsOn } = question;

  return (
    <section className="rounded-3xl border-2 border-lime-400 bg-lime-50 p-4" data-testid="session-prompt">
      <span className="text-[11px] font-black uppercase tracking-[0.16em] text-lime-800">
        Session {period.session} starts {startsOn ? fmtDateShort(startsOn) : 'soon'}
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
