import { Link } from 'react-router';
import { Trophy } from 'lucide-react';
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
          className="flex items-center gap-3 rounded-3xl border-2 border-lime-400 bg-lime-50 p-4 transition hover:bg-lime-100"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-lime-400 text-black">
            <Trophy className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-sm font-extrabold uppercase tracking-tight text-lime-950">
              Vote for Player of the Match
            </span>
            <span className="block text-xs font-semibold text-lime-900">
              {g.score_us}–{g.score_them} {resultOf(g)} vs {g.opponent} · Voting closes {closesLabel(g.potm_closes_at)}
            </span>
          </span>
          <span className="shrink-0 rounded-full bg-zinc-950 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-white">
            Vote
          </span>
        </Link>
      ))}
    </div>
  );
}
