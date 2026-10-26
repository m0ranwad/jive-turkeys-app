import { useState } from 'react';
import { PageHeader, PageSpinner } from '@/components/PageSpinner';
import { SessionStepper } from '@/components/dues/DuesParts';
import { MyDues } from '@/components/dues/MyDues';
import { TeamDues } from '@/components/dues/TeamDues';
import { Button } from '@/components/ui/button';
import { CARD } from '@/lib/constants';
import { currentSession, openSession, stepSession } from '@/lib/dues';
import { today } from '@/lib/format';
import { useDues } from '@/hooks/useDues';
import { useTeam } from '@/hooks/useTeam';
import { cn } from '@/lib/utils';

const VIEWS = [
  { value: 'mine', label: 'My dues' },
  { value: 'team', label: 'Team dues' },
];

/** What you owe and how to pay, and the whole team's dues. Anyone can mark players paid; captains set the fee. */
export function DuesPage() {
  const { user, isCaptain, loading: teamLoading, settings, roster, reload: reloadTeam } = useTeam();
  const dues = useDues();
  const [picked, setPicked] = useState(null);
  const [period, setPeriod] = useState(null);
  const [retrying, setRetrying] = useState(false);

  if (teamLoading || dues.loading || !user) return <PageSpinner />;
  if (dues.failed) {
    // Nothing to pay or mark from until everything loads: a share worked out from part of it could be wrong.
    const retry = async () => {
      setRetrying(true);
      await dues.reload();
      setRetrying(false);
    };
    return (
      <div className="space-y-5">
        <PageHeader title="Dues" />
        <section className={cn(CARD, 'text-center')} data-testid="dues-failed">
          <p className="text-sm font-medium text-zinc-500">The dues didn't load. Check your signal and try again.</p>
          <Button
            onClick={retry}
            disabled={retrying}
            className="mt-4 h-11 rounded-xl bg-lime-400 px-6 font-bold text-black hover:bg-lime-300"
          >
            {retrying ? 'Trying again…' : 'Try again'}
          </Button>
        </section>
      </div>
    );
  }

  // Captains usually come here to collect, players to pay.
  const view = picked ?? (isCaptain ? 'team' : 'mine');
  // Opens on the current session: the next game's, a session asked about between sessions, or the latest one.
  const current = currentSession(dues.games, today(), roster?.asks);
  // Its games are all played and nothing else is on the schedule: it keeps its list, and captains correct it.
  const over = !openSession(dues.games, today(), roster?.asks);
  const shown = period ?? current;
  const isCurrent = shown.year === current.year && shown.session === current.session;
  const hasFee = dues.dues.some((d) => d.season_year === Number(shown.year) && d.session === Number(shown.session));
  const shared = { data: dues, period: shown, current, user, settings, onChanged: dues.reload };

  return (
    <div className="space-y-4">
      <PageHeader title="Dues" />
      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-zinc-200/60 p-1" role="tablist">
        {VIEWS.map((v) => (
          <button
            key={v.value}
            type="button"
            role="tab"
            aria-selected={view === v.value}
            onClick={() => setPicked(v.value)}
            className={cn(
              'rounded-xl py-2.5 text-xs font-bold uppercase tracking-[0.08em] transition',
              view === v.value ? 'bg-white text-black shadow-sm' : 'text-zinc-600 hover:text-zinc-800',
            )}
          >
            {v.label}
          </button>
        ))}
      </div>
      <SessionStepper
        period={shown}
        note={isCurrent ? 'This session' : hasFee ? null : 'No fee set'}
        onStep={(delta) => setPeriod(stepSession(shown, delta))}
      />
      {view === 'team' ? (
        <TeamDues
          {...shared}
          over={over}
          isCaptain={isCaptain}
          onSettingsSaved={async () => {
            await reloadTeam();
          }}
        />
      ) : (
        <MyDues {...shared} onPickSession={setPeriod} onShowTeam={() => setPicked('team')} />
      )}
    </div>
  );
}
