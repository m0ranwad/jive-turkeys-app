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
          to={`/games/${g.id}#vote`}
          className="flex min-h-[60px] items-center gap-3 rounded-2xl border border-black/5 bg-white px-3 py-2.5 transition hover:bg-zinc-50"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-lime-100 text-lime-700">
            <Trophy className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-xs font-extrabold uppercase tracking-tight text-zinc-900">
              Vote for Player of the Match
            </span>
            <span className="block text-[11px] font-semibold text-zinc-500">
              {g.score_us}–{g.score_them} {resultOf(g)} vs {g.opponent} · closes {closesLabel(g.potm_closes_at)}
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden="true" />
        </Link>
      ))}
    </div>
  );
}
