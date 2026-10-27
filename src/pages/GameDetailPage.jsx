import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Pencil, Target, Trash2 } from 'lucide-react';
import { api } from '@/api';
import { HeadcountPanel } from '@/components/game/HeadcountPanel';
import { PotmVoting } from '@/components/game/PotmVoting';
import { ResultCard } from '@/components/game/ResultCard';
import { ResultDialog } from '@/components/game/ResultDialog';
import { RsvpCard } from '@/components/game/RsvpCard';
import { RsvpForDialog } from '@/components/game/RsvpForDialog';
import { CallForSubsButton, CopyReminderButton } from '@/components/game/ShareButtons';
import { PageSpinner } from '@/components/PageSpinner';
import { GameFormDialog } from '@/components/schedule/GameFormDialog';
import { useToast } from '@/components/ui/toast';
import { AddToCalendar } from '@/components/game/AddToCalendar';
import { useRsvp } from '@/hooks/useRsvp';
import { useSeasonData } from '@/hooks/useSeasonData';
import { saveFailedToast } from '@/lib/errors';
import { hasKickedOff } from '@/lib/calendar';
import { fmtDateLong, fmtTime, jerseyText, seasonLabel, today } from '@/lib/format';
import { membersForSession } from '@/lib/roster';
import { headcount as computeHeadcount, isRosterStatus, playerKey, resultOf, suspendedIds } from '@/lib/team-logic';
import { cn } from '@/lib/utils';

const pill = 'inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.12em] transition';

export function GameDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const data = useSeasonData();
  const rsvp = useRsvp(data);
  const { toast } = useToast();
  const [resultOpen, setResultOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Captains: the player whose RSVP they're setting (someone who texted, or hasn't joined the site).
  const [rsvpFor, setRsvpFor] = useState(null);

  const game = (data.games || []).find((g) => g.id === id);
  // Who was on the team in the game's session, including roster names who haven't joined the site.
  const sessionProfiles = useMemo(
    () => (game ? membersForSession(data.players || [], data.roster?.rows, { year: game.season_year, session: game.session }) : []),
    [game, data.players, data.roster],
  );
  const counts = useMemo(
    () => (game ? computeHeadcount({ game, rsvps: data.rsvps, profiles: sessionProfiles, settings: data.settings }) : null),
    [game, data.rsvps, sessionProfiles, data.settings],
  );

  if (data.loading) return <PageSpinner />;

  if (!game) {
    return (
      <div className="rounded-3xl border border-black/5 bg-white p-8 text-center">
        <p className="font-display text-lg font-extrabold uppercase tracking-tight">Game not found</p>
        <Link to="/" className="mt-3 inline-block text-sm font-semibold text-lime-700">
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

  const setRsvp = (status) => rsvp.setStatus(game, status);
  const toggleGk = () => rsvp.toggleGk(game);

  // Captains set anyone's RSVP; null clears it back to no reply.
  const rsvpOf = (player) => (data.rsvps || []).find((r) => r.game_id === game.id && r.user_id === player.user_id) || null;
  const setRsvpForPlayer = (player, status) =>
    run(() => {
      const current = rsvpOf(player);
      if (!status) return current ? api.entities.Rsvp.delete(current.id) : null;
      if (current) return api.entities.Rsvp.update(current.id, { status, playing_gk: status === 'in' && !!current.playing_gk });
      return api.entities.Rsvp.create({ game_id: game.id, ...playerKey(player), status, playing_gk: false });
    });
  const toggleGkFor = (player) => {
    const current = rsvpOf(player);
    if (current) run(() => api.entities.Rsvp.update(current.id, { playing_gk: !current.playing_gk }));
  };

  const setJersey = (jersey) => jersey !== game.jersey && run(() => api.entities.Game.update(game.id, { jersey }));

  const deleteGame = async () => {
    if (!window.confirm('Delete this game and its stats?')) return;
    try {
      // RSVPs, stats and votes for the game are removed with it.
      await api.entities.Game.delete(game.id);
    } catch (err) {
      toast(saveFailedToast(err));
      return;
    }
    toast({ title: 'Game deleted' });
    navigate('/');
  };

  // All in one step (save_game_result in the database), so a dropped connection can't leave half a result.
  const saveResult = async ({ score_us, score_them, rows, fillIns }) => {
    await api.games.saveResult(game.id, {
      scoreUs: score_us,
      scoreThem: score_them,
      lines: rows.map((row) => ({
        ...playerKey(row.profile),
        played: !!row.played,
        goals: row.goals || 0,
        assists: row.assists || 0,
        blue_cards: row.blue_cards || 0,
        red_cards: row.red_cards || 0,
      })),
      // People from outside the team who played this game for us: the whole list, saved ones keep their id.
      fillIns: fillIns.map((f) => ({
        ...(f.id && { id: f.id }),
        display_name: f.display_name.trim() || null,
        gender: f.gender,
        goals: f.goals || 0,
        assists: f.assists || 0,
      })),
    });
    await data.reload();
    toast({ title: 'Result saved' });
  };

  // The result lists that session's team, plus anyone who already has a line for this game.
  const resultProfiles = [
    ...sessionProfiles,
    ...data.players.filter(
      (p) => !sessionProfiles.some((s) => s.user_id === p.user_id) && data.stats.some((s) => s.game_id === game.id && s.user_id === p.user_id),
    ),
  ];

  const statsWithNames = data.stats
    .filter((s) => s.game_id === game.id)
    .map((s) => {
      const p = data.players.find((x) => x.user_id === s.user_id);
      return { ...s, player_name: p?.display_name || 'Unknown', gender: p?.gender };
    });

  // Before kickoff the main job is getting enough players: Call for subs leads (lime when we're short), and
  // Enter result waits at the end (still there in case the game's time is wrong). Once it's started, it leads.
  const started = game.has_result || hasKickedOff(game);
  const resultButton = (
    <button
      onClick={() => setResultOpen(true)}
      className={cn(pill, started ? 'bg-lime-400 text-black hover:bg-lime-300' : 'bg-white/5 text-white hover:bg-white/10')}
    >
      <Target className="h-3.5 w-3.5" />
      {game.has_result ? 'Edit result' : 'Enter result'}
    </button>
  );
  const captainTools = (
    <div className="flex flex-wrap gap-2">
      {started && resultButton}
      {!game.has_result && (
        <CallForSubsButton
          game={game}
          settings={data.settings}
          profiles={sessionProfiles}
          rsvps={data.rsvps}
          primary={!started && !!counts?.isShort}
        />
      )}
      {!game.has_result && counts && <CopyReminderButton game={game} headcount={counts} settings={data.settings} />}
      <button onClick={() => setEditOpen(true)} className={cn(pill, 'bg-white/5 text-white hover:bg-white/10')}>
        <Pencil className="h-3.5 w-3.5" /> Edit
      </button>
      <button onClick={deleteGame} className={cn(pill, 'bg-white/5 text-white/70 hover:bg-red-500 hover:text-white')}>
        <Trash2 className="h-3.5 w-3.5" /> Delete
      </button>
      {!started && resultButton}
    </div>
  );

  return (
    <div className="space-y-4">
      <button
        onClick={() => navigate('/')}
        className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-500 transition hover:text-zinc-900"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Schedule
      </button>

      <section className="overflow-hidden rounded-3xl bg-zinc-950 text-white">
        <div className="p-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-lime-400">
            {seasonLabel(game.season_year, game.session)}
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
                    aria-pressed={game.jersey === jersey}
                    disabled={!data.isCaptain || busy}
                    onClick={() => setJersey(jersey)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] font-black uppercase tracking-[0.08em] transition',
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
              {game.date >= today() && <AddToCalendar game={game} settings={data.settings} />}
            </div>
          )}
          {game.notes && <p className="mt-3 rounded-2xl bg-white/5 px-3.5 py-2.5 text-xs text-white/70">{game.notes}</p>}
        </div>

        {data.isCaptain && game.has_result && <div className="border-t border-white/10 px-5 py-3.5">{captainTools}</div>}
      </section>

      {!game.has_result && onRoster && (
        <RsvpCard
          rsvp={myRsvp}
          onSet={setRsvp}
          onToggleGk={toggleGk}
          suspended={suspended.includes(data.user.id)}
          busy={busy || rsvp.isBusy(game)}
        />
      )}

      {/* Before a game, a captain answers for themselves first, like everyone else; their tools come next. */}
      {data.isCaptain && !game.has_result && (
        <section aria-label="Captain tools" className="rounded-3xl bg-zinc-950 px-5 py-3.5 text-white">
          {captainTools}
        </section>
      )}

      {counts && (
        <HeadcountPanel
          game={game}
          headcount={counts}
          suspendedIds={suspended}
          settings={data.settings}
          onPick={data.isCaptain && !game.has_result ? setRsvpFor : null}
        />
      )}

      {game.has_result && (
        <>
          <ResultCard game={game} stats={statsWithNames} fillIns={data.fillIns} />
          <PotmVoting
            game={game}
            profiles={data.players}
            stats={data.stats}
            votes={data.votes}
            user={data.user}
            settings={data.settings}
            onChanged={data.reload}
          />
        </>
      )}

      <RsvpForDialog
        player={rsvpFor}
        rsvp={rsvpFor ? rsvpOf(rsvpFor) : null}
        busy={busy}
        onSet={(status) => setRsvpForPlayer(rsvpFor, status)}
        onToggleGk={() => toggleGkFor(rsvpFor)}
        onClose={() => setRsvpFor(null)}
      />
      <ResultDialog
        open={resultOpen}
        onOpenChange={setResultOpen}
        game={game}
        profiles={resultProfiles}
        rsvps={data.rsvps}
        stats={data.stats}
        fillIns={data.fillIns}
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
