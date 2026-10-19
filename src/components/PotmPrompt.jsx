import { Link } from 'react-router';
import { ChevronRight, Trophy } from 'lucide-react';
import { resultOf } from '@/lib/team-logic';
import { closesLabel, gamesToVoteOn } from '@/lib/potm';

/** On Schedule: games you played whose Player of the Match vote is open and still needs your vote. */
export function PotmPrompt({ data }) {
  if (!data.user) return null;
  const games = gamesToVoteOn({ games: data.games, stats: data.stats, votes: data.votes, userId: data.user.id, settings: data.settings });
  if (!games.length) return null;

  return (
    <div className="space-y-2" data-testid="potm-prompt">
      {games.map((g) => (
        <Link
          key={g.id}
          to={`/games/${g.id}`}
          className="flex items-center gap-3 rounded-2xl border border-black/5 bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition hover:border-lime-400"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-lime-400 text-black">
            <Trophy className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-display text-sm font-extrabold uppercase tracking-tight">
              Vote for Player of the Match
            </span>
            <span className="block truncate text-[11px] font-semibold text-zinc-500">
              {g.score_us}–{g.score_them} {resultOf(g)} vs {g.opponent} · closes {closesLabel(g.potm_closes_at)}
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" />
        </Link>
      ))}
    </div>
  );
}
