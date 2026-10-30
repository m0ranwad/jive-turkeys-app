import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { ArrowLeft, ChevronDown, Clock, MapPin, MoreHorizontal, Navigation, Pencil, Shirt, Target, Trash2 } from 'lucide-react';
import { api } from '@/api';
import { HeadcountPanel } from '@/components/game/HeadcountPanel';
import { PotmVoting } from '@/components/game/PotmVoting';
import { ResultCard } from '@/components/game/ResultCard';
import { ResultDialog } from '@/components/game/ResultDialog';
import { RsvpCard } from '@/components/game/RsvpCard';
import { RsvpForDialog } from '@/components/game/RsvpForDialog';
import { CallForSubsButton, RemindTeamButton } from '@/components/game/ShareButtons';
import { PageSpinner } from '@/components/PageSpinner';
import { GameFormDialog } from '@/components/schedule/GameFormDialog';
import { useToast } from '@/components/ui/toast';
import { AddToCalendar } from '@/components/game/AddToCalendar';
import { useRsvp } from '@/hooks/useRsvp';
import { useSeasonData } from '@/hooks/useSeasonData';
import { saveFailedToast } from '@/lib/errors';
import { hasKickedOff, kickoff } from '@/lib/calendar';
import { fmtDateLong, fmtTime, jerseyText, mapsUrl, seasonLabel, today } from '@/lib/format';
import { membersForSession } from '@/lib/roster';
import { headcount as computeHeadcount, isRosterStatus, playerKey, resultOf, suspendedIds } from '@/lib/team-logic';
import { cn } from '@/lib/utils';

const pill = 'inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-[13px] font-bold transition';
const ghost = 'bg-white/10 text-white hover:bg-white/20';
const detail = 'flex items-center gap-2.5 text-sm font-semibold text-white/80';
const icon = 'h-[18px] w-[18px] shrink-0 text-lime-400';

export function GameDetailPage() {
  const { id } = useParams();
  const { hash } = useLocation();
  const navigate = useNavigate();
  const data = useSeasonData();
  const rsvp = useRsvp(data);
  const { toast } = useToast();
  const [resultOpen, setResultOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
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

  // Captain tools reorder at kickoff (below), so a page left open re-renders then. Long waits go in steps,
  // because a browser timer can't wait more than about 24 days.
  const [now, setNow] = useState(() => Date.now());
  const kickoffAt = game && !game.has_result ? kickoff(game).valueOf() : null;
  useEffect(() => {
    const wait = kickoffAt - Date.now();
    if (kickoffAt == null || !(wait > 0)) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(wait, 2 ** 31 - 1));
    return () => clearTimeout(timer);
  }, [kickoffAt, now]);

  // Vote on Schedule opens the game at its vote (#vote).
  const votingShown = !!game?.has_result;
  useEffect(() => {
    if (hash !== '#vote' || !votingShown) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    document.getElementById('vote')?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  }, [hash, votingShown]);

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
  // Enter result waits under More (still there in case the game's time is wrong). Once it's started, it leads.
  // Edit and Delete live under More, so Delete never sits next to an everyday button.
  const started = game.has_result || hasKickedOff(game);
  const resultButton = (
    <button
      onClick={() => setResultOpen(true)}
      className={cn(pill, started ? 'bg-lime-400 text-black hover:bg-lime-300' : ghost)}
    >
      <Target className="h-4 w-4" />
      {game.has_result ? 'Edit result' : 'Enter result'}
    </button>
  );
  const captainTools = (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {started && resultButton}
        {!game.has_result && (
          <CallForSubsButton
            game={game}
            headcount={counts}
            settings={data.settings}
            profiles={sessionProfiles}
            rsvps={data.rsvps}
            primary={!started && counts.isShort}
          />
        )}
        {!game.has_result && <RemindTeamButton game={game} headcount={counts} settings={data.settings} />}
        <button
          aria-label="More"
          aria-expanded={moreOpen}
          aria-controls="game-more"
          onClick={() => setMoreOpen((open) => !open)}
          className={cn(pill, ghost, 'w-11 justify-center px-0', moreOpen && 'bg-white/20')}
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>
      </div>
      {moreOpen && (
        <div id="game-more" className="flex flex-wrap gap-2">
          {!started && resultButton}
          <button onClick={() => setEditOpen(true)} className={cn(pill, ghost)}>
            <Pencil className="h-4 w-4" /> Edit game
          </button>
          <button onClick={deleteGame} className={cn(pill, 'bg-white/10 text-white/80 hover:bg-red-600 hover:text-white')}>
            <Trash2 className="h-4 w-4" /> Delete game
          </button>
        </div>
      )}
    </div>
  );
  const otherJersey = game.jersey === 'backup' ? 'primary' : 'backup';

  return (
    <div className="space-y-4">
      <button
        onClick={() => navigate('/')}
        className="inline-flex min-h-8 items-center gap-1.5 text-[13px] font-semibold text-zinc-600 transition hover:text-zinc-900"
      >
        <ArrowLeft className="h-4 w-4" /> Schedule
      </button>

      <section className="overflow-hidden rounded-3xl bg-zinc-950 text-white">
        <div className="p-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-lime-400">
            {seasonLabel(game.season_year, game.session)}
          </div>
          <h1 className="mt-1.5 font-display text-3xl font-extrabold uppercase leading-none tracking-tight">vs {game.opponent}</h1>
          {/* Everyone knows the venue: the field number is enough, and Directions opens the address. */}
          <ul className="mt-4 space-y-2.5">
            <li className={cn(detail, 'text-[15px] font-bold text-white')}>
              <Clock className={icon} aria-hidden="true" />
              {fmtDateLong(game.date)} · {fmtTime(game.time)}
            </li>
            <li className={detail}>
              <MapPin className={icon} aria-hidden="true" />
              Field {game.field_number || 'TBD'}
            </li>
            {!game.has_result && (
              <li className={detail}>
                <Shirt className={icon} aria-hidden="true" />
                {jerseyText(game.jersey, data.settings)} jersey
                {data.isCaptain && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setJersey(otherJersey)}
                    aria-label={`Change to the ${jerseyText(otherJersey, data.settings)} jersey`}
                    className="ml-auto min-h-8 text-[13px] font-semibold text-white/60 underline underline-offset-2 hover:text-white"
                  >
                    Change
                  </button>
                )}
              </li>
            )}
          </ul>
          {!game.has_result && (game.location || game.date >= today()) && (
            <div className="mt-4 flex flex-wrap gap-2">
              {game.location && (
                <a href={mapsUrl(game.location)} target="_blank" rel="noreferrer" className={cn(pill, ghost, 'font-semibold')}>
                  <Navigation className="h-4 w-4" aria-hidden="true" /> Directions
                </a>
              )}
              {game.date >= today() && (
                <AddToCalendar game={game} settings={data.settings} className={cn(pill, ghost, 'font-semibold normal-case tracking-normal')} />
              )}
            </div>
          )}
          {game.has_result && (
            <div className="mt-4 flex items-baseline gap-3" data-testid="final-score">
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
          {game.notes && <p className="mt-3 rounded-2xl bg-white/5 px-3.5 py-2.5 text-xs text-white/70">{game.notes}</p>}

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
          {data.isCaptain && (
            <section aria-label="Captain tools" className="mt-4 border-t border-white/10 pt-4">
              {captainTools}
            </section>
          )}
        </div>
      </section>

      {/* A played game leads with what happened: the score, then the vote, then who said they were in, folded. */}
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

      {counts && !game.has_result && (
        <HeadcountPanel
          game={game}
          headcount={counts}
          suspendedIds={suspended}
          me={data.user.id}
          onPick={data.isCaptain ? setRsvpFor : null}
        />
      )}
      {counts && game.has_result && (
        <details className="group rounded-3xl border border-black/5 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
            <span className="font-display text-sm font-extrabold uppercase tracking-[0.12em]">Who said they were in</span>
            <span className="flex items-center gap-2 text-xs font-semibold text-zinc-500">
              {counts.totalIn} in
              <ChevronDown className="h-4 w-4 transition group-open:rotate-180 motion-reduce:transition-none" />
            </span>
          </summary>
          <div className="-mt-2">
            <HeadcountPanel game={game} headcount={counts} suspendedIds={suspended} me={data.user.id} bare />
          </div>
        </details>
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
