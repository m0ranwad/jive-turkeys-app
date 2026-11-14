import { CARD } from '@/lib/constants';
import { cleanLabel, isKeeper, keeperGame, keeperLabel } from '@/lib/keepers';
import { fillInLabel, gameFillIns } from '@/lib/results';
import { cn } from '@/lib/utils';

/** The keeper's tags: which halves, a clean sheet, and (when captains show them) goals against. */
function KeeperTags({ row, game, showAgainst }) {
  if (!isKeeper(row)) return null;
  const kept = keeperGame(row, game);
  const clean = cleanLabel(kept);
  return (
    <>
      <span className="rounded-full bg-zinc-950 px-2 py-0.5 text-white">{keeperLabel(kept.halves)}</span>
      {clean && <span className="rounded-full border border-lime-500 bg-white px-2 py-0.5 text-lime-800">{clean}</span>}
      {showAgainst && kept.against > 0 && (
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600">{kept.against} against</span>
      )}
    </>
  );
}

/**
 * Who played, scored, assisted, kept goal and got carded, and any fill-ins from outside the team.
 * The score is in the game's header. Goals against show only when captains turn them on.
 */
export function ResultCard({ game, stats, fillIns = [], showAgainst = false }) {
  const byGoals = (a, b) => (b.goals || 0) - (a.goals || 0) || (b.assists || 0) - (a.assists || 0);
  const rows = stats.filter((s) => s.game_id === game.id && s.played).sort(byGoals);
  const ours = gameFillIns(game, fillIns);
  const fillInRows = ours.map((f, i) => ({ ...f, fillIn: true, player_name: fillInLabel(f, i, ours.length) })).sort(byGoals);

  return (
    <section className={CARD}>
      <h3 className="font-display text-sm font-extrabold uppercase tracking-[0.12em]">Result</h3>
      <div className="mt-3 space-y-2">
        {rows.length + fillInRows.length === 0 && <p className="text-sm text-zinc-500">No player stats recorded.</p>}
        {[...rows, ...fillInRows].map((row) => (
          <div key={row.id} className="flex items-center gap-3 border-b border-zinc-100 pb-2 last:border-0 last:pb-0">
            <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', row.gender === 'F' ? 'bg-lime-400' : 'bg-zinc-900')} />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {row.player_name}
              {row.fillIn && row.display_name?.trim() && (
                <span className="ml-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-zinc-500">fill-in</span>
              )}
            </span>
            <div className="flex flex-wrap items-center justify-end gap-1.5 text-[11px] font-bold">
              <KeeperTags row={row} game={game} showAgainst={showAgainst} />
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
