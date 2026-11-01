import { Link } from 'react-router';
import { Check, ChevronRight, KeyRound } from 'lucide-react';
import { CARD } from '@/lib/constants';
import { fmtDateShort, initials, shortName } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Captains, on the Team page: "Playing session N?" at a glance. One card with a block per session
 * being asked (the session about to start, and one asked about ahead): how many have answered, a bar,
 * and who hasn't, as tappable name chips (dashed for roster names who haven't joined). Tapping a name
 * answers for them.
 * The team code reminder sits at the bottom while a new session is starting.
 *
 * `sessions`: [{ period, startsOn, aheadLabel, total, waiting, onPick, actions, testId }].
 */
export function SessionAnswersCard({ sessions, meId, codeStale }) {
  const shown = sessions.filter(Boolean);
  if (!shown.length) return null;
  return (
    <section className={cn(CARD, 'space-y-4')} aria-labelledby="session-answers-title">
      <h3 id="session-answers-title" className="font-display text-sm font-extrabold uppercase tracking-[0.12em]">
        Who's playing
      </h3>
      {shown.map((s, i) => (
        <SessionBlock key={`${s.period.year}-${s.period.session}`} session={s} meId={meId} divided={i > 0} />
      ))}
      {codeStale && (
        <Link
          to="/settings"
          data-testid="team-code-stale"
          className="-mx-1 flex items-center gap-3 rounded-2xl bg-amber-50 px-3 py-2.5 text-amber-950 transition hover:bg-amber-100"
        >
          <KeyRound aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 text-xs font-semibold">
            New session: change the team code so old invites stop working
          </span>
          <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0" />
        </Link>
      )}
    </section>
  );
}

function SessionBlock({ session, meId, divided }) {
  const { period, startsOn, aheadLabel, total, waiting, onPick, actions, testId } = session;
  const answered = total - waiting.length;
  const pct = total ? Math.round((answered / total) * 100) : 0;
  // Short names ("Sam O."), unless two people would share one.
  const counts = new Map();
  waiting.forEach((p) => counts.set(shortName(p.display_name), (counts.get(shortName(p.display_name)) || 0) + 1));
  const labelOf = (p) => (p.user_id === meId ? 'You' : counts.get(shortName(p.display_name)) > 1 ? p.display_name : shortName(p.display_name));

  return (
    <div data-testid={testId} className={cn(divided && 'border-t border-zinc-100 pt-4')}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="font-display text-base font-extrabold uppercase tracking-tight">Session {period.session}</div>
        <div className="shrink-0 text-xs font-semibold text-zinc-600">
          <span className="font-display text-base font-extrabold text-zinc-950">{answered}</span> of {total} answered
        </div>
      </div>
      <div className="text-xs font-medium text-zinc-500">
        {aheadLabel && `${aheadLabel} · `}
        {startsOn ? `Starts ${fmtDateShort(startsOn)}` : 'Start date to come'}
      </div>
      <div
        role="progressbar"
        aria-label={`Session ${period.session} answers`}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={answered}
        className="mt-2.5 h-2 overflow-hidden rounded-full bg-zinc-100"
      >
        <div
          className="h-full rounded-full bg-lime-400 motion-safe:transition-[width] motion-safe:duration-500 motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>

      {waiting.length === 0 ? (
        <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-lime-700">
          <Check aria-hidden="true" className="h-4 w-4" /> Everyone has answered
        </p>
      ) : (
        <div className="mt-3">
          <div className="text-xs font-bold text-zinc-600">Waiting on {waiting.length} · tap a name to answer</div>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {waiting.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onPick(p)}
                  data-waiting={p.display_name}
                  className={cn(
                    'flex h-8 items-center gap-1.5 rounded-full py-1 pl-1 pr-3 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    p.guest ? 'border border-dashed border-zinc-300 bg-white hover:bg-zinc-50' : 'bg-zinc-100 hover:bg-zinc-200',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'grid h-6 w-6 shrink-0 place-items-center rounded-full font-display text-[11px] font-extrabold uppercase',
                      p.guest
                        ? 'border border-dashed border-zinc-400 bg-white text-zinc-600'
                        : p.gender === 'F'
                          ? 'bg-lime-400 text-black'
                          : 'bg-zinc-900 text-lime-400',
                    )}
                  >
                    {initials(p.display_name)}
                  </span>
                  <span aria-hidden="true" className="whitespace-nowrap text-xs font-semibold text-zinc-800">
                    {labelOf(p)}
                  </span>
                  <span className="sr-only">
                    Answer for {p.display_name}
                    {p.guest && ', not joined yet'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** The small grey buttons under a session ("Answer for someone", "Change date"). */
export function SessionAction({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full bg-zinc-100 px-3.5 py-2 text-[11px] font-bold uppercase tracking-[0.1em] text-zinc-700 transition hover:bg-zinc-200"
    >
      {children}
    </button>
  );
}
