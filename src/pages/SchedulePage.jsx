import { useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { Plus, Upload } from 'lucide-react';
import { api } from '@/api';
import { PageHeader, PageSpinner } from '@/components/PageSpinner';
import { GameCard } from '@/components/schedule/GameCard';
import { GameFormDialog } from '@/components/schedule/GameFormDialog';
import { ImportScheduleDialog } from '@/components/schedule/ImportScheduleDialog';
import { useToast } from '@/components/ui/toast';
import { useSeasonData } from '@/hooks/useSeasonData';
import { seasonLabel, today } from '@/lib/format';
import { headcount } from '@/lib/team-logic';

export function SchedulePage() {
  const data = useSeasonData();
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
      byGame[game.id] = headcount({ game, rsvps: data.rsvps, profiles: data.profiles, settings: data.settings });
    });
    return byGame;
  }, [data.games, data.rsvps, data.profiles, data.settings]);

  if (data.loading) return <PageSpinner />;

  const defaultSession = sessions[0]
    ? { year: sessions[0].year, session: sessions[0].session }
    : { year: dayjs().year(), session: 1 };

  return (
    <div className="space-y-6">
      <PageHeader title="Schedule" subtitle="Tap a game to RSVP and see the headcount.">
        {data.isCaptain && (
          <div className="flex gap-2">
            <button
              onClick={() => setFormOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-lime-400 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-black transition hover:bg-lime-300"
            >
              <Plus className="h-3.5 w-3.5" /> Add game
            </button>
            <button
              onClick={() => setImportOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-950 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-white transition hover:bg-zinc-800"
            >
              <Upload className="h-3.5 w-3.5" /> Import
            </button>
          </div>
        )}
      </PageHeader>

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

      {sessions.map((s) => (
        <section key={`${s.year}-${s.session}`} className="space-y-3">
          <div className="flex items-center gap-3">
            <h2 className="font-display text-lg font-extrabold uppercase tracking-[0.08em]">{seasonLabel(s.year, s.session)}</h2>
            <span className="h-px flex-1 bg-zinc-200" />
            <span className="text-[10px] font-black uppercase tracking-[0.14em] text-zinc-400">
              {s.games.length} game{s.games.length === 1 ? '' : 's'}
            </span>
          </div>
          {s.upcoming.length > 0 && (
            <div className="space-y-2.5">
              {s.upcoming.map((g) => (
                <GameCard key={g.id} game={g} headcount={counts[g.id]} settings={data.settings} />
              ))}
            </div>
          )}
          {s.past.length > 0 && (
            <div className="space-y-2.5 pt-1">
              <span className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-400">Played</span>
              {s.past.map((g) => (
                <GameCard key={g.id} game={g} headcount={counts[g.id]} settings={data.settings} />
              ))}
            </div>
          )}
        </section>
      ))}

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
