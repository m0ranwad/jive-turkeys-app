import { useState } from 'react';
import { Trophy } from 'lucide-react';
import { api } from '@/api';
import { useToast } from '@/components/ui/toast';
import { AWARD_LABEL, CARD } from '@/lib/constants';
import { cn } from '@/lib/utils';

/** Player of the Match: anyone who played can vote for a teammate who played. */
export function PotmVoting({ game, profiles, stats, votes, user, settings, onChanged }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(null);

  if (!game.has_result) return null;

  const awards = settings?.potm_mode === 'overall' ? ['overall'] : ['man', 'woman'];
  const playedIds = stats.filter((s) => s.game_id === game.id && s.played).map((s) => s.user_id);
  const played = profiles.filter((p) => playedIds.includes(p.user_id));
  const canVote = playedIds.includes(user.id);
  const nameOf = (userId) => profiles.find((p) => p.user_id === userId)?.display_name || 'Unknown';

  const tally = (award) => {
    const counts = {};
    votes
      .filter((v) => v.game_id === game.id && v.award === award)
      .forEach((v) => (counts[v.voted_for_id] = (counts[v.voted_for_id] || 0) + 1));
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  };
  const myVote = (award) => votes.find((v) => v.game_id === game.id && v.voter_id === user.id && v.award === award);

  const castVote = async (award, votedForId) => {
    setBusy(true);
    try {
      const existing = myVote(award);
      if (existing) await api.entities.PotmVote.update(existing.id, { voted_for_id: votedForId });
      else await api.entities.PotmVote.create({ game_id: game.id, voter_id: user.id, award, voted_for_id: votedForId });
      setChanging(null);
      toast({ title: 'Vote counted' });
      onChanged();
    } catch (err) {
      toast({ title: "Vote didn't go through", description: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={CARD}>
      <h3 className="font-display text-sm font-extrabold uppercase tracking-[0.12em]">Player of the Match</h3>
      <div className="mt-3 space-y-4">
        {awards.map((award) => {
          const ranked = tally(award);
          const leaders = ranked.length ? ranked.filter(([, n]) => n === ranked[0][1]) : [];
          const mine = myVote(award);
          const eligible = played.filter(
            (p) =>
              p.user_id !== user.id &&
              (award === 'overall' || (award === 'man' && p.gender === 'M') || (award === 'woman' && p.gender === 'F')),
          );
          const voting = canVote && (!mine || changing === award);

          return (
            <div key={award} className="rounded-2xl bg-zinc-50 p-3.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-[0.14em] text-zinc-400">{AWARD_LABEL[award]}</span>
                {mine && !voting && (
                  <button
                    onClick={() => setChanging(award)}
                    className="text-[10px] font-black uppercase tracking-[0.12em] text-zinc-400 transition hover:text-zinc-900"
                  >
                    Change vote
                  </button>
                )}
              </div>

              {leaders.length > 0 && !voting && (
                <div className="mt-2 space-y-1.5">
                  {leaders.map(([userId, count]) => (
                    <div key={userId} className="flex items-center gap-2">
                      <span className="grid h-7 w-7 place-items-center rounded-full bg-lime-400 text-black">
                        <Trophy className="h-3.5 w-3.5" />
                      </span>
                      <span className="font-display text-sm font-extrabold uppercase tracking-tight">{nameOf(userId)}</span>
                      <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-zinc-400">
                        {count} vote{count === 1 ? '' : 's'}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {leaders.length === 0 && !voting && (
                <p className="mt-2 text-xs font-medium text-zinc-400">
                  {played.length ? 'No votes yet.' : 'No votes — no stats recorded for this game.'}
                </p>
              )}

              {voting && (
                <div className="mt-2">
                  {eligible.length === 0 ? (
                    <p className="text-xs font-medium text-zinc-400">No eligible teammates.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {eligible.map((p) => (
                        <button
                          key={p.user_id}
                          disabled={busy}
                          onClick={() => castVote(award, p.user_id)}
                          className={cn(
                            'rounded-full border-2 px-3 py-1.5 text-xs font-bold transition disabled:opacity-50',
                            mine?.voted_for_id === p.user_id
                              ? 'border-black bg-lime-400 text-black'
                              : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400',
                          )}
                        >
                          {p.display_name}
                        </button>
                      ))}
                    </div>
                  )}
                  {mine && (
                    <button
                      onClick={() => setChanging(null)}
                      className="mt-2 text-[10px] font-black uppercase tracking-[0.12em] text-zinc-400"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              )}

              {!canVote && leaders.length > 0 && (
                <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-400">
                  Voting is open to players who played this game
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
