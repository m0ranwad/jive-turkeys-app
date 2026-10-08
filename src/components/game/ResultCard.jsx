import { ResultBadge } from '@/components/schedule/GameCard';
import { CARD } from '@/lib/constants';
import { resultOf } from '@/lib/team-logic';
import { cn } from '@/lib/utils';

/** Final score plus who scored, assisted, and got carded. */
export function ResultCard({ game, stats }) {
  const rows = stats
    .filter((s) => s.game_id === game.id && s.played)
    .sort((a, b) => (b.goals || 0) - (a.goals || 0) || (b.assists || 0) - (a.assists || 0));
  const result = resultOf(game);

  return (
    <section className={CARD}>
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm font-extrabold uppercase tracking-[0.12em]">Result</h3>
        <ResultBadge result={result} className="h-8 w-8 rounded-xl text-xs" />
      </div>
      <div className="mt-3 flex items-baseline gap-3">
        <span className="font-display text-4xl font-extrabold leading-none">{game.score_us ?? 0}</span>
        <span className="text-sm font-bold text-zinc-300">–</span>
        <span className="font-display text-4xl font-extrabold leading-none text-zinc-400">{game.score_them ?? 0}</span>
        <span className="ml-1 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">vs {game.opponent}</span>
      </div>
      <div className="mt-4 space-y-2">
        {rows.length === 0 && <p className="text-sm text-zinc-400">No player stats recorded.</p>}
        {rows.map((row) => (
          <div key={row.id} className="flex items-center gap-3 border-b border-zinc-100 pb-2 last:border-0 last:pb-0">
            <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', row.gender === 'F' ? 'bg-lime-400' : 'bg-zinc-900')} />
            <span className="flex-1 truncate text-sm font-semibold">{row.player_name}</span>
            <div className="flex items-center gap-2 text-[11px] font-bold">
              {(row.goals || 0) > 0 && <span className="rounded-full bg-lime-100 px-2 py-0.5 text-lime-800">{row.goals}G</span>}
              {(row.assists || 0) > 0 && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600">{row.assists}A</span>}
              {(row.blue_cards || 0) > 0 && (
                <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-700">{row.blue_cards} blue</span>
              )}
              {(row.red_cards || 0) > 0 && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-700">{row.red_cards} red</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
