import { Link } from 'react-router';
import { fmtDateShort, fmtTime, jerseyText } from '@/lib/format';
import { resultOf, shortageText } from '@/lib/team-logic';
import { shortageIsUrgent } from '@/lib/calendar';
import { cn } from '@/lib/utils';

/**
 * How many more players (and girls) a game needs, in the game page's words
 * (shortageText()). Red ("Short · …") when it's `urgent`; otherwise a calm chip
 * in the `calm` colours, so a game days away doesn't look like an emergency.
 */
export function ShortBanner({ headcount, urgent = true, calm = 'bg-zinc-100 text-zinc-600', className }) {
  const text = shortageText(headcount);
  if (!text) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.1em]',
        urgent ? 'bg-red-600 text-white' : calm,
        className,
      )}
    >
      {urgent && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
      {urgent ? `Short · ${text}` : text}
    </span>
  );
}

export function ResultBadge({ result, className }) {
  return (
    <span
      className={cn(
        'grid place-items-center font-display font-black',
        result === 'W' && 'bg-lime-400 text-black',
        result === 'L' && 'bg-zinc-900 text-white',
        result === 'D' && 'bg-zinc-200 text-zinc-600',
        className,
      )}
    >
      {result}
    </span>
  );
}

export function JerseyDot({ jersey, className }) {
  return (
    <span
      className={cn(
        'rounded-full',
        jersey === 'backup' ? 'bg-zinc-900' : 'bg-lime-400 ring-1 ring-black/10',
        className,
      )}
    />
  );
}

/** Later upcoming games: a link above your answer buttons, all inside one card. */
export function LaterGameCard({ game, headcount, settings, children }) {
  return (
    <div className="rounded-3xl border border-black/5 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <Link to={`/games/${game.id}`} className="block rounded-3xl p-4 transition hover:bg-zinc-50">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">
              {fmtDateShort(game.date)} · {fmtTime(game.time)}
            </div>
            <div className="mt-1 break-words font-display text-lg font-extrabold uppercase tracking-tight">vs {game.opponent}</div>
          </div>
          {headcount && (
            <span className="shrink-0 rounded-full bg-lime-100 px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.08em] text-lime-800">
              {headcount.totalIn} in
            </span>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold text-zinc-500">
          <span>Field {game.field_number || 'TBD'}</span>
          <span className="inline-flex items-center gap-1.5">
            <JerseyDot jersey={game.jersey} className="h-2.5 w-2.5" />
            {jerseyText(game.jersey, settings)}
          </span>
        </div>
        {headcount && shortageIsUrgent(game) && (
          <ShortBanner className="mt-3" headcount={headcount} />
        )}
      </Link>
      {children && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

/** Compact results; a past game without a saved score must not look like a draw. */
export function PlayedList({ games }) {
  return (
    <ul aria-label="Game results" className="divide-y divide-zinc-100 overflow-hidden rounded-3xl border border-black/5 bg-white">
      {games.map((g) => {
        const result = g.has_result ? resultOf(g) : null;
        const label = { W: 'Won', L: 'Lost', D: 'Draw' }[result];
        return (
          <li key={g.id}>
            {/* An inset ring: the list's rounded corners would clip an outline drawn outside the row. */}
            <Link
              to={`/games/${g.id}`}
              className="flex min-h-[60px] items-center gap-3 px-4 py-3 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              {result && (
                <span aria-hidden="true">
                  <ResultBadge result={result} className="h-8 w-8 rounded-xl text-xs" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                {label && <span className="sr-only">{label}, </span>}
                <span className="block break-words font-display text-sm font-extrabold uppercase tracking-tight">vs {g.opponent}</span>
                <span className="block text-[11px] font-semibold text-zinc-500">{fmtDateShort(g.date)}</span>
              </span>
              {result ? (
                <span className="shrink-0 font-display text-xl font-extrabold">{g.score_us ?? 0}–{g.score_them ?? 0}</span>
              ) : (
                <span className="text-right text-[11px] font-semibold text-zinc-500">No result yet</span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
