import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Pencil, Target, Trash2 } from 'lucide-react';
import { api } from '@/api';
import { HeadcountPanel } from '@/components/game/HeadcountPanel';
import { PotmVoting } from '@/components/game/PotmVoting';
import { ResultCard } from '@/components/game/ResultCard';
import { ResultDialog } from '@/components/game/ResultDialog';
import { RsvpCard } from '@/components/game/RsvpCard';
import { CallForSubsButton, CopyReminderButton } from '@/components/game/ShareButtons';
import { PageSpinner } from '@/components/PageSpinner';
import { GameFormDialog } from '@/components/schedule/GameFormDialog';
import { useToast } from '@/components/ui/toast';
import { useSeasonData } from '@/hooks/useSeasonData';
import { fmtDateLong, fmtTime, jerseyText } from '@/lib/format';
import { headcount as computeHeadcount, isRosterStatus, resultOf, suspendedIds } from '@/lib/team-logic';
import { cn } from '@/lib/utils';

const pill = 'inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.12em] transition';

export function GameDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const data = useSeasonData();
  const { toast } = useToast();
  const [resultOpen, setResultOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const game = (data.games || []).find((g) => g.id === id);
  const counts = useMemo(
    () => (game ? computeHeadcount({ game, rsvps: data.rsvps, profiles: data.profiles, settings: data.settings }) : null),
    [game, data.rsvps, data.profiles, data.settings],
  );

  if (data.loading) return <PageSpinner />;

  if (!game) {
    return (
      <div className="rounded-3xl border border-black/5 bg-white p-8 text-center">
        <p className="font-display text-lg font-extrabold uppercase tracking-tight">Game not found</p>
        <Link to="/" className="mt-3 inline-block text-sm font-semibold text-lime-600">
          Back to schedule
        </Link>
      </div>
    );
  }

  const suspended = suspendedIds(game, data.games, data.stats);
  const myRsvp = (data.rsvps || []).find((r) => r.game_id === game.id && r.user_id === data.user.id);
  const onRoster = isRosterStatus(data.profile);
  const result = game.has_result ? resultOf(game) : null;

  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
      await data.reload();
    } catch (err) {
      toast({ title: "That didn't save", description: err.message });
    } finally {
      setBusy(false);
    }
  };

  const setRsvp = (status) =>
    run(() =>
      myRsvp
        ? api.entities.Rsvp.update(myRsvp.id, { status, playing_gk: status === 'in' && !!myRsvp.playing_gk })
        : api.entities.Rsvp.create({ game_id: game.id, user_id: data.user.id, status, playing_gk: false }),
    );

  const toggleGk = () => myRsvp && run(() => api.entities.Rsvp.update(myRsvp.id, { playing_gk: !myRsvp.playing_gk }));

  const setJersey = (jersey) => jersey !== game.jersey && run(() => api.entities.Game.update(game.id, { jersey }));

  const deleteGame = async () => {
    if (!window.confirm('Delete this game and its stats?')) return;
    // RSVPs, stats and votes for the game are removed with it.
    await api.entities.Game.delete(game.id);
    toast({ title: 'Game deleted' });
    navigate('/');
  };

  const saveResult = async ({ score_us, score_them, rows }) => {
    await api.entities.Game.update(game.id, { score_us, score_them, has_result: true });
    const existing = data.stats.filter((s) => s.game_id === game.id);
    const updates = [];
    const creates = [];
    const removals = [];
    rows.forEach((row) => {
      const current = existing.find((s) => s.user_id === row.profile.user_id);
      const line = {
        game_id: game.id,
        user_id: row.profile.user_id,
        played: !!row.played,
        goals: row.goals || 0,
        assists: row.assists || 0,
        blue_cards: row.blue_cards || 0,
        red_cards: row.red_cards || 0,
      };
      const hasNumbers = line.goals + line.assists + line.blue_cards + line.red_cards > 0;
      if (line.played || hasNumbers) {
        if (current) updates.push({ id: current.id, ...line });
        else creates.push(line);
      } else if (current) {
        removals.push(current.id);
      }
    });
    if (updates.length) await api.entities.GameStat.bulkUpdate(updates);
    if (creates.length) await api.entities.GameStat.bulkCreate(creates);
    for (const statId of removals) await api.entities.GameStat.delete(statId);
    await data.reload();
    toast({ title: 'Result saved' });
  };

  const statsWithNames = data.stats
    .filter((s) => s.game_id === game.id)
    .map((s) => {
      const p = data.profiles.find((x) => x.user_id === s.user_id);
      return { ...s, player_name: p?.display_name || 'Unknown', gender: p?.gender };
    });

  return (
    <div className="space-y-4">
      <button
        onClick={() => navigate('/')}
        className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-400 transition hover:text-zinc-900"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Schedule
      </button>

      <section className="overflow-hidden rounded-3xl bg-zinc-950 text-white">
        <div className="p-5">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-lime-400">
            {game.season_year} · Session {game.session}
          </div>
          <h1 className="mt-1.5 font-display text-3xl font-extrabold uppercase leading-none tracking-tight">vs {game.opponent}</h1>
          <p className="mt-2 text-sm font-medium text-white/60">
            {fmtDateLong(game.date)} · {fmtTime(game.time)} · Field {game.field_number || 'TBD'}
          </p>
          {game.has_result && (
            <div className="mt-4 flex items-baseline gap-3">
              <span className="font-display text-4xl font-extrabold leading-none">{game.score_us ?? 0}</span>
              <span className="text-white/30">–</span>
              <span className="font-display text-4xl font-extrabold leading-none text-white/40">{game.score_them ?? 0}</span>
              <span
                className={cn(
                  'ml-1 grid h-8 w-8 place-items-center rounded-xl font-display text-xs font-black',
                  result === 'W' && 'bg-lime-400 text-black',
                  result === 'L' && 'bg-white/10 text-white',
                  result === 'D' && 'bg-white/10 text-white/60',
                )}
              >
                {result}
              </span>
            </div>
          )}
          {!game.has_result && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-full bg-white/5 p-1">
                {['primary', 'backup'].map((jersey) => (
                  <button
                    key={jersey}
                    disabled={!data.isCaptain || busy}
                    onClick={() => setJersey(jersey)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[10px] font-black uppercase tracking-[0.08em] transition',
                      game.jersey === jersey ? 'bg-white text-black' : 'text-white/50',
                      !data.isCaptain && 'opacity-70',
                    )}
                  >
                    <span
                      className={cn(
                        'h-2.5 w-2.5 rounded-full',
                        jersey === 'backup' ? 'bg-zinc-900 ring-1 ring-white/30' : 'bg-lime-400',
                      )}
                    />
                    {jerseyText(jersey, data.settings)}
                  </button>
                ))}
              </div>
            </div>
          )}
          {game.notes && <p className="mt-3 rounded-2xl bg-white/5 px-3.5 py-2.5 text-xs text-white/70">{game.notes}</p>}
        </div>

        {data.isCaptain && (
          <div className="flex flex-wrap gap-2 border-t border-white/10 px-5 py-3.5">
            <button onClick={() => setResultOpen(true)} className={cn(pill, 'bg-lime-400 text-black hover:bg-lime-300')}>
              <Target className="h-3.5 w-3.5" />
              {game.has_result ? 'Edit result' : 'Enter result'}
            </button>
            {!game.has_result && counts && <CopyReminderButton game={game} headcount={counts} settings={data.settings} />}
            {!game.has_result && (
              <CallForSubsButton game={game} settings={data.settings} profiles={data.profiles} rsvps={data.rsvps} />
            )}
            <button onClick={() => setEditOpen(true)} className={cn(pill, 'bg-white/5 text-white hover:bg-white/10')}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </button>
            <button onClick={deleteGame} className={cn(pill, 'bg-white/5 text-white/70 hover:bg-red-500 hover:text-white')}>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          </div>
        )}
      </section>

      {!game.has_result && onRoster && (
        <RsvpCard
          rsvp={myRsvp}
          onSet={setRsvp}
          onToggleGk={toggleGk}
          suspended={suspended.includes(data.user.id)}
          busy={busy}
        />
      )}

      {counts && <HeadcountPanel game={game} headcount={counts} suspendedIds={suspended} settings={data.settings} />}

      {game.has_result && (
        <>
          <ResultCard game={game} stats={statsWithNames} />
          <PotmVoting
            game={game}
            profiles={data.profiles}
            stats={data.stats}
            votes={data.votes}
            user={data.user}
            settings={data.settings}
            onChanged={data.reload}
          />
        </>
      )}

      <ResultDialog
        open={resultOpen}
        onOpenChange={setResultOpen}
        game={game}
        profiles={data.profiles}
        rsvps={data.rsvps}
        stats={data.stats}
        onSave={saveResult}
      />
      <GameFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        game={game}
        settings={data.settings}
        onSave={async (values) => {
          await api.entities.Game.update(game.id, values);
          await data.reload();
          toast({ title: 'Game updated' });
        }}
      />
    </div>
  );
}
