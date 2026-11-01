import { useState } from 'react';
import { Link } from 'react-router';
import { Check, ChevronDown, ChevronRight, KeyRound } from 'lucide-react';
import { CARD } from '@/lib/constants';
import { fmtDateShort, initials, shortName } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Captains, on the Team page: "Playing session N?" at a glance. One card with a block per session
 * being asked (the session about to start, and one asked about ahead): how many have answered, a bar,
 * and who hasn't, as name chips (dashed for roster names who haven't joined). Tapping a name answers
 * for them. While the session about to start is still being answered, a session asked ahead keeps its
 * names folded away until tapped. The team code reminder sits at the bottom while a new session is starting.
 *
 * `sessions`: [{ period, startsOn, ahead, total, waiting, onPick, onChangeDate, onAllAnswers, testId }].
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
        <SessionBlock
          key={`${s.period.year}-${s.period.session}`}
          session={s}
          meId={meId}
          divided={i > 0}
          folded={i > 0 && s.ahead}
        />
      ))}
      {codeStale && (
        <Link
          to="/settings"
          data-testid="team-code-stale"
          className="-mx-1 flex items-center gap-3 rounded-2xl bg-amber-50 px-3 py-2.5 text-amber-950 transition hover:bg-amber-100"
        >
          <KeyRound aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 text-xs font-semibold">New session: change the team code so old invites stop working</span>
          <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0" />
        </Link>
      )}
    </section>
  );
}

const LINK = 'font-semibold text-zinc-700 underline decoration-zinc-300 underline-offset-2 transition hover:text-black hover:decoration-zinc-900';

function SessionBlock({ session, meId, divided, folded }) {
  const { period, startsOn, ahead, total, waiting, onPick, onChangeDate, onAllAnswers, testId } = session;
  const [open, setOpen] = useState(!folded);
  const answered = total - waiting.length;
  const pct = total ? Math.round((answered / total) * 100) : 0;
  // Short names ("Sam O."), unless two people would share one.
  const counts = new Map();
  waiting.forEach((p) => counts.set(shortName(p.display_name), (counts.get(shortName(p.display_name)) || 0) + 1));
  const labelOf = (p) => (p.user_id === meId ? 'You' : counts.get(shortName(p.display_name)) > 1 ? p.display_name : shortName(p.display_name));

  return (
    <div data-testid={testId} className={cn(divided && 'border-t border-zinc-100 pt-4')}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-display text-base font-extrabold uppercase tracking-tight">Session {period.session}</span>
          {ahead && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-bold text-zinc-600">Asked ahead</span>}
        </div>
        <div className="shrink-0 text-xs font-semibold text-zinc-600">
          <span className="font-display text-base font-extrabold text-zinc-950">{answered}</span> of {total} answered
        </div>
      </div>
      <div className="mt-0.5 text-xs font-medium text-zinc-500">
        {startsOn ? `Starts ${fmtDateShort(startsOn)}` : 'Start date to come'}
        {onChangeDate && (
          <>
            {' · '}
            <button type="button" onClick={onChangeDate} className={LINK}>
              Change date
            </button>
          </>
        )}
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
      ) : !open ? (
        // Folded: a few initials and how many are left; tapping shows the names.
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded="false"
          className="-mx-1 mt-2 flex w-[calc(100%+0.5rem)] items-center gap-2.5 rounded-2xl px-1 py-1.5 text-left transition hover:bg-zinc-50"
        >
          <span aria-hidden="true" className="flex shrink-0 gap-1">
            {waiting.slice(0, 4).map((p) => (
              <Avatar key={p.id} player={p} />
            ))}
          </span>
          <span className="min-w-0 flex-1 text-xs font-bold text-zinc-600">Waiting on {waiting.length}</span>
          <span className="flex shrink-0 items-center gap-0.5 text-xs font-semibold text-zinc-600">
            Show <ChevronDown aria-hidden="true" className="h-4 w-4" />
          </span>
        </button>
      ) : (
        <div className="mt-3">
          <div className="text-xs font-bold text-zinc-600">Waiting on {waiting.length} · tap a name to answer</div>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {waiting.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onPick(p)}
                  aria-haspopup="dialog"
                  data-waiting={p.display_name}
                  className={cn(
                    'flex h-8 items-center gap-1.5 rounded-full py-1 pl-1 pr-3 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    p.guest ? 'border border-dashed border-zinc-300 bg-white hover:bg-zinc-50' : 'bg-zinc-100 hover:bg-zinc-200',
                  )}
                >
                  <Avatar player={p} />
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
      {onAllAnswers && (open || waiting.length === 0) && (
        <button
          type="button"
          onClick={onAllAnswers}
          className="mt-3 flex items-center gap-0.5 text-xs font-bold text-zinc-700 transition hover:text-black"
        >
          See all answers <ChevronRight aria-hidden="true" className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/** Initials in a small circle, coloured like the Team page (dashed for roster names who haven't joined). */
function Avatar({ player, className }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid h-6 w-6 shrink-0 place-items-center rounded-full font-display text-[11px] font-extrabold uppercase',
        player.guest
          ? 'border border-dashed border-zinc-400 bg-white text-zinc-600'
          : player.gender === 'F'
            ? 'bg-lime-400 text-black'
            : 'bg-zinc-900 text-lime-400',
        className,
      )}
    >
      {initials(player.display_name)}
    </span>
  );
}
