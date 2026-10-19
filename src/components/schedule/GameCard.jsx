import { Link } from 'react-router';
import { fmtDateShort, fmtTime, jerseyText } from '@/lib/format';
import { resultOf } from '@/lib/team-logic';
import { cn } from '@/lib/utils';

export function ShortBanner({ needTotal = 0, needWomen = 0, className }) {
  if (!needTotal && !needWomen) return null;
  const parts = [];
  if (needTotal) parts.push(`Need ${needTotal} more`);
  if (needWomen) parts.push(`${needWomen} more ${needWomen === 1 ? 'woman' : 'women'}`);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.1em] text-white',
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-white" />
      Short · {parts.join(' · ')}
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

export function GameCard({ game, headcount, settings }) {
  const final = game.has_result;
  const result = final ? resultOf(game) : null;
  const chip = 'rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.08em]';

  return (
    <Link
      to={`/games/${game.id}`}
      className="block rounded-3xl border border-black/5 bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition motion-safe:hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.07)] active:translate-y-0"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">
            {fmtDateShort(game.date)} · {fmtTime(game.time)}
          </div>
          <div className="mt-1 truncate font-display text-lg font-extrabold uppercase tracking-tight">vs {game.opponent}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold text-zinc-500">
            <span>Field {game.field_number || 'TBD'}</span>
            <span className="inline-flex items-center gap-1.5">
              <JerseyDot jersey={game.jersey} className="h-2.5 w-2.5" />
              {jerseyText(game.jersey, settings)}
            </span>
          </div>
        </div>
        {final ? (
          <div className="flex shrink-0 items-center gap-2">
            <div className="text-right">
              <div className="font-display text-2xl font-extrabold leading-none">
                {game.score_us ?? 0}–{game.score_them ?? 0}
              </div>
              <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-500">Final</div>
            </div>
            <ResultBadge result={result} className="h-9 w-9 rounded-2xl text-sm" />
          </div>
        ) : (
          <ShortBanner
            className="hidden shrink-0 sm:inline-flex"
            needTotal={headcount?.needTotal}
            needWomen={headcount?.needWomen}
          />
        )}
      </div>
      {!final && headcount && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {/* On phones the banner sits with the counts so the opponent name has room. */}
          <ShortBanner className="sm:hidden" needTotal={headcount.needTotal} needWomen={headcount.needWomen} />
          <span className={cn(chip, 'bg-lime-100 text-lime-800')}>{headcount.totalIn} in</span>
          <span className={cn(chip, 'bg-zinc-100 text-zinc-600')}>{headcount.womenFieldIn} women</span>
          <span className={cn(chip, 'bg-zinc-100 text-zinc-600')}>{headcount.groups.maybe.length} maybe</span>
          <span className={cn(chip, 'bg-zinc-100 text-zinc-600')}>{headcount.groups.none.length} no reply</span>
        </div>
      )}
    </Link>
  );
}

/**
 * A game after the next one: when, where, how many are in, and your answer
 * inside the card. No "Short" alarm this far out; that's for the next game.
 */
export function LaterGameCard({ game, headcount, settings, answer }) {
  return (
    <div className="rounded-3xl border border-black/5 bg-white p-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <Link to={`/games/${game.id}`} className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-500">
            {fmtDateShort(game.date)} · {fmtTime(game.time)}
          </div>
          <div className="mt-0.5 truncate font-display text-base font-extrabold uppercase tracking-tight">vs {game.opponent}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold text-zinc-500">
            <span>Field {game.field_number || 'TBD'}</span>
            <span className="inline-flex items-center gap-1.5">
              <JerseyDot jersey={game.jersey} className="h-2.5 w-2.5" />
              {jerseyText(game.jersey, settings)}
            </span>
          </div>
        </div>
        {headcount && (
          <span className="shrink-0 rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.08em] text-zinc-600">
            {headcount.totalIn} in
          </span>
        )}
      </Link>
      {answer && <div className="mt-3">{answer}</div>}
    </div>
  );
}

/** Played games as one short list: date, opponent, score and result. */
export function PlayedList({ games }) {
  return (
    <div className="divide-y divide-zinc-100 overflow-hidden rounded-3xl border border-black/5 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      {games.map((game) => (
        <Link key={game.id} to={`/games/${game.id}`} className="flex items-center gap-3 px-3.5 py-2.5 transition hover:bg-zinc-50">
          <ResultBadge result={resultOf(game)} className="h-8 w-8 shrink-0 rounded-xl text-xs" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-display text-sm font-extrabold uppercase tracking-tight">vs {game.opponent}</div>
            <div className="text-[11px] font-semibold text-zinc-500">{fmtDateShort(game.date)}</div>
          </div>
          <div className="shrink-0 font-display text-lg font-extrabold">
            {game.score_us ?? 0}–{game.score_them ?? 0}
          </div>
        </Link>
      ))}
    </div>
  );
}
