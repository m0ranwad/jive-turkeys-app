import { useState } from 'react';
import { PageHeader, PageSpinner } from '@/components/PageSpinner';
import { SessionStepper } from '@/components/dues/DuesParts';
import { MyDues } from '@/components/dues/MyDues';
import { TeamDues } from '@/components/dues/TeamDues';
import { CARD } from '@/lib/constants';
import { currentSession, stepSession } from '@/lib/dues';
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
  const { user, isCaptain, loading: teamLoading, settings, reload: reloadTeam } = useTeam();
  const dues = useDues();
  const [picked, setPicked] = useState(null);
  const [period, setPeriod] = useState(null);

  if (teamLoading || dues.loading || !user) return <PageSpinner />;
  if (dues.failed) {
    return (
      <div className="space-y-5">
        <PageHeader title="Dues" />
        <section className={cn(CARD, 'text-center')}>
          <p className="text-sm font-medium text-zinc-500">The dues didn't load. Try again in a minute.</p>
        </section>
      </div>
    );
  }

  // Captains usually come here to collect, players to pay.
  const view = picked ?? (isCaptain ? 'team' : 'mine');
  // Opens on the session of the next game (or the latest one).
  const current = currentSession(dues.games, today());
  const shown = period ?? current;
  const isCurrent = shown.year === current.year && shown.session === current.session;
  const hasFee = dues.dues.some((d) => d.season_year === Number(shown.year) && d.session === Number(shown.session));
  const shared = { data: dues, period: shown, user, settings, onChanged: dues.reload };

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
              view === v.value ? 'bg-white text-black shadow-sm' : 'text-zinc-500 hover:text-zinc-800',
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
          isCaptain={isCaptain}
          onSettingsSaved={async () => {
            await reloadTeam();
          }}
        />
      ) : (
        <MyDues {...shared} onPickSession={setPeriod} />
      )}
    </div>
  );
}
