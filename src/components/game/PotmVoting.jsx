import { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import { api } from '@/api';
import { useToast } from '@/components/ui/toast';
import { AWARD_LABEL, CARD } from '@/lib/constants';
import { fmtDateShort } from '@/lib/format';
import { closesLabel, potmAwards, votingOpen } from '@/lib/potm';
import { playerKey } from '@/lib/team-logic';
import { cn } from '@/lib/utils';

/**
 * Player of the Match: anyone who played can vote for a teammate who played,
 * including one who hasn't joined the site (they can't vote themselves), until
 * voting closes (a set time after the result is posted; lib/potm.js).
 * `profiles` includes roster names and `votes` are keyed with keyedVote().
 */
export function PotmVoting({ game, profiles, stats, votes, user, settings, onChanged }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(null);
  // Redraws when voting closes, so the vote buttons go away without a reload.
  const [, setTick] = useState(0);
  useEffect(() => {
    const left = game.potm_closes_at ? new Date(game.potm_closes_at).getTime() - Date.now() : -1;
    if (left < 0 || left > 2 ** 31 - 1) return undefined;
    const timer = setTimeout(() => setTick((n) => n + 1), left + 500);
    return () => clearTimeout(timer);
  }, [game.potm_closes_at]);

  if (!game.has_result) return null;

  const awards = potmAwards(settings);
  const open = votingOpen(game);
  const playedIds = stats.filter((s) => s.game_id === game.id && s.played).map((s) => s.user_id);
  const played = profiles.filter((p) => playedIds.includes(p.user_id));
  const canVote = open && playedIds.includes(user.id);
  const nameOf = (userId) => profiles.find((p) => p.user_id === userId)?.display_name || 'Unknown';

  const tally = (award) => {
    const counts = {};
    votes
      .filter((v) => v.game_id === game.id && v.award === award)
      .forEach((v) => (counts[v.voted_for_id] = (counts[v.voted_for_id] || 0) + 1));
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  };
  const myVote = (award) => votes.find((v) => v.game_id === game.id && v.voter_id === user.id && v.award === award);

  const castVote = async (award, player) => {
    if (!votingOpen(game)) {
      toast({ title: 'Voting has closed', description: `It closed ${closesLabel(game.potm_closes_at)}.` });
      setChanging(null);
      return;
    }
    setBusy(true);
    try {
      const existing = myVote(award);
      const { user_id, guest_id } = playerKey(player);
      const choice = { voted_for_id: user_id, voted_for_guest_id: guest_id };
      if (existing) await api.entities.PotmVote.update(existing.id, choice);
      else await api.entities.PotmVote.create({ game_id: game.id, voter_id: user.id, award, ...choice });
      setChanging(null);
      toast({ title: 'Vote counted' });
      onChanged();
    } catch (err) {
      // The deadline passed between loading the page and tapping (the database refuses it).
      const closed = !votingOpen(game) || /row-level security|Voting has closed/i.test(err.message);
      toast(
        closed
          ? { title: 'Voting has closed', description: 'Votes are locked for this game.' }
          : { title: "Vote didn't go through", description: err.message },
      );
      if (closed) onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    // #vote: where Vote on Schedule lands, clear of the sticky header.
    <section id="vote" className={cn(CARD, 'scroll-mt-24')}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="font-display text-sm font-extrabold uppercase tracking-[0.12em]">Player of the Match</h3>
        {game.potm_closes_at && (
          <span
            data-testid="potm-deadline"
            className={cn(
              'text-[11px] font-black uppercase tracking-[0.1em]',
              open ? 'text-lime-700' : 'text-zinc-500',
            )}
          >
            {open ? `Voting open until ${closesLabel(game.potm_closes_at)}` : 'Voting closed'}
          </span>
        )}
      </div>
      <p data-testid="potm-game" className="mt-1 break-words text-xs font-semibold text-zinc-600">
        vs {game.opponent}{game.date && <> · {fmtDateShort(game.date)}</>}
      </p>
      {open && !canVote && <p className="mt-1 text-xs font-medium text-zinc-500">Only players from this game vote.</p>}
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
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <span className="text-[11px] font-black uppercase tracking-[0.14em] text-zinc-500">{AWARD_LABEL[award]}</span>
                {mine && !voting && canVote && (
                  <button
                    onClick={() => setChanging(award)}
                    className="min-h-11 px-2 text-[11px] font-black uppercase tracking-[0.12em] text-zinc-500 transition hover:text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
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
                      <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-zinc-500">
                        {count} vote{count === 1 ? '' : 's'}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {leaders.length === 0 && !voting && (
                <p className="mt-2 text-xs font-medium text-zinc-500">
                  {played.length ? 'No votes yet.' : 'No votes — no stats recorded for this game.'}
                </p>
              )}

              {voting && (
                <div className="mt-2">
                  {eligible.length === 0 ? (
                    <p className="text-xs font-medium text-zinc-500">No eligible teammates.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {eligible.map((p) => (
                        <button
                          key={p.user_id}
                          aria-pressed={mine?.voted_for_id === p.user_id}
                          disabled={busy}
                          onClick={() => castVote(award, p)}
                          className={cn(
                            'min-h-11 min-w-11 max-w-full break-words rounded-full border-2 px-3 py-2 text-xs font-bold transition disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
                            mine?.voted_for_id === p.user_id
                              ? 'border-black bg-lime-400 text-black'
                              : p.guest
                                ? 'border-dashed border-zinc-300 bg-zinc-50 text-zinc-500 hover:border-zinc-400'
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
                      className="mt-2 min-h-11 min-w-11 px-2 text-[11px] font-black uppercase tracking-[0.12em] text-zinc-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              )}

            </div>
          );
        })}
      </div>
    </section>
  );
}
