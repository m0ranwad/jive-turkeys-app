import { useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { Plus, Upload } from 'lucide-react';
import { api } from '@/api';
import { PageHeader, PageSpinner } from '@/components/PageSpinner';
import { PotmPrompt } from '@/components/PotmPrompt';
import { InstallCard, useInstall } from '@/components/InstallApp';
import { NotificationsPrompt, showInstallGuide, usePush } from '@/components/chat/Notifications';
import { SessionPrompt, SessionQuestionPanel, sessionQuestion } from '@/components/SessionPrompt';
import { GameCard, LaterGameCard, PlayedList } from '@/components/schedule/GameCard';
import { AnswerButtons, answerLabel } from '@/components/game/AnswerButtons';
import { NextGameCard } from '@/components/schedule/NextGame';
import { GameFormDialog } from '@/components/schedule/GameFormDialog';
import { ImportScheduleDialog } from '@/components/schedule/ImportScheduleDialog';
import { useToast } from '@/components/ui/toast';
import { useRsvp } from '@/hooks/useRsvp';
import { useSeasonData } from '@/hooks/useSeasonData';
import { seasonLabel, today } from '@/lib/format';
import { membersForSession } from '@/lib/roster';
import { headcount, isRosterStatus, suspendedIds } from '@/lib/team-logic';

/** Captains only: one small button for adding games, so the top of Schedule stays for everyone's next game. */
function AddGamesMenu({ onAdd, onImport }) {
  const [open, setOpen] = useState(false);
  const item = 'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-bold text-zinc-900 transition hover:bg-zinc-100';
  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-full bg-lime-400 px-3.5 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-black transition hover:bg-lime-300"
      >
        <Plus className="h-3.5 w-3.5" /> Add
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-11 z-20 w-56 rounded-2xl border border-black/5 bg-white p-1 shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
            <button type="button" className={item} onClick={() => (setOpen(false), onAdd())}>
              <Plus className="h-4 w-4" /> Add a game
            </button>
            <button type="button" className={item} onClick={() => (setOpen(false), onImport())}>
              <Upload className="h-4 w-4" /> Import the schedule
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function SchedulePage() {
  const data = useSeasonData();
  const rsvp = useRsvp(data);
  const [showPast, setShowPast] = useState(false);
  const pushStatus = usePush();
  const { offer: offerInstall } = useInstall();
  const { toast } = useToast();
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const todayIso = today();

  const sessions = useMemo(() => {
    const bySession = new Map();
    (data.games || []).forEach((g) => {
      const key = `${g.season_year}-${g.session}`;
      if (!bySession.has(key)) bySession.set(key, { year: g.season_year, session: g.session, games: [] });
      bySession.get(key).games.push(g);
    });
    return [...bySession.values()]
      .sort((a, b) => b.year - a.year || b.session - a.session)
      .map((s) => ({
        ...s,
        upcoming: s.games.filter((g) => g.date >= todayIso).sort((a, b) => (a.date < b.date ? -1 : 1)),
        past: s.games.filter((g) => g.date < todayIso).sort((a, b) => (a.date < b.date ? 1 : -1)),
      }));
  }, [data.games, todayIso]);

  const counts = useMemo(() => {
    const byGame = {};
    (data.games || []).forEach((game) => {
      // Who was on the team in the game's session.
      const profiles = membersForSession(data.players || [], data.roster?.rows, { year: game.season_year, session: game.session });
      byGame[game.id] = headcount({ game, rsvps: data.rsvps, profiles, settings: data.settings });
    });
    return byGame;
  }, [data.games, data.rsvps, data.players, data.roster, data.settings]);

  if (data.loading) return <PageSpinner />;

  // The soonest game without a result, and the session it's in (or the latest one).
  const nextGame = (data.games || [])
    .filter((g) => !g.has_result && g.date >= todayIso)
    .sort((a, b) => (a.date === b.date ? (a.time || '').localeCompare(b.time || '') : a.date < b.date ? -1 : 1))[0];
  const currentKey = nextGame ? `${nextGame.season_year}-${nextGame.session}` : sessions[0] && `${sessions[0].year}-${sessions[0].session}`;
  // The current session and the one before it stay open (last week's results, Player of the Match); older ones fold away.
  const currentIndex = Math.max(0, sessions.findIndex((s) => `${s.year}-${s.session}` === currentKey));
  const currentSessions = sessions.slice(0, currentIndex + 2);
  const pastSessions = sessions.slice(currentIndex + 2);
  const onRoster = isRosterStatus(data.profile);
  // "Playing session N?" goes inside the Next game card when that game starts the session.
  const question = sessionQuestion({ profile: data.profile, roster: data.roster, games: data.games });
  const questionInCard = !!question && question.first?.id === nextGame?.id;

  const sessionBlock = (s) => {
    // The next game is the card at the top; the list carries on from the game after it.
    const later = s.upcoming.filter((g) => g.id !== nextGame?.id);
    if (!later.length && !s.past.length) return null;
    return (
      <section key={`${s.year}-${s.session}`} className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="font-display text-lg font-extrabold uppercase tracking-[0.08em]">{seasonLabel(s.year, s.session)}</h2>
          <span className="h-px flex-1 bg-zinc-200" />
          <span className="text-[11px] font-black uppercase tracking-[0.14em] text-zinc-500">
            {s.games.length} game{s.games.length === 1 ? '' : 's'}
          </span>
        </div>
        {later.length > 0 && (
          <div className="space-y-2.5">
            {later.map((g) =>
              g.has_result ? (
                <GameCard key={g.id} game={g} headcount={counts[g.id]} settings={data.settings} />
              ) : (
                <LaterGameCard
                  key={g.id}
                  game={g}
                  headcount={counts[g.id]}
                  settings={data.settings}
                  answer={
                    onRoster && (
                      <AnswerButtons
                        compact
                        label={answerLabel(g)}
                        status={rsvp.mine(g)?.status}
                        onSet={(status) => rsvp.setStatus(g, status)}
                        busy={rsvp.isBusy(g)}
                      />
                    )
                  }
                />
              ),
            )}
          </div>
        )}
        {s.past.length > 0 && (
          <div className="space-y-2 pt-1">
            <span className="text-[11px] font-black uppercase tracking-[0.16em] text-zinc-500">Played</span>
            <PlayedList games={s.past} />
          </div>
        )}
      </section>
    );
  };

  const defaultSession = sessions[0]
    ? { year: sessions[0].year, session: sessions[0].session }
    : { year: dayjs().year(), session: 1 };

  return (
    <div className="space-y-6">
      <PageHeader title="Schedule">
        {data.isCaptain && <AddGamesMenu onAdd={() => setFormOpen(true)} onImport={() => setImportOpen(true)} />}
      </PageHeader>

      {nextGame && (
        <NextGameCard
          game={nextGame}
          headcount={counts[nextGame.id]}
          settings={data.settings}
          rsvp={rsvp.mine(nextGame)}
          onRoster={onRoster}
          suspended={suspendedIds(nextGame, data.games, data.stats).includes(data.user?.id)}
          onSet={(status) => rsvp.setStatus(nextGame, status)}
          busy={rsvp.isBusy(nextGame)}
          startsSession={questionInCard ? question.period.session : null}
          sessionPanel={
            questionInCard && (
              <SessionQuestionPanel
                profile={data.profile}
                question={question}
                gameAnswer={rsvp.mine(nextGame)?.status}
                onAnswered={data.reload}
              />
            )
          }
        />
      )}
      <PotmPrompt data={data} />
      {!questionInCard && (
        <SessionPrompt profile={data.profile} roster={data.roster} games={data.games} onAnswered={data.reload} />
      )}
      <InstallCard onShowHow={showInstallGuide} />
      {/* In the iPhone browser it would only repeat "add to Home Screen", which Get the app already asks. */}
      {!(offerInstall && pushStatus === 'needs-install') && <NotificationsPrompt state={pushStatus} variant="card" />}

      {sessions.length === 0 && (
        <div className="rounded-3xl border border-dashed border-zinc-300 bg-white p-10 text-center">
          <p className="font-display text-lg font-extrabold uppercase tracking-tight">No games yet</p>
          <p className="mx-auto mt-2 max-w-xs text-sm text-zinc-500">
            {data.isCaptain
              ? 'Add a game or import the schedule from the complex.'
              : "The captain hasn't posted the schedule yet."}
          </p>
        </div>
      )}

      {currentSessions.map(sessionBlock)}

      {/* Earlier sessions fold away, so the list doesn't keep growing season after season. */}
      {pastSessions.length > 0 && (
        <div className="space-y-6">
          <button
            type="button"
            aria-expanded={showPast}
            onClick={() => setShowPast((open) => !open)}
            className="flex w-full items-center justify-between rounded-3xl border border-dashed border-zinc-300 bg-white px-4 py-3 text-xs font-bold uppercase tracking-[0.1em] text-zinc-500 transition hover:border-zinc-900 hover:text-black"
          >
            <span>Past sessions · {pastSessions.length}</span>
            <span>{showPast ? 'Hide' : 'Show'}</span>
          </button>
          {showPast && pastSessions.map(sessionBlock)}
        </div>
      )}

      <GameFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        game={null}
        settings={data.settings}
        defaultSession={defaultSession}
        onSave={async (values) => {
          await api.entities.Game.create(values);
          await data.reload();
          toast({ title: 'Game added' });
        }}
      />
      <ImportScheduleDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        settings={data.settings}
        existingGames={data.games || []}
        onDone={async (count) => {
          await data.reload();
          toast({ title: `${count} game${count === 1 ? '' : 's'} imported` });
        }}
      />
    </div>
  );
}
