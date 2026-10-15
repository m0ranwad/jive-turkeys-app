import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { AnswerButtons, SuspendedBadge, answerLabel } from '@/components/game/AnswerButtons';
import { ShortBanner, JerseyDot } from '@/components/schedule/GameCard';
import { fmtDateShort, fmtTime, jerseyText } from '@/lib/format';

/**
 * The next game, at the top of Schedule: when and where, the headcount, and
 * your answer right there. Most visits are "am I playing Thursday?".
 */
export function NextGameCard({ game, headcount, settings, rsvp, onRoster, suspended, onSet, busy }) {
  const status = rsvp?.status;
  return (
    <section className="overflow-hidden rounded-3xl bg-zinc-950 p-4 text-white" aria-label="Next game">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="text-[10px] font-black uppercase tracking-[0.18em] text-lime-400">Next game</span>
          <div className="mt-1 truncate font-display text-2xl font-extrabold uppercase tracking-tight">vs {game.opponent}</div>
          <div className="mt-1 text-xs font-semibold text-white/70">
            {fmtDateShort(game.date)} · {fmtTime(game.time)} · Field {game.field_number || 'TBD'}
          </div>
          <div className="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold text-white/70">
            <JerseyDot jersey={game.jersey} className="h-2.5 w-2.5 ring-1 ring-white/30" />
            {jerseyText(game.jersey, settings)}
          </div>
        </div>
        <Link
          to={`/games/${game.id}`}
          className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-white/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.1em] text-white transition hover:bg-white/20"
        >
          Details <ChevronRight className="h-3 w-3" />
        </Link>
      </div>

      {headcount && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.08em]">
          <span className="rounded-full bg-lime-400 px-2.5 py-1 text-black">{headcount.totalIn} in</span>
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-white/80">
            {headcount.womenFieldIn}/{headcount.minWomen} women
          </span>
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-white/80">{headcount.groups.none.length} no reply</span>
          <ShortBanner needTotal={headcount.needTotal} needWomen={headcount.needWomen} />
        </div>
      )}

      {onRoster && (
        <div className="mt-4 rounded-2xl bg-white p-3 text-zinc-900">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[10px] font-black uppercase tracking-[0.14em] text-zinc-500">
              {status ? 'Your answer' : "You haven't answered"}
            </span>
            {suspended && <SuspendedBadge />}
          </div>
          <AnswerButtons label={answerLabel(game)} status={status} onSet={onSet} busy={busy} />
        </div>
      )}
    </section>
  );
}
